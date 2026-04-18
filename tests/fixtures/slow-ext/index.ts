import { Type } from "@sinclair/typebox";
import type { ExtensionApi } from "@/api-mock/extension-api.ts";

export default function (pi: ExtensionApi): void {
  pi.registerTool({
    name: "hang",
    description: "Blocks until the signal aborts",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal) {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { content: [{ type: "text", text: "unreachable" }] };
    },
  });
}
