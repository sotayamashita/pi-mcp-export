import { Type } from "@sinclair/typebox";
import type { ToolRegistry } from "@/registry/tool-registry.ts";
import type { EventRouter, EventHandler } from "@/registry/event-router.ts";
import type { ToolDef } from "@/types/tool-def.ts";
import type { ExecuteContext } from "@/types/extension-context.ts";
import type { PiExecOptions, PiExecResult } from "./pi-exec.ts";
import { piExec } from "./pi-exec.ts";
import { warnUnsupported } from "./unsupported.ts";

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

const COMMAND_PARAMS = Type.Object({
  args: Type.Optional(Type.String()),
});

export function createExtensionApi(registry: ToolRegistry, events: EventRouter): ExtensionApi {
  return {
    registerTool(def) {
      registry.register(def);
    },
    registerCommand(name, opts) {
      registry.register({
        name: `command_${name}`,
        description: opts.description,
        parameters: COMMAND_PARAMS,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const p = (params ?? {}) as { args?: string };
          await opts.handler(p.args ?? "", ctx);
          return { content: [{ type: "text", text: `command ${name} executed` }] };
        },
      });
    },
    registerShortcut(_key, _opts) {
      warnUnsupported("registerShortcut");
    },
    on(event, handler) {
      events.on(event, handler);
    },
    exec(cmd, args, opts) {
      return piExec(cmd, args, opts);
    },
  };
}
