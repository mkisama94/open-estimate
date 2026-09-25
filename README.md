# Open Estimate (OES) — Ph1 M1

COSMIC機能規模測定規格（ISO/IEC 19761 / COSMIC v5.0）に基づき、AIが開発したWeb/APIアプリのソースコードから機能規模（CFP: COSMIC Function Points）を決定論的に計数・評価し、参考工数を算出するMCP（Model Context Protocol）サーバーです。

## 概要 (M1)

M1マイルストーンでは、ChatGPTや各種AIホスト（Claude Desktop, Cursor等）と連携して最低限動作するMCPサーバーと4つのコアツールを提供します。

| ツール名 | 役割 |
|---|---|
| `get_assessor_contract` | AIへAssessment用JSON Schema、Assessor指示（SKILL.md）、測定規則、TESTプロファイル、読取上限を返却 |
| `prepare_repository` | 対象リポジトリのパス検証、除外判定、不変スナップショットキャッシュ作成、UTF-8 line_count・SHA-256計算、安定manifest生成 |
| `read_repository_file` | 固定スナップショットから最大400行/64KiBのチャンクを行番号付きで読取。読取カバレッジ台帳を記録 |
| `evaluate_assessment` | 提出されたAssessmentを厳格検証（重複キー検査・JSON Schema・Semantic検証）、カバレッジ自動再構築、COSMICデータ移動計数（CFP算出）、完全性状態判定、工数・参考額試算、Report返却 |

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

## ChatGPT / Claude Desktop / Cursor での接続設定

MCPクライアント（ChatGPT Desktop, Claude Desktop, Cursor等）の設定ファイルに以下を追加します。

### Claude Desktop / ChatGPT 設定例 (`mcpServers`)

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

- 仕様書正本: [`docs/milestones/PH1-SPEC.md`](docs/milestones/PH1-SPEC.md) (OES-PH1-0.1.0-draft.1)
- スキーマ正本: [`contracts/oes-ph1.schema.json`](contracts/oes-ph1.schema.json)
- 実行指示正本: [`skills/open-estimate-assessor/SKILL.md`](skills/open-estimate-assessor/SKILL.md)
- 実装ログ: [`docs/IMPLEMENTATION-LOG.md`](docs/IMPLEMENTATION-LOG.md)
