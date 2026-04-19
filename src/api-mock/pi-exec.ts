import { spawn } from "node:child_process";

export interface PiExecOptions {
  cwd?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export interface PiExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
}

const ESCALATION_MS = 500;

export function piExec(
  command: string,
  args: ReadonlyArray<string>,
  opts: PiExecOptions,
): Promise<PiExecResult> {
  return new Promise<PiExecResult>((resolvePromise) => {
    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let requestedKill = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const killCascade = (): void => {
      if (child.exitCode !== null || child.killed) return;
      requestedKill = true;
      child.kill("SIGTERM");
      if (killTimer) return;
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, ESCALATION_MS);
      killTimer.unref();
    };

    if (opts.signal) {
      if (opts.signal.aborted) killCascade();
      else opts.signal.addEventListener("abort", killCascade, { once: true });
    }
    if (opts.timeout) {
      timeoutTimer = setTimeout(killCascade, opts.timeout);
      timeoutTimer.unref();
    }

    const cleanup = (): void => {
      if (killTimer) clearTimeout(killTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      opts.signal?.removeEventListener("abort", killCascade);
    };

    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise({
        code,
        stdout,
        stderr,
        killed: requestedKill || signal !== null,
      });
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise({ code: null, stdout, stderr, killed: requestedKill });
    });
  });
}
