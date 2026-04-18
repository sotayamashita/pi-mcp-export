import { Server } from "@modelcontextprotocol/sdk/server";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { dispatchTool } from "@/dispatch/tool-dispatcher.ts";
import { typeboxToJsonSchema } from "@/schema/typebox-to-json-schema.ts";
import type { ToolRegistry } from "@/registry/tool-registry.ts";

export function createServer(registry: ToolRegistry): Server {
  const server = new Server(
    { name: "pi-mcp-export", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.list().map((tool) => ({
      name: tool.name,
      inputSchema: typeboxToJsonSchema(tool.parameters),
      ...(tool.description !== undefined && { description: tool.description }),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return dispatchTool(registry, name, args ?? {});
  });

  return server;
}
