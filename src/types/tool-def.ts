import type { TSchema } from "@sinclair/typebox";
import type { ExecuteContext } from "@/types/extension-context.ts";

export interface ToolExecuteResult {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
}

export interface ToolDef {
  name: string;
  label?: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: ReadonlyArray<string>;
  parameters: TSchema;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal,
    onUpdate: (partial: unknown) => void,
    ctx: ExecuteContext,
  ) => Promise<ToolExecuteResult>;
}
