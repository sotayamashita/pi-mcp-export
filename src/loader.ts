import { existsSync } from "node:fs";
import { createJiti } from "jiti";
import { createExtensionApi } from "@/api-mock/extension-api.ts";
import type { ToolRegistry } from "@/registry/tool-registry.ts";
import type { EventRouter } from "@/registry/event-router.ts";
import type { ExtensionApi } from "@/api-mock/extension-api.ts";
import type { LoadDiagnostics } from "@/api-mock/load-diagnostics.ts";

type ExtensionEntry = (pi: ExtensionApi) => void | Promise<void>;

export async function loadExtension(
  path: string,
  registry: ToolRegistry,
  events: EventRouter,
  diagnostics?: LoadDiagnostics,
  commandNames?: Set<string>,
): Promise<void> {
  if (!existsSync(path)) {
    throw new Error(`Extension file not found: ${path}`);
  }
  const jiti = createJiti(import.meta.url);
  const entry = await jiti.import<ExtensionEntry>(path, { default: true });
  const api = createExtensionApi(registry, events, diagnostics, commandNames);
  await entry(api);
}
