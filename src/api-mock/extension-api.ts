import { Type } from "@sinclair/typebox";
import type { ToolRegistry } from "@/registry/tool-registry.ts";
import type { EventRouter, EventHandler } from "@/registry/event-router.ts";
import type { ToolDef } from "@/types/tool-def.ts";
import type { ExecuteContext } from "@/types/extension-context.ts";
import type { PiExecOptions, PiExecResult } from "./pi-exec.ts";
import { piExec } from "./pi-exec.ts";
import { warnUnsupported } from "./unsupported.ts";
import type { LoadDiagnostics } from "./load-diagnostics.ts";
import { SUPPORTED_EVENTS, UNSUPPORTED_EVENTS } from "./support-policy.ts";

export interface CommandHandler {
  description: string;
  handler: (args: string, ctx: ExecuteContext) => Promise<void>;
}

export interface ShortcutHandler {
  description: string;
  handler: (ctx: ExecuteContext) => Promise<void>;
}

export interface ExtensionApi {
  registerTool(def: ToolDef): void;
  registerCommand(name: string, opts: CommandHandler): void;
  registerShortcut(key: string, opts: ShortcutHandler): void;
  on(event: string, handler: EventHandler): void;
  exec(cmd: string, args: ReadonlyArray<string>, opts: PiExecOptions): Promise<PiExecResult>;
}

export const COMMAND_PREFIX = "command_";

const COMMAND_PARAMS = Type.Object({
  args: Type.Optional(Type.String()),
});

export function createExtensionApi(
  registry: ToolRegistry,
  events: EventRouter,
  diagnostics?: LoadDiagnostics,
  commandNames?: Set<string>,
): ExtensionApi {
  return {
    registerTool(def) {
      registry.register(def);
    },
    registerCommand(name, opts) {
      registry.register({
        name: `${COMMAND_PREFIX}${name}`,
        description: opts.description,
        parameters: COMMAND_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const p = (params ?? {}) as { args?: string };
          await opts.handler(p.args ?? "", ctx);
          return { content: [{ type: "text", text: `command ${name} executed` }] };
        },
      });
      commandNames?.add(name);
    },
    registerShortcut(key, _opts) {
      warnUnsupported("registerShortcut");
      diagnostics?.record({
        kind: "unsupported-api",
        api: "registerShortcut",
        meta: { key },
      });
    },
    on(event, handler) {
      events.on(event, handler);
      const reason = UNSUPPORTED_EVENTS.get(event);
      if (reason !== undefined) {
        diagnostics?.record({ kind: "unsupported-event", event, reason });
      } else if (!SUPPORTED_EVENTS.has(event)) {
        diagnostics?.record({ kind: "unknown-event", event });
      }
    },
    exec(cmd, args, opts) {
      return piExec(cmd, args, opts);
    },
  };
}
