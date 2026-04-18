import type { ToolRegistry } from "@/registry/tool-registry.ts";
import type { ToolDef } from "@/types/tool-def.ts";
import { warnUnsupported } from "./unsupported.ts";

export interface ExtensionApi {
  registerTool(def: ToolDef): void;
  registerShortcut(key: string, opts: unknown): void;
}

export function createExtensionApi(registry: ToolRegistry): ExtensionApi {
  return {
    registerTool(def) {
      registry.register(def);
    },
    registerShortcut(_key, _opts) {
      warnUnsupported("registerShortcut");
    },
  };
}
