import { Command } from "commander";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { EventRouter } from "@/registry/event-router.ts";
import { loadExtension } from "@/loader.ts";
import { createServer } from "@/server.ts";

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

async function run(): Promise<void> {
  const program = new Command();
  program.name("pi-mcp-export").description("Export pi coding agent extensions as MCP servers");

  program
    .command("serve")
    .description("Start an MCP stdio server exposing one or more extensions")
    .requiredOption(
      "--extension <path>",
      "Path to an extension file or directory (repeatable)",
      (value: string, previous: string[] | undefined) =>
        previous ? [...previous, value] : [value],
    )
    .action(async (opts: { extension: string[] }) => {
      const registry = new ToolRegistry();
      const events = new EventRouter();
      for (const path of opts.extension) {
        await loadExtension(resolveExtensionPath(path), registry, events);
      }
      const server = createServer(registry, events);
      const transport = new StdioServerTransport();
      await server.connect(transport);
    });

  await program.parseAsync(process.argv);
}

await run();
