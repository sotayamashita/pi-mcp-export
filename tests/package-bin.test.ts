import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const PKG_PATH = fileURLToPath(new URL("../package.json", import.meta.url));

describe("package.json bin mapping", () => {
  it("publishes pi-mcp-export as an executable whose target file exists", () => {
    const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as {
      bin?: Record<string, string> | string;
    };
    expect(pkg.bin).toBeDefined();

    const binTarget = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["pi-mcp-export"];
    expect(binTarget).toBeTypeOf("string");

    const absolute = resolve(dirname(PKG_PATH), binTarget!);
    expect(existsSync(absolute)).toBe(true);
  });
});
