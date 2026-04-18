import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { EventRouter } from "@/registry/event-router.ts";
import { LoadDiagnostics } from "@/api-mock/load-diagnostics.ts";
import { buildInspectReport, formatReport } from "./inspect.ts";
import type { ToolDef } from "@/types/tool-def.ts";

function makeTool(name: string, description?: string): ToolDef {
  return {
    name,
    ...(description !== undefined && { description }),
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: name }] }),
  };
}

describe("inspect", () => {
  it("builds a report that splits tools from commands and supported from unsupported events", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("greet", "say hi"));
    registry.register(makeTool("command_autoresearch", "run research"));

    const events = new EventRouter();
    events.on("session_start", () => {});
    events.on("agent_start", () => {});

    const diagnostics = new LoadDiagnostics();
    diagnostics.record({
      kind: "unsupported-event",
      event: "agent_start",
      reason: "agent lifecycle events are not observable from MCP",
    });
    diagnostics.record({
      kind: "unsupported-api",
      api: "registerShortcut",
      meta: { key: "cmd+K" },
    });

    const report = buildInspectReport(
      "/some/path",
      registry,
      events,
      diagnostics,
      new Set(["autoresearch"]),
    );

    expect(report).toEqual({
      extension: "/some/path",
      tools: [{ name: "greet", description: "say hi" }],
      commands: [{ name: "autoresearch", description: "run research" }],
      events: {
        supported: [{ event: "session_start", handlerCount: 1 }],
        unsupported: [
          {
            event: "agent_start",
            handlerCount: 1,
            reason: "agent lifecycle events are not observable from MCP",
          },
        ],
        unknown: [],
      },
      unsupportedApis: [{ api: "registerShortcut", meta: { key: "cmd+K" } }],
    });
  });

  it("classifies command_-prefixed registerTool entries as tools, not commands", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("command_status", "a tool legitimately named command_status"));

    const report = buildInspectReport(
      "/ext",
      registry,
      new EventRouter(),
      new LoadDiagnostics(),
      new Set(),
    );

    expect(report.tools.map((t) => t.name)).toEqual(["command_status"]);
    expect(report.commands).toEqual([]);
  });

  it("surfaces unknown-event diagnostics under events.unknown", () => {
    const events = new EventRouter();
    events.on("session_strat", () => {});
    const diagnostics = new LoadDiagnostics();
    diagnostics.record({ kind: "unknown-event", event: "session_strat" });

    const report = buildInspectReport("/ext", new ToolRegistry(), events, diagnostics);

    expect(report.events.unknown).toEqual([{ event: "session_strat", handlerCount: 1 }]);
  });

  it("formats the report as parseable JSON when format is json", () => {
    const report = buildInspectReport(
      "/some/path",
      new ToolRegistry(),
      new EventRouter(),
      new LoadDiagnostics(),
    );

    const output = formatReport(report, "json");
    const parsed = JSON.parse(output) as unknown;

    expect(parsed).toEqual(report);
  });

  it("formats the report as human-readable text with section headers", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("greet", "say hi"));
    const events = new EventRouter();
    events.on("tool_call", () => {});
    const diagnostics = new LoadDiagnostics();
    diagnostics.record({
      kind: "unsupported-api",
      api: "registerShortcut",
      meta: { key: "cmd+K" },
    });

    const report = buildInspectReport("/ext", registry, events, diagnostics);
    const text = formatReport(report, "text");

    expect(text).toMatch(/Extension: \/ext/);
    expect(text).toMatch(/Tools/);
    expect(text).toMatch(/greet/);
    expect(text).toMatch(/tool_call/);
    expect(text).toMatch(/registerShortcut/);
  });
});
