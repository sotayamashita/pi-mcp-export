import { Type } from "@sinclair/typebox";
import type { ExtensionApi } from "@/api-mock/extension-api.ts";

export default function (pi: ExtensionApi): void {
  pi.registerTool({
    name: "noop",
    description: "Does nothing of interest",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
  pi.registerCommand("ping", {
    description: "Ping command",
    handler: async () => {},
  });
  pi.registerShortcut("cmd+K", {
    description: "Palette",
    handler: async () => {},
  });
  pi.on("agent_start", () => {});
}
