import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../../bin/pi-mcp-export.mjs", import.meta.url));
const EXT_PATH =
  process.env["PI_AUTORESEARCH_PATH"] ??
  "/Users/sotayamashita/Projects/repository-research/pi-autoresearch/extensions/pi-autoresearch";
const SKIP_REASON = !existsSync(EXT_PATH) ? `pi-autoresearch not found at ${EXT_PATH}` : "";

const describeIfPresent = SKIP_REASON ? describe.skip : describe;

describeIfPresent("pi-autoresearch e2e", () => {
  let workDir: string;
  let client: Client;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "pi-mcp-export-phase2-"));
    execSync(
      "git init --quiet && git config user.email test@example.com && git config user.name test",
      { cwd: workDir, shell: "/bin/sh" },
    );

    const transport = new StdioClientTransport({
      command: "node",
      args: [CLI, "serve", "--extension", EXT_PATH],
      cwd: workDir,
    });
    client = new Client({ name: "phase2-e2e", version: "0.0.0" });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    if (client) await client.close();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("exposes the 3 experiment tools plus command_autoresearch via tools/list", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual(
      expect.arrayContaining([
        "command_autoresearch",
        "init_experiment",
        "log_experiment",
        "run_experiment",
      ]),
    );
  });

  it("completes init -> run -> log sequence and appends a result to autoresearch.jsonl", async () => {
    const init = await client.callTool({
      name: "init_experiment",
      arguments: {
        name: "phase-2-smoke",
        metric_name: "duration_ms",
        metric_unit: "ms",
        direction: "lower",
      },
    });
    expect(init).not.toHaveProperty("isError", true);

    const run = await client.callTool({
      name: "run_experiment",
      arguments: { command: "echo ok" },
    });
    expect(run).not.toHaveProperty("isError", true);

    const log = await client.callTool({
      name: "log_experiment",
      arguments: {
        commit: "0000000",
        metric: 1,
        status: "keep",
        description: "phase-2 smoke test",
      },
    });
    expect(log).not.toHaveProperty("isError", true);

    const jsonlPath = join(workDir, "autoresearch.jsonl");
    expect(existsSync(jsonlPath)).toBe(true);
    const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
    const records = lines.map((line) => JSON.parse(line) as { type?: string });
    const results = records.filter(
      (r) => r.type === "result" || r.type === undefined || r.type === "experiment",
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
  }, 60000);
});
