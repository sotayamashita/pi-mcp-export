import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "@/registry/tool-registry.ts";
import type { EventRouter } from "@/registry/event-router.ts";
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
  events?: EventRouter;
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
    const ctx = createExecuteContext({
      cwd: opts.cwd,
      signal: opts.signal,
      notify: opts.notify,
      ...(opts.sessionId !== undefined && { sessionId: opts.sessionId }),
    });
    const toolCallId = randomUUID();
    const input = ((args as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;

    let content: CallToolResult["content"] = [];
    let details: unknown;
    let isError = false;
    let blocked = false;

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
          r = await handler(callEvent, ctx);
        } catch (err) {
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
        try {
          const executeResult = await tool.execute(toolCallId, input, opts.signal, onUpdate, ctx);
          content = executeResult.content;
          details = executeResult.details;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          content = [{ type: "text", text: message }];
          isError = true;
        }
      }
    }

    if (opts.events) {
      const resultEvent: ToolResultEvent = {
        type: "tool_result",
        toolCallId,
        toolName: name,
        input: inputSnapshot,
        content: blocked ? cloneContent(content) : content,
        details: blocked ? cloneDetails(details) : details,
        isError,
      };
      for (const handler of opts.events.handlersOf("tool_result")) {
        let r: unknown;
        try {
          r = await handler(resultEvent, ctx);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[pi-mcp-export] handler for "tool_result" threw: ${message}\n`);
          continue;
        }
        if (blocked) continue;
        if (typeof r !== "object" || r === null) continue;
        if ("content" in r) {
          resultEvent.content = (r as { content: CallToolResult["content"] }).content;
        }
        if ("details" in r) resultEvent.details = (r as { details: unknown }).details;
        if ("isError" in r) resultEvent.isError = Boolean((r as { isError: unknown }).isError);
      }
      if (!blocked) {
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
