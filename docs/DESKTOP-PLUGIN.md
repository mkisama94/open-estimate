# Open Estimate 0.4.0 デスクトップ試用版

ローカルMCPへの依存を外し、ホスト標準ツール、短時間で終了するNode.js補助CLI、HTTPリモートMCPに分離した版です。認証・サーバー保存・証明書発行・公開は含みません。

## ビルドと検証

Node.js 24以上で以下を実行します。

```powershell
npm ci
npm run build
npm test
npm run deploy:mcp:check
npm run plugin:pack
npm run plugin:smoke
```

新配布先は `release/desktop-marketplace`。旧 `release/local-marketplace` と旧ZIPは置き換えません。プラグインはNode.jsをPATHから起動し、作成者PCの実行ファイルパス・評価対象を設定に埋め込みません。

MCP接続先設定は `https://open-estimate.ai-orchestration.jp/mcp`。これは配布設定であり、公開済み・接続確認済みという意味ではありません。Workerのデプロイと当該ドメインへの経路設定は別作業です。開発時は `npm run dev:mcp` でHTTP MCPを起動できます。Webサイト用の既存wrangler.jsoncとは別のwrangler.mcp.jsoncを使います。

## 処理の流れ

補助スクリプトは `node <Skill配置先>/scripts/oes.mjs <command>`。JSONをstdinへ渡し、stdoutにJSONを1件返します。リポジトリ内での開発用起動は `node dist/local/cli.js <command>`。

| コマンド | 入力・動作 |
| --- | --- |
| contract | `{}`。Assessment Schema・Skill情報・読取上限を返す |
| scan | root絶対パス。本文を読まず構成・session_idを返す |
| confirm | root・session_id・user_confirmed。会話で対象の同意を得た後に実行 |
| prepare | root・session_id。測定コピー・manifest・Assessment初期値を作る |
| read | root・session_id・snapshot_id・file_id、任意のstart_line/max_lines。行番号付き読取と台帳更新 |
| export | root・session_id・snapshot_id・assessment（JSON文字列）。根拠と読取台帳を検査し、送信用modelをプレビュー。ネット送信しない |
| purge | session_id。当該sessionのコピーと台帳を削除 |

送信同意後にホストがリモートMCPのevaluate_modelへmodelとdisplay_currencyを渡します。読取対象の同意、送信の同意、将来の保存の同意は別です。

## 送信契約 v1

`contracts/remote-model.schema.json` が許可リストです。元のAssessmentはローカルに保持し、サーバーへは送信しません。送るのは、連番のユーザー・ストア・データグループ・関心対象・意味バリアント、プロセスの状態、トリガー、E/X/R/W、完全性・適用困難の申告、表示通貨です。名前、説明、パス、根拠本文、原ID、ソースhashを含みません。任意文字列の説明欄はありません。

サーバーは未知フィールド・値域・件数・参照・peer/store・トリガー・重複を検査し、サーバー同梱のTESTプロファイルからCFP・工数・USD額・表示時FRB換算を算出します。HTTP本文は1MiB、全movementは1万件まで。計算済みCFP・金額・任意プロファイルは受け付けません。

この検査はモデルの意味の正しさやソースの存在を証明しません。形式上整合する虚偽申告は見抜けません。応答にはCLIENT_REPORTED、NOT_INDEPENDENTLY_VERIFIED、未署名・未保存・未公開を含みます。自由記述を除外しても機能構成の情報は送られます。

入力・応答の独自ログ・DB保存は行いません。Workerのobservabilityは無効。公開時のエッジログ・アクセス制限・レート制限等は配信環境で確認する必要があります。本版に所有者認証はありません。保存操作は提供しません。

## ローカル保持

既定はOS一時領域のopen-estimate-helper。OES_HELPER_STATEで変更できます。コピーと読取台帳を24時間有効とし、期限後の処理は拒否します。自動削除は行わずpurgeで削除します。クラッシュでlockが残った場合は実行中プロセスがないことを確認し、当該sessionのlockを削除します。

## 検証の境界

自動テストはCollector再利用、別プロセスでの確認・コピー・行読取・履歴復元・根拠検査、改変検出、送信投影、HTTP MCP、FRB fixture、移設した配布物の起動を確認します。Work/Codexへ実際にインストールした会話操作、クリーンOS、公開ドメインのリモート接続、審査通過は別の受入項目です。旧ローカル評価保存・HTML表示のコードは比較用に残しますが、新Skillの実行フローは使用しません。
