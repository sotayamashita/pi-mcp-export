export const SUPPORTED_EVENTS: ReadonlySet<string> = new Set([
  "session_start",
  "session_shutdown",
  "tool_call",
  "tool_result",
]);

export const UNSUPPORTED_EVENTS: ReadonlyMap<string, string> = new Map([
  ["before_agent_start", "agent lifecycle events are not observable from MCP"],
  ["agent_start", "agent lifecycle events are not observable from MCP"],
  ["agent_end", "agent lifecycle events are not observable from MCP"],
  ["session_tree", "pi-specific multi-session tree has no MCP equivalent"],
  ["session_before_switch", "pi-specific session switching has no MCP equivalent"],
  ["turn_start", "pi-specific conversation turns are not surfaced in MCP"],
  ["turn_end", "pi-specific conversation turns are not surfaced in MCP"],
  ["session_before_compact", "pi-specific context compaction has no MCP equivalent"],
  ["resources_discover", "MCP client does not yet expose a discovery hook"],
]);

export interface UnsupportedApi {
  readonly name: string;
  readonly reason: string;
}

export const UNSUPPORTED_APIS: ReadonlyArray<UnsupportedApi> = [
  {
    name: "registerShortcut",
    reason: "MCP has no keyboard shortcut mechanism",
  },
];
