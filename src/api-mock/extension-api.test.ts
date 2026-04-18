import { describe, it, expect, vi, afterEach } from "vitest";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { EventRouter } from "@/registry/event-router.ts";
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
    const api = createExtensionApi(registry, new EventRouter());
    const tool = makeTool("greet");

    api.registerTool(tool);

    expect(registry.get("greet")).toBe(tool);
  });

  it("registers event handlers on the EventRouter", async () => {
    const router = new EventRouter();
    const api = createExtensionApi(new ToolRegistry(), router);
    const handler = vi.fn();

    api.on("session_start", handler);
    await router.emit("session_start", { reason: "startup" });

    expect(handler).toHaveBeenCalledWith({ reason: "startup" });
  });

  it("exposes registerCommand as a Tool named command_<name>", async () => {
    const registry = new ToolRegistry();
    const api = createExtensionApi(registry, new EventRouter());
    const handler = vi.fn(async (_args: string) => {});

    api.registerCommand("autoresearch", {
      description: "Run autoresearch command",
      handler,
    });

    const tool = registry.get("command_autoresearch");
    expect(tool).toBeDefined();
    expect(tool?.description).toBe("Run autoresearch command");
  });

  it("provides pi.exec that shells out via piExec", async () => {
    const api = createExtensionApi(new ToolRegistry(), new EventRouter());

    const result = await api.exec("node", ["-e", "console.log('x')"], {});

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("x");
  });

  it("warns to stderr and no-ops when an unsupported API is invoked", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const api = createExtensionApi(new ToolRegistry(), new EventRouter());

    expect(() =>
      api.registerShortcut("ctrl+x", { description: "x", handler: async () => {} }),
    ).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/registerShortcut/));
  });
});
