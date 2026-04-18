import { describe, it, expect, vi } from "vitest";
import { EventRouter } from "./event-router.ts";

describe("EventRouter", () => {
  it("invokes every handler registered for an event in registration order", async () => {
    const router = new EventRouter();
    const calls: string[] = [];
    router.on("session_start", () => {
      calls.push("a");
    });
    router.on("session_start", () => {
      calls.push("b");
    });

    await router.emit("session_start", { reason: "startup" });

    expect(calls).toEqual(["a", "b"]);
  });

  it("is a no-op when emitting an event with no registered handlers", async () => {
    const router = new EventRouter();

    await expect(router.emit("session_start", {})).resolves.toBeUndefined();
  });

  it("continues invoking later handlers after one throws and reports the failure to stderr", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const router = new EventRouter();
      const later = vi.fn();
      router.on("session_start", () => {
        throw new Error("boom");
      });
      router.on("session_start", later);

      await router.emit("session_start", {});

      expect(later).toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/session_start.*boom/));
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
