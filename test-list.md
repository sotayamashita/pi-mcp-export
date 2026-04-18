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

## Phase 3 ✓

**Status:** 全 60 ケース GREEN（Phase 1 の 23 + Phase 2 の 23 + Phase 3 の 14）。`pnpm test` / `typecheck` / `lint` クリーン。スコープは `onUpdate` → MCP `notifications/progress` 配線のみ。spec §6.1 Phase 3 の `ctx.ui.notify` と `registerCommand` は Phase 2 で先行実装済み。

### 層 1: Dispatcher 側の onUpdate 配線

- [x] 1. `sendProgress` 未指定時は onUpdate が no-op のまま（tool が onUpdate を呼んでもクラッシュしない）
- [x] 2. `sendProgress` 指定時、`onUpdate({details: {phase: "running", elapsed: "2s"}})` で `sendProgress({progress: 1, message: "running (2s)"})` が呼ばれる
- [x] 3. onUpdate 複数回で progress カウンタが 1, 2, 3... と単調増加
- [x] 4. partial が string / null / details なしでも fallback message で sendProgress が呼ばれる
- [x] 5. sendProgress が throw しても tool 実行は完走する
- [x] 8. (Codex P1) 保留中の sendProgress Promise を全て await してから tool response を返す
- [x] 9. (Codex P2) error path でも pendingProgress を flush してから isError 応答を返す
- [x] 10. (Codex round 3 P1) sendProgress が never-settle でも 1000ms で flush を諦めて hang しない
- [x] 11. (Codex round 3 P2) tool が MCP shape `{progress, total, message}` を返したらそのまま passthrough
- [x] 12. (Codex round 4 P2) MCP shape と legacy shape を混在させても progress が単調増加
- [x] 13. (Codex round 4 P2) progress chain 直列化により sendProgress が非同期に並行解決しても発火順序を保つ
- [x] 14. (Codex round 5 P2) tool が明示的に送った MCP progress（0 や繰り返し含む）は mutation せず verbatim 配信。flush timeout を 5s に拡大

### 層 2: Server 側の progressToken 処理

- [x] 6. `_meta.progressToken` 指定時に `extra.sendNotification({method: "notifications/progress", params: {progressToken, progress, message?}})` が呼ばれる
- [x] 7. `_meta.progressToken` 未指定時は `extra.sendNotification` を一切呼ばない

## Phase 4 ✓

**Status:** 全 81 ケース GREEN（Phase 1 の 23 + Phase 2 の 23 + Phase 3 の 14 + Phase 4 の 21）。`pnpm test` / `typecheck` / `lint` クリーン。`before_agent_start` / `agent_*` / `session_tree` / `session_before_switch` / `turn_*` / `session_before_compact` / `resources_discover` は MCP 側に対応経路がないため永続 deferred として spec §10 に確定記録。Codex review を 8 ラウンド回し P1 3 件 / P2 7 件を TDD 修正、round 9 で cyclic-input + function-injection の組合せのみ documented limitation として残す。

### 層 1: EventRouter

- [x] 1. handlersOf は未登録 event に対して空配列を返す
- [x] 2. handlersOf は登録順で handler を返す

### 層 2: Dispatcher tool_call pre-hook

- [x] 3. execute の前に event `{type: "tool_call", toolCallId, toolName, input}` と ctx を渡して handler を発火
- [x] 4. handler が `{block: true, reason}` を返すと execute を skip し `{isError: true, content: [{text: 含 reason}]}` を返す
- [x] 5. 先頭 handler の block で後続 handler は呼ばれない
- [x] 6. handler が `event.input` を mutate すると execute は mutated input を受け取る

### 層 3: Dispatcher tool_result post-hook

- [x] 7. execute 後に event `{type: "tool_result", toolCallId, toolName, input, content, details, isError}` と ctx を渡して handler を発火
- [x] 8. handler が `{content?, details?, isError?}` を返すと結果に部分上書きされる
- [x] 9. 複数 handler がチェインし、2 番目は 1 番目の mutation を反映した event を受ける
- [x] 10. execute が throw しても tool_result は `isError: true` で発火し、handler の返値で result を置き換え可能

### 層 4: Codex review 対応（P1 3 件 / P2 7 件）

- [x] 11. (Codex round 1 P1) server.ts の CallTool handler から events を dispatchTool に渡す
- [x] 12. (Codex round 1 P2) post-hook が details を上書きしたとき、isError: true でも structuredContent を返す
- [x] 13. (Codex round 2 P2) blocked 呼び出しでも tool_result を発火（audit 可視性）
- [x] 14. (Codex round 2 P2) tool_result.input は execute の params 参照とは別スナップショット
- [x] 15. (Codex round 3 P1) tool_call handler が throw したら fail-closed で block
- [x] 16. (Codex round 3 P2) tool_result.input を deep-clone で nested mutation から守る
- [x] 17. (Codex round 4 P2) structuredClone が失敗しても tool 実行を継続（fallback）
- [x] 18. (Codex round 5 P2) 未知 tool でも tool_call/tool_result を発火（audit 可視性）
- [x] 19. (Codex round 5 P2) cloneInput の fallback は JSON deep-copy を優先
- [x] 20. (Codex round 6 P1) blocked の場合 tool_result handler の return 値は無視（deny-by-default）
- [x] 21. (Codex round 7 P1) blocked の場合 event.content の in-place mutation も無視（deep clone）

## Phase 5 以降で扱う予定

- `ctx.ui.setWidget` / `ctx.ui.custom` の実描画（MCP プリミティブ追加待ち）
- `--strict` / `--timeout` / `inspect` サブコマンド
- npm 公開、pi-autoresearch の snapshot 化
