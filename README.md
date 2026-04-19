# pi-mcp-export

Expose [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extensions as [MCP](https://modelcontextprotocol.io/) servers.

Point it at a pi extension; any MCP client (Claude Desktop, Cursor, Codex, Hermes, …) can then call its tools and commands.

## Requirements

- [mise](https://mise.jdx.dev/) — picks up `node` (LTS) and `pnpm` from [`mise.toml`](mise.toml)
- A pi extension (a `.ts` file, or a directory with `index.ts`)

## Quick start

Pre-release — run from a local checkout:

```bash
git clone https://github.com/sotayamashita/pi-mcp-export.git
cd pi-mcp-export
pnpm install

node bin/pi-mcp-export.mjs serve --extension /path/to/extension
node bin/pi-mcp-export.mjs inspect --extension /path/to/extension
```

## MCP client config

```json
{
  "mcpServers": {
    "my-pi-extension": {
      "command": "node",
      "args": [
        "/absolute/path/to/pi-mcp-export/bin/pi-mcp-export.mjs",
        "serve",
        "--extension",
        "/absolute/path/to/extension"
      ]
    }
  }
}
```

## CLI

```
serve   --extension <path>... [--strict] [--timeout <seconds>]
inspect --extension <path>... [--format text|json]
```

- `--strict` — exit non-zero if the extension uses APIs the adapter can't forward
- `--timeout` — per-tool-call timeout, `0` disables (default)
- `inspect` loads without opening a server and reports what's registered

## What's forwarded

| pi                                 | MCP                                        |
| ---------------------------------- | ------------------------------------------ |
| `pi.registerTool`                  | `tools/list` + `tools/call`                |
| `pi.registerCommand("x", …)`       | tool named `command_x`                     |
| `pi.on("session_start\|shutdown")` | server init / close                        |
| `pi.on("tool_call")`               | pre-hook, fail-closed block                |
| `pi.on("tool_result")`             | post-hook, can override the result         |
| `onUpdate`                         | `notifications/progress`                   |
| `ctx.ui.notify`                    | `logging` notification                     |
| `ctx.cwd` / `ctx.signal`           | server cwd / per-call `AbortSignal`        |
| `pi.exec`                          | `child_process.spawn` (SIGTERM→500ms→KILL) |

No-ops (no MCP equivalent): `ctx.ui.confirm/select/input/setWidget/custom`, `registerShortcut`, and agent-lifecycle events (`agent_start`, `turn_start`, …). Use `--strict` to reject them at load time.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

TypeScript runs via [jiti](https://github.com/unjs/jiti); no build step.

## License

[Apache-2.0](LICENSE)
