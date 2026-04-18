import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../bin/pi-mcp-export.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/minimal-ext", import.meta.url));
const OTHER_FIXTURE = fileURLToPath(new URL("../fixtures/other-ext", import.meta.url));

async function connectCli(
  extensionArgs: string[] = ["--extension", FIXTURE],
): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [CLI, "serve", ...extensionArgs],
  });
  const client = new Client({ name: "e2e-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

describe("pi-mcp-export serve (stdio e2e)", () => {
  it("exposes the fixture's greet tool over stdio", async () => {
    const { client, close } = await connectCli();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["greet"]);

      const result = await client.callTool({
        name: "greet",
        arguments: { name: "world" },
      });
      expect(result).toMatchObject({
        content: [{ type: "text", text: "hello, world" }],
      });
    } finally {
      await close();
    }
  }, 15000);

  it("registers tools from every repeated --extension flag", async () => {
    const { client, close } = await connectCli([
      "--extension",
      FIXTURE,
      "--extension",
      OTHER_FIXTURE,
    ]);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["farewell", "greet"]);
    } finally {
      await close();
    }
  }, 15000);

  it("exits with an error when --extension is omitted", async () => {
    const { spawn } = await import("node:child_process");
    const child = spawn("node", [CLI, "serve"], { stdio: "pipe" });
    const stderr = await new Promise<string>((resolveP) => {
      let buf = "";
      child.stderr.on("data", (c: Buffer) => (buf += c.toString()));
      child.on("close", () => resolveP(buf));
    });
    expect(stderr).toMatch(/extension/i);
  }, 10000);
});
