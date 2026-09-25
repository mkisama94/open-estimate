# 実装ログ (IMPLEMENTATION LOG)

## [2026-09-17] マイルストーン M1: 最低限動作するMCPサーバーと4つのコアツールの実装

### 概要
`PH1-SPEC.md`（仕様ID: OES-PH1-0.1.0-draft.1）に基づき、AIクライアント（ChatGPT等）連携用のMCPサーバー基盤およびM1指定の4つのツールを実装しました。

### 実装したMCPツール
1. `get_assessor_contract`: AIへAssessment用JSON Schema、Assessor指示（SKILL.md）、測定規則（COSMIC v5.0 / OES Mapping）、プロファイル識別情報を返却。
2. `prepare_repository`: 対象リポジトリのパス検証（パストラバーサル・symlink・絶対パス拒否）、標準除外リスト（.git, node_modules, binary, .env等）に基づく除外判定、不変スナップショットキャッシュの作成、UTF-8 line_count規約準拠・SHA-256計算、Unicodeコードポイント順の安定manifestおよびmanifest_hashを生成。
3. `read_repository_file`: 不変スナップショットキャッシュから1行〜最大400行かつ64KiBまでのチャンクを行番号付きで読取。読取カバレッジ台帳（analyzed/supporting/unread/excluded）を記録。
4. `evaluate_assessment`: 提出されたAssessmentのraw text重複キー検査、JSON Schema 2020-12 (Ajv 2020) 厳格検証、意味検証（Semantic Validation）、読取カバレッジに基づくinput自動再構築、COSMICデータ移動計数（CFP算出）、完全性状態判定（COMPLETE/PARTIAL/UNSUPPORTED/INCOMPLETE）、TESTプロファイルによる換算試算、Report生成およびreport_hash計算、ローカル状態保持。

### 変更・新規作成ファイル
- `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`
- `DEPENDENCIES.md`: 固定依存関係とバージョン記録
- `contracts/oes-ph1.schema.json`: JSON Schema 2020-12 正本
- `skills/open-estimate-assessor/SKILL.md`, `skill.manifest.json`: Assessor指示書
- `src/core/types.ts`: TypeScript型定義
- `src/core/json-parser.ts`: raw text重複キー検査パーサー
- `src/core/canonical.ts`: RFC 8785 (JCS) 正規化およびSHA-256
- `src/core/validate.ts`: Schema & Semanticバリデータ
- `src/core/normalize.ts`: 決定論的正規化ソート
- `src/core/measure.ts`: COSMIC CFP決定論的計数・状態判定
- `src/core/estimate.ts`: decimal.jsによる換算試算
- `src/core/features.ts`: 分析用特徴量抽出
- `src/collector/safe-paths.ts`: 安全パス解決
- `src/collector/classification.ts`: ファイル分類・除外判定
- `src/collector/snapshot.ts`: スナップショット作成
- `src/collector/coverage.ts`: 読取台帳・カバレッジ再構築
- `src/mcp/state.ts`: MCPローカル状態管理
- `src/mcp/tools/*.ts`: 4ツールのハンドラ
- `src/mcp/server.ts`, `src/index.ts`: MCP stdioサーバー
- `examples/basic-assessment.json`: 6 CFP Golden Fixture
- `src/mcp/resources.ts`: MCPリソース定義（JSON Schema, SKILL.md）
- `README.md`: ChatGPT / Claude Desktop 設定方法と利用ガイド
- `examples/calculation-context.test.json`: TESTプロファイル
- `tests/unit/*.ts`, `tests/integration/*.ts`: 全35件のテスト

### 実行したテストコマンドと結果
1. `npm run build`: 正常終了 (0エラー)
2. `npm run typecheck`: 正常終了 (0エラー)
3. `npm test` (vitest run): 全8テストファイル、全35テスト PASS
   - `json-parser.test.ts`: 4 passed (重複キー検出 A05)
   - `safe-paths.test.ts`: 6 passed (パストラバーサル拒否 A83)
   - `measure.test.ts`: 4 passed (6 CFP計数 A01, COMPLETE/PARTIAL/UNSUPPORTED状態判定 A19-A23)
   - `canonical.test.ts`: 2 passed (JCSキー順序不変性 A02, ID順正規化 A03)
   - `estimate.test.ts`: 4 passed (工数・金額換算 A30-A32, プロファイル不在処理 A35)
   - `validate.test.ts`: 11 passed (Schema, ID重複, 参照解決, 行範囲, プロセス制約, 重複移動 A06-A17)
   - `collector.test.ts`: 1 passed (スナップショットとカバレッジ台帳)
   - `mcp-server.test.ts`: 3 passed (4ツールのエンドツーエンド連携 + MCPリソース提供)
4. MCP stdio 起動検証:
   - JSON-RPC `initialize`、`tools/list`、`resources/list`、`prompts/list`、`tools/call` を stdin 経由で送信し、stdout に純粋な JSON-RPC レスポンスが返ること、ログは stderr にのみ出力されること（A87）を確認。

### 未解決事項・次のステップ
- M1の目標スコープはすべて達成・テスト通過。
- 次のマイルストーン（M2以降）では、署名発行（`issue_certificate`）、ローカル検証（`verify_certificate`）、SQLite永続化（`db/001_initial.sql`）、レポートHTML出力（`render_report`）等に進むことが可能です。

## 2026-09-25 — Cloudflareの配信対象未設定を修正

`npm run build` は成功していたが、公開アセットもWrangler設定も存在せず、`npx wrangler deploy` が配信対象を検出できなかった。既存の `dist/index.js` はstdio MCPであり、HTTP Workerではない。

- `wrangler.jsonc` で `public/` のみを静的配信対象に指定。
- 案内ページ・CSS・404ページ・レスポンスヘッダーを追加。署名発行・台帳・Web検証は未提供と表示し、架空の検証結果は返さない。
- Wrangler 4.140.0をexact versionのdevDependencyとして追加し、lockfileを更新。既存依存パッケージのバージョン変更はない。
- ローカルWeb起動・deploy dry-run・deployのnpm scriptsと、Workers Buildsの設定手順を追加。
- Wranglerのローカル状態、npmキャッシュ、開発用秘密値ファイルをGitの除外対象に追加。

検証結果:

- `npm run build`: 成功。
- `npm test`: 8ファイル・35テスト成功。
- `npm run deploy:check`: 成功。`public/` の4ファイルを検出。
- `wrangler dev` のHTTP確認: `/`・`/styles.css` は200。未実装の検証/API、`/dist/index.js`、`/package.json`、`/.open-estimate-cache/` は404。
- `npm audit`: 既存Vitestとそのmockerにmoderateの指摘が2件。今回追加したWranglerへの指摘はない。テスト基盤のメジャー更新は別作業とする。

サンドボックス内の確認では `WRANGLER_LOG_PATH` と `WRANGLER_REGISTRY_PATH` をリポジトリ内の `.cache/wrangler/` 配下へ指定した。本番のCloudflareアカウントへのデプロイは実施していない。今回公開可能にしたのは案内ページであり、Issuer・D1・リモートMCPの実装完了を意味しない。
