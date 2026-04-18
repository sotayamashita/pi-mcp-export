# Phase 1 Test List

**Status:** 全 20 ケース GREEN。`pnpm test:run` (7 files, 20 tests) / `pnpm typecheck` / `pnpm exec oxlint src tests bin` すべてクリーン。

## 層 1: TypeBox → JSON Schema 変換 ✓

- [x] 1. `Type.Object({})` → `{"type": "object", "properties": {}, "required": []}`
- [x] 2. `Type.String()` → `{"type": "string"}`
- [x] 3. `Type.Number()` → `{"type": "number"}`
- [x] 4. `Type.Boolean()` → `{"type": "boolean"}`
- [x] 5. `Type.Object({name: Type.String()})` の required に `["name"]`
- [x] 6. 未知コンストラクタ → `{"type": "string"}` + stderr 警告

## 層 2: Tool Registry ✓

- [x] 7. `register` → `get` で同じインスタンスが返る
- [x] 8. 同名 2 回目は `/already registered/` エラー
- [x] 9. `list()` で登録順の配列

## 層 3: ExtensionAPI モック ✓

- [x] 10. `registerTool` が Tool Registry に委譲
- [x] 11. `registerShortcut` は no-op + stderr 警告

## 層 4: Extension Loader ✓

- [x] 12. fixture 拡張を jiti で評価、`registerTool` が registry に反映
- [x] 13. 存在しないパスで `Extension file not found: ...` エラー

## 層 5: Tool Dispatcher ✓

- [x] 14. `execute` に args を渡して pi 形式 → MCP CallToolResult 形式で返す
- [x] 15. `execute` throw → `{isError: true, content: [{text: message}]}`
- [x] 16. 未登録ツール呼び出し → `{isError: true, content: [{text: "unknown tool \"…\""}]}` （cycle 中に追加発見）

## 層 6: MCP Server (in-memory 統合) ✓

- [x] 17. Client.listTools() が `{name, description, inputSchema}` を返す
- [x] 18. Client.callTool() がディスパッチ結果を返す

## 層 7: CLI + e2e (child_process + stdio) ✓

- [x] 19. `pi-mcp-export serve --extension tests/fixtures/minimal-ext` → stdio 経由で listTools / callTool が動作
- [x] 20. `--extension` 未指定 → 非ゼロ終了 + stderr に `extension` を含む

## 手動検証（保留）

- MCP Inspector 経由での対話的検証は未実施。e2e テストが `spawn` + `StdioClientTransport` で同じロジックをプログラムからなぞっているため、Inspector での検証は Phase 2 以降の UX 確認時に回す。

## Phase 2 以降に送ったスコープ

- `Type.Array`, `Type.Optional`, `Type.Union`, `StringEnum` 変換
- `registerCommand`, `ctx.ui.notify`, `ctx.signal`, イベントフック
- `--strict`, `--timeout`, `inspect` サブコマンド
- pi-autoresearch 実拡張での E2E
- @mariozechner/pi-coding-agent 型の取り込み
