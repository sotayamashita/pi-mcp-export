import { describe, it, expect, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { dispatchTool } from "./tool-dispatcher.ts";
import type { ToolDef } from "@/types/tool-def.ts";

describe("dispatchTool", () => {
  it("invokes execute with the provided arguments and returns the content as an MCP tool result", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: "hello, world" }] });
    const registry = new ToolRegistry();
    registry.register({
      name: "greet",
      parameters: Type.Object({ name: Type.String() }),
      execute,
    } satisfies ToolDef);

    const result = await dispatchTool(registry, "greet", { name: "world" });

    expect(execute).toHaveBeenCalledWith({ name: "world" });
    expect(result).toEqual({
      content: [{ type: "text", text: "hello, world" }],
    });
  });

  it("returns an MCP error result when the tool's execute throws", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "boom",
      parameters: Type.Object({}),
      execute: async () => {
        throw new Error("kaboom");
      },
    } satisfies ToolDef);

    const result = await dispatchTool(registry, "boom", {});

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("kaboom") }],
    });
  });

  it("returns an MCP error result when the requested tool is unknown", async () => {
    const registry = new ToolRegistry();

    const result = await dispatchTool(registry, "missing", {});

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: expect.stringMatching(/unknown tool "missing"/) }],
    });
  });
});
