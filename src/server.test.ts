import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { createServer } from "./server.ts";
import type { ToolDef } from "@/types/tool-def.ts";

async function connectedPair(
  registry: ToolRegistry,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(registry);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function greetTool(): ToolDef {
  return {
    name: "greet",
    description: "Greets the given name",
    parameters: Type.Object({ name: Type.String() }),
    async execute(params) {
      const { name } = params as { name: string };
      return { content: [{ type: "text", text: `hello, ${name}` }] };
    },
  };
}

describe("createServer", () => {
  it("lists registered tools via the MCP tools/list request", async () => {
    const registry = new ToolRegistry();
    registry.register(greetTool());
    const { client, close } = await connectedPair(registry);

    try {
      const { tools } = await client.listTools();
      expect(tools).toEqual([
        {
          name: "greet",
          description: "Greets the given name",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      ]);
    } finally {
      await close();
    }
  });

  it("dispatches a tools/call request through the registry", async () => {
    const registry = new ToolRegistry();
    registry.register(greetTool());
    const { client, close } = await connectedPair(registry);

    try {
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
  });
});
