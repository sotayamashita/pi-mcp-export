import type { TSchema } from "@sinclair/typebox";

export interface ToolDef {
  name: string;
  description?: string;
  parameters: TSchema;
  execute: (params: unknown) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}
