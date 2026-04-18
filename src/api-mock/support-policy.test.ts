import { describe, it, expect } from "vitest";
import { SUPPORTED_EVENTS, UNSUPPORTED_EVENTS, UNSUPPORTED_APIS } from "./support-policy.ts";

describe("support-policy", () => {
  it("enumerates 4 supported and 9 unsupported events with disjoint names", () => {
    expect(SUPPORTED_EVENTS.size).toBe(4);
    expect(SUPPORTED_EVENTS.has("session_start")).toBe(true);
    expect(SUPPORTED_EVENTS.has("session_shutdown")).toBe(true);
    expect(SUPPORTED_EVENTS.has("tool_call")).toBe(true);
    expect(SUPPORTED_EVENTS.has("tool_result")).toBe(true);

    expect(UNSUPPORTED_EVENTS.size).toBe(9);
    for (const name of [
      "before_agent_start",
      "agent_start",
      "agent_end",
      "session_tree",
      "session_before_switch",
      "turn_start",
      "turn_end",
      "session_before_compact",
      "resources_discover",
    ]) {
      expect(UNSUPPORTED_EVENTS.has(name)).toBe(true);
      expect(typeof UNSUPPORTED_EVENTS.get(name)).toBe("string");
    }

    for (const name of SUPPORTED_EVENTS) {
      expect(UNSUPPORTED_EVENTS.has(name)).toBe(false);
    }

    expect(UNSUPPORTED_APIS.some((a) => a.name === "registerShortcut")).toBe(true);
  });
});
