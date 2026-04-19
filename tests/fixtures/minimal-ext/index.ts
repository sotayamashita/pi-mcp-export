import { Type } from "@sinclair/typebox";
import type { ExtensionApi } from "@/api-mock/extension-api.ts";

export default function (pi: ExtensionApi): void {
  pi.registerTool({
    name: "greet",
    description: "Greets the given name",
    parameters: Type.Object({ name: Type.String() }),
    async execute(_toolCallId, params) {
      const { name } = params as { name: string };
      return { content: [{ type: "text", text: `hello, ${name}` }] };
    },
  });
}
