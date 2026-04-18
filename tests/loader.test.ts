import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { ToolRegistry } from "@/registry/tool-registry.ts";
import { loadExtension } from "@/loader.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/minimal-ext/index.ts", import.meta.url));
const BROKEN = fileURLToPath(new URL("./fixtures/broken-ext/index.ts", import.meta.url));

describe("loadExtension", () => {
  it("loads a fixture extension and registers its tools via the ExtensionAPI mock", async () => {
    const registry = new ToolRegistry();

    await loadExtension(FIXTURE, registry);

    const greet = registry.get("greet");
    expect(greet).toBeDefined();
    expect(greet?.name).toBe("greet");
  });

  it("throws a meaningful error when the extension file does not exist", async () => {
    const registry = new ToolRegistry();

    await expect(loadExtension("/tmp/definitely-missing-pi-ext.ts", registry)).rejects.toThrow(
      /definitely-missing-pi-ext/,
    );
  });

  it("propagates extension-internal module resolution errors instead of masking them as a missing extension", async () => {
    const registry = new ToolRegistry();

    await expect(loadExtension(BROKEN, registry)).rejects.toThrow(/does-not-exist/);
    await expect(loadExtension(BROKEN, registry)).rejects.not.toThrow(/Extension file not found/);
  });
});
