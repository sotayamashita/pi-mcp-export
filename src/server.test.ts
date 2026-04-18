import { describe, it, expect, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { EventRouter } from "@/registry/event-router.ts";
import { createServer } from "./server.ts";
import type { ToolDef } from "@/types/tool-def.ts";

async function connectedPair(
  registry: ToolRegistry,
  events: EventRouter = new EventRouter(),
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(registry, events);
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
    async execute(_toolCallId, params) {
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

  it("emits session_start once the client is connected", async () => {
    const events = new EventRouter();
    const onStart = vi.fn();
    events.on("session_start", onStart);

    const { close } = await connectedPair(new ToolRegistry(), events);
    try {
      expect(onStart).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });

  it("emits session_shutdown when the server closes", async () => {
    const events = new EventRouter();
    const onShutdown = vi.fn();
    events.on("session_shutdown", onShutdown);

    const { close } = await connectedPair(new ToolRegistry(), events);
    await close();

    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it("invokes session_shutdown handlers with a live (non-aborted) ctx.signal", async () => {
    const events = new EventRouter();
    let observedAborted: boolean | undefined;
    events.on("session_shutdown", async (_event, ctx) => {
      observedAborted = (ctx as { signal: AbortSignal }).signal.aborted;
    });

    const { close } = await connectedPair(new ToolRegistry(), events);
    await close();

    expect(observedAborted).toBe(false);
  });
});
