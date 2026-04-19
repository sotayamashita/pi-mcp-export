import { describe, it, expect } from "vitest";
import { piExec } from "./pi-exec.ts";

describe("piExec", () => {
  it("captures stdout, stderr, and exit code on success", async () => {
    const result = await piExec("node", ["-e", "console.log('hi'); console.error('err');"], {});

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hi");
    expect(result.stderr).toContain("err");
    expect(result.killed).toBe(false);
  });

  it("returns the non-zero exit code without throwing", async () => {
    const result = await piExec("node", ["-e", "process.exit(3)"], {});

    expect(result.code).toBe(3);
    expect(result.killed).toBe(false);
  });

  it("kills the process when the AbortSignal fires and surfaces killed=true", async () => {
    const controller = new AbortController();
    const pending = piExec("node", ["-e", "setInterval(() => {}, 1000)"], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);

    const result = await pending;

    expect(result.killed).toBe(true);
  }, 5000);

  it("escalates to SIGKILL when the child traps SIGTERM after abort", async () => {
    const controller = new AbortController();
    const start = Date.now();
    const pending = piExec(
      "node",
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);

    const result = await pending;
    const elapsed = Date.now() - start;

    expect(result.killed).toBe(true);
    expect(elapsed).toBeLessThan(3000);
  }, 5000);
});
