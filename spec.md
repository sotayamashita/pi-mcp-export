# pi-mcp-export — Specification

**Status:** Draft v0.1
**Last updated:** 2026-04-17
**Author:** Sota Yamashita

## 0. 背景と前提知識

### 0.1 登場するフレームワーク

- **pi coding agent** — Mario Zechner 氏が開発する minimal な TypeScript 製コーディング CLI エージェント。npm パッケージ [`@mariozechner/pi-coding-agent`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)、モノレポは [`badlogic/pi-mono`](https://github.com/badlogic/pi-mono)。OpenClaw 等のエージェントの基盤として採用されている。**MCP を意図的にサポートしていない**（最小主義ゆえ）。
- **Hermes Agent** — Nous Research が開発する Python 製の自己改善型エージェント。[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)。MCP をネイティブサポート（`tools/mcp_tool.py` に ~1050 行のクライアント実装）。pip installable なプラグインシステム（entry point `hermes_agent.plugins`）を持つ。
- **MCP (Model Context Protocol)** — Anthropic が提唱するエージェント ↔ 外部ツール間の標準プロトコル。stdio / HTTP / SSE で接続し、tools / prompts / resources を露出する。TypeScript SDK [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) が公式。

### 0.2 pi 拡張（Extension）とは

pi では ExtensionAPI を使って拡張を書く。エントリポイントは `export default function(pi: ExtensionAPI) { ... }`。主要な登録 API:

```typescript
pi.registerTool({ name, parameters: TypeBoxSchema, async execute(...) })
pi.registerCommand("mycommand", { handler: async (args, ctx) => {...} })
pi.registerShortcut("ctrl+x", {...})   // TUI キーバインド
pi.on("session_start", async (event, ctx) => {...})  // 40+ ライフサイクルイベント
ctx.ui.notify("msg", "info")           // ユーザー通知
ctx.ui.setWidget("key", ["line1"])     // エディタ上のウィジェット描画
```

拡張は `~/.pi/agent/extensions/<name>/index.ts` に置かれ、pi 起動時に jiti で評価される。

### 0.3 アンカー用例: pi-autoresearch

本プロジェクトの主要検証対象は [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch)（MIT）。任意の最適化ターゲット（テスト速度、バンドルサイズ、LLM 学習の val_bpb 等）に対して自律的に実験ループを回す pi 拡張。提供する 3 ツール:

| ツール            | 機能                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `init_experiment` | セッション設定（名前、メトリック、単位、最適化方向）。最初に 1 回呼ぶ                                            |
| `run_experiment`  | 任意コマンドを実行、壁時計を計測、出力をキャプチャ                                                               |
| `log_experiment`  | 結果を記録。`keep` は auto-commit、`discard`/`crash`/`checks_failed` は auto-revert。`autoresearch.jsonl` に追記 |

加えて `/autoresearch` スラッシュコマンド、ステータスウィジェット、`Ctrl+X` / `Ctrl+Shift+X` キーバインド、ブラウザダッシュボードを持つ。3 ツールは単純なロジック中心（描画依存なし）のため **本プロジェクトの対応範囲に収まる**。ウィジェット・キーバインド部分は対象外（§5）。

### 0.4 動機となった具体的課題

ユーザー（この spec の作成者）は pi-autoresearch を Hermes Agent で使いたい。移植方法として以下の 3 案を検討した:

| 案                                                             | 内容                                                                                                                         | 工数目安[^estimate]                                      | リーチ                                  | 採否    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- | ------- |
| **A: Hermes 専用プラグイン** (`hermes-pi-bridge`)              | Hermes の `hermes_agent.plugins` entry point を使った Python プラグイン。Node サブプロセスで pi 拡張をホスト、RPC でブリッジ | ~1000 行（Python ~400 + TS shim ~500 + テスト ~100）     | Hermes ユーザーのみ                     | ✕ 却下  |
| **B: MCP サーバ変換器** (`pi-mcp-export`) ← **本プロジェクト** | pi 拡張を MCP サーバとして公開。あらゆる MCP クライアント（Hermes, Claude Desktop, Cursor, Codex, Cline）が利用可            | ~800 行（TS のみ、クライアント側実装不要）、10-15 営業日 | 全 MCP クライアント                     | ⭕ 採用 |
| **C: フル互換シム**                                            | Hermes コアに 10 箇所以上のフック追加、pi 40 イベント全て対応                                                                | 5000 行以上、upstream 困難                               | Hermes ユーザーのみ（理論上 100% 互換） | ✕ 却下  |

[^estimate]: 工数は粗い概算で、次の根拠に基づく:

    - **案 A の Python ~400 行**: Hermes の `tools/mcp_tool.py`（~1050 行）を参考に、プラグイン entry + ツールディスパッチ + RPC クライアント + キャッシュ管理の最小セットを想定
    - **案 A / B の TS ~500 行**: ExtensionAPI モック（~150）、TypeBox 変換（~100）、ツール収集・ディスパッチ（~150）、ライフサイクル（~100）
    - **案 C の 5000 行+**: Hermes 現行の agent loop（`run_agent.py`）の主要変更点 × 10 箇所、各 300-500 行の変更 + pi の 40 イベント × 平均 50 行のブリッジコード
    - **10-15 営業日（案 B）**: §6.1 の 7 フェーズの合計。最大ボトルネックは Phase 2（pi-autoresearch E2E）と Phase 4（イベントフック）
    - これらは実装前の見積もりで、TypeBox の未知ケースや MCP クライアントごとの挙動差異で変動する

**B を選んだ理由（優先順位順）**:

第一にリーチ。案 B は Hermes 以外（Claude Desktop, Cursor, Codex, Cline 等）にも届く。案 A は Hermes 専用で、他クライアントのユーザーには何も届かない。

第二に工数。Hermes 側の MCP クライアントが既にあるため、案 A の ~1000 行に対し案 B は ~800 行で済む。

第三に責任範囲の線引き。pi 側の描画系 API（`ctx.ui.setWidget` 等）は MCP の外側と割り切れるので、対応か非対応かの判断で迷う箇所が少ない。

第四に副次効果。[pi-mono Issue #563](https://github.com/badlogic/pi-mono/issues/563) の「pi に MCP 拡張の例を」にも応える。

**撤退条件（トレードオフが崩れた場合）**:

工数観点での判断ゾーン（§6.1 の見積もりとの距離を表で明示）:

| 実績工数（Phase 2 終了時点からの総予測） | 見積もり比                                        | 判断                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ≤ 15 営業日                              | 基準どおり（10-15 営業日）                        | 継続                                                                                                                       |
| 15-20 営業日                             | ブレ許容範囲内（±30% = 13-19.5 営業日の上端付近） | **継続**、リスク表の緩和策を発動                                                                                           |
| 20-25 営業日                             | 見積もり 1.5-1.7 倍                               | **継続**（リーチの優位はコア判断基準のため、この水準では案 A にピボットしない）                                            |
| 25-30 営業日                             | 見積もり 1.7-2 倍                                 | **黄信号**: Phase 3 以降のスコープ削減を検討（案 B 内で対応拡張を絞る、`registerCommand` の Prompt 実装を Phase 7 送り等） |
| 30+ 営業日                               | 見積もり 2 倍超                                   | **赤信号・撤退判断**: リーチを犠牲にして案 A（Hermes 専用）へのピボットを再検討                                            |

MCP クライアント互換性観点:

| クライアント対応率                                                        | 判断                                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 主要 5 クライアント（Hermes/Claude Desktop/Cursor/Codex/Cline）で全て動作 | 継続・現行スコープ維持                                                                                                                     |
| 半数以上（3/5 以上）で動作                                                | 継続・動作クライアントを README で明示                                                                                                     |
| 半数未満（2/5 以下）で動作                                                | **スコープ再定義**: 「全 MCP クライアント対応」前提が崩れるため、主要 3 クライアント（Hermes, Claude Desktop, Cursor）に限定して再定義する |

### 0.5 既存ツール調査（車輪の再発明回避確認）

着手前に同等ツールの存在を調査（2026-04-17）。**直接相当するツールは存在しない**ことを確認:

| 探したもの                          | 結果          |
| ----------------------------------- | ------------- |
| pi 拡張 → MCP サーバ変換器          | ❌ 存在しない |
| pi 拡張 → Hermes ブリッジ           | ❌ 存在しない |
| pi → 任意フレームワーク汎用アダプタ | ❌ 存在しない |

近接するが方向・対象が異なるプロジェクト:

- [`nicobailon/pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) — **MCP サーバを pi から消費する**ためのアダプタ（逆方向）。遅延ロード・プロキシツール 1 本にまとめる設計は参考価値あり
- [Hermes Issue #360](https://github.com/NousResearch/hermes-agent/issues/360) — Hermes に pi 風 RPC モードを追加する**提案段階**。方向が逆で未実装
- [`NousResearch/hermes-paperclip-adapter`](https://github.com/NousResearch/hermes-paperclip-adapter) — Hermes を Paperclip 内で動かす。方向が逆
- `mcporter` — OpenClaw が pi に MCP を持ち込むため採用。pi 自身は MCP 未サポート
- [agentskills.io](https://hermes-agent.nousresearch.com/docs/skills/) — SKILL.md のクロスフレームワーク標準。pi-autoresearch の SKILL.md 部分はこの標準で既に Hermes から利用可能。**残課題は拡張の TS ツール部分のみ** → これが本プロジェクトの対象

## 1. Overview

### 1.1 目的

pi coding agent（`@mariozechner/pi-coding-agent`）の拡張（extension）を **MCP (Model Context Protocol) サーバとして露出する変換器**を提供する。これにより pi 拡張を、MCP 対応の任意のエージェント（Hermes Agent, Claude Desktop, Cursor, Codex, Cline 等）から利用可能にする。

### 1.2 動機

- 出発点は、Hermes Agent ユーザーが pi-autoresearch（§0.3）の 3 ツールを使いたいという個別要求。Python で 3 ツールを書き直しても safe-git / checkpoint など他拡張には応用できず、拡張ごとに同じ作業を繰り返すことになる
- pi の拡張エコシステム（autoresearch, safe-git, checkpoint, pi-canvas 等）は TypeScript + pi ExtensionAPI 前提で書かれ、他フレームワークから直接触れない
- 一方、各フレームワークが MCP にはほぼ対応している（Hermes は `tools/mcp_tool.py` でネイティブ対応）。変換器を 1 本挟めば、どの pi 拡張をどの MCP クライアントで使うかは掛け算で選べる
- pi 自身は MCP を入れていない（最小主義）ため、外側で橋を架けるのが自然

### 1.3 非目的

- pi 拡張の**完全互換**は目指さない（UI 描画・キーバインド・セッション永続化等は対象外、§5 参照）
- pi CLI そのものの MCP 化ではない（対象は**拡張の public API**のみ）
- MCP → pi の逆方向（これは [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) が既に担当）

### 1.4 成功条件

1. `pi-mcp-export serve --extension <path>` で pi 拡張を stdio MCP サーバとして起動できる
2. Hermes ユーザーが `mcp.json` に `pi-mcp-export` を登録すると、次のセッションから pi 拡張のツールが `tools/list` に現れ、呼び出しの結果が pi 本体で呼んだ時と一致する
3. 検証対象の `pi-autoresearch` 3 ツールが end-to-end で動作する。`init_experiment` で cwd に `autoresearch.jsonl` が作られ、`run_experiment` で任意コマンドを spawn し壁時計を計測、`log_experiment` で結果が jsonl に追記される
   - **pi-autoresearch を検証対象に選んだ理由**: ①本プロジェクトの出発点となった個別要求、②MIT ライセンスで再配布・fixture 化が容易、③3 ツールが単純なロジック中心（描画依存なし）で対応スコープに収まる、④ブラウザダッシュボード（`node:http` サーバ）を含むため拡張内完結型の副作用も検証できる。他の pi 拡張（safe-git, checkpoint 等）は Phase 6 以降の対応拡大で取り込む想定（§4.1 の回帰テスト参照）
4. 非対応 I/F は起動時・`inspect` コマンドで明示的にレポートされる

## 2. スコープ

### 2.1 対応する pi ExtensionAPI

| pi ExtensionAPI                  | MCP への写像                                             | 優先度 | 対応 Phase |
| -------------------------------- | -------------------------------------------------------- | ------ | ---------- |
| `pi.registerTool(def)`           | MCP Tool（`tools/list`, `tools/call`）                   | P0     | Phase 1-2  |
| `pi.registerCommand(name, opts)` | MCP Tool（`name` で露出、もしくは Prompt — §4.3 で決定） | P1     | Phase 3    |
| `pi.on("session_start", fn)`     | MCP `initialize` で発火                                  | P2     | Phase 4    |
| `pi.on("session_shutdown", fn)`  | MCP server shutdown で発火                               | P2     | Phase 4    |
| `pi.on("tool_call", fn)` (block) | MCP Tool dispatcher の pre-hook                          | P2     | Phase 4    |
| `pi.on("tool_result", fn)`       | MCP Tool dispatcher の post-hook                         | P2     | Phase 4    |
| `ctx.ui.notify(msg, level)`      | MCP `notifications/message`                              | P1     | Phase 3    |
| `ctx.ui.setStatus(key, text)`    | MCP `notifications/message` (info)                       | P2     | Phase 4    |
| `ctx.cwd`                        | MCP クライアントから渡される workspace or CLI 引数       | P0     | Phase 1-2  |
| `ctx.signal` (AbortSignal)       | MCP tool call cancellation                               | P1     | Phase 2    |

**優先度の定義**:

| 優先度 | 基準                                                             | 根拠                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | **拡張が 1 つでも動くのに必須**                                  | ツール登録と cwd が無ければ拡張として何も成立しない。pi-autoresearch の 3 ツールも `ctx.cwd` で `autoresearch.jsonl` の書き込み先が決まる                                        |
| **P1** | **pi-autoresearch の完全動作に必要、かつ他多くの拡張も使う機能** | `registerCommand` は `/autoresearch` 相当、`ctx.ui.notify` は進捗表示、`ctx.signal` は長時間実行ツールのキャンセル。どれも検証対象に不可欠                                       |
| **P2** | **一部拡張でのみ使用、無くても主要機能は動く**                   | ライフサイクルイベント系は「危険操作の事前ブロック」等の付加機能で、pi-autoresearch は使わない。対応しないと一部拡張で挙動が欠落するが、P0/P1 が揃えば拡張の主要ツールは動作する |

各項目がどの Phase で実装されるかは右列および §6.1 参照。P0 は Phase 2 完了で揃い、P1 は Phase 3 完了、P2 は Phase 4 完了で揃う。

**優先度が拡張依存で揺らぐ問題への対処**:

上記の P0/P1/P2 は **pi-autoresearch を一次検証対象に置いた序列** であり、他拡張では序列が崩れる可能性がある。特に `ctx.signal` (P1) と `ctx.cwd` (P0) の境界は「pi-autoresearch が `ctx.cwd` を必須で使い、`ctx.signal` は使用するが実装簡略化の余地がある」ことに依存する。

対応方針:

1. **初期リリース（Phase 6 まで）は pi-autoresearch を絶対基準として扱う** — 優先度決定の一貫性を保つ
2. **Phase 7 以降で追加拡張を fixture 化する際**、新規拡張が P0 機能だけで動かない（例: `ctx.signal` が無いと動作不可）と判明した場合:
   - 当該機能を **P0 に昇格する PR を提案**
   - または **「この拡張は Phase X 以降のバージョンで対応」と `examples/supported-extensions.md` に明記**
   - Phase の再計画は行わず、**リリース済みバージョンの優先度は固定**して後方互換を保つ
3. **優先度表は「現時点のスナップショット」として扱う** — 決定ログ（§10）に pi-autoresearch を基準とした序列であることを明記し、将来の拡張追加で序列が変わる可能性を残す

### 2.2 対応しない pi ExtensionAPI

| pi ExtensionAPI                             | 理由                                         |
| ------------------------------------------- | -------------------------------------------- |
| `pi.registerShortcut`                       | MCP にキーボード入力機構なし                 |
| `ctx.ui.setWidget` / `ctx.ui.custom()`      | MCP に TUI 描画なし                          |
| `pi.registerFlag`                           | MCP クライアントの CLI 引数に介入不可        |
| `pi.registerProvider` / `pi.setModel`       | MCP はモデルプロバイダ管理をしない           |
| `pi.registerMessageRenderer`                | MCP にメッセージ描画カスタマイズなし         |
| `session_before_compact` カスタム要約       | MCP クライアント側の compaction に介入不可   |
| `pi.appendEntry(customType, data)` の永続化 | MCP サーバはステートレスを基本とする（§5.4） |
| `ctx.sessionManager.fork/switchSession`     | MCP クライアントのセッション管理に依存       |

### 2.3 対象ユーザー

- **一次**: Hermes Agent / Claude Desktop / Cursor / Codex 等で pi 拡張を使いたい開発者
- **二次**: pi 拡張作者（自分の拡張を他エージェントにも届けたい）
- **三次**: pi コミュニティ（[pi-mono Issue #563](https://github.com/badlogic/pi-mono/issues/563) の MCP 対応要望）

## 3. アーキテクチャ

### 3.1 全体図

```
┌──────────────────── pi-mcp-export (Node.js CLI) ──────────────────────┐
│                                                                        │
│  $ pi-mcp-export serve --extension <path> [--extension <path>...]      │
│                                                                        │
│  ┌─────────── MCP Server (stdio / HTTP) ───────────────────────────┐  │
│  │  @modelcontextprotocol/sdk                                        │  │
│  │    ├─ initialize          → Extension Loader を起動                 │  │
│  │    ├─ tools/list          → Tool Registry の内容を返却              │  │
│  │    ├─ tools/call(n, args) → Dispatcher → Extension の execute()    │  │
│  │    ├─ prompts/list        → registerCommand の内容（§4.3 次第）      │  │
│  │    └─ notifications       → ctx.ui.notify の変換出力                │  │
│  └──────────────────────────┬──────────────────────────────────────┘  │
│                             │                                          │
│  ┌────────── Extension Loader ─────────────────────────────────────┐  │
│  │  jiti で <path>/index.ts を評価                                    │  │
│  │  ExtensionAPI モックを引数として default export を呼び出し           │  │
│  │    ├─ registerTool(def)    → Tool Registry へ追加                  │  │
│  │    ├─ registerCommand(...) → Command Registry へ追加                │  │
│  │    ├─ on(event, handler)   → Event Router へ登録                   │  │
│  │    └─ 未サポート API       → no-op + 起動時警告                     │  │
│  └──────────────────────────┬──────────────────────────────────────┘  │
│                             │                                          │
│  ┌────────── Shared State ─────────────────────────────────────────┐  │
│  │  Tool Registry      : Map<name, {def, extensionId, sourcePath}>   │  │
│  │  Command Registry   : Map<name, {handler, extensionId}>           │  │
│  │  Event Router       : Map<eventName, handler[]>                   │  │
│  │  Session State      : in-memory、プロセス終了で消失（§5.4）          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌────────── TypeBox → JSON Schema Converter ─────────────────────┐  │
│  │  Type.Object / Type.String / Type.Number / Type.Array / Optional │  │
│  │  Type.Union / StringEnum (pi 独自) 個別対応                        │  │
│  │  Unknown: string フォールバック + 警告                              │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 実行フロー

```
[起動時]
1. CLI: --extension の path を列挙
2. 各 path で Extension Loader を起動
3. ExtensionAPI モックを注入して default export 関数を呼び出す
4. registerTool / registerCommand / on の呼び出しを収集
5. 非対応 API 呼び出しがあれば stderr に警告
6. MCP stdio サーバを開始

[tools/call リクエスト]
1. Tool Registry から該当ツールを検索
2. pre_tool_call イベントハンドラを順次実行（block 判定）
3. ExecuteContext を構築（ctx.cwd, ctx.signal, ctx.ui...）
4. Extension の execute(toolCallId, params, signal, onUpdate, ctx) を呼び出し
5. 戻り値（pi の content + details）を MCP の ToolResult 形式に変換
6. post_tool_call イベントハンドラを実行
7. クライアントへ返却

[停止時]
1. session_shutdown ハンドラを発火
2. stdio を閉じる
```

### 3.3 プロセスモデル

- **1 プロセス = 1 MCP サーバ**、複数拡張を同居可能
- **ライフサイクル**: MCP クライアント（Hermes 等）が起動・停止を制御（stdio 接続）
- **拡張のプロセス分離はしない**: 全拡張は同じ Node プロセス上で動作。隔離が必要なら複数 `pi-mcp-export` インスタンスを MCP サーバとして並列登録

## 4. 主要な設計判断

### 4.1 TypeBox → JSON Schema 変換

**課題**: pi 拡張は `@sinclair/typebox` の `Type.Object({...})` でツールパラメータを定義。MCP は JSON Schema を要求する。TypeBox は JSON Schema 互換を謳うが、`pi-ai` の `StringEnum`（Google Gemini 互換用の独自ヘルパ）など差分がある。

**方針**:

1. TypeBox 標準コンストラクタ（`Type.Object`, `Type.String`, `Type.Number`, `Type.Boolean`, `Type.Array`, `Type.Optional`, `Type.Union`, `Type.Literal`）はそのまま透過
2. `StringEnum` は `{"type": "string", "enum": [...]}` に変換
3. `Type.Transform` / `Type.Static` など非 JSON Schema 要素は値部分のみ抽出
4. 未知のコンストラクタは `{"type": "string"}` フォールバック + stderr 警告
5. 変換結果は MCP Inspector で `tools/list` して人間が目視検証できる

**未知型フォールバックを `string` にした根拠（代替案との比較）**:

| 代替案                               | 挙動                               | 却下理由                                                                                                                                                                                                                                                            |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{}` / `{"type": "any"}`（採用せず） | 型チェックなしで何でも受け付ける   | MCP クライアントが LLM に「この引数は何でも良い」と伝えてしまい、LLM が適切な値を生成できない。結果としてランタイムで拡張側の検証エラーが頻発し、デバッグが困難                                                                                                     |
| 起動失敗（strict mode 相当）         | 未知型検出で即エラー               | 拡張の 1 ツールの 1 パラメータに未知型があるだけで拡張全体が使えなくなる。pi 拡張の多くは `Type.Transform` 等の周辺機能を **ツールの主機能と無関係な箇所**で使っているため、過剰な防御になる                                                                        |
| `{"type": "string"}`（**採用**）     | 文字列として受け付け、拡張側で解釈 | ①多くの TypeBox 型（日付、JSON 文字列、URL 等）は文字列表現を持ち、シリアライズ往復が成立する ②LLM が文字列を生成するのが最も安定する ③拡張側が `JSON.parse` や型変換で復元する余地を残す ④実行時エラーが発生しても `post_tool_call` フックや stderr 警告で診断可能 |

`--strict` フラグ指定時は未知型検出で起動失敗に切り替え（§4.2 の strict 連動と同じポリシー）。

**テスト**: pi-autoresearch の 3 ツールに加え、safe-git, checkpoint の型定義を fixture として取り込み回帰テスト。

### 4.2 `ctx.ui` のハンドリング

**課題**: pi 拡張は `ctx.ui.notify("msg", "info")`、`ctx.ui.setStatus(key, text)`、`ctx.ui.confirm(title, body)` 等を呼ぶ。MCP にはこれらに直接対応する機能がない。

**方針**:

- `notify` / `setStatus` → MCP `notifications/message` に変換（クライアントがログ表示する想定）
- `confirm` / `select` / `input` → **非対話動作**でデフォルト値を返す + 起動時に「この拡張は confirm を使うため完全には動作しない可能性があります」と警告
- `ctx.ui.custom()` → no-op + 警告

**デフォルト値の選定根拠**:
| API | 戻り値 | 選定理由 |
|---|---|---|
| `confirm(title, body)` → Promise<boolean> | `false` | **最も保守的な選択**: pi 拡張の confirm は典型的に「危険操作の事前承認」（例: `rm -rf` ガード、破壊的 git 操作）。不明なら拒否しておけば安全側に倒れる。`true` を返すと意図しない破壊操作が走るリスクがある |
| `select(title, options)` → Promise<T \| null> | `null` | pi 本体の挙動（ユーザーが ESC でキャンセルした場合）と同一。null チェックを怠っている拡張は `pi.registerTool` 時点で本体でも crash するはずで、挙動の一貫性が保たれる |
| `input(title, placeholder)` → Promise<string> | `""`（空文字） | pi 本体の挙動（空入力で確定した場合）と同一。`null` を返すと string 型の戻り値前提コードが即座に crash する |

**`--strict` フラグとの連動**: デフォルト値返却では「確認を必要とする拡張が確認なしで動く」セキュリティ懸念が残るため（§5.2, §7 リスク表参照）、`--strict` 指定時は confirm / select / input を呼び出した時点で**ツール実行を中断し MCP error として返す**。UI 非対応の拡張は動かせなくなる代わりに、予期せぬ破壊操作は防げる。デフォルト（非 strict）は pi-autoresearch のような UI 非依存の拡張をまず動かすことを優先した設定。

**補足**: MCP には双方向の UI 問い合わせ機構がないため、対話的確認を必要とする拡張は本質的に対応不可。MCP の `elicitation` プリミティブ（策定中）が普及すれば §8 将来拡張で再対応する。`pi-autoresearch` は `notify` / `setStatus` のみ使うため非 strict デフォルトで問題にならない想定。

### 4.3 `pi.registerCommand` の MCP 表現

**課題**: pi の `/autoresearch optimize X` のような slash command は、MCP に直接相当するプリミティブがない。

**候補**:

- **案 A**: MCP Tool として露出（`name: "command_autoresearch"`, `inputSchema: {args: string}`）
  - 利点: MCP クライアント側の追加実装不要。Hermes からは `{"tool": "command_autoresearch", "args": {"args": "optimize X"}}` で呼べる
  - 欠点: `/autoresearch` スラッシュコマンドとしての UX が失われる（ツール呼び出しになる）
- **案 B**: MCP Prompt として露出（`prompts/list`, `prompts/get`）
  - 利点: セマンティクス的にはコマンドに近い
  - 欠点: Prompt プリミティブのクライアント側実装が進んでおらず Hermes でも利用経路が未整備

**判断**: **初期リリース（Phase 3 終了時点）は案 A（Tool 化）でデフォルト固定**する。理由は、MCP Prompt プリミティブのクライアント側実装が未成熟で（Hermes のスラッシュコマンド統合経路が未整備、Cursor / Codex も Prompt 対応が限定的）、Tool 化なら全 MCP クライアントで即座に動作する可搬性を最優先できるため。

**タイムライン**:

- **Phase 3 実装中**: 案 A（Tool 化）を**先に**実装しデフォルトに据える。案 B（Prompt 化）は同 Phase 内で**実験実装**として `--expose-commands-as-prompts` フラグの裏に置く（コードは書くが品質保証の対象外）
- **Phase 3 終了時**: Hermes / Claude Desktop で案 A の動作を確認してリリース。案 B は experimental ラベルで含める
- **Phase 7 以降（リリース後）**: 主要 MCP クライアントの Prompt 対応状況が成熟した段階で、案 B のデフォルト昇格を再評価

**「Prompt 成熟」の判定基準（Phase 7 再評価トリガ）**:

下記の**3 条件すべて**を満たした時点で案 B のデフォルト昇格を再評価する:

```
条件 1: 主要 MCP クライアント 5 つ（Hermes / Claude Desktop / Cursor / Codex / Cline）のうち
        3 つ以上で Prompt プリミティブが UI に露出されている
        （ユーザーが `/prompt-name` や UI メニューから起動できる経路が存在）
        ↓
条件 2: 上記のうち Hermes が対応している
        （本プロジェクトの一次ユーザーが使えなければ意味がない）
        ↓
条件 3: Prompt の引数受け渡しがクライアント間で互換動作することを
        examples/ に同梱するサンプル拡張で確認できる
```

**再評価の具体トリガ**:

- 6 ヶ月ごとに主要クライアントの MCP 対応状況を確認（`examples/mcp-client-capability.md` を作成して追跡）
- クライアント側のリリースノートで Prompt 対応が告知されたら即座に条件チェック
- 条件達成時は GitHub Issue を立てて昇格 PR を作成、達成しなければ次の 6 ヶ月サイクルへ

試作結果がどうであれ、**初期リリースは案 A で出す**方針。

### 4.4 イベントフックの MCP 写像

| pi event                  | MCP タイミング                     | 備考                                                                                        |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `session_start`           | `initialize` 完了直後              | reason は常に `"startup"`                                                                   |
| `session_shutdown`        | stdio close / SIGTERM              | クリーンアップ用途                                                                          |
| `resources_discover`      | `initialize` 中                    | `skillPaths` 等の戻り値を MCP resources として expose するか **Phase 4 で判断**（下記参照） |
| `before_agent_start`      | **非対応**                         | MCP に対応するフックなし（クライアント側の agent loop に介入不可）                          |
| `tool_call` (block)       | `tools/call` 受信直後、dispatch 前 | block 判定を尊重し、MCP error として返す                                                    |
| `tool_result`             | `tools/call` レスポンス送信直前    | modify は許容                                                                               |
| `turn_start` / `turn_end` | **非対応**                         | クライアントの turn 境界を MCP サーバからは知れない                                         |
| `session_before_compact`  | **非対応**                         | クライアントの compaction に介入不可                                                        |

**`resources_discover` の判断期限と基準**: Phase 4（イベントフック実装）の末尾で白黒をつける。判断は以下の**決定木**に従う:

```
Q1. Phase 4 時点で対応済みの pi 拡張（fixture + pi-autoresearch + 追加拡張）のうち、
    resources_discover を呼ぶ拡張は 1 つ以上あるか？
    │
    ├─ No  → 【非対応 (no-op + 警告)】で確定、決定ログに記録
    │
    └─ Yes → Q2 へ

Q2. 呼ばれる resources_discover の戻り値に skillPaths が含まれる拡張が 1 つ以上あるか？
    │
    ├─ No  → 【非対応】で確定（promptPaths / themePaths のみは下表の通り写像不能）
    │
    └─ Yes → Q3 へ

Q3. 主要 MCP クライアント（Hermes / Claude Desktop / Cursor のうち 2 つ以上）で
    resources/list の結果から SKILL.md を取り込む経路が存在するか？
    │
    ├─ No  → 【非対応】で確定、決定ログに「クライアント側実装待ち」と記録
    │         §8 将来拡張で再検討
    │
    └─ Yes → 【対応】で確定、skillPaths のみを resources として expose する実装を追加
             （工数見積もり: 追加 1-2 営業日）
```

**`skillPaths` のみ意味を持つ理由（クライアント側概念の差異）**:
| pi 側の概念 | クライアント側の対応状況 | MCP resources への写像可否 |
|---|---|---|
| `skillPaths`（SKILL.md が置かれたディレクトリ） | Hermes は `~/.hermes/skills/`、Claude Code / Cursor / Codex も SKILL.md を読む標準（agentskills.io）。**クライアント共通の概念が存在** | ⭕ `resources/list` → URI スキーム `file://` で skill.md を expose し、クライアントが読んで取り込む経路が現実的 |
| `promptPaths`（プロンプトテンプレート） | Hermes には `promptPaths` 概念がなく、Claude Code はスラッシュコマンド化している形で異なる抽象。Cursor / Codex も個別形式。**クライアント間で共通抽象がない** | ❌ resources として expose しても、クライアント側で「プロンプトテンプレート」として取り込む経路が存在しない |
| `themePaths`（pi の TUI テーマ） | Hermes は `hermes_cli/skin_engine.py` で独自の skin 形式、Claude Code / Cursor / Codex も個別。**TUI スタイル自体がクライアント依存** | ❌ pi の theme フォーマットを他クライアントで解釈する術がない |

判断は Phase 4 末で確定させる（Phase 5 の inspect コマンドで非対応 API リストを固定するため）。

### 4.5 拡張のインストール方式

**前提**: pi 拡張は `~/.pi/agent/extensions/<name>/index.ts` に置かれる、もしくは npm パッケージとして配布される。

**pi-mcp-export の対応**:

- `--extension <path>` 形式のローカルパス指定（初期対応）
- `--extension npm:@user/pkg@1.0.0` 形式の npm 参照（Phase 6 で対応）
- `--extensions-dir ~/.pi/agent/extensions` で自動スキャン（Phase 6）
- 拡張の `package.json` に依存がある場合、初回ロード時に `npm install` を `.pi-mcp-export-cache/` 配下で自動実行

**Phase 順序の根拠**: 初期はローカルパスのみを対象とすることで、fixture（`tests/fixtures/minimal-ext`, `pi-autoresearch-snapshot`）を使った検証サイクルが最速になる（ネットワーク I/O・npm cache・バージョン解決が入らない）。npm 参照と自動スキャンはユーザー利便性のための拡張で、コアロジック（loader・schema 変換・dispatcher）が安定した後で Phase 6 にまとめる。逆順（npm 参照を先）にすると、拡張ロード失敗の原因切り分けが「コードバグ」「npm 解決失敗」「TypeBox 変換失敗」の 3 層にまたがって診断コストが高くなる。

### 4.6 ランタイムと言語選定

- **言語**: TypeScript（pi 拡張そのものが TS、ExtensionAPI 型互換のため）
- **ランタイム**: Node.js 20+ LTS
- **評価器**: [jiti](https://github.com/unjs/jiti)（pi 本体が採用しているのと同じ、TS を compile なしで実行）
- **MCP SDK**: [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
- **配布**: npm (`npm install -g pi-mcp-export`)、Homebrew は後続検討

**ランタイム選定の比較検討**:

| 候補                            | 採否             | 根拠                                                                                                                                                                                                                                                                             |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js 20+ LTS**             | ⭕ 採用          | ①pi 本体が Node.js で動作するため、pi 拡張との互換性を担保するうえでランタイム差異リスクが最小 ②MCP TS SDK の公式サポート対象 ③20+ LTS で ES2023 機能（`Array.prototype.findLast` 等）が使えて jiti との組み合わせで安定 ④ユーザー側に既にインストール済みである可能性が最も高い |
| **Bun**                         | △ 実験的サポート | ①Node 互換 API で動くことを確認 ②TypeScript ネイティブ実行で jiti 不要の利点あり ③pi 拡張が Node 固有 API（`node:child_process` のエッジケース等）に依存する場合の挙動差異懸念 ④**既定は Node、Bun は実験的サポート**に留める（サポート範囲は下記で明示）                        |
| **Deno**                        | ✕ 却下           | ①パーミッションモデルが Node と異なり、pi 拡張が前提とする `node:fs` 等のフルアクセス前提と衝突 ②npm 互換モードはあるが jiti の TS 評価経路が未検証 ③ユーザー側の普及率が Node より低く、導入コストが高い                                                                        |
| TypeScript 直接コンパイル (tsc) | ✕ 却下           | ①拡張のロードは実行時なので AOT コンパイルは不要 ②pi 本体が jiti を採用しており、pi の挙動を忠実に再現するには同じ評価経路が望ましい                                                                                                                                             |

**Node.js 20+ LTS を最低バージョンにした根拠**: Node 18 は 2025-04 で EOL、20 は LTS が 2026-04 まで。本プロジェクトのリリース時点（2026 年後半想定）で最も安全に推奨できる下限。`engines.node` に明記する。

**Bun「実験的サポート」の具体的定義**: 以下の内容で運用する（実装者の裁量に委ねない）:

| 項目                      | Node.js（正式サポート）                                       | Bun（実験的サポート）                                                                                                                               |
| ------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI でのテスト実行         | ⭕ 全テスト（unit + E2E）を必ず実行、失敗したら PR マージ不可 | △ smoke test のみ（CLI 起動と 1 ツール呼び出し）を `continue-on-error: true` で実行、失敗してもブロックしない                                       |
| パッケージ `engines` 宣言 | ⭕ `engines.node: ">=20.0.0"` で明記                          | ✕ 宣言しない（Bun は engines を参照しないが、Node ユーザーへ誤認誘導を避けるため）                                                                  |
| README での言及           | ⭕ Quick Start のメイン経路                                   | △ 「Bun でも動作することを確認していますが正式サポート外」と別セクションで記載、挙動差異が疑われる場合は Node で再現してから Issue を立てるよう案内 |
| Issue 受付                | ⭕ 全て対応                                                   | △ Bun 固有の問題は Won't Fix ラベルで閉じる。ただし Node でも再現する場合は通常対応                                                                 |
| リリースノート            | ⭕ 動作要件に明記                                             | ✕ 明記しない                                                                                                                                        |

つまり Bun サポートは「動けばラッキー、CI は通すが品質保証しない」レベル。将来 Bun 側で pi 拡張を動かす需要が高まれば正式サポートへ昇格を検討する（§8 将来拡張の候補に追加）。

## 5. 制約と既知の制限

### 5.1 描画系機能の非対応

`ctx.ui.setWidget`, `ctx.ui.custom()`, `registerShortcut` は実装しない。pi-autoresearch のステータスウィジェットやキーバインド（`Ctrl+X` ダッシュボード）は **動作しない**。ブラウザダッシュボード（`/autoresearch export` による `node:http` サーバ）は拡張の中で完結するため動作する。

**「拡張内完結」の具体的根拠**:
| 観点 | pi-autoresearch の実装 | pi-mcp-export 配下での挙動 |
|---|---|---|
| サーバ起動 API | 拡張内で `http.createServer()` を呼び、`server.listen(port)` でバインド | jiti 経由で評価されるため **Node プロセス内で同じコールスタックで動作**。追加の設定は不要 |
| ポート選定 | 拡張内で利用可能ポートを検索（`0` を渡して OS 割当、または固定ポート） | **ポート衝突が発生する場合あり**: 同一マシンで複数の pi-mcp-export プロセス（複数 MCP クライアントから接続）が立ち上がると、固定ポート前提の拡張では **後発が EADDRINUSE で失敗** する。ランダムポートを使う拡張は問題なし |
| プロセス寿命 | 拡張は pi 本体プロセス内で起動、pi 終了時にサーバも終了 | **pi-mcp-export プロセスの寿命に従属**。MCP クライアント（Hermes 等）が stdio を閉じると pi-mcp-export が終了し、`server.close()` が呼ばれなくても Node のプロセス終了で TCP ソケットは閉じる |
| グレースフル終了 | pi 本体が `session_shutdown` でハンドラ発火 → 拡張が `server.close()` 実施 | Phase 4 の `session_shutdown` 実装後は**同等に動作**。それ以前は強制終了扱いで進行中のレスポンスが中断する可能性あり |
| cwd の扱い | pi プロセスの cwd でファイル書き込み | MCP クライアントから `--cwd` で渡された値を使う。クライアントが cwd を渡さない場合は pi-mcp-export プロセスの cwd（通常ユーザーの起動時 cwd） |

**運用上の注意**（README で明示予定）:

- pi-autoresearch のようにポート固定（例: `localhost:4321`）を前提とする拡張を複数の MCP クライアントから同時起動する場合、**1 クライアントずつ使う運用**を推奨
- 将来的に `--port-offset` フラグなどで複数インスタンス共存を補助する余地あり（§8 将来拡張候補）
- ダッシュボード URL（`http://localhost:4321` 等）は MCP notifications 経由でクライアントに通知される（`ctx.ui.notify` 実装済み）。クライアント側で自動でブラウザ起動するかはクライアント依存

### 5.2 非対話的

`ctx.ui.confirm` / `select` / `input` を使う拡張は、対話部分が常にデフォルト値を返す挙動になる。明示的な確認を必要とする危険な操作（例: `rm -rf` ガード系）を行う拡張は機能不全となる。

### 5.3 モデル制御の非対応

`pi.setModel`, `pi.registerProvider`, `pi.getThinkingLevel` 等のモデル制御は MCP スコープ外のため非対応。モデル選択は MCP クライアント（Hermes 等）の責務。

### 5.4 セッション永続化の制限

- `pi.appendEntry(customType, data)` は in-memory のみ。プロセス終了で消失
- `ctx.sessionManager.getSessionFile()` は `null` を返す
- 拡張がファイルシステムに書き出すデータ（例: pi-autoresearch の `autoresearch.jsonl`）は cwd ベースで動作 → MCP クライアントから渡される cwd 次第で振る舞いが決まる

### 5.5 マルチユーザー／並列呼び出し

- 単一 pi-mcp-export プロセスは **1 クライアント / stdio** を前提
- 複数クライアントから同時接続したい場合はプロセスを複数起動
- ツール呼び出しの並列性は pi 拡張側の実装に依存（拡張がグローバル状態を持つ場合レース発生可）

**「1 プロセス = 1 クライアント」にした根拠**:

1. **stdio プロトコルの本質的制約** — MCP stdio 接続は双方向パイプ前提で、複数クライアントの多重化は MCP 仕様が想定していない。HTTP / SSE モード（§8 将来拡張）でのみ多重接続が意味を持つ
2. **pi 拡張の内部状態モデル** — pi 拡張は「1 セッション = 1 拡張インスタンス」を前提に書かれている（`session_start` → `session_shutdown` が 1 回ずつ）。複数クライアントで共有すると、`pi.appendEntry` の in-memory 状態や `ctx.ui.setStatus` のキー衝突が起き、拡張作者が想定していない挙動になる
3. **プロセス分離のコストが低い** — Node.js プロセスの起動は数百 ms、メモリは拡張あたり ~50 MB 程度で、クライアントごとに分離する実装コストは低い。MCP クライアント側の設定で `command: "pi-mcp-export"` を複数エントリ書くだけで済む
4. **状態共有の複雑さを避ける** — プロセス間で拡張状態を共有しようとすると、ロック・シリアライズ・一貫性管理が必要になる。そこまでの価値がある利用形態（例: 重い初期化を共有したい）は現時点で想定されない

将来 HTTP / SSE モードを追加した場合は「1 プロセス = N クライアント」を検討するが、その際も拡張インスタンスはセッション単位で分離する方針を維持する。

### 5.6 ライセンス

- pi-mcp-export 自体は **MIT** で配布予定
- `@mariozechner/pi-coding-agent` (MIT) の型定義を dev-dep として取り込む
- 実装中は pi 拡張そのもののコードを再配布しない

## 6. 実装計画

### 6.1 フェーズ分け

| Phase | 成果物                                                                                      | 検証基準                                                              | 工数目安 |
| ----- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------- |
| **0** | リポ初期化、`package.json`, CI 雛形、README stub                                            | `npm run build` 成功                                                  | 0.5 日   |
| **1** | `serve` コマンドスケルトン、MCP stdio サーバ、`registerTool` 1 種、TypeBox 変換の基本ケース | fixture の 1 ツール拡張を MCP Inspector で呼び出し成功                | 1-2 日   |
| **2** | `registerTool` のフル対応、`ctx.cwd`, `ctx.signal`, error handling                          | `pi-autoresearch` の 3 ツールを Hermes から end-to-end で呼べる       | 2-3 日   |
| **3** | `registerCommand` を MCP Tool として露出、`ctx.ui.notify` → MCP notifications               | `pi-autoresearch` の `/autoresearch` コマンド相当が Hermes から呼べる | 2 日     |
| **4** | イベントフック（`session_start`, `session_shutdown`, `tool_call` block, `tool_result`）     | Hermes のセッション開始・終了で拡張のハンドラが発火                   | 2-3 日   |
| **5** | `inspect` サブコマンド（拡張の対応可否レポート）、非対応 API 警告の整備                     | `pi-mcp-export inspect <path>` で対応状況が可読な形で出力             | 1 日     |
| **6** | npm 公開、README 完成、pi-autoresearch 用 example、CI 緑化、MCP Inspector スクリプト        | `npm install -g pi-mcp-export` で外部ユーザーが動かせる               | 1-2 日   |

**合計見積: 10-15 営業日**

**Phase 2 と Phase 4 がボトルネックとなる根拠**:

- **Phase 2 (`registerTool` フル対応・2-3 日)** が重い理由:
  - 実 pi 拡張（pi-autoresearch）の 3 ツールが使う全機能を網羅する必要あり: `ctx.cwd`, `ctx.signal`（AbortSignal 伝播）、`onUpdate` コールバック（tool 実行中の進捗通知）、pi の戻り値形式（`{ content: [...], details: {...} }`）→ MCP `ToolResult` 形式への変換、例外処理（拡張内 throw をどう MCP error にマップするか）
  - `run_experiment` は子プロセスを spawn しタイムアウト・シグナル伝播が必要。MCP キャンセルシグナル → `ctx.signal` → 子プロセス kill の経路を正しく通す必要がある
  - E2E 検証（MCP Inspector + Hermes）で 2 経路確認する工数が追加でかかる
- **Phase 4 (イベントフック・2-3 日)** が重い理由:
  - `tool_call` block 判定は **dispatcher の pre-hook** でハンドラ戻り値 `{block: true, reason: "..."}` を検査し、MCP error として返す経路の実装・テストが必要
  - 複数の `on("tool_call", ...)` ハンドラが登録された場合の**発火順序保証**（pi 本体の挙動に合わせる必要）
  - `session_start` / `session_shutdown` は 1 回ずつ発火する保証（stdio close の競合、SIGTERM 受信時のクリーンアップ順序）が必要で、race condition のテストが手間
  - `resources_discover` の判断（§4.4）が Phase 4 末で発生するため、判断によって実装量が変動

**他 Phase が軽い根拠**: Phase 0/5/6 は定型作業（リポ初期化、レポート機能、リリース準備）で裁量が少ない。Phase 1 は最小スケルトンで 1 ツールのみ、Phase 3 は `registerCommand` 2 案のうち案 A に絞ってデフォルト実装するため実装対象が明確。

**見積もりの性質と reforecast**:

本節の Phase 別日数と合計 10-15 営業日は、**実装着手前の粗い目安**であり実績データに基づかない。参考値として Hermes の `tools/mcp_tool.py`（~1050 行）と TypeScript 公式 SDK の example server（200-400 行）を見たが、いずれも 1 事例で reference class forecasting（Kahneman の outside view）には足りない。McConnell _Software Estimation_ の Cone of Uncertainty は実装前の見積もりを ±4 倍幅とする。

そのため数値の信頼性は、内部推論ではなく**外部への接地**で確保する:

1. **Phase 1 完了時点で reforecast する** — 実作業時間を計測し、残 Phase の日数を実績ベースで上書きする。本節の数値はその時点で更新される
2. **判断の主軸は §0.4 の撤退条件表** — 「30 日超で撤退」の閾値は案 A/B/C 比較（外部）に根拠を持つ。点推定の精度ではなく、撤退ラインの非対称性が実意思決定に効く
3. **±ブレ幅は書かない** — 実装前の「3 要因単純加算で ±X%」のような自己正当化は LLM の confabulation と区別がつかないため、実績が出るまで精度の主張は避ける

### 6.2 リポジトリ構成

```
pi-mcp-export/
├── package.json                       # bin: pi-mcp-export
├── tsconfig.json
├── README.md                          # 利用例、制約一覧、対応拡張リスト
├── spec.md                            # 本ドキュメント（メンテ継続）
├── LICENSE                            # MIT
├── .github/workflows/
│   ├── ci.yml                         # typecheck, test, lint
│   └── release.yml                    # npm publish
├── src/
│   ├── cli.ts                         # エントリポイント（commander）
│   ├── server.ts                      # MCP サーバ本体
│   ├── loader.ts                      # jiti ベースの拡張評価
│   ├── api_mock/
│   │   ├── extension_api.ts           # ExtensionAPI モック実装
│   │   ├── ui_context.ts              # ctx.ui → MCP notification
│   │   ├── session_manager.ts         # ctx.sessionManager 最小スタブ
│   │   └── unsupported.ts             # 非対応 API の no-op + 警告
│   ├── schema/
│   │   ├── typebox_to_json_schema.ts  # TypeBox → JSON Schema
│   │   └── errors.ts                  # 変換不能時のフォールバック
│   ├── registry/
│   │   ├── tools.ts                   # Tool Registry
│   │   ├── commands.ts                # Command Registry
│   │   └── events.ts                  # Event Router
│   ├── dispatch/
│   │   ├── tool_dispatcher.ts         # tools/call 実装
│   │   └── command_dispatcher.ts      # command-as-tool 実装
│   └── inspect.ts                     # inspect サブコマンド
├── tests/
│   ├── fixtures/
│   │   ├── minimal-ext/               # 1 ツールの極小拡張
│   │   └── pi-autoresearch-snapshot/  # 対応確認用の snapshot
│   ├── loader.test.ts
│   ├── schema.test.ts
│   ├── dispatcher.test.ts
│   └── e2e/
│       ├── mcp_inspector.test.ts      # MCP Inspector で tool call
│       └── hermes.test.ts             # Hermes 向け設定で動作確認
└── examples/
    ├── hermes-config.md               # Hermes mcp.json 設定例
    ├── claude-desktop-config.md       # Claude Desktop 設定例
    └── supported-extensions.md        # 動作確認済み拡張リスト
```

### 6.3 CLI 仕様

```
pi-mcp-export <command> [options]

Commands:
  serve      MCP サーバを stdio で起動
  inspect    拡張が対応可能か検査してレポート

Common options:
  --extension <path>          拡張のパス or npm: 参照（複数指定可）
  --extensions-dir <dir>      ディレクトリ内の拡張を自動検出
  --log-level <level>         debug | info | warn | error (default: info)

serve options:
  --cwd <path>                拡張に渡す cwd（default: プロセス cwd）
  --expose-commands-as-prompts   registerCommand を MCP Prompt に露出（default: Tool）
  --strict                    非対応 API 使用を検出したら起動失敗
  --timeout <sec>             1 ツール呼び出しのタイムアウト（default: 300）

inspect options:
  --format <fmt>              text | json (default: text)
```

### 6.4 テスト戦略

- **単体テスト**: Vitest、loader / schema / dispatcher を網羅
- **統合テスト**: MCP Inspector を使った tool call / prompts list の E2E
- **回帰テスト**: pi-autoresearch を snapshot として取り込み、リリース前に必ず実行
- **CI**: GitHub Actions で typecheck + test + lint を PR ごとに実行
- **手動検証チェックリスト**: `examples/supported-extensions.md` に既知拡張の対応状況を表で管理

## 7. リスクと緩和策

| リスク                                        | 影響                                    | 緩和策                                                                           |
| --------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| pi 側が `ExtensionAPI` の内部型を破壊的に変更 | 突然動かなくなる                        | pi のバージョンを `peerDependencies` で固定、CI で複数バージョンをマトリクス実行 |
| TypeBox 変換で未知型が頻発                    | 拡張の一部ツールが動かない              | `inspect` で事前検査、フォールバック警告を明示                                   |
| `ctx.ui.confirm` に依存する拡張で安全性低下   | 危険操作が確認なしで実行                | `--strict` フラグで confirm 検知時に起動失敗、README で注意喚起                  |
| MCP クライアントごとの非互換                  | Hermes では動くが Cursor では動かない等 | Phase 6 の E2E で主要クライアントを確認、差分を README に明示                    |
| pi 拡張側の作者が商用利用を嫌う               | ライセンス問題                          | MIT ライセンスの拡張のみ example として同梱、others は URL 参照のみ              |
| Node ランタイム必須で敷居が高い               | 導入障壁                                | README で Node インストール手順を明記、`bunx` でも動くことを確認                 |

## 8. 将来の拡張

- **npm 直接インストール**: `pi-mcp-export serve --extension npm:@user/pkg` で自動 fetch
- **pi-mono への upstream PR**: 公式に `pi extensions export-mcp` サブコマンドを提案
- **対応拡張カタログ**: [agentskills.io](https://agentskills.io) に連なる形で、動作確認済み pi 拡張のリストをサイト化
- **リモート MCP モード**: stdio だけでなく HTTP / SSE 対応
- **対話的 UI のブリッジ**: MCP の `elicitation` プリミティブ（策定中）が普及したら `ctx.ui.confirm` を実装

## 9. 参考資料

### 9.1 pi / Hermes / pi-autoresearch

- [@mariozechner/pi-coding-agent (npm)](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) — pi 拡張 API の型定義
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) — pi のモノレポ
- [pi-mono Issue #563 — MCP extension example](https://github.com/badlogic/pi-mono/issues/563) — pi コミュニティ側の MCP 対応要望
- [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — 本プロジェクトのアンカー検証対象
- [NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent) — Hermes 本体
- [Hermes plugin build guide](https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin) — 却下した案 A の実装手段
- [Hermes Issue #360 — Pi-inspired RPC mode](https://github.com/NousResearch/hermes-agent/issues/360) — Hermes 側の関連提案（本プロジェクトとは方向が逆）
- [@sinclair/typebox](https://github.com/sinclairzx81/typebox) — pi 拡張が使うスキーマライブラリ（JSON Schema 変換対象）
- [`@mariozechner/pi-ai` の StringEnum](https://github.com/badlogic/pi-mono) — pi 独自の enum ヘルパ（§4.1 で個別対応）

### 9.2 MCP

- [Model Context Protocol specification](https://modelcontextprotocol.io/)
- [@modelcontextprotocol/sdk (TypeScript)](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)

### 9.3 近接プロジェクト

- [nicobailon/pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) — 方向が逆（MCP → pi）、設計の参考
- [Skills Hub (agentskills.io)](https://hermes-agent.nousresearch.com/docs/skills/) — SKILL.md のクロスフレームワーク標準

## 10. 決定ログ

| 日付       | 決定事項                                                                                                                                                                                                                                                    | 根拠                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-17 | 3 案（§0.4 の A/B/C）から **案 B: MCP 変換器** を選択                                                                                                                                                                                                       | **優先順位**: ①リーチ（全 MCP クライアント）②工数（~800 行、Hermes 側クライアント既存）③責任範囲の明快さ ④コミュニティ貢献（pi Issue #563）。**撤退条件**: Phase 2 終了時点で工数が 30 営業日超に膨らむ兆候があれば案 A にピボット再検討。詳細は §0.4                                                                                                                                                                            |
| 2026-04-17 | 実装言語は TypeScript                                                                                                                                                                                                                                       | pi 拡張が TS ネイティブ、ExtensionAPI 型を再利用できる、jiti で compile 不要                                                                                                                                                                                                                                                                                                                                                     |
| 2026-04-17 | 配布は npm (`pi-mcp-export`)                                                                                                                                                                                                                                | Node エコシステムとの親和性、MCP クライアントの設定に `command: "npx pi-mcp-export"` と書ける                                                                                                                                                                                                                                                                                                                                    |
| 2026-04-17 | UI 系・キーバインド・モデル制御は非対応で割り切る                                                                                                                                                                                                           | MCP のスコープ外、対応しようとすると責務が肥大化（詳細は §5）                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-04-17 | SKILL.md 部分は別扱い（本プロジェクトのスコープ外）                                                                                                                                                                                                         | pi-autoresearch の SKILL.md は agentskills.io 標準準拠で、`~/.hermes/skills/` 直置きで動作する。本プロジェクトは TS 拡張部分のみ対象                                                                                                                                                                                                                                                                                             |
| 2026-04-18 | §6.1 の工数見積もり自己正当化（±30% ブレ幅の 3 要因加算表・±20% では足りない理由・±50% は過大な理由）を削除し、「Phase 1 完了時に実績で reforecast」方針に置き換え                                                                                          | 実装前の LLM 生成見積もりは reference class の裏付けを持たず、内部推論による自己正当化は confabulation と区別がつかない（別セッションで同じプロンプトを投げれば ±25% でも ±40% でも同じ文体で正当化される）。McConnell の Cone of Uncertainty、Kahneman の planning fallacy、No Estimates 派（Duarte/Holub）が揃って inside view を警告する。判断に効くのは非対称な境界（§0.4 の撤退閾値）であり、点推定の精度は実績で上書きする |
| 2026-04-18 | TypeBox → JSON Schema 変換は kind 別分岐を止め `JSON.parse(JSON.stringify(schema))` + `[Kind]` 存在チェックに統一                                                                                                                                           | §12.1。TypeBox 0.34.x は `[Kind]` Symbol を除けば JSON Schema を直接出力しており、§4.1 policy 1「標準コンストラクタはそのまま透過」を最短で実現できる。Phase 2 の Array/Union/Optional/Literal も追加コードなしで透過する。代償: 未知型検出が「TypeBox 以外」単位になり spec §4.1 の「個別 kind の未知」粒度は失う（実害なし）                                                                                                   |
| 2026-04-18 | `--extension` は commander の collector で repeatable、default 値は渡さない                                                                                                                                                                                 | §12.4。`requiredOption` に default 配列を渡すと required 判定が殺される commander 仕様。default なし + collector 側で `previous === undefined` を吸収することで spec §6.3「複数指定可」を Phase 1 から満たす                                                                                                                                                                                                                     |
| 2026-04-18 | Loader は `existsSync` でエントリ存在を先に確認し、不在は `Extension file not found:` で包む。それ以外の jiti エラーは verbatim で propagate                                                                                                                | §12.5。/simplify で一度削除したが /codex:review で「jiti の MODULE_NOT_FOUND は拡張の内部 import 失敗でも出る」ことが判明して復活。TOCTOU より診断可能性を優先                                                                                                                                                                                                                                                                   |
| 2026-04-18 | `package.json.bin.pi-mcp-export: ./bin/pi-mcp-export.mjs` を宣言                                                                                                                                                                                            | spec §1.4 成功条件 1「`pi-mcp-export serve --extension <path>` で起動」を `npm install -g` 経由で満たすため。静的テスト (`tests/package-bin.test.ts`) で bin マップと target の実在を検証                                                                                                                                                                                                                                        |
| 2026-04-18 | `--extension <path>` の `<path>` がディレクトリのとき `<path>/index.ts` に解決する                                                                                                                                                                          | spec §6.3 は file/directory 扱いを未指定。pi 本体が `~/.pi/agent/extensions/<name>/index.ts` 規約なので合わせる。エラーは `ENOENT` のみ握りつぶし、それ以外（EACCES 等）は propagate                                                                                                                                                                                                                                             |
| 2026-04-18 | jiti の `@/*` alias は `bin/pi-mcp-export.mjs` で明示注入                                                                                                                                                                                                   | §12.2。jiti 2.x は tsconfig `paths` を自動読み取りしないため。拡張側で絶対 import を許したければ同じ alias 注入が必要                                                                                                                                                                                                                                                                                                            |
| 2026-04-18 | Tool `execute` シグネチャを pi の正式形 `(toolCallId, params, signal, onUpdate, ctx)` に統一                                                                                                                                                                | Phase 1 の単引数形は最小動作用。pi-autoresearch など実拡張はこの 5 引数形を前提とし、`ctx.ui.notify` / `ctx.cwd` / `ctx.signal` を実際に touch する。ToolDef も `label` / `promptSnippet` / `promptGuidelines` / `details?` を optional 化                                                                                                                                                                                       |
| 2026-04-18 | `pi.registerCommand("x", ...)` を Tool 名 `command_x` として Registry に露出                                                                                                                                                                                | spec §4.3 案 A。Phase 3 以降で MCP Prompt 成熟を待つが、Phase 2 は Tool 化で即可搬                                                                                                                                                                                                                                                                                                                                               |
| 2026-04-18 | `pi.on(event, handler)` は全 event 登録を受け入れるが、発火するのは `session_start` / `session_shutdown` のみ                                                                                                                                               | spec §4.4 の写像。他イベントは Phase 3-4 で発火経路を追加。emit signature は `(name, eventObj, ctx)` variadic                                                                                                                                                                                                                                                                                                                    |
| 2026-04-18 | `ctx.ui.setWidget` / `ctx.ui.custom` は shape-preserving no-op（custom は `undefined` で即 resolve）                                                                                                                                                        | spec §2.2 非対応。pi-autoresearch の blocking overlay は shortcut 経路なので本プランでは発火しない                                                                                                                                                                                                                                                                                                                               |
| 2026-04-18 | pi-autoresearch は `tests/fixtures/` に snapshot せず、外部 path を直接 `--extension` に渡す                                                                                                                                                                | spec §6.2 の snapshot 計画は Phase 6（npm 公開準備）で再考。開発中は外部 path のほうがバージョン固定不要 + `node_modules` も外部 repo のものが自然に解決。E2E テストは `existsSync` で検出・非存在環境は `describe.skip`                                                                                                                                                                                                         |
| 2026-04-18 | `ctx.sessionManager.getBranch()` は同期 iterable を返す (`ReadonlyArray<unknown>`、Phase 2 では `[]`)                                                                                                                                                       | §12.7。命名に反し実体は「セッション履歴ツリーの分岐エントリ列」。pi-autoresearch は `for (const entry of ctx.sessionManager.getBranch())` で同期反復するため async / null では TypeError                                                                                                                                                                                                                                         |
| 2026-04-18 | Tool の `details` 戻り値を MCP `CallToolResult.structuredContent` に forward（Codex P1）                                                                                                                                                                    | pi-autoresearch は全 3 ツールで `{content, details}` を返し、`details` に実験 state や実行メタデータ（commit、duration、metric 等）を入れる。dispatcher が content だけ返す形では MCP クライアントが構造化データを失う。`details === undefined` のときは `structuredContent` フィールドを付けない（MCP spec 準拠）                                                                                                               |
| 2026-04-18 | `pi.exec` は spawn native signal/timeout に任せず、abort/timeout を手動 listen し SIGTERM→500ms→SIGKILL で段階送出（Codex P2a）                                                                                                                             | §12.9。spec §2 の SIGKILL escalation 要件。/simplify で一度「spawn `{signal, timeout}` で足りる」と判断したが、実測で SIGTERM を trap する子プロセスが zombie 化することを Codex で検出                                                                                                                                                                                                                                          |
| 2026-04-18 | `session_shutdown` の emit は `sessionAborter.abort()` より先に await する（Codex P2b）                                                                                                                                                                     | §12.10。abort を先に呼ぶと handler の `ctx.signal.aborted === true` で始まり、`pi.exec(..., {signal: ctx.signal})` 等のクリーンアップ処理が即座にキャンセルされる。emit→abort の順にすることで live signal で handler が走り、その後 signal が truthy になる                                                                                                                                                                     |
| 2026-04-18 | Phase 3 のスコープは `onUpdate` → MCP `notifications/progress` 配線のみ（`ctx.ui.notify` / `registerCommand` は Phase 2 で前倒し済み）                                                                                                                      | §12.12。Phase 2 で実装した `notify` wiring と `registerCommand` Tool 化は spec §6.1 上は Phase 3 成果物だった。Phase 3 の新規作業は dispatcher/server の `sendProgress` 配線と E2E テストのみに絞った                                                                                                                                                                                                                            |
| 2026-04-18 | 明示的 MCP-shape `{progress, total, message}` は verbatim 配信、`{details:{phase,elapsed}}` 等は counter ベース合成 + 単調性保証                                                                                                                            | §12.13。tool が explicit に送った progress 値（0 や重複含む）は上書きしない。合成パス（fallback counter）は `lastProgress + 1` で単調増加を保証し、mixed shape（explicit → legacy）でも percent UI が後退しない                                                                                                                                                                                                                  |
| 2026-04-18 | progress 送信は promise chain で直列化、flush は 5s timeout で race する                                                                                                                                                                                    | §12.13。fire-and-forget だと response より後に notification が到着し client 側で "unknown token" 扱いされる。無限 await は遅い/壊れた transport で hang する。2 つの Codex review round を経て「直列化 chain で順序保証 + 5s キャップ」の中庸案に収束                                                                                                                                                                            |
| 2026-04-18 | Phase 4 で `tool_call` pre-hook と `tool_result` post-hook を dispatcher に実装。fail-closed（pre-hook throw で block）・deny-by-default（blocked 時の post-hook mutation は無視）・audit 可視性（blocked / unknown tool でも post-hook 発火）を TDD で固定 | §12.14。Codex review を 8 ラウンド回し P1 3 件 / P2 7 件を漸近的に解消。blocked 時の event.content deep clone、tool_result.input の deep snapshot、`structuredClone` の fallback チェーンなど、エッジケースを段階的に固めた                                                                                                                                                                                                      |
| 2026-04-18 | 以下のイベントは永続的に非対応（MCP に対応経路なし）: `before_agent_start` / `agent_start` / `agent_end` / `session_tree` / `session_before_switch` / `turn_start` / `turn_end` / `session_before_compact` / `resources_discover`                           | §12.14。pi-autoresearch は `resources_discover` を登録しない（§4.4 決定木 Q1=No 経路）。agent lifecycle 系はクライアント側 agent loop 内の概念で MCP サーバから観測・介入不可。登録は `pi.on(...)` で受け付けるが発火しない（no-op）。Phase 5 の `inspect` サブコマンドで "unsupported" ラベルを出力予定                                                                                                                         |

## 11. 進捗 (Progress)

**最終更新:** 2026-04-18 / **現在位置:** Phase 4 完了、Phase 5 未着手。

### 完了済み (Phase 0-1)

- **リポジトリ足場**: pnpm / husky / commitlint / secretlint / oxfmt / oxlint / vitest / nano-staged / TypeScript（strict + exactOptionalPropertyTypes 等）、Node 20+ LTS ESM、`@types/node` exact pin
- **CLI**: `pi-mcp-export serve --extension <path>` 動作。`--extension` は繰り返し可（複数拡張同時 load）。`package.json.bin` で `npm install -g` から起動可能
- **ExtensionAPI カバー範囲（Phase 1）**:
  - `pi.registerTool(def)` の受付と MCP `tools/list` / `tools/call` への露出
  - TypeBox → JSON Schema 変換（§12.1 の透過方式により Phase 2 の Array/Union/Optional/Literal も自動対応）
  - `registerShortcut` = no-op + stderr 警告
  - jiti 経由の拡張評価、`bin/pi-mcp-export.mjs` で `@/*` alias 注入
  - stdio MCP サーバ、in-memory 統合テスト、`child_process` による CLI e2e

### 完了済み (Phase 2)

- **Tool `execute` シグネチャを 5 引数化**（`toolCallId, params, signal, onUpdate, ctx`）。ToolDef も pi-autoresearch の実フィールド（`label`, `promptSnippet`, `promptGuidelines`, `details?`）を optional 受け入れ
- **`pi.exec`**: `node:child_process.spawn` ラッパ。cwd / signal / timeout / env 対応、SIGTERM → 500ms → SIGKILL
- **EventRouter** + **`pi.on`**: 全 event 登録可、`session_start` / `session_shutdown` は server lifecycle で実発火（emit signature `(eventObj, ctx)`）
- **`pi.registerCommand`**: Tool 名 `command_<name>` として Registry に露出（spec §4.3 案 A）
- **`ExecuteContext` builder**: cwd / signal / hasUI=false / hasTerminal=false / ui.notify（MCP `sendLoggingMessage` 経由） / setWidget・custom の no-op / getContextUsage スタブ / sessionManager（getSessionId 定数、getBranch 空配列）
- **MCP `tools/call` → signal + notify wire**: SDK `setRequestHandler(schema, (req, extra) => ...)` の `extra.signal` を dispatcher 経由で tool に渡す。`ctx.ui.notify` は `server.sendLoggingMessage({level, data})` へ
- **pi-autoresearch E2E**: 外部 path を `--extension` で指定。`tools/list` に 3 ツール + `command_autoresearch` が出て、`init → run "echo ok" → log` のフルパスで `autoresearch.jsonl` に記録される
- **検証**: 12 テストファイル / 46 ケース GREEN、`pnpm typecheck` / `pnpm lint` クリーン（Codex review 3 指摘 = tool `details` → `structuredContent`、pi-exec SIGKILL 段階送出復活、`session_shutdown` emit→abort 順序 — すべて TDD で修正）

### 完了済み (Phase 3)

- **`onUpdate` → MCP `notifications/progress`**: dispatcher 内で `sendProgress` optional 経由。`DispatchOptions.sendProgress?: (ProgressParams) => void | Promise<void>`
- **Server 側の progressToken 抽出**: `request.params._meta?.progressToken` を読んで per-call で sendProgress を構築。未指定時は progress 配線全体が no-op
- **2 種類の partial 形式に対応**:
  - Explicit MCP shape `{progress, total?, message?}` → verbatim 配信（tool 供給値を一切 mutation しない）
  - Legacy shape `{details: {phase, elapsed}}` 等 → counter ベースで合成、`lastProgress + 1` で単調増加を保証
- **配送品質**: promise chain 直列化で発射順序保証、`Promise.race(chain, 5s-timeout)` で hang 防止、エラーは握り潰して tool 実行を妨げない。success / error path 両方で flush
- **E2E**: InMemoryTransport 層で client の `onprogress` callback に progress 1..N が順序通り届くことを検証
- **検証**: 12 テストファイル / 60 ケース GREEN、`pnpm typecheck` / `pnpm lint` クリーン。Codex review 5 ラウンド（P1 1 件、P2 6 件）すべて TDD 修正、round 6 で指摘 0 件収束

### 完了済み (Phase 4)

- **`tool_call` pre-hook**: dispatcher が execute の直前に `events.handlersOf("tool_call")` を順次呼び出し、`{type, toolCallId, toolName, input}` event と ctx を渡す。最初に `{block: true, reason}` を返した handler で short-circuit して MCP error を返す。handler throw は fail-closed（block として扱う）。handler は `event.input` を mutate でき、execute はその mutated input を受け取る
- **`tool_result` post-hook**: dispatcher が execute 後に `events.handlersOf("tool_result")` を順次呼び出し、`{type, toolCallId, toolName, input, content, details, isError}` event と ctx を渡す。handler は `{content?, details?, isError?}` を返して結果を部分上書き可能。複数 handler は mutation をチェインする
- **Blocked 時の deny-by-default**: blocked 呼び出しでも tool_result は発火（audit/redaction 用）、ただし handler の戻り値は無視、event に渡す content/details は deep clone して in-place mutation による block 回避を防ぐ
- **Unknown tool の audit 可視性**: 未登録の tool 名が来ても tool_call / tool_result が発火し、handler は `{toolName: "missing", isError: true}` を観測可能
- **`tool_result.input` snapshot**: execute が params を mutate しても post-hook は元の input を観測する（`structuredClone` → JSON deep clone → shallow clone のフォールバックチェーン）
- **非対応イベント（永続 deferred）**: `before_agent_start` / `agent_start` / `agent_end` / `session_tree` / `session_before_switch` / `turn_start` / `turn_end` / `session_before_compact` / `resources_discover` — `pi.on(...)` で登録は受け付けるが発火しない（MCP から観測不能）
- **検証**: 12 テストファイル / 81 ケース GREEN、`pnpm typecheck` / `pnpm lint` クリーン。Codex review 8 ラウンドで P1 3 件（wire events、fail-closed throw、block-mutation chain）と P2 7 件（details on error、blocked audit、deep snapshot、etc）を TDD 修正。round 9 の "cyclic input + function-injection" P2 のみ documented limitation

### 未実装（Phase 5 以降）

- `ctx.ui.setWidget` / `ctx.ui.custom` の実描画（MCP プリミティブ追加待ち）
- `--strict` / `--timeout` / `inspect` サブコマンド
- pi-autoresearch の snapshot 化と npm 公開（Phase 6）

### トラッキング資料

- `test-list.md` — Phase 1 / Phase 2 テストケース状態
- `/Users/sotayamashita/.claude/plans/eventual-sniffing-glacier.md` — 直近のフェーズプラン
- `@10 決定ログ` — 日付順の決定履歴
- `@12 Surprises & Discoveries` — 実装で判明した spec 設計時点の未見通し事項

## 12. Surprises & Discoveries

実装で判明した、spec 作成時点では見通せなかった事実。以降のフェーズ設計と Phase 1 の決定ログ (§10) の参照先。

### 12.1 TypeBox schemas are already JSON Schema at runtime

§4.1 は kind ごとの変換ロジックを要求していたが、TypeBox 0.34.x が出力するオブジェクトは `[Kind]` Symbol を除けばそのまま JSON Schema 形式。実装は `JSON.parse(JSON.stringify(schema))` + `[Kind]` 存在チェックに収束した（Symbol キーは JSON 直列化で自動的に落ちる）。副次効果として Phase 2 に送ったはずの Array / Optional / Union / Literal も追加コードなしで透過する。§4.1 の「policy 1: 標準コンストラクタはそのまま透過」を文字通り最小コストで実現できた。

### 12.2 jiti does not auto-read tsconfig paths

pi 本体と同じランタイム（jiti）を採用したが、jiti 2.x は tsconfig の `paths` を自動読み取りしない。`@/*` alias は `bin/pi-mcp-export.mjs` の `createJiti(url, {alias: {"@": srcRoot}})` で明示注入。Phase 2 以降で拡張側も絶対 import を許可したいなら同じ注入が必要。

### 12.3 MCP SDK v1.29.0 root export is broken

`import "@modelcontextprotocol/sdk"` は `ERR_MODULE_NOT_FOUND` で失敗する（`dist/esm/index.js` が未ビルド）。subpath 経由に統一した: `/server`, `/client`, `/types.js`, `/server/stdio.js`, `/client/stdio.js`, `/inMemory.js`。§7 リスク表（pi/ExtensionAPI 型の破壊的変更）と同類の上流リスクがあり、peerDependency ピン時に副次影響を受ける可能性。

### 12.4 Commander's `requiredOption` is silently satisfied by a collector default

`--extension` を繰り返し可にするため commander に collector 関数を渡したが、同時に default 値 `[]` を渡すと `requiredOption` が「既定値あり = 満たされた」と判定し、引数省略時のエラーが出なくなる。default を渡さず collector 側で `previous === undefined` を吸収する形で解決。テストケース 20（`--extension` 未指定で非ゼロ終了）が一旦タイムアウトで落ちて判明した。

### 12.5 Loader error fidelity requires a pre-existence check

/simplify フェーズで「jiti の `MODULE_NOT_FOUND` はパスを含むので `existsSync` 事前チェックは不要」と判断して削除した。その後 /codex:review で「jiti は拡張の _内部_ import 解決失敗でも同じ `MODULE_NOT_FOUND` を投げる」ことが判明。内部失敗を "Extension file not found" に書き換えるとユーザーがデバッグできない。`existsSync` を復活させてエントリ欠落のみ wrap、jiti のその他エラーは verbatim で propagate する構造に戻した。TOCTOU の懸念より診断可能性を優先。review 層を重ねたことで改善方針同士の衝突を検出できた事例。

### 12.6 ExtensionAPI type drift risk in fixtures

当初 fixture は `ExtensionApiLike` として ExtensionAPI 形状を手書きしていたが、本体の `ExtensionApi` が進化すると fixture が silent drift する（§6.2 のテスト戦略における fixture 品質リスク）。`import type { ExtensionApi } from "@/api-mock/extension-api.ts"` で本体型と結合する形に統一。jiti の alias 注入（§12.2）がこの import を解決する。

### 12.7 `ctx.sessionManager.getBranch()` is a session-history iterable, not git

Phase 2 で pi-autoresearch の `session_start` handler がロード直後に `ctx.sessionManager.getBranch is not a function or its return value is not iterable` で throw した。API 名から「git branch 名を返す」と誤読し、最初 `Promise<string | null>` として実装したのが原因。実体は **セッション履歴ツリーの「現在ブランチ」に沿ったエントリ列** で、pi-autoresearch は `for (const entry of ctx.sessionManager.getBranch())` と同期反復する。`ReadonlyArray<unknown>`（Phase 2 では `[]`）を同期返却する形に修正。ExtensionAPI の命名が機能ドメインを強く示唆しても、実装を確認してから型を決めるべき、という教訓。

### 12.8 pi-autoresearch loads cleanly despite large unsupported API surface

Phase 2 開始前の調査で pi-autoresearch は ExtensionAPI を 10+ 箇所で touch すると判明（setWidget / custom / on × 7 / registerCommand / exec / abort / getContextUsage / sessionManager）していた。ロード時点で全欠落するとクラッシュする懸念があったが、実装順に層を積んだ結果、最終的な Phase 2 実装では:

- 実装: registerTool / registerCommand / on / exec / notify / getContextUsage / sessionManager の最小形
- 無害 no-op: setWidget / custom / abort / registerShortcut
- 未発火: agent\_\* / session_tree / session_before_switch / before_agent_start

これで pi-autoresearch の 3 ツール（+ command_autoresearch）が E2E 通過。**「すべて実装しないと動かない」前提が実測で崩れ、spec §2.1 の P0/P1/P2 階層が現実的に機能する**ことを確認できた。将来拡張（pi-mcp-adapter、safe-git 等）でも同様に段階的対応が可能と見込める。

### 12.9 Node's `spawn({signal})` does not actually kill processes that trap SIGTERM

Phase 2 /simplify で「spawn の native `signal` option に任せれば手書きの abort listener は不要」と判断し、手書き SIGTERM→SIGKILL 段階送出を削除した。Codex /review で検証: Node は abort 時に SIGTERM を 1 回送るだけで、子プロセスが `process.on("SIGTERM", () => {})` で握り潰すと **Node は `error: AbortError` を emit して追跡を諦めるが、子プロセスは生存し続ける**（zombie）。`killed=true` を返しながら実際はリークしている状態。

検出手順:

```javascript
const controller = new AbortController();
const child = spawn(
  "node",
  ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
  { signal: controller.signal, stdio: ["ignore", "pipe", "pipe"] },
);
child.on("error", (err) => console.log("error:", err.name, err.code));
// → abort 後すぐ `error: AbortError ABORT_ERR` を emit。close は来ない。
```

修正: abort/timeout を手動 listen し、SIGTERM 即送 → 500ms 後 SIGKILL 送出の段階処理を維持。spec §2 の "SIGTERM→500ms→SIGKILL" 要件は "簡素化して native 任せ" で満たせないことが実測された。

### 12.10 Shutdown signal: abort-before-emit cancels cleanup work

`session_shutdown` handler が pi.exec や fetch 等の **cleanup 処理を `ctx.signal` に紐づけて実行する** ことを想定した場合、emit の前に `sessionAborter.abort()` を呼ぶと、cleanup 処理が起動直後に即キャンセルされる。「signal を abort することで shutdown を通知する」という直感は handler 側の責務を誤って狭める。

修正: `void (async () => { try { await events.emit(...) } finally { sessionAborter.abort(); } })()`。handler が live signal で走り、完了後に signal が truthy になる。handler が signal abort を検知したいなら代替経路（例: `events.emit("shutdown-pending")` のようなセマンティックイベント）を用意する。Phase 2 は deferred。

### 12.11 Simplification passes can regress spec requirements

§12.9 と §12.10 は、いずれも /simplify フェーズで「冗長」と判断した箇所を Codex /review が「spec 違反 / バグ」として引き戻した事例。§12.5 の loader error fidelity と合わせて 3 件目。パターン: **reviewer はコードの現在形を見て冗長性を判断するが、spec 要件（ここでは "SIGTERM→500ms→SIGKILL"）や意味論（ここでは "cleanup 中に signal は live"）まで照合しきれない**。対策は 2 つのレビュー層（/simplify と /codex:review）を直列で通すことで、単層では見落とす衝突を顕在化させる。Phase 1 でも §12.5 で同じ救済が効いており、本プロジェクトでは両層を回すのがデフォルトになる。

### 12.12 Phase 3 成果物の大半は Phase 2 で前倒し実装されていた

spec §6.1 の Phase 3 成果物は `registerCommand` Tool 化 + `ctx.ui.notify` → MCP notifications の 2 項目。Phase 2 で pi-autoresearch E2E を通すために最小限の `ctx.ui.notify` 配線（`server.sendLoggingMessage` への mapping）が必要になり、同時に `registerCommand` も `command_<name>` Tool として実装された。結果として Phase 3 の実作業は `onUpdate` → `notifications/progress` 配線 1 本に縮小（~9 日想定が ~1 日規模へ）。**spec 上のフェーズ境界と実装順序の非一致は自然に起こる**。Phase 単位の工数見積もりは「何を残して何を前倒すか」で前後すると割り切り、§11 の完了／未実装リストを実装実績に合わせて更新する運用で済ませる。

### 12.13 MCP progress notification の配送品質は 5 ラウンドの review で収束した

spec §2.1 は `onUpdate` の対応を Phase 3 送りとだけ書く。実装で判明した多層の設計空間:

| 問題領域        | 素朴案                      | 問題点                                                  | 最終解                                                               |
| --------------- | --------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| tool → progress | counter の単純合成          | tool が明示的に送る `{progress, total, message}` を喪失 | explicit shape は verbatim、legacy shape は counter ベースで合成     |
| 単調性          | explicit 値も強制的にバンプ | `{progress: 0, total: 100}` が `1/100` に化ける         | counter 側だけ `lastProgress + 1` で monotonic、explicit は verbatim |
| 配送順序        | fire-and-forget             | 非同期送信で順序がズレる可能性                          | promise chain で直列化                                               |
| 最終通知の drop | fire-and-forget             | response 到着後に notification が来ると client が drop  | finally で chain を await                                            |
| hang 耐性       | 無限 await                  | 遅い transport で hang                                  | `Promise.race(chain, 5s-timeout)` で中庸                             |
| error path      | success のみで flush        | tool throw 後の通知が drop                              | try/finally で error path でも flush                                 |

Codex review を 5 ラウンド回して上記 6 問題を 1 つずつ顕在化 → TDD で順次解決。round 6 で指摘 0 件収束。**レビュー層を重ねることは正味のコスト（~7 TDD サイクル追加）だが、配送品質の実装責任を spec 側に押し戻さずサーバ側で完結させた**。将来、他拡張が異なる partial shape で onUpdate を呼んでも、`extractExplicitProgress` と `progressMessage` の 2 関数だけを拡張すれば対応できる。

### 12.14 Phase 4 の tool_call / tool_result 実装は review 8 ラウンドで収束した

spec §4.4 は `tool_call` を "block 判定を尊重" と `tool_result` を "modify 許容" とだけ書く。実装で判明したエッジケース群:

| 問題領域               | 素朴案                          | 問題点                                                   | 最終解                                                    |
| ---------------------- | ------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| server 配線            | dispatcher に events を渡さない | 実 MCP パスで hooks が発火しない                         | CallTool handler で events を opts に forward             |
| pre-hook throw         | fail-open（undefined 扱い）     | policy handler 例外で危険 tool が通る                    | dispatcher 側で fail-closed、error を reason として block |
| error 時の details     | isError 時は content のみ返す   | post-hook が詳細メタデータを付けても失われる             | `structuredContent` を isError 時も返す                   |
| blocked の audit       | 早期 return で tool_result skip | audit/redaction hook が blocked 呼び出しを観測できない   | blocked でも tool_result 発火、ただし戻り値は無視         |
| unknown tool           | 早期 return で hooks 両方 skip  | 未知 tool の probing が audit できない                   | unknown tool でも tool_call / tool_result 両方発火        |
| input snapshot         | 参照保持                        | execute が params mutate すると post-hook が汚染される   | `structuredClone` → JSON → shallow のチェーン             |
| blocked event mutation | ignore return value のみ        | handler が `event.content[0].text = "..."` で block 回避 | blocked の event に渡す content/details は deep clone     |

8 ラウンドで P1 3 件（wire events、fail-closed throw、in-place block bypass）、P2 7 件を解消。**Phase 3 の 5 ラウンドより長く回す必要があった理由**: event hooks は "セキュリティプリミティブ"（deny-by-default を保証する policy gate）として機能するため、mutation 経路・参照共有・fallback の全てで "block が抜ける可能性" を 1 つずつ潰す必要があった。最終的に残した limitation は "cyclic input + function-injection 同時発生時の nested mutation leak" のみ — 実拡張でこの組合せを使う事例はなく、documented として扱う。
