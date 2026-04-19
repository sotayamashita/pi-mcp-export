import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../bin/pi-mcp-export.mjs", import.meta.url));
const UNSUPPORTED_FIXTURE = fileURLToPath(new URL("../fixtures/unsupported-ext", import.meta.url));
const MINIMAL_FIXTURE = fileURLToPath(new URL("../fixtures/minimal-ext", import.meta.url));

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolveP) => {
    const child = spawn("node", [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("close", (code) => resolveP({ code, stdout, stderr }));
  });
}

describe("pi-mcp-export inspect (cli e2e)", () => {
  it("emits JSON enumerating tools, commands, events, and unsupported APIs", async () => {
    const { code, stdout } = await runCli([
      "inspect",
      "--extension",
      UNSUPPORTED_FIXTURE,
      "--format",
      "json",
    ]);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      tools: Array<{ name: string }>;
      commands: Array<{ name: string }>;
      events: {
        unsupported: Array<{ event: string; handlerCount: number }>;
      };
      unsupportedApis: Array<{ api: string; meta?: Record<string, unknown> }>;
    };
    expect(parsed.tools.map((t) => t.name)).toContain("noop");
    expect(parsed.commands.map((c) => c.name)).toContain("ping");
    expect(parsed.events.unsupported.map((e) => e.event)).toContain("agent_start");
    expect(parsed.unsupportedApis).toEqual([{ api: "registerShortcut", meta: { key: "cmd+K" } }]);
  }, 15000);

  it("emits a JSON array when --format json is given repeated --extension flags", async () => {
    const { code, stdout } = await runCli([
      "inspect",
      "--extension",
      MINIMAL_FIXTURE,
      "--extension",
      UNSUPPORTED_FIXTURE,
      "--format",
      "json",
    ]);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as Array<{ tools: Array<{ name: string }> }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.tools.map((t) => t.name)).toContain("greet");
    expect(parsed[1]?.tools.map((t) => t.name)).toContain("noop");
  }, 15000);

  it("attributes strict-mode diagnostics to the extension path when serving multiple extensions", async () => {
    const { code, stderr } = await runCli([
      "serve",
      "--extension",
      MINIMAL_FIXTURE,
      "--extension",
      UNSUPPORTED_FIXTURE,
      "--strict",
    ]);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/unsupported-ext/);
    expect(stderr).toMatch(/registerShortcut/);
  }, 15000);

  it("refuses to serve in --strict mode when the extension registers unsupported items", async () => {
    const { code, stderr } = await runCli([
      "serve",
      "--extension",
      UNSUPPORTED_FIXTURE,
      "--strict",
    ]);

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/strict/i);
    expect(stderr).toMatch(/registerShortcut/);
    expect(stderr).toMatch(/agent_start/);
  }, 15000);
});
