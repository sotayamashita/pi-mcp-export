import { describe, it, expect, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { EventRouter } from "@/registry/event-router.ts";
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

  it("fires tool_call pre-hook with the event shape {type, toolCallId, toolName, input} before execute", async () => {
    const events = new EventRouter();
    const preHook = vi.fn();
    events.on("tool_call", preHook);
    const execute = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "done" }] });
    const registry = new ToolRegistry();
    registry.register({
      name: "greet",
      parameters: Type.Object({ name: Type.String() }),
      execute,
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "greet",
      { name: "world" },
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(preHook).toHaveBeenCalledTimes(1);
    const [event, ctx] = preHook.mock.calls[0]!;
    expect(event).toMatchObject({
      type: "tool_call",
      toolName: "greet",
      input: { name: "world" },
    });
    expect(typeof event.toolCallId).toBe("string");
    expect(ctx).toBeDefined();
    expect(preHook.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]!);
  });

  it("returns an MCP error and skips execute when a tool_call handler returns block: true", async () => {
    const events = new EventRouter();
    events.on("tool_call", () => ({ block: true, reason: "policy forbids" }));
    const execute = vi.fn();
    const registry = new ToolRegistry();
    registry.register({
      name: "forbidden",
      parameters: Type.Object({}),
      execute,
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "forbidden",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("policy forbids") }],
    });
  });

  it("does not invoke subsequent tool_call handlers after the first returns block: true", async () => {
    const events = new EventRouter();
    events.on("tool_call", () => ({ block: true, reason: "nope" }));
    const second = vi.fn();
    events.on("tool_call", second);
    const registry = new ToolRegistry();
    registry.register({
      name: "blocked",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "should not run" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "blocked",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(second).not.toHaveBeenCalled();
  });

  it("passes the mutated input from tool_call handlers into tool.execute", async () => {
    const events = new EventRouter();
    events.on("tool_call", (event) => {
      const e = event as { input: Record<string, unknown> };
      e.input["name"] = "mutated";
    });
    const execute = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "done" }] });
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      parameters: Type.Object({ name: Type.String() }),
      execute,
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "echo",
      { name: "original" },
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const [, params] = execute.mock.calls[0]!;
    expect(params).toEqual({ name: "mutated" });
  });

  it("fires tool_result post-hook after execute with the full event shape", async () => {
    const events = new EventRouter();
    const postHook = vi.fn();
    events.on("tool_result", postHook);
    const registry = new ToolRegistry();
    registry.register({
      name: "summarize",
      parameters: Type.Object({ topic: Type.String() }),
      async execute() {
        return {
          content: [{ type: "text", text: "summary body" }],
          details: { tokens: 42 },
        };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "summarize",
      { topic: "phase-4" },
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(postHook).toHaveBeenCalledTimes(1);
    const [event] = postHook.mock.calls[0]!;
    expect(event).toMatchObject({
      type: "tool_result",
      toolName: "summarize",
      input: { topic: "phase-4" },
      content: [{ type: "text", text: "summary body" }],
      details: { tokens: 42 },
      isError: false,
    });
  });

  it("applies partial overrides (content/details/isError) from tool_result handlers", async () => {
    const events = new EventRouter();
    events.on("tool_result", () => ({
      content: [{ type: "text", text: "redacted" }],
      details: { redacted: true },
    }));
    const registry = new ToolRegistry();
    registry.register({
      name: "sensitive",
      parameters: Type.Object({}),
      async execute() {
        return {
          content: [{ type: "text", text: "original" }],
          details: { secret: "shh" },
        };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "sensitive",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(result).toEqual({
      content: [{ type: "text", text: "redacted" }],
      structuredContent: { redacted: true },
    });
  });

  it("chains multiple tool_result handlers so each sees prior mutations", async () => {
    const events = new EventRouter();
    const seen: Array<{ type: string; content: unknown }> = [];
    events.on("tool_result", (event) => {
      const e = event as { content: unknown };
      seen.push({ type: "first", content: e.content });
      return { content: [{ type: "text", text: "mutated-by-first" }] };
    });
    events.on("tool_result", (event) => {
      const e = event as { content: unknown };
      seen.push({ type: "second", content: e.content });
      return undefined;
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "chained",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "original" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "chained",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(seen[0]!.content).toEqual([{ type: "text", text: "original" }]);
    expect(seen[1]!.content).toEqual([{ type: "text", text: "mutated-by-first" }]);
    expect(result).toEqual({ content: [{ type: "text", text: "mutated-by-first" }] });
  });

  it("fails closed: tool_call handler throw blocks execute with a 'handler crashed' error", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const events = new EventRouter();
      events.on("tool_call", () => {
        throw new Error("policy misconfigured");
      });
      const execute = vi.fn();
      const registry = new ToolRegistry();
      registry.register({
        name: "sensitive",
        parameters: Type.Object({}),
        execute,
      } satisfies ToolDef);

      const result = await dispatchTool(
        registry,
        "sensitive",
        {},
        {
          signal: new AbortController().signal,
          cwd: process.cwd(),
          notify: () => {},
          events,
        },
      );

      expect(execute).not.toHaveBeenCalled();
      expect(result).toMatchObject({ isError: true });
      const text = (result.content as Array<{ text: string }>)[0]!.text;
      expect(text).toMatch(/policy misconfigured|blocked/i);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("fires tool_call and tool_result hooks even for unknown tool names (audit visibility)", async () => {
    const events = new EventRouter();
    const preHook = vi.fn();
    const postHook = vi.fn();
    events.on("tool_call", preHook);
    events.on("tool_result", postHook);
    const registry = new ToolRegistry();

    const result = await dispatchTool(
      registry,
      "nonexistent",
      { q: 1 },
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(preHook).toHaveBeenCalledTimes(1);
    expect(preHook.mock.calls[0]![0]).toMatchObject({
      type: "tool_call",
      toolName: "nonexistent",
      input: { q: 1 },
    });
    expect(postHook).toHaveBeenCalledTimes(1);
    expect(postHook.mock.calls[0]![0]).toMatchObject({
      type: "tool_result",
      toolName: "nonexistent",
      isError: true,
    });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("nonexistent") }],
    });
  });

  it("falls back to a deep JSON snapshot when structuredClone fails (function injection)", async () => {
    const events = new EventRouter();
    let observedFilter: unknown;
    events.on("tool_call", (event) => {
      const e = event as { input: Record<string, unknown> };
      e.input["fn"] = (): void => {};
    });
    events.on("tool_result", (event) => {
      const e = event as { input: { filter: { enabled: boolean } } };
      observedFilter = { ...e.input.filter };
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "nested-after-fn",
      parameters: Type.Object({ filter: Type.Object({ enabled: Type.Boolean() }) }),
      async execute(_toolCallId, params) {
        (params as { filter: { enabled: boolean } }).filter.enabled = false;
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "nested-after-fn",
      { filter: { enabled: true } },
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(observedFilter).toEqual({ enabled: true });
  });

  it("falls back to a shallow snapshot when input is not structured-cloneable", async () => {
    const events = new EventRouter();
    let observedInput: Record<string, unknown> | undefined;
    events.on("tool_call", (event) => {
      const e = event as { input: Record<string, unknown> };
      e.input["attachment"] = (): void => {};
    });
    events.on("tool_result", (event) => {
      observedInput = { ...(event as { input: Record<string, unknown> }).input };
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "fn-mutator",
      parameters: Type.Object({ label: Type.String() }),
      async execute() {
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "fn-mutator",
      { label: "hello" },
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(result).not.toHaveProperty("isError");
    expect(observedInput).toBeDefined();
    expect(observedInput!["label"]).toBe("hello");
  });

  it("tool_result.input deep-clones so nested mutation by execute cannot leak into hooks", async () => {
    const events = new EventRouter();
    let observedFilter: unknown;
    events.on("tool_result", (event) => {
      const e = event as { input: { filter: { enabled: boolean } } };
      observedFilter = { ...e.input.filter };
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "nested-mutator",
      parameters: Type.Object({ filter: Type.Object({ enabled: Type.Boolean() }) }),
      async execute(_toolCallId, params) {
        (params as { filter: { enabled: boolean } }).filter.enabled = false;
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "nested-mutator",
      { filter: { enabled: true } },
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(observedFilter).toEqual({ enabled: true });
  });

  it("deny-by-default survives in-place mutation of the event by tool_result handlers", async () => {
    const events = new EventRouter();
    events.on("tool_call", () => ({ block: true, reason: "nope" }));
    events.on("tool_result", (event) => {
      const e = event as {
        isError: boolean;
        content: Array<{ type: "text"; text: string }>;
      };
      e.isError = false;
      if (e.content[0]) e.content[0].text = "sneaky success";
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "guarded",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "never" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "guarded",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("nope") }],
    });
  });

  it("ignores tool_result handler overrides when the call was blocked (deny-by-default)", async () => {
    const events = new EventRouter();
    events.on("tool_call", () => ({ block: true, reason: "denied by policy" }));
    const postHook = vi.fn(() => ({
      isError: false,
      content: [{ type: "text", text: "faked success" }],
    }));
    events.on("tool_result", postHook);
    const registry = new ToolRegistry();
    registry.register({
      name: "guarded",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "should never run" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "guarded",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(postHook).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("denied by policy") }],
    });
  });

  it("fires tool_result on blocked tool calls so audit/redaction hooks still observe them", async () => {
    const events = new EventRouter();
    events.on("tool_call", () => ({ block: true, reason: "denied" }));
    const postHook = vi.fn();
    events.on("tool_result", postHook);
    const registry = new ToolRegistry();
    registry.register({
      name: "auditable",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "should not run" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "auditable",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(postHook).toHaveBeenCalledTimes(1);
    const [event] = postHook.mock.calls[0]!;
    expect(event).toMatchObject({
      type: "tool_result",
      toolName: "auditable",
      isError: true,
    });
    expect(result).toMatchObject({ isError: true });
  });

  it("tool_result.input is a snapshot unaffected by execute mutating its params", async () => {
    const events = new EventRouter();
    let observedInput: unknown;
    events.on("tool_result", (event) => {
      observedInput = { ...(event as { input: Record<string, unknown> }).input };
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "mutator",
      parameters: Type.Object({ x: Type.Number() }),
      async execute(_toolCallId, params) {
        (params as { x: number }).x = 999;
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    await dispatchTool(
      registry,
      "mutator",
      { x: 1 },
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(observedInput).toEqual({ x: 1 });
  });

  it("preserves tool_result handler details override even when result stays isError: true", async () => {
    const events = new EventRouter();
    events.on("tool_result", () => ({
      details: { errorCode: "E_DENIED", hint: "retry after auth" },
    }));
    const registry = new ToolRegistry();
    registry.register({
      name: "failing",
      parameters: Type.Object({}),
      async execute() {
        throw new Error("nope");
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "failing",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        events,
      },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "nope" }],
      structuredContent: { errorCode: "E_DENIED", hint: "retry after auth" },
    });
  });

  it("fires tool_result with isError: true when execute throws and allows handler override", async () => {
    const events = new EventRouter();
    let observedIsError: boolean | undefined;
    let observedContent: unknown;
    events.on("tool_result", (event) => {
      const e = event as { isError: boolean; content: unknown };
      observedIsError = e.isError;
      observedContent = e.content;
      return {
        content: [{ type: "text", text: "handled gracefully" }],
        isError: false,
      };
    });
    const registry = new ToolRegistry();
    registry.register({
      name: "boom",
      parameters: Type.Object({}),
      async execute() {
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
        events,
      },
    );

    expect(observedIsError).toBe(true);
    expect(observedContent).toEqual([{ type: "text", text: "kaboom" }]);
    expect(result).toEqual({ content: [{ type: "text", text: "handled gracefully" }] });
  });

  it("returns an MCP error when execute exceeds timeoutMs and propagates abort via ctx.signal", async () => {
    let observedSignal: AbortSignal | undefined;
    const registry = new ToolRegistry();
    registry.register({
      name: "slow",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, signal) {
        observedSignal = signal;
        await new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(undefined), { once: true });
        });
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "slow",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        timeoutMs: 50,
      },
    );

    expect(observedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/timed out/i) }],
    });
  });

  it("enforces timeoutMs when a tool_call hook hangs before execute runs", async () => {
    const events = new EventRouter();
    events.on("tool_call", () => new Promise(() => {}));
    const execute = vi.fn();
    const registry = new ToolRegistry();
    registry.register({
      name: "wrapped",
      parameters: Type.Object({}),
      execute,
    } satisfies ToolDef);

    const start = Date.now();
    const result = await dispatchTool(
      registry,
      "wrapped",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        timeoutMs: 50,
        events,
      },
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/timed out/i) }],
    });
  });

  it("enforces timeoutMs even when the tool ignores the signal entirely", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "uncooperative",
      parameters: Type.Object({}),
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 60000));
        return { content: [{ type: "text", text: "never reached" }] };
      },
    } satisfies ToolDef);

    const start = Date.now();
    const result = await dispatchTool(
      registry,
      "uncooperative",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        timeoutMs: 50,
      },
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/timed out/i) }],
    });
  });

  it("short-circuits when a tool_result hook hangs after execute already timed out", async () => {
    const events = new EventRouter();
    events.on("tool_result", () => new Promise(() => {}));
    const registry = new ToolRegistry();
    registry.register({
      name: "slow-then-hang",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, signal) {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { content: [{ type: "text", text: "unreachable" }] };
      },
    } satisfies ToolDef);

    const start = Date.now();
    const result = await dispatchTool(
      registry,
      "slow-then-hang",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        timeoutMs: 50,
        events,
      },
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/timed out/i) }],
    });
  });

  it("preserves the timeout error even when a tool_result hook tries to override it", async () => {
    const events = new EventRouter();
    events.on("tool_result", () => ({
      content: [{ type: "text", text: "normalized success" }],
      isError: false,
    }));
    const registry = new ToolRegistry();
    registry.register({
      name: "slow-overridden",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, signal) {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { content: [{ type: "text", text: "never" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "slow-overridden",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        timeoutMs: 50,
        events,
      },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/timed out/i) }],
    });
  });

  it("still invokes later tool_result hooks when the timeout fires mid-hook", async () => {
    const events = new EventRouter();
    events.on("tool_result", () => new Promise(() => {}));
    const secondHook = vi.fn();
    events.on("tool_result", secondHook);

    const registry = new ToolRegistry();
    registry.register({
      name: "quick",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "ok" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "quick",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        timeoutMs: 50,
        events,
      },
    );

    expect(secondHook).toHaveBeenCalledTimes(1);
    const firstCall = secondHook.mock.calls[0] as unknown as ReadonlyArray<{ isError: boolean }>;
    expect(firstCall[0]?.isError).toBe(true);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/timed out/i) }],
    });
  });

  it("stops forwarding progress notifications after the tool has timed out", async () => {
    const sendProgress = vi.fn();
    const progressFromTool: Array<() => void> = [];
    const registry = new ToolRegistry();
    registry.register({
      name: "ghost",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, onUpdate) {
        onUpdate({ details: { phase: "one" } });
        await new Promise<void>((resolve) => {
          progressFromTool.push(() => {
            onUpdate({ details: { phase: "late-after-timeout" } });
            resolve();
          });
        });
        return { content: [{ type: "text", text: "eventually" }] };
      },
    } satisfies ToolDef);

    const dispatchPromise = dispatchTool(
      registry,
      "ghost",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        timeoutMs: 50,
        sendProgress,
      },
    );
    const result = await dispatchPromise;

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/timed out/i) }],
    });
    const progressCountBefore = sendProgress.mock.calls.length;
    progressFromTool[0]?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(sendProgress.mock.calls.length).toBe(progressCountBefore);
  });

  it("invokes tool_result handlers on timeout for audit but silently bounds slow handlers", async () => {
    const events = new EventRouter();
    events.on("tool_call", () => new Promise(() => {}));
    const postHook = vi.fn(() => new Promise(() => {}));
    events.on("tool_result", postHook);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const registry = new ToolRegistry();
      registry.register({
        name: "noisy",
        parameters: Type.Object({}),
        async execute() {
          return { content: [{ type: "text", text: "ok" }] };
        },
      } satisfies ToolDef);

      const result = await dispatchTool(
        registry,
        "noisy",
        {},
        {
          signal: new AbortController().signal,
          cwd: process.cwd(),
          notify: () => {},
          timeoutMs: 50,
          events,
        },
      );

      expect(postHook).toHaveBeenCalledTimes(1);
      const firstCall = postHook.mock.calls[0] as unknown as ReadonlyArray<{ isError: boolean }>;
      expect(firstCall[0]?.isError).toBe(true);
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringMatching(/timed out/i) }],
      });
    } finally {
      const writes = stderrSpy.mock.calls.map(([c]) => String(c));
      stderrSpy.mockRestore();
      expect(writes.some((w) => /handler for "tool_result" threw/.test(w))).toBe(false);
    }
  });

  it("converts synchronous execute() throws into an MCP error result", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "sync-throw",
      parameters: Type.Object({}),
      execute: (() => {
        throw new Error("sync boom");
      }) as unknown as ToolDef["execute"],
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "sync-throw",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        timeoutMs: 5000,
      },
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "sync boom" }],
    });
  });

  it("returns the normal result when execute finishes before timeoutMs elapses", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "fast",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "done" }] };
      },
    } satisfies ToolDef);

    const result = await dispatchTool(
      registry,
      "fast",
      {},
      {
        signal: new AbortController().signal,
        cwd: process.cwd(),
        notify: () => {},
        timeoutMs: 5000,
      },
    );

    expect(result).toEqual({ content: [{ type: "text", text: "done" }] });
  });
});
