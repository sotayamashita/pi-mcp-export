// @ts-expect-error intentionally missing: fixture verifies that loader propagates nested MODULE_NOT_FOUND
import "./does-not-exist.ts";
import type { ExtensionApi } from "@/api-mock/extension-api.ts";

export default function (_pi: ExtensionApi): void {
  return;
}
