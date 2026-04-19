import { randomUUID } from "node:crypto";
import type { ExecuteContext } from "@/types/extension-context.ts";

export interface ExecuteContextArgs {
  cwd: string;
  signal: AbortSignal;
  notify: (message: string, level?: "info" | "warn" | "error") => void;
  sessionId?: string;
}

export function createExecuteContext(args: ExecuteContextArgs): ExecuteContext {
  const sessionId = args.sessionId ?? `mcp-${randomUUID()}`;

  return {
    cwd: args.cwd,
    signal: args.signal,
    hasUI: false,
    hasTerminal: false,
    ui: {
      notify: args.notify,
      setWidget: () => {},
      custom: async () => undefined,
    },
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => [],
    },
    getContextUsage: () => ({ input: 0, output: 0, total: 0 }),
    abort: () => {},
  };
}
