import { describe, it, expect } from "vitest";
import { LoadDiagnostics } from "./load-diagnostics.ts";

describe("LoadDiagnostics", () => {
  it("preserves insertion order in list()", () => {
    const d = new LoadDiagnostics();
    d.record({
      kind: "unsupported-event",
      event: "agent_start",
      reason: "no mcp equivalent",
    });
    d.record({
      kind: "unsupported-api",
      api: "registerShortcut",
      meta: { key: "cmd+K" },
    });

    expect(d.list()).toEqual([
      { kind: "unsupported-event", event: "agent_start", reason: "no mcp equivalent" },
      { kind: "unsupported-api", api: "registerShortcut", meta: { key: "cmd+K" } },
    ]);
  });

  it("reports isEmpty before and after recording", () => {
    const d = new LoadDiagnostics();
    expect(d.isEmpty()).toBe(true);
    d.record({ kind: "unsupported-api", api: "registerShortcut" });
    expect(d.isEmpty()).toBe(false);
  });
});
