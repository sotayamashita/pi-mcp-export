import { Kind } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";

export function typeboxToJsonSchema(schema: TSchema): unknown {
  const kind = (schema as { [Kind]?: string })[Kind];
  if (typeof kind !== "string") {
    process.stderr.write(`[pi-mcp-export] value is not a TypeBox schema, falling back to string\n`);
    return { type: "string" };
  }
  const stripped = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  if (stripped["type"] === "object" && !Array.isArray(stripped["required"])) {
    stripped["required"] = [];
  }
  return stripped;
}
