import { describe, it, expect, vi, afterEach } from "vitest";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { createExtensionApi } from "./extension-api.ts";
import type { ToolDef } from "@/types/tool-def.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeTool(name: string): ToolDef {
  return {
    name,
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: name }] }),
  };
}

describe("createExtensionApi", () => {
  it("forwards registerTool to the underlying ToolRegistry", () => {
    const registry = new ToolRegistry();
    const api = createExtensionApi(registry);
    const tool = makeTool("greet");

    api.registerTool(tool);

    expect(registry.get("greet")).toBe(tool);
  });

  it("warns to stderr and no-ops when an unsupported API is invoked", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const api = createExtensionApi(new ToolRegistry());

    expect(() => api.registerShortcut("ctrl+x", {})).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/registerShortcut/));
  });
});
