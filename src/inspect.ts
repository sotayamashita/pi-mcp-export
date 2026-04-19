import type { ToolRegistry } from "@/registry/tool-registry.ts";
import type { EventRouter } from "@/registry/event-router.ts";
import type { LoadDiagnostics } from "@/api-mock/load-diagnostics.ts";
import { SUPPORTED_EVENTS, UNSUPPORTED_EVENTS } from "@/api-mock/support-policy.ts";
import { COMMAND_PREFIX } from "@/api-mock/extension-api.ts";

export interface InspectReport {
  readonly extension: string;
  readonly tools: ReadonlyArray<{ name: string; description?: string }>;
  readonly commands: ReadonlyArray<{ name: string; description?: string }>;
  readonly events: {
    readonly supported: ReadonlyArray<{ event: string; handlerCount: number }>;
    readonly unsupported: ReadonlyArray<{
      event: string;
      handlerCount: number;
      reason: string;
    }>;
    readonly unknown: ReadonlyArray<{ event: string; handlerCount: number }>;
  };
  readonly unsupportedApis: ReadonlyArray<{
    api: string;
    meta?: Readonly<Record<string, unknown>>;
  }>;
}

export function buildInspectReport(
  extension: string,
  registry: ToolRegistry,
  events: EventRouter,
  diagnostics: LoadDiagnostics,
  commandNames: ReadonlySet<string> = new Set(),
): InspectReport {
  const tools: Array<{ name: string; description?: string }> = [];
  const commands: Array<{ name: string; description?: string }> = [];
  for (const tool of registry.list()) {
    const entry: { name: string; description?: string } = { name: tool.name };
    if (tool.description !== undefined) entry.description = tool.description;
    const bare = tool.name.startsWith(COMMAND_PREFIX)
      ? tool.name.slice(COMMAND_PREFIX.length)
      : undefined;
    if (bare !== undefined && commandNames.has(bare)) {
      commands.push({ ...entry, name: bare });
    } else {
      tools.push(entry);
    }
  }

  const supported: Array<{ event: string; handlerCount: number }> = [];
  for (const event of SUPPORTED_EVENTS) {
    const count = events.handlersOf(event).length;
    if (count > 0) supported.push({ event, handlerCount: count });
  }
  const unsupported: Array<{ event: string; handlerCount: number; reason: string }> = [];
  for (const [event, reason] of UNSUPPORTED_EVENTS) {
    const count = events.handlersOf(event).length;
    if (count > 0) unsupported.push({ event, handlerCount: count, reason });
  }

  const unknown: Array<{ event: string; handlerCount: number }> = [];
  const unsupportedApis: Array<{
    api: string;
    meta?: Readonly<Record<string, unknown>>;
  }> = [];
  const seenUnknown = new Set<string>();
  for (const d of diagnostics.list()) {
    if (d.kind === "unsupported-api") {
      const entry: { api: string; meta?: Readonly<Record<string, unknown>> } = {
        api: d.api,
      };
      if (d.meta !== undefined) entry.meta = d.meta;
      unsupportedApis.push(entry);
    } else if (d.kind === "unknown-event" && !seenUnknown.has(d.event)) {
      seenUnknown.add(d.event);
      unknown.push({ event: d.event, handlerCount: events.handlersOf(d.event).length });
    }
  }

  return {
    extension,
    tools,
    commands,
    events: { supported, unsupported, unknown },
    unsupportedApis,
  };
}

export function formatReport(report: InspectReport, format: "text" | "json"): string {
  if (format === "json") return JSON.stringify(report, null, 2);

  const lines: string[] = [];
  lines.push(`Extension: ${report.extension}`);
  lines.push("");
  lines.push(`Tools (${report.tools.length}):`);
  for (const t of report.tools) {
    lines.push(`  - ${t.name}${t.description ? `: ${t.description}` : ""}`);
  }
  lines.push("");
  lines.push(`Commands (${report.commands.length}):`);
  for (const c of report.commands) {
    lines.push(`  - ${c.name}${c.description ? `: ${c.description}` : ""}`);
  }
  lines.push("");
  lines.push("Events:");
  lines.push(`  supported (${report.events.supported.length}):`);
  for (const e of report.events.supported) {
    lines.push(`    - ${e.event} (${e.handlerCount} handler${e.handlerCount === 1 ? "" : "s"})`);
  }
  lines.push(`  unsupported (${report.events.unsupported.length}):`);
  for (const e of report.events.unsupported) {
    lines.push(
      `    - ${e.event} (${e.handlerCount} handler${e.handlerCount === 1 ? "" : "s"}) — ${e.reason}`,
    );
  }
  lines.push(`  unknown (${report.events.unknown.length}):`);
  for (const e of report.events.unknown) {
    lines.push(`    - ${e.event} (${e.handlerCount} handler${e.handlerCount === 1 ? "" : "s"})`);
  }
  lines.push("");
  lines.push(`Unsupported APIs (${report.unsupportedApis.length}):`);
  for (const a of report.unsupportedApis) {
    const meta = a.meta ? ` ${JSON.stringify(a.meta)}` : "";
    lines.push(`  - ${a.api}${meta}`);
  }
  return `${lines.join("\n")}\n`;
}
