# 実装ログ (IMPLEMENTATION LOG)

## 2026-10-18 — デスクトップ試用版 0.4.0

- ローカルstdio MCP必須構成を廃止。同梱CLIのcontract/scan/confirm/prepare/read/export/purgeと、HTTP MCPのevaluate_modelに分離。旧ローカル経路のコード・旧配布先は比較用として維持。
- Collector・SHA-256・行番号付き読取・CoverageTracker・Assessment検証を再利用。session JSONに対象確認と読取台帳を保存し、別プロセスで復元。24時間で期限切れ、purgeで明示削除。export時にも全測定コピーのhashを照合。
- 送信契約v1は連番整数・enum・booleanのみ。原ID・名前・説明・パス・根拠本文・hash・計算済み値・任意プロファイルを受け付けない。入力Schema・参照・トリガー・peer/store・重複・上限をサーバーで検査し、CFP/TEST工数/USD/FRB表示換算を再計算。
- assuranceにCLIENT_REPORTED、NOT_INDEPENDENTLY_VERIFIED、未署名・未保存・未公開を明示。認証・所有者管理・証明書発行は実装しない。
- 検証：build、Vitest 92件、Worker dry-run、実際のローカルworkerdへSDKのHTTP MCPクライアントで接続してinitialize/list/call（6 CFP・18人時・900 USD）、別フォルダーへ移設した配布物のCLI起動・対象確認・秘密ファイル除外・読取・削除が成功。FRB換算は既存fixtureと取得処理の回帰試験で確認。
- L01/L03/L04/L06はローカル自動検証済み。L05は正規投影のcanary非混入・未知フィールド拒否・アプリの非保存を検証、公開環境ログは未確認。L02のWork/Codex実機操作、クリーンOS、公開ドメイン接続、審査は未実施。詳細は[DESKTOP-PLUGIN.md](DESKTOP-PLUGIN.md)。

## 2026-10-14 — ローカルプラグイン評価版 0.2.0

- Skill＋stdio MCP＋実行時依存を含むローカルマーケットプレイスを作成。導入・品質確認・対象workspace切替は[LOCAL-PLUGIN.md](LOCAL-PLUGIN.md)。対象とNodeパスを配布時に固定する。
- 6ツールへ拡張。評価をローカルJSONに保存し、`get_evaluation`で再表示、`render_report`で機能・根拠・未解決点を確認できるHTMLを生成する。認証・署名・発行・公開・Web管理・デプロイは対象外。
- 固定Report v3とCalculationBasis、可変DisplayQuote v1を追加。旧Report/PublicEstimate契約は上書きしない。Webへ組み込める共通計算・取得処理を実装したが、公開DTOへの投影とWeb接続は未実装。
- FRB H.10 Weeklyを直接取得。表示要求ごとに再確認し、同時要求だけ統合。5秒・5MiB制限、方向・単位・日付・ND・正数検査、取得失敗時の警告付きキャッシュ、14日超の未算出、USD接続不要を実装。
- 作業範囲は設計・実装・テスト（企画・運用を除く）。係数2/3/5人時/CFPと時給50 USDはTEST値。標本数0・架空値を明示し、工程別比率は作らない。
- 元manifest・hash・byte数・行数・入力metadata・実読取台帳を照合。未読根拠、ファイル省略、改ざん、資料だけの実装根拠申告を拒否。Skill package hashはPH1-SPECの各ファイルhash＋JCS方式で配布ディレクトリから再計算する。
- 検証：TypeScript build/typecheck、Vitest 70件、Skill Creator quick_validate。別ディレクトリの配布物からstdio起動し、実コード読取→手動基準Assessmentの6 CFP／18人時／900 USD→別プロセスから再表示→HTMLを確認。実際のAIモデルによる抽出やアプリへのインストールは未検証。
- FRB実接続：2026-10-14に成功。2026-10-09観測、2026-10-13公表、158.34 JPY/USD。手動基準の中央値は142,506円（TEST）。確認記録とHTMLは`release/validation/`へ出力。
- FXキャッシュ・読取台帳はプロセス内。保存評価は同一workspace設定で再起動後も取得可能。snapshot・評価・HTMLの自動削除は未実装。初回AIチャットでの品質確認は導入手順に記載。

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

## 2026-10-14 — 表示時為替と対象作業の仕様更新（未実装）

利用者の指定を受け、FRB H.10直接取得、プラグイン・Web共通の表示時換算、対象作業「設計・実装・テスト」（企画・運用除外）を仕様へ反映した。

- `docs/implementation/DISPLAY-VALUATION.md`を共通契約として追加。固定評価・USD基準額と可変DisplayQuoteの分離、表示時のFRB再確認、取得失敗時の表示、署名・公開同意・印刷・外部SNS cacheの扱い、V01〜V12の受入条件を記載。
- PRODUCT-ARCHITECTURE、PH1-SPEC、ALGORITHMS、MCP-CHATGPT-PLUGIN、PLUGIN-IMPLEMENTATION、WEB-API-IMPLEMENTATION、SHARED-SPEC、ACCEPTANCE、IMPLEMENTATION、READMEの関連規定と参照を更新。
- 旧scopeを自動的に新scopeへ読み替えない。工程別工数の比率を創作しない。
- 今回は仕様文書のみ。`src/`、`contracts/`、`skills/`、`public/`の実装変更、プラグイン配布、FRB adapterの実接続試験、デプロイは未実施。工数係数・時給の実績データ承認とは別の変更として扱う。

確認：文書差分、参照リンク、関連旧規定との整合を確認。受入V01〜V12は実装後の試験であり、現時点はNOT_RUN。

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

## 2026-10-18 — 対象プロジェクトの走査・確認（0.3.0）

固定対象の配布を廃止。discover_workspaceでファイル構成のみ走査し、利用者の回答後にconfirm_workspaceで確定する8ツール構成。MCP rootsを優先、非対応時は会話の現在のプロジェクトを出所未検証の候補として提示する。roots取得失敗は別パスにフォールバックしない。再走査・roots変更・再起動で確認無効、対象変更で旧snapshotを破棄。確認申告はAIによるもので独立したユーザー操作の証明ではない。AsyncLocalStorageで要求ごとの対象を分離。Typecheck、build、78テストと配布物のstdio試験で検証。実際のCodexホストのroots提供状況は未検証。

## 2026-10-18 — ローカルMCP必須条件の廃止（仕様変更）

利用者からCodexでの動作確認と初期目的の達成が報告された。続く公開配布の検討で、ローカルMCP申請に承認済みパートナーの制約があること、利用者がローカル実装を書き換えられるためMCP接続が真正性の保証にならないことを確認した。

- `LOCAL-EXECUTION-BOUNDARY.md`を追加。公開版はSkill・標準ツール・ローカル補助スクリプトとリモートMCPに分ける。
- PRODUCT-ARCHITECTUREとREADME、MCP/プラグイン実装仕様への参照を更新。対象範囲の確認と読み取り制限は維持し、ローカル記録・ハッシュ・確認フラグをクライアント申告として扱う。
- サーバーの責務を入力検査・独立再計算・サーバー側認可に置き、ソース実在性やAI解釈の正しさを独立検証済みと説明しない。
- 公式のSkillスクリプト同梱とデスクトップ実行プラグインの手順を参照。次期構成の審査通過・動作を保証しない。送信Schema・認証/保存・実行環境・キャッシュ寿命の未決を維持する。

今回は仕様のみ。0.3.0のコード・実行Skill・配布物の変更、リモートMCP実装、デプロイは行っていない。L01〜L06の移行受入条件は未実施。
