import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "@/registry/tool-registry.ts";
import type { EventRouter } from "@/registry/event-router.ts";
import { createExecuteContext } from "@/api-mock/execute-context.ts";
import type { ProgressParams } from "@/types/progress-params.ts";

const FALLBACK_PROGRESS_MESSAGE = "progress update";
const FLUSH_TIMEOUT_MS = 5000;
const POST_HOOK_BUDGET_MS = 100;

export interface DispatchOptions {
  signal: AbortSignal;
  cwd: string;
  notify: (message: string, level?: "info" | "warn" | "error") => void;
  sessionId?: string;
  sendProgress?: (params: ProgressParams) => void | Promise<void>;
  events?: EventRouter;
  timeoutMs?: number;
}

interface ToolCallEvent {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface ToolResultEvent {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  content: CallToolResult["content"];
  details: unknown;
  isError: boolean;
}

function isBlockResult(r: unknown): boolean {
  return (
    typeof r === "object" && r !== null && "block" in r && (r as { block: unknown }).block === true
  );
}

function blockReason(r: unknown): string {
  const reason = (r as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : "Tool execution was blocked";
}

function cloneInput(input: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(input);
  } catch {
    try {
      return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    } catch {
      return { ...input };
    }
  }
}

function cloneContent(content: CallToolResult["content"]): CallToolResult["content"] {
  try {
    return structuredClone(content);
  } catch {
    return JSON.parse(JSON.stringify(content)) as CallToolResult["content"];
  }
}

function cloneDetails(details: unknown): unknown {
  if (details === undefined) return undefined;
  try {
    return structuredClone(details);
  } catch {
    try {
      return JSON.parse(JSON.stringify(details));
    } catch {
      return details;
    }
  }
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

function withBudget<T>(p: Promise<T>, budgetMs: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_resolve, reject) => {
      const t = setTimeout(() => reject(new Error("post-hook budget exceeded")), budgetMs);
      t.unref?.();
    }),
  ]);
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("dispatch aborted by timeout"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("dispatch aborted by timeout")), {
      once: true,
    });
  });
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
  const sendProgress = opts.sendProgress;
  let highestSynthesized = 0;
  let progressChain: Promise<unknown> = Promise.resolve();
  let hasPending = false;

  const timeoutMs = opts.timeoutMs;
  let timeoutController: AbortController | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let effectiveSignal = opts.signal;
  if (timeoutMs !== undefined && timeoutMs > 0) {
    const ctrl = new AbortController();
    timeoutController = ctrl;
    effectiveSignal = AbortSignal.any([opts.signal, ctrl.signal]);
    timeoutHandle = setTimeout(() => ctrl.abort(), timeoutMs);
    timeoutHandle.unref?.();
  }
  const raceTimeout = <T>(p: Promise<T>): Promise<T> =>
    timeoutController ? Promise.race([p, rejectOnAbort(timeoutController.signal)]) : p;
  const timeoutMessage = (): string => `Tool execution timed out after ${(timeoutMs ?? 0) / 1000}s`;
  const onUpdate = (partial: unknown): void => {
    if (!sendProgress) return;
    if (timeoutController?.signal.aborted) return;
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
    const ctx = createExecuteContext({
      cwd: opts.cwd,
      signal: effectiveSignal,
      notify: opts.notify,
      ...(opts.sessionId !== undefined && { sessionId: opts.sessionId }),
    });
    const toolCallId = randomUUID();
    const input = ((args as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;

    let content: CallToolResult["content"] = [];
    let details: unknown;
    let isError = false;
    let blocked = false;
    let timedOut = false;

    if (opts.events) {
      const callEvent: ToolCallEvent = {
        type: "tool_call",
        toolCallId,
        toolName: name,
        input,
      };
      for (const handler of opts.events.handlersOf("tool_call")) {
        let r: unknown;
        try {
          r = await raceTimeout(Promise.resolve(handler(callEvent, ctx)));
        } catch (err) {
          if (timeoutController?.signal.aborted) {
            content = [{ type: "text", text: timeoutMessage() }];
            isError = true;
            blocked = true;
            timedOut = true;
            break;
          }
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[pi-mcp-export] handler for "tool_call" threw: ${message}\n`);
          content = [{ type: "text", text: `Tool execution was blocked: ${message}` }];
          isError = true;
          blocked = true;
          break;
        }
        if (isBlockResult(r)) {
          content = [{ type: "text", text: blockReason(r) }];
          isError = true;
          blocked = true;
          break;
        }
      }
    }

    const inputSnapshot = cloneInput(input);

    if (!blocked) {
      if (!tool) {
        content = [{ type: "text", text: `unknown tool "${name}"` }];
        isError = true;
      } else {
        let executePromise: Promise<{ content: CallToolResult["content"]; details?: unknown }>;
        try {
          executePromise = Promise.resolve(
            tool.execute(toolCallId, input, effectiveSignal, onUpdate, ctx),
          );
        } catch (err) {
          executePromise = Promise.reject(err);
        }
        try {
          const executeResult = await raceTimeout(executePromise);
          content = executeResult.content;
          details = executeResult.details;
        } catch (err) {
          if (timeoutController?.signal.aborted) {
            content = [{ type: "text", text: timeoutMessage() }];
            details = undefined;
            isError = true;
            timedOut = true;
          } else {
            const message = err instanceof Error ? err.message : String(err);
            content = [{ type: "text", text: message }];
            isError = true;
          }
        }
        executePromise.catch(() => {});
      }
    }

    if (opts.events) {
      const resultEvent: ToolResultEvent = {
        type: "tool_result",
        toolCallId,
        toolName: name,
        input: inputSnapshot,
        content: blocked || timedOut ? cloneContent(content) : content,
        details: blocked || timedOut ? cloneDetails(details) : details,
        isError,
      };
      for (const handler of opts.events.handlersOf("tool_result")) {
        let r: unknown;
        try {
          if (timedOut) {
            r = await withBudget(Promise.resolve(handler(resultEvent, ctx)), POST_HOOK_BUDGET_MS);
          } else {
            r = await raceTimeout(Promise.resolve(handler(resultEvent, ctx)));
          }
        } catch (err) {
          if (timedOut) continue;
          if (timeoutController?.signal.aborted) {
            content = [{ type: "text", text: timeoutMessage() }];
            details = undefined;
            isError = true;
            timedOut = true;
            resultEvent.content = cloneContent(content);
            resultEvent.details = cloneDetails(details);
            resultEvent.isError = true;
            continue;
          }
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[pi-mcp-export] handler for "tool_result" threw: ${message}\n`);
          continue;
        }
        if (blocked || timedOut) continue;
        if (typeof r !== "object" || r === null) continue;
        if ("content" in r) {
          resultEvent.content = (r as { content: CallToolResult["content"] }).content;
        }
        if ("details" in r) resultEvent.details = (r as { details: unknown }).details;
        if ("isError" in r) resultEvent.isError = Boolean((r as { isError: unknown }).isError);
      }
      if (!blocked && !timedOut) {
        content = resultEvent.content;
        details = resultEvent.details;
        isError = resultEvent.isError;
      }
    }

    return {
      content,
      ...(isError && { isError: true }),
      ...(details !== undefined && {
        structuredContent: details as { [x: string]: unknown },
      }),
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (hasPending && !timeoutController?.signal.aborted) {
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
