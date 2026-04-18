import type { ToolDef } from "@/types/tool-def.ts";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();

  register(def: ToolDef): void {
    if (this.tools.has(def.name)) {
      throw new Error(`Tool "${def.name}" is already registered`);
    }
    this.tools.set(def.name, def);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  list(): ReadonlyArray<ToolDef> {
    return [...this.tools.values()];
  }
}
