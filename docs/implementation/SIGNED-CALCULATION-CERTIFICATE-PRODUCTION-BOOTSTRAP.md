# 本番基盤の接続試験

実施日：2026-10-20 JST  
実測時刻：2026-10-20 12:30:16 JST（2026-10-20T03:30:16.457Z）  
利用者の指示：「本番環境を使ってテストしてみましょうか。私以外まだ誰も使っていない」

## 結果と範囲

**既存本番Workerと新規専用D1の接続試験はPASS。ログイン・承認・証明書発行・一般公開の受入は未実施。**

試験対象は本番URL `https://open-estimate.ai-orchestration.jp`。発行・公開flagをfalseに保ったまま、read-onlyの`GET /api/v1/certificate-readiness`を追加して本番Workerへ反映した。これは証明書機能の本公開やL4完了を意味しない。

Auth0 tenantの有無・domainは利用者へ確認中。本番の認証/本人承認adapter、ログインcallback、browser sessionは未接続。合成fixtureのテスト鍵を運用secretへ登録していない。

## 変更したリソース

| 項目 | 実測・設定 |
|---|---|
| 既存Worker | `open-estimate` |
| 既存custom domain | `open-estimate.ai-orchestration.jp`。Cloudflare APIで対象serviceとの対応を読取確認してから明示設定 |
| 反映前version | `98eff564-98f6-46a9-a072-9193962782fc` |
| 反映後version | `2d93f5ea-1843-4918-8ca5-88380d325d57` |
| 新規D1 | `open-estimate-certificates`、APAC、binding=`CERTIFICATES_DB` |
| D1 ID | `bdb25739-fcee-4fa8-8dd2-9453a75bbaca` |
| migration | `0001_certificates.sql`、`0002_web_approval_grants.sql`をremoteへ適用成功 |
| 発行/公開flag | 両方false |
| 本番のLP assets | Wrangler出力は更新なし。反映前後とローカルindexのSHA-256一致 |
| MCP | 既存の別Worker・`/mcp*`ルートを維持。MCP Worker自体をデプロイしていない |

`wrangler.jsonc`にaccount、custom domain、D1 bindingを明示した。readinessでは主DBセッションを使って必要な11テーブルの存在だけを確認し、owner/内容/ID/鍵/例外詳細を配信しない。

## 本番URLでの7項目

| 試験 | 期待・実測 |
|---|---|
| LP | 200、SHA-256=`8ec252a68f7265e3288dd95575e89e63d05f6c9b8161b8442a16467e7ad9a01c`、反映前と一致 |
| readiness | 200、database=READY、authentication=NOT_CONNECTED、issuance=DISABLED、publication=DISABLED、no-store |
| 空のPOST `/api/v1/publications` | 403 AUTH_CONSENT_NOT_READY、no-store |
| 空のPOST `/api/v1/certificate-previews` | 403 AUTH_CONSENT_NOT_READY、no-store |
| 合成の未知share IDの詳細 | 403、過去の結果や合成証明書を配信しない |
| 未設定の鍵カタログ | 403、運用鍵を偽装して配信しない |
| 既存MCP initialize | 200、JSON-RPCの初期接続応答あり。モデルの評価やFX取得を実行していない |

機械可読の実測結果：[production-checks/certificate-bootstrap-2026-10-20T03-30-16-457Z.json](production-checks/certificate-bootstrap-2026-10-20T03-30-16-457Z.json)。

再確認コマンド：`node scripts/check-certificate-production.mjs`。固定した本番URLに対する接続段階専用の試験であり、ログイン接続後に成功条件を変更せず流用しない。入力は空の拒否試験とMCP initializeだけ。私有モデル・nonce・承認情報は送らない。

本番D1への件数SELECTでもcertificates/publications/signing_keys/web_approval_grantsはすべて0件、rows_written=0、served_by_primary=trueを確認。証明書発行、署名鍵登録、ユーザーデータ公開はしていない。

## 検証コマンド

- `npm run typecheck`
- `npx vitest run tests/unit/certificate-readiness.test.ts tests/integration/certificate-service.test.ts`：22件PASS
- `npm run build`：PASS
- `npm run deploy:check`：PASS、D1 binding確認
- `npx wrangler d1 migrations apply open-estimate-certificates --remote`：2件適用成功
- `npm run deploy`：対象Worker/custom domainへ反映成功
- `node scripts/check-certificate-production.mjs`：7項目PASS
- `git diff --check`：PASS
- 最終`npm test`：33ファイル341件すべてPASS（2026-10-20 12:30:36 JST開始）

## 次に必要な接続

Auth0テナントのdomainとweb/native client/APIの設定を確定し、PKCE callback・browser session・CSRFを接続する。その後、本人アカウントと合成モデルで送信許可→preview→発行/公開承認→発行→第三者検証→所有者停止を実測する。運用鍵は新規生成し、本番secretへ保存する。既存のTEST鍵は流用しない。

実D1での原子的な発行・競合・公開停止・復旧、engine配布物/登録カタログ、CLI回復、運営上限等は引き続き未受入。D1のテーブル作成・読取成功を、それらの合格と扱わない。

## 戻す必要がある場合

今回のWeb Workerを反映前versionへrollbackできる識別子は上表に記録した。必要時は`npx wrangler rollback 98eff564-98f6-46a9-a072-9193962782fc --message "Revert certificate bootstrap"`を対象`open-estimate`に対して実行し、LP/MCPを再確認する。本作業ではrollbackしていない。新D1は既存の他DBから独立しており、rollbackに合わせたDB削除は自動で行わない。
