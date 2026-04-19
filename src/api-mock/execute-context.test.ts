import { describe, it, expect, vi } from "vitest";
import { createExecuteContext } from "./execute-context.ts";

describe("createExecuteContext", () => {
  it("exposes cwd, signal, and headless flags from the injected arguments", () => {
    const controller = new AbortController();
    const ctx = createExecuteContext({
      cwd: "/tmp/work",
      signal: controller.signal,
      notify: () => {},
    });

    expect(ctx.cwd).toBe("/tmp/work");
    expect(ctx.signal).toBe(controller.signal);
    expect(ctx.hasUI).toBe(false);
    expect(ctx.hasTerminal).toBe(false);
  });

  it("forwards ui.notify to the injected notify callback", () => {
    const notify = vi.fn();
    const ctx = createExecuteContext({
      cwd: "/tmp",
      signal: new AbortController().signal,
      notify,
    });

    ctx.ui.notify("hello", "info");

    expect(notify).toHaveBeenCalledWith("hello", "info");
  });

  it("makes ui.setWidget and ui.custom no-ops (custom resolves immediately)", async () => {
    const ctx = createExecuteContext({
      cwd: "/tmp",
      signal: new AbortController().signal,
      notify: () => {},
    });

    expect(() => ctx.ui.setWidget("key", () => ({}))).not.toThrow();
    await expect(ctx.ui.custom(() => {})).resolves.toBeUndefined();
  });

  it("stubs getContextUsage, abort, and sessionManager with safe defaults", async () => {
    const ctx = createExecuteContext({
      cwd: "/tmp",
      signal: new AbortController().signal,
      notify: () => {},
    });

    expect(ctx.getContextUsage()).toEqual({ input: 0, output: 0, total: 0 });
    expect(() => ctx.abort()).not.toThrow();
    expect(ctx.sessionManager.getSessionId()).toMatch(/^mcp-/);
    expect(ctx.sessionManager.getBranch()).toEqual([]);
  });
});
