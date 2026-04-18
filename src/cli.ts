import { Command } from "commander";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { EventRouter } from "@/registry/event-router.ts";
import { loadExtension } from "@/loader.ts";
import { createServer } from "@/server.ts";
import { LoadDiagnostics } from "@/api-mock/load-diagnostics.ts";
import { buildInspectReport, formatReport, type InspectReport } from "@/inspect.ts";

function resolveExtensionPath(input: string): string {
  const absolute = resolve(input);
  try {
    if (statSync(absolute).isDirectory()) {
      return join(absolute, "index.ts");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return absolute;
}

function summarizeDiagnostics(
  entries: ReadonlyArray<{ path: string; diagnostics: LoadDiagnostics }>,
): string {
  const lines = ["[pi-mcp-export] --strict refusing to start. Unsupported usage:"];
  for (const { path, diagnostics } of entries) {
    if (diagnostics.isEmpty()) continue;
    lines.push(`  ${path}:`);
    for (const d of diagnostics.list()) {
      if (d.kind === "unsupported-event") {
        lines.push(`    - on("${d.event}") — ${d.reason}`);
      } else if (d.kind === "unknown-event") {
        lines.push(`    - on("${d.event}") — unknown event name (typo or unsupported)`);
      } else {
        const meta = d.meta ? ` ${JSON.stringify(d.meta)}` : "";
        lines.push(`    - ${d.api}${meta}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

async function run(): Promise<void> {
  const program = new Command();
  program.name("pi-mcp-export").description("Export pi coding agent extensions as MCP servers");

  const collectExtension = (value: string, previous: string[] | undefined): string[] =>
    previous ? [...previous, value] : [value];

  program
    .command("serve")
    .description("Start an MCP stdio server exposing one or more extensions")
    .requiredOption(
      "--extension <path>",
      "Path to an extension file or directory (repeatable)",
      collectExtension,
    )
    .option(
      "--strict",
      "Fail to start if the extension registers an unsupported event or API",
      false,
    )
    .option("--timeout <seconds>", "Per-tool-call timeout in seconds (default 0 = disabled)", "0")
    .action(async (opts: { extension: string[]; strict?: boolean; timeout?: string }) => {
      const timeoutRaw = opts.timeout ?? "0";
      const timeoutSec = /^(?:\d+|\d+\.\d+|\.\d+)$/.test(timeoutRaw)
        ? Number.parseFloat(timeoutRaw)
        : Number.NaN;
      if (!Number.isFinite(timeoutSec) || timeoutSec < 0) {
        process.stderr.write(`[pi-mcp-export] invalid --timeout value: ${timeoutRaw}\n`);
        process.exit(1);
      }
      if (timeoutSec > 0 && timeoutSec < 0.001) {
        process.stderr.write(
          `[pi-mcp-export] --timeout must be 0 (disabled) or at least 0.001 seconds\n`,
        );
        process.exit(1);
      }
      const registry = new ToolRegistry();
      const events = new EventRouter();
      const perExtension: Array<{ path: string; diagnostics: LoadDiagnostics }> = [];
      for (const path of opts.extension) {
        const resolved = resolveExtensionPath(path);
        const diagnostics = new LoadDiagnostics();
        await loadExtension(resolved, registry, events, diagnostics);
        perExtension.push({ path: resolved, diagnostics });
      }
      if (opts.strict && perExtension.some((e) => !e.diagnostics.isEmpty())) {
        process.stderr.write(summarizeDiagnostics(perExtension));
        process.exit(1);
      }
      const server = createServer(registry, events, {
        ...(timeoutSec > 0 && { perCallTimeoutMs: Math.round(timeoutSec * 1000) }),
      });
      const transport = new StdioServerTransport();
      await server.connect(transport);
    });

  program
    .command("inspect")
    .description("Report which ExtensionAPI features an extension uses")
    .requiredOption(
      "--extension <path>",
      "Path to an extension file or directory",
      collectExtension,
    )
    .option("--format <fmt>", "Output format: text | json", "text")
    .action(async (opts: { extension: string[]; format?: string }) => {
      if (opts.format !== undefined && opts.format !== "json" && opts.format !== "text") {
        process.stderr.write(
          `[pi-mcp-export] invalid --format value: ${opts.format} (expected text | json)\n`,
        );
        process.exit(1);
      }
      const format: "json" | "text" = opts.format === "json" ? "json" : "text";
      const reports: InspectReport[] = [];
      for (const path of opts.extension) {
        const registry = new ToolRegistry();
        const events = new EventRouter();
        const diagnostics = new LoadDiagnostics();
        const commandNames = new Set<string>();
        const resolved = resolveExtensionPath(path);
        await loadExtension(resolved, registry, events, diagnostics, commandNames);
        reports.push(buildInspectReport(resolved, registry, events, diagnostics, commandNames));
      }
      if (format === "json") {
        const payload = reports.length === 1 ? reports[0] : reports;
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        process.stdout.write(`${reports.map((r) => formatReport(r, "text")).join("\n")}\n`);
      }
    });

  await program.parseAsync(process.argv);
}

await run();
