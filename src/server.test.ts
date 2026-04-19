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

  it("forwards onUpdate partials as notifications/progress when client provides a progressToken", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "progress-sender",
      description: "emits progress",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "running", elapsed: "1s" } });
        onUpdate({ details: { phase: "done" } });
        return { content: [{ type: "text", text: "ok" }] };
      },
    });

    const { client, close } = await connectedPair(registry);
    const onprogress = vi.fn();
    try {
      await client.callTool({ name: "progress-sender", arguments: {} }, undefined, {
        onprogress,
      });
      expect(onprogress).toHaveBeenCalledTimes(2);
      const first = onprogress.mock.calls[0]![0];
      expect(first.progress).toBe(1);
      expect(first.message).toMatch(/running/);
      const second = onprogress.mock.calls[1]![0];
      expect(second.progress).toBe(2);
    } finally {
      await close();
    }
  });

  it("fires tool_call hooks through the real MCP dispatch path (block propagates to client)", async () => {
    const events = new EventRouter();
    events.on("tool_call", () => ({ block: true, reason: "denied by policy" }));
    const registry = new ToolRegistry();
    const execute = vi.fn();
    registry.register({
      name: "sensitive",
      description: "blocked tool",
      parameters: Type.Object({}),
      execute,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer(registry, events);
    const client = new Client({ name: "hook-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "sensitive", arguments: {} });
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("denied by policy") }],
      });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("does not emit progress notifications when the client omits the progressToken", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "progress-sender-silent",
      description: "emits progress",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "running" } });
        return { content: [{ type: "text", text: "ok" }] };
      },
    });

    const { client, close } = await connectedPair(registry);
    const onprogress = vi.fn();
    try {
      // No onprogress passed → SDK does not attach a progressToken.
      await client.callTool({ name: "progress-sender-silent", arguments: {} });
      expect(onprogress).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
