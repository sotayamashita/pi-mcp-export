import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "@/registry/tool-registry.ts";

export async function dispatchTool(
  registry: ToolRegistry,
  name: string,
  args: unknown,
): Promise<CallToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `unknown tool "${name}"` }],
    };
  }
  try {
    const result = await tool.execute(args);
    return { content: result.content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
}
