# Open Estimate (OES) — Work／Codex・ローカル実行向け 0.7.0

**ソース解析には、対象フォルダーを読み取り、補助スクリプトを実行できるWorkまたはCodexのローカル実行環境とNode.js 24以上が必要です。** Chatモードでフォルダーパスを指定するだけでは解析できません。Work／Codexでも対象へアクセスできないクラウド環境では実行できません。[初めての導入・開始手順とエラー別の案内](docs/DESKTOP-PLUGIN.md)を参照してください。Assessmentの下書きと検査済み入力をセッション内にローカル保持します。評価ID・サーバー保存・確認用HTML・証明書は未提供です。Workでの評価完了は実機未確認です。

**現在の構成**：同梱CLIとHTTPリモートMCPを使用します。`npm run build` → `npm test` → `npm run plugin:pack` → `npm run plugin:smoke`。単独packはローカル検証用の`release/local-marketplace`です。正規配布先`release/desktop-marketplace`への昇格は統合リリース経路を使います。[利用・送信契約・検証範囲](docs/DESKTOP-PLUGIN.md)と[Assessment v2の実装内容](docs/implementation/ASSESSMENT-RECORDS-V2.md)を参照してください。サーバー保存・認証・発行は未提供で、0.5.0の本番デプロイは実施していません。以下の0.3.0記述は従来実装の記録で、現行版の導入手順には使いません。

**中央測定ルール（0.7.0）**：原本は`rules/measurement/source.md`一つです。contract・skill-integrity → `get_measurement_rules`で全文取得 → scan・`bind-rules`で版固定 → 既存の対象確認と解析 → export → リモート評価の順です。数値モデル・表示通貨・配布スキルのID/版/整合性確認用ハッシュ・固定した測定ルールのruleset_refを送信します。対象ソース、対象パス、Assessment、判断台帳、ルール本文、ローカルcontextは送信しません。 初回対応後の本文更新は `npm run rules:release` だけで行い、プラグインの再配布・版採番・hash転記を不要にします。[運用手順](docs/implementation/CENTRAL-MEASUREMENT-RULES-OPERATIONS.md)／[実装・検証記録](docs/implementation/CENTRAL-MEASUREMENT-RULES-RESULT.md)。本番反映・正規配布先への昇格・実ホスト受入は別工程です。

**0.6.0時点のスキル整合性の記録**：数値モデルと、利用する配布スキルのID・版・整合性確認用ハッシュを送信します。対象ソースコード、名称、説明、ファイルパス、根拠本文、対象ソースのハッシュは送信しません。 `get_skill_policy` → CLIの`skill-integrity` → exportの`skill_integrity`を評価へ送ります。正規版との申告一致であり、独立監査・認証・実行証明ではありません。公開は `npm run release -- --version <次の版>`、事前検証は `release:prepare` です。[運用手順](docs/implementation/SKILL-INTEGRITY-OPERATIONS.md)。本変更の本番反映とWork実機受入は未実施です。

**過去の構成検討（2026-10-18、現在は実装済み）**：公開版はローカルMCPを必須とせず、Work／CodexのSkill・標準ツール・補助スクリプトとリモートMCPに分けます。ローカルの測定記録を独立検証済みの証拠として扱いません。[構成変更と検証の境界](docs/implementation/LOCAL-EXECUTION-BOUNDARY.md)。以下は現在の0.3.0の導入・実装情報です。

**0.3.0：対象パスの固定を廃止しました。** 現在のプロジェクトを`discover_workspace`で構成走査し、ユーザーの回答後に`confirm_workspace`で確定して解析します。MCP rootsを優先し、非対応時は会話の現在のプロジェクト情報を候補として明示します。対象変更や再起動後は再確認します。[最新の導入・利用手順](docs/LOCAL-PLUGIN.md)を参照してください。ツールは8個です。

ローカル導入と品質確認は **[プラグイン導入手順](docs/LOCAL-PLUGIN.md)** を参照してください。`npm run build` → `npm run plugin:pack` でSkill・stdio MCP・実行時依存を含むローカルマーケットプレイスを生成します。対象は設計・実装・テスト（企画・運用を除く）。工数係数・時給はTEST値、為替は表示時にFRBから直接取得します。

> **製品方針の更新（2026-10-11）**：[製品構成とデータの扱い](docs/implementation/PRODUCT-ARCHITECTURE.md)を参照してください。測定はCodexのローカルプラグイン、初回の発行・公開は会話で確定、継続管理はWebで行う方針です。本READMEのM1実装は、その全体を実現済みという意味ではありません。

COSMIC機能規模測定規格（ISO/IEC 19761 / COSMIC v5.0）に基づき、AIが開発したWeb/APIアプリのソースコードから機能規模（CFP: COSMIC Function Points）を決定論的に計数・評価し、参考工数を算出するMCP（Model Context Protocol）サーバーです。

## 現在のローカル実装

M1の4ツールに評価の永続化・再表示・HTML出力を追加し、6つのツールを提供します。認証・証明書・公開・Web管理はこの版に含みません。

| ツール名 | 役割 |
|---|---|
| `get_assessor_contract` | AIへAssessment用JSON Schema、Assessor指示（SKILL.md）、測定規則、TESTプロファイル、読取上限を返却 |
| `prepare_repository` | 対象リポジトリのパス検証、除外判定、不変スナップショットキャッシュ作成、UTF-8 line_count・SHA-256計算、安定manifest生成 |
| `read_repository_file` | 固定スナップショットから最大400行/64KiBのチャンクを行番号付きで読取。読取カバレッジ台帳を記録 |
| `evaluate_assessment` | 提出されたAssessmentを厳格検証（重複キー検査・JSON Schema・Semantic検証）、カバレッジ自動再構築、COSMICデータ移動計数（CFP算出）、完全性状態判定、工数・参考額試算、Report返却 |
| `get_evaluation` | 保存済み評価をIDから取得し、FRB公表為替を再確認して表示額を再計算 |
| `render_report` | 機能別計数・根拠・TEST試算・表示時換算を含むローカルHTMLを生成 |

---

## インストールとビルド

```bash
# 依存関係のインストール
npm install

# TypeScriptビルド
npm run build

# テスト実行
npm test
```

---

## Cloudflare Workersへの公開

現在のCloudflare配信対象は、`public/` にあるプロジェクト案内ページです。
ローカルMCPは引き続き利用者の端末で起動します。証明書発行API・D1保存・公開台帳・Web検証・リモートMCPは、このデプロイには含まれません。

`wrangler.jsonc` で静的アセットのディレクトリを明示しています。`dist/index.js` はNode.jsのstdioエントリーポイントであり、HTTP Workerの `main` に指定しないでください。`dist/` やリポジトリ全体を静的配信対象にする必要もありません。

Cloudflare Workers Buildsの設定:

| 設定 | 値 |
|---|---|
| ルートディレクトリ | リポジトリのルート |
| ビルドコマンド | `npm run build` |
| デプロイコマンド | `npm run deploy`（既存の `npx wrangler deploy` でも可） |
| Worker名 | `open-estimate`（ダッシュボード側と `wrangler.jsonc` を一致させる） |

WranglerはdevDependencyとして固定し、`package-lock.json` と一緒に管理します。Cloudflareの依存関係インストールでdevDependenciesを省略しないでください。

```bash
npm ci
npm run build
npm run deploy:check  # 認証や公開を行わず設定を検証
npm run dev:web       # ローカルで案内ページを確認
# Cloudflareの認証・Worker名を確認してから公開
npm run deploy
```

`Could not detect a directory containing static files` が出る場合は、ビルド対象コミットに `wrangler.jsonc` と `public/` が含まれていること、およびルートディレクトリを確認してください。`tsc` はローカルMCP用JavaScriptを生成する処理で、公開HTMLを生成する処理ではありません。

設定形式: [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)、[Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)。

---

## stdio MCPクライアントでの直接接続設定

ChatGPT/Codexのプラグイン導入は上記の導入手順を使います。以下は汎用stdio MCPクライアントで直接起動する場合の設定例です。

### stdio設定例 (`mcpServers`)

```json
{
  "mcpServers": {
    "open-estimate": {
      "command": "node",
      "args": ["c:/git/open-estimate/dist/index.js"],
      "env": {
        "OES_WORKSPACE_ROOT": "c:/git/open-estimate"
      }
    }
  }
}
```

※ `OES_WORKSPACE_ROOT` には、分析対象リポジトリが配置されたルートディレクトリを指定してください。未指定の場合は起動時のカレントディレクトリが使用されます。

---

## AI Assessor の実行ワークフロー

1. **契約・ルールの取得**:
   - AIが `get_assessor_contract` ツールを引数 `{}` で呼び出します。
   - スキーマ定義や `SKILL.md` の測定規則（COSMIC Entry, Exit, Read, Write の定義や制約）を受け取ります。
2. **リポジトリの準備**:
   - `prepare_repository` を呼び出します（例: `{ "relative_path": "" }`）。
   - 不変スナップショットが作成され、`snapshot_id` とファイル一覧（`manifest`）が返ります。
3. **コードの読取と機能分析**:
   - `read_repository_file` を用いて、必要なソースコードを行番号付きで読み取ります。
   - AIが機能プロセス、関心対象（Objects of Interest）、データグループ、永続ストア、機能ユーザー、データ移動を識別します。
4. **評価と計数**:
   - 識別した機能モデルを JSON Schema に沿った `Assessment` オブジェクトとして `evaluate_assessment` へ送信します。
   - 決定論的な検証器により、CFP（機能規模）、完全性状態（COMPLETE/PARTIAL等）、参考工数（人時）および参考労務額（USD/JPY）が記載された `Report` が即座に返されます。

---

## 仕様と契約

- 表示・対象作業の更新（2026-10-14）: [`docs/implementation/DISPLAY-VALUATION.md`](docs/implementation/DISPLAY-VALUATION.md) — FRB直接取得、表示時換算、設計・実装・テスト（企画・運用を除外）。ローカル経路と共通計算を実装済み。Web接続は未実装。
- 次期実装指示: [`docs/implementation/MCP-CHATGPT-PLUGIN.md`](docs/implementation/MCP-CHATGPT-PLUGIN.md) — MCP・ChatGPTプラグイン・Web見積書の契約と実装順（設計文書、未実装の変更を含む）
- 計算・検証アルゴリズム: [`docs/implementation/ALGORITHMS.md`](docs/implementation/ALGORITHMS.md) — CFP、分位点、工数・通貨換算、丸め、状態、hash
- 次期受入試験: [`docs/implementation/ACCEPTANCE.md`](docs/implementation/ACCEPTANCE.md) — 自動試験・実ChatGPT会話・Web・公開/撤回の完了条件
- 仕様書正本: [`docs/milestones/PH1-SPEC.md`](docs/milestones/PH1-SPEC.md) (OES-PH1-0.1.0-draft.1)
- スキーマ正本: [`contracts/oes-ph1.schema.json`](contracts/oes-ph1.schema.json)
- 実行指示正本: [`skills/open-estimate-assessor/SKILL.md`](skills/open-estimate-assessor/SKILL.md)
- 実装ログ: [`docs/IMPLEMENTATION-LOG.md`](docs/IMPLEMENTATION-LOG.md)
