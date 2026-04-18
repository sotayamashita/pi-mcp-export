import { describe, it, expect, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { dispatchTool } from "./tool-dispatcher.ts";
import type { ToolDef } from "@/types/tool-def.ts";

describe("dispatchTool", () => {
  it("invokes execute with (toolCallId, params, signal, onUpdate, ctx) and returns content", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: "hello, world" }] });
    const registry = new ToolRegistry();
    registry.register({
      name: "greet",
      parameters: Type.Object({ name: Type.String() }),
      execute,
    } satisfies ToolDef);
    const controller = new AbortController();

    const result = await dispatchTool(
      registry,
      "greet",
      { name: "world" },
      {
        signal: controller.signal,
        cwd: "/tmp/work",
        notify: () => {},
      },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const [toolCallId, params, signal, onUpdate, ctx] = execute.mock.calls[0]!;
    expect(typeof toolCallId).toBe("string");
    expect(params).toEqual({ name: "world" });
    expect(signal).toBe(controller.signal);
    expect(typeof onUpdate).toBe("function");
    expect(ctx.cwd).toBe("/tmp/work");
    expect(result).toEqual({
      content: [{ type: "text", text: "hello, world" }],
    });
  });

  it("forwards ctx.ui.notify calls to the injected notify callback", async () => {
    const notify = vi.fn();
    const registry = new ToolRegistry();
    registry.register({
      name: "noisy",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        ctx.ui.notify("step 1", "info");
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "noisy",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify,
      },
    );

    expect(notify).toHaveBeenCalledWith("step 1", "info");
  });

  it("returns an MCP error result when the tool's execute throws", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "boom",
      parameters: Type.Object({}),
      execute: async () => {
        throw new Error("kaboom");
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "boom",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
      },
    );

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("kaboom") }],
    });
  });

  it("forwards tool details into structuredContent on success", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "withDetails",
      parameters: Type.Object({}),
      async execute() {
        return {
          content: [{ type: "text", text: "done" }],
          details: { experimentId: 42, phase: "complete" },
        };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "withDetails",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
      },
    );

    expect(result).toEqual({
      content: [{ type: "text", text: "done" }],
      structuredContent: { experimentId: 42, phase: "complete" },
    });
  });

  it("omits structuredContent when tool does not return details", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "plain",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "plain",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
      },
    );

    expect(result).not.toHaveProperty("structuredContent");
  });

  it("returns an MCP error result when the requested tool is unknown", async () => {
    const registry = new ToolRegistry();

    const result = await dispatchTool(
      registry,
      "missing",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
      },
    );

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/unknown tool "missing"/) }],
    });
  });
});
