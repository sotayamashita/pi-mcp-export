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

  it("does not crash when tool calls onUpdate but no sendProgress is provided", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "chatty",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "running", elapsed: "1s" } });
        onUpdate("anything");
        onUpdate(null);
        return { content: [{ type: "text", text: "ok" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "chatty",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
      },
    );

    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("forwards onUpdate to sendProgress with monotonic counter and phase+elapsed message", async () => {
    const sendProgress = vi.fn();
    const registry = new ToolRegistry();
    registry.register({
      name: "progress-emitter",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "running", elapsed: "2s" } });
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "progress-emitter",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );

    expect(sendProgress).toHaveBeenCalledTimes(1);
    const [params] = sendProgress.mock.calls[0]!;
    expect(params.progress).toBe(1);
    expect(params.message).toMatch(/running/);
    expect(params.message).toMatch(/2s/);
  });

  it("increments progress counter monotonically across multiple onUpdate calls", async () => {
    const sendProgress = vi.fn();
    const registry = new ToolRegistry();
    registry.register({
      name: "multi-progress",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "a" } });
        onUpdate({ details: { phase: "b" } });
        onUpdate({ details: { phase: "c" } });
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "multi-progress",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );

    const progresses = sendProgress.mock.calls.map((call) => call[0].progress);
    expect(progresses).toEqual([1, 2, 3]);
  });

  it("sends progress with fallback message when partial has unexpected shape", async () => {
    const sendProgress = vi.fn();
    const registry = new ToolRegistry();
    registry.register({
      name: "weird-partial",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate("plain string");
        onUpdate(null);
        onUpdate({});
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "weird-partial",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );

    expect(sendProgress).toHaveBeenCalledTimes(3);
    for (const call of sendProgress.mock.calls) {
      expect(typeof call[0].progress).toBe("number");
      expect(typeof call[0].message).toBe("string");
      expect(call[0].message.length).toBeGreaterThan(0);
    }
  });

  it("awaits pending sendProgress promises before resolving the tool call", async () => {
    const order: string[] = [];
    const sendProgress = vi.fn((params: { progress: number }) => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(`progress-${params.progress}`);
          resolve();
        }, 20);
      });
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "awaited-progress",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "a" } });
        onUpdate({ details: { phase: "b" } });
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "awaited-progress",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );
    order.push("return");

    expect(order).toEqual(["progress-1", "progress-2", "return"]);
  });

  it("awaits pending progress even when the tool throws after emitting progress", async () => {
    const order: string[] = [];
    const sendProgress = vi.fn((params: { progress: number }) => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(`progress-${params.progress}`);
          resolve();
        }, 20);
      });
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "progress-then-throw",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "before-throw" } });
        throw new Error("kaboom");
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "progress-then-throw",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );
    order.push("return");

    expect(result).toHaveProperty("isError", true);
    expect(order).toEqual(["progress-1", "return"]);
  });

  it(
    "does not hang when a progress notification never settles (flush timeout)",
    { timeout: 10000 },
    async () => {
      const sendProgress = vi.fn(() => new Promise<void>(() => {}));
      const registry = new ToolRegistry();
      registry.register({
        name: "hang-progress",
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal, onUpdate) {
          onUpdate({ details: { phase: "a" } });
          return { content: [{ type: "text", text: "done" }] };
        },
      } satisfies ToolDef);

      const start = Date.now();
      const result = await dispatchTool(
        registry,
        "hang-progress",
        {},
        {
          signal: new AbortController().signal,
          cwd: process.cwd(),
          notify: () => {},
          sendProgress,
        },
      );
      const elapsed = Date.now() - start;

      expect(result).toEqual({ content: [{ type: "text", text: "done" }] });
      expect(elapsed).toBeLessThan(6000);
      expect(elapsed).toBeGreaterThanOrEqual(4800);
    },
  );

  it("passes through tool-provided progress, total, and message when partial uses MCP shape", async () => {
    const sendProgress = vi.fn();
    const registry = new ToolRegistry();
    registry.register({
      name: "explicit-progress",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ progress: 50, total: 100, message: "halfway" });
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "explicit-progress",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );

    expect(sendProgress).toHaveBeenCalledWith({ progress: 50, total: 100, message: "halfway" });
  });

  it("keeps progress monotonic when tool mixes MCP-shape and legacy partials", async () => {
    const sendProgress = vi.fn();
    const registry = new ToolRegistry();
    registry.register({
      name: "mixed-shape",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ progress: 50, total: 100 });
        onUpdate({ details: { phase: "step" } });
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "mixed-shape",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );

    const progresses = sendProgress.mock.calls.map((c) => c[0].progress);
    expect(progresses[0]).toBe(50);
    expect(progresses[1]).toBeGreaterThan(50);
  });

  it("delivers progress notifications in emission order even if sendProgress resolves out of order", async () => {
    const observed: number[] = [];
    let callIndex = 0;
    const sendProgress = vi.fn(() => {
      const idx = ++callIndex;
      const delay = idx === 1 ? 40 : 10;
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          observed.push(idx);
          resolve();
        }, delay);
      });
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "rapid",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "a" } });
        onUpdate({ details: { phase: "b" } });
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "rapid",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );

    expect(observed).toEqual([1, 2]);
  });

  it("passes tool-supplied progress through verbatim even when the value is zero or repeats", async () => {
    const sendProgress = vi.fn();
    const registry = new ToolRegistry();
    registry.register({
      name: "zero-progress",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ progress: 0, total: 100, message: "starting" });
        onUpdate({ progress: 0, total: 100, message: "still starting" });
        onUpdate({ progress: 5, total: 100, message: "5%" });
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "zero-progress",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );

    const progresses = sendProgress.mock.calls.map((c) => c[0].progress);
    expect(progresses).toEqual([0, 0, 5]);
  });

  it("swallows sendProgress errors so tool execution still completes", async () => {
    const sendProgress = vi.fn(() => {
      throw new Error("transport dead");
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "progress-after-throw",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "running" } });
        return { content: [{ type: "text", text: "still-done" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "progress-after-throw",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        sendProgress,
      },
    );

    expect(result).toEqual({ content: [{ type: "text", text: "still-done" }] });
    expect(sendProgress).toHaveBeenCalled();
  });
});
