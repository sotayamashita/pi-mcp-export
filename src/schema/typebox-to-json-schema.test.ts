import { describe, it, expect, vi, afterEach } from "vitest";
import { Type } from "@sinclair/typebox";
import { typeboxToJsonSchema } from "./typebox-to-json-schema.ts";

describe("typeboxToJsonSchema", () => {
  it("converts empty Type.Object to object schema with empty properties and required", () => {
    const schema = Type.Object({});
    expect(typeboxToJsonSchema(schema)).toEqual({
      type: "object",
      properties: {},
      required: [],
    });
  });

  it("converts Type.String to string schema", () => {
    expect(typeboxToJsonSchema(Type.String())).toEqual({ type: "string" });
  });

  it("converts Type.Number to number schema", () => {
    expect(typeboxToJsonSchema(Type.Number())).toEqual({ type: "number" });
  });

  it("converts Type.Boolean to boolean schema", () => {
    expect(typeboxToJsonSchema(Type.Boolean())).toEqual({ type: "boolean" });
  });

  it("marks declared properties as required in the object schema", () => {
    const schema = Type.Object({ name: Type.String(), age: Type.Number() });
    expect(typeboxToJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name", "age"],
    });
  });

  describe("unknown kind fallback", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("falls back to string schema and writes a stderr warning for unknown kinds", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const unknown = { $id: "mystery" } as unknown as Parameters<typeof typeboxToJsonSchema>[0];

      expect(typeboxToJsonSchema(unknown)).toEqual({ type: "string" });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/not a TypeBox schema/));
    });
  });
});
