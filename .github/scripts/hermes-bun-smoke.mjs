import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Exercise the packaged MCP entrypoint, not workspace source or Node.
const runtime = path.resolve(process.argv[2] ?? "dist/hermes-runtime");
const requireFromRuntime = createRequire(path.join(runtime, "package.json"));
const { Client } = await import(pathToFileURL(requireFromRuntime.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
const { StdioClientTransport } = await import(pathToFileURL(requireFromRuntime.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
const tmp = await mkdtemp(path.join(os.tmpdir(), "samchon-bun-smoke-"));
try {
  for (const [language, name, source] of [
    ["typescript", "example.ts", "export function greet(name: string): string { return `hi ${name}`; }\n"],
    ["python", "example.py", 'def greet(name: str) -> str:\n    return f"hi {name}"\n'],
  ]) {
    const project = path.join(tmp, language);
    await mkdir(project);
    await writeFile(path.join(project, name), source);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(runtime, "lib/bin.js"), "--cwd", project, "--mode", "static", "--language", language],
      stderr: "pipe",
    });
    const client = new Client({ name: "hermes-bun-artifact-smoke", version: "1.0.0" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert(tools.tools.some((tool) => tool.name === "inspect_code_graph"), "MCP tool absent");
      const result = await client.callTool({
        name: "inspect_code_graph",
        arguments: {
          question: `What is the public surface of this ${language} project?`,
          draft: { reason: "Need indexed symbols", type: "overview" },
          review: "Project overview is sufficient",
          request: { type: "overview", aspect: "all" },
        },
      });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const output = result.structuredContent;
      assert.equal(output?.result?.type, "overview", JSON.stringify(result));
      assert(output.result.counts.files >= 1, `${language} has no indexed files`);
      assert(output.result.counts.nodes >= 2, `${language} has no indexed declarations`);
      console.log(`${language}: MCP handshake + indexed overview OK`);
    } finally {
      await client.close();
    }
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}
