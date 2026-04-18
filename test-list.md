# Test List

## Phase 1 ✓

**Status:** 全 20 ケース GREEN（Phase 1 確定時）。詳細はリポジトリ履歴参照。

- 層 1 (TypeBox → JSON Schema 変換) 6 ケース
- 層 2 (Tool Registry) 3 ケース
- 層 3 (ExtensionAPI モック) 2 ケース
- 層 4 (Extension Loader) 2 ケース
- 層 5 (Tool Dispatcher) 3 ケース
- 層 6 (MCP Server 統合) 2 ケース
- 層 7 (CLI + e2e) 2 ケース
- Codex review 対応 3 ケース（loader 内部 MODULE_NOT_FOUND 伝搬、`--extension` 繰り返し、`package.json` bin 宣言）

## Phase 2 ✓

**Status:** 全 42 ケース GREEN（Phase 1 の 23 + Phase 2 新規 19）。`pnpm test` / `typecheck` / `lint` クリーン。

### 層 1: ToolDef 拡張 ✓

- [x] 1. `label` / `promptSnippet` / `promptGuidelines` を optional として受け入れる（pi-autoresearch が `label` を渡す）

### 層 2: pi.exec (spawn wrapper) ✓

- [x] 2. stdout / stderr / exit code を捕捉
- [x] 3. 非ゼロ終了を throw せず `code` に返す
- [x] 4. AbortSignal 発火で SIGTERM → `killed: true`

### 層 3: EventRouter ✓

- [x] 5. 同一 event に複数 handler を登録順に呼ぶ
- [x] 6. 未登録 event への emit は no-op
- [x] 7. handler throw 後も次の handler を呼ぶ + stderr 警告

### 層 4: ExecuteContext builder ✓

- [x] 8. cwd / signal / hasUI: false / hasTerminal: false を公開
- [x] 9. ui.notify を injected callback に forward
- [x] 10. ui.setWidget / ui.custom は no-op（custom は即 resolve）
- [x] 11. getContextUsage / abort / sessionManager が安全なデフォルトを返す

### 層 5: ExtensionApi 拡張 ✓

- [x] 12. registerTool を ToolRegistry へ委譲（既存）
- [x] 13. `pi.on` が EventRouter に登録
- [x] 14. `pi.registerCommand("x", ...)` が `command_x` Tool として Registry 登録
- [x] 15. `pi.exec` が piExec に委譲
- [x] 16. 未対応 API (`registerShortcut`) は no-op + 警告

### 層 6: Dispatcher signature change ✓

- [x] 17. `execute(toolCallId, params, signal, onUpdate, ctx)` の 5 引数で呼ばれる
- [x] 18. ctx.ui.notify が injected notify callback に橋渡し
- [x] 19. throw / 未登録 tool は MCP error として返す（既存）

### 層 7: Server wire-up ✓

- [x] 20. initialize 後に `session_start` 発火
- [x] 21. server.close 時に `session_shutdown` 発火

### 層 8: pi-autoresearch E2E ✓

- [x] 22. `tools/list` に `init_experiment` / `run_experiment` / `log_experiment` + `command_autoresearch` が出る
- [x] 23. init → run "echo ok" → log のシーケンスで `autoresearch.jsonl` に result が追記される

## Phase 3 以降で扱う予定

- `onUpdate` → MCP `notifications/progress`
- lifecycle events の残り 5 種類（agent_start / agent_end / session_tree / session_before_switch / before_agent_start）
- `ctx.ui.setWidget` / `ctx.ui.custom` の実描画（MCP プリミティブ追加待ち）
- `--strict` / `--timeout` / `inspect` サブコマンド
- npm 公開、pi-autoresearch の snapshot 化
