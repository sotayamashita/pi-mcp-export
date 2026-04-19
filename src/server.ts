import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { dispatchTool } from "@/dispatch/tool-dispatcher.ts";
import { typeboxToJsonSchema } from "@/schema/typebox-to-json-schema.ts";
import { createExecuteContext } from "@/api-mock/execute-context.ts";
import type { ToolRegistry } from "@/registry/tool-registry.ts";
import type { EventRouter } from "@/registry/event-router.ts";
import type { ProgressParams } from "@/types/progress-params.ts";

export interface ServerOptions {
  cwd?: string;
  perCallTimeoutMs?: number;
}

export function createServer(
  registry: ToolRegistry,
  events?: EventRouter,
  options: ServerOptions = {},
): Server {
  const cwd = options.cwd ?? process.cwd();
  const sessionId = `mcp-${randomUUID()}`;
  const server = new Server(
    { name: "pi-mcp-export", version: "0.1.0" },
    { capabilities: { tools: {}, logging: {} } },
  );

  const notify = (message: string, level: "info" | "warn" | "error" = "info"): void => {
    void server.sendLoggingMessage({
      level: level === "warn" ? "warning" : level,
      data: message,
    });
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.list().map((tool) => ({
      name: tool.name,
      inputSchema: typeboxToJsonSchema(tool.parameters),
      ...(tool.description !== undefined && { description: tool.description }),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const progressToken = request.params._meta?.progressToken;
    const sendProgress =
      progressToken !== undefined
        ? (params: ProgressParams): Promise<void> =>
            extra.sendNotification({
              method: "notifications/progress",
              params: { progressToken, ...params },
            })
        : undefined;
    return dispatchTool(registry, name, args ?? {}, {
      signal: extra.signal,
      cwd,
      notify,
      sessionId,
      ...(sendProgress !== undefined && { sendProgress }),
      ...(events !== undefined && { events }),
      ...(options.perCallTimeoutMs !== undefined && { timeoutMs: options.perCallTimeoutMs }),
    });
  });

  if (events) {
    const sessionAborter = new AbortController();
    const buildEventCtx = (): unknown =>
      createExecuteContext({ cwd, signal: sessionAborter.signal, notify, sessionId });
    server.oninitialized = (): void => {
      void events.emit("session_start", { reason: "startup" }, buildEventCtx());
    };
    const previousOnClose = server.onclose;
    server.onclose = (): void => {
      void (async () => {
        try {
          await events.emit("session_shutdown", { reason: "close" }, buildEventCtx());
        } finally {
          sessionAborter.abort();
        }
      })();
      previousOnClose?.();
    };
  }

  return server;
}
