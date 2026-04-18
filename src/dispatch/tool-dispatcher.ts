import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "@/registry/tool-registry.ts";
import { createExecuteContext } from "@/api-mock/execute-context.ts";
import type { ProgressParams } from "@/types/progress-params.ts";

const FALLBACK_PROGRESS_MESSAGE = "progress update";
const FLUSH_TIMEOUT_MS = 5000;

export interface DispatchOptions {
  signal: AbortSignal;
  cwd: string;
  notify: (message: string, level?: "info" | "warn" | "error") => void;
  sessionId?: string;
  sendProgress?: (params: ProgressParams) => void | Promise<void>;
}

function progressMessage(partial: unknown): string {
  if (typeof partial !== "object" || partial === null || !("details" in partial)) {
    return FALLBACK_PROGRESS_MESSAGE;
  }
  const details = partial.details;
  if (typeof details !== "object" || details === null) {
    return FALLBACK_PROGRESS_MESSAGE;
  }
  const phase = "phase" in details && typeof details.phase === "string" ? details.phase : undefined;
  const elapsed =
    "elapsed" in details && typeof details.elapsed === "string" ? details.elapsed : undefined;
  if (phase && elapsed) return `${phase} (${elapsed})`;
  return phase ?? elapsed ?? FALLBACK_PROGRESS_MESSAGE;
}

function extractExplicitProgress(partial: unknown): ProgressParams | null {
  if (typeof partial !== "object" || partial === null || !("progress" in partial)) return null;
  const progress = partial.progress;
  if (typeof progress !== "number") return null;
  const out: ProgressParams = { progress };
  if ("total" in partial && typeof partial.total === "number") out.total = partial.total;
  if ("message" in partial && typeof partial.message === "string") out.message = partial.message;
  return out;
}

export async function dispatchTool(
  registry: ToolRegistry,
  name: string,
  args: unknown,
  opts: DispatchOptions,
): Promise<CallToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `unknown tool "${name}"` }],
    };
  }
  const sendProgress = opts.sendProgress;
  let highestSynthesized = 0;
  let progressChain: Promise<unknown> = Promise.resolve();
  let hasPending = false;
  const onUpdate = (partial: unknown): void => {
    if (!sendProgress) return;
    const explicit = extractExplicitProgress(partial);
    let params: ProgressParams;
    if (explicit) {
      params = explicit;
      highestSynthesized = Math.max(highestSynthesized, explicit.progress);
    } else {
      highestSynthesized += 1;
      params = { progress: highestSynthesized, message: progressMessage(partial) };
    }
    hasPending = true;
    progressChain = progressChain.then(() => sendProgress(params)).catch(() => {});
  };
  try {
    try {
      const ctx = createExecuteContext({
        cwd: opts.cwd,
        signal: opts.signal,
        notify: opts.notify,
        ...(opts.sessionId !== undefined && { sessionId: opts.sessionId }),
      });
      const result = await tool.execute(randomUUID(), args, opts.signal, onUpdate, ctx);
      return {
        content: result.content,
        ...(result.details !== undefined && {
          structuredContent: result.details as { [x: string]: unknown },
        }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  } finally {
    if (hasPending) {
      await Promise.race([
        progressChain,
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, FLUSH_TIMEOUT_MS);
          t.unref?.();
        }),
      ]);
    }
  }
}
