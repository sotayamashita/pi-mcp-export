import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "./tool-registry.ts";
import type { ToolDef } from "@/types/tool-def.ts";

function fakeTool(name: string): ToolDef {
  return {
    name,
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: name }] }),
  };
}

describe("ToolRegistry", () => {
  it("registers a tool and returns it via get(name)", () => {
    const registry = new ToolRegistry();
    const tool = fakeTool("alpha");

    registry.register(tool);

    expect(registry.get("alpha")).toBe(tool);
  });

  it("rejects a duplicate tool registration with a descriptive error", () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool("alpha"));

    expect(() => registry.register(fakeTool("alpha"))).toThrow(/already registered/);
  });

  it("lists every registered tool in insertion order", () => {
    const registry = new ToolRegistry();
    const a = fakeTool("a");
    const b = fakeTool("b");
    registry.register(a);
    registry.register(b);

    expect(registry.list()).toEqual([a, b]);
  });
});
