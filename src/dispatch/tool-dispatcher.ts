import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "@/registry/tool-registry.ts";
import { createExecuteContext } from "@/api-mock/execute-context.ts";

export interface DispatchOptions {
  signal: AbortSignal;
  cwd: string;
  notify: (message: string, level?: "info" | "warn" | "error") => void;
  sessionId?: string;
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
  try {
    const ctx = createExecuteContext({
      cwd: opts.cwd,
      signal: opts.signal,
      notify: opts.notify,
      ...(opts.sessionId !== undefined && { sessionId: opts.sessionId }),
    });
    const onUpdate = (_partial: unknown): void => {};
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
}
