> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# Auth0ログイン接続の作業記録

更新日：2026-10-20 JST

最新状態：**本人確認だけのログイン試験を本番配備済み。実ユーザーのログイン・logoutは未受入。証明書の発行・公開は無効。** 配備version=`92803c12-c95b-41fe-ac62-d052e8767ae1`。

## 確認済みの外部設定

- Auth0 tenant：`dev-gn7tvk0anp6d5frl`（US、画面の環境表示はDEVELOPMENT）。
- カスタムドメイン：`auth.ai-orchestration.jp`。利用者の検証操作後、管理画面で`ready`を読取確認した。
- 利用者が`Open Estimate Web`を作成した。管理画面でRegular Web Application、Client ID=`csqN2pYPrG6jnMz00qm44pFi1CjAvv2v`を読取確認した。
- Client Secretは取得・表示・リポジトリ保存していない。

## 今回のローカル実装

`src/web/browser-login.ts`に、ログイン開始、PKCE S256、state/nonce、コード交換、固定issuer/JWKSのRS256 ID token検証、ブラウザーsession、CSRF付きlogoutを実装した。`src/web/worker.ts`の`WEB_LOGIN_ENABLED`で経路を接続する。本人だけの本番試験のため、今回の配備設定はtrue。falseへ戻すと試験経路を無効にできる。

今回のsessionは**本人確認だけの試験用**。`scopes: []`であり、`certificates:manage`を持たない。既存のBearer access token adapterとは別経路で、承認フォームの権限検査にも通らない。証明書発行・公開APIへのsession認証接続や権限付与は行っていない。

stateはD1でhashだけを保存し、callbackで`DELETE ... RETURNING`によって一度だけ消費する。PKCE verifierとnonceは10分有効の暗号化cookieに置き、D1へ保存しない。cookieはhost限定、Secure、HttpOnly、SameSite=Lax、Path=/。ID/access token・メール・生session IDをDBやログへ保存しない。session寿命は30分とID token期限の短い方。再ログイン成功時に旧sessionを削除し、logoutでDBのsessionを削除してからAuth0のlogoutへ移動する。refresh tokenは要求しない。

`migrations/0003_browser_sessions.sql`は2026-10-20に**本番D1へ適用済み**（5 commands、成功）。失効状態の読取とstate消費にはD1 primary sessionを使う。テーブル作成は成功したが、実D1上のログインcallback・競合の受入は未実施。

## Auth0へ登録するURL

以下3項目は利用者がSaveしたと報告した後、管理画面で各値と未保存表示がないことを読取確認した。

| 項目 | 登録値 |
|---|---|
| Application Login URI | `https://open-estimate.ai-orchestration.jp/manage/auth/login` |
| Allowed Callback URLs | `https://open-estimate.ai-orchestration.jp/manage/auth/callback` |
| Allowed Logout URLs | `https://open-estimate.ai-orchestration.jp/manage` |

このサーバー側redirect方式では、Allowed Web OriginsやCORSを追加する必要はない。wildcardを登録しない。Auth0画面のDomain欄が標準tenant domainのままでも、アプリ側のissuerと各認証endpointにはカスタムドメインを一貫して使う。

## 本番接続までに残る作業

1. 上記URLは保存済み。管理画面で登録値を確認した。
2. 利用者がClient SecretをCloudflare Worker secret `AUTH0_WEB_CLIENT_SECRET`へ直接保存済み。`BROWSER_SESSION_SECRET`も32 byte乱数を生成し、値を表示・ファイル保存せず子プロセスのstdin経由で本番secretへ登録済み。secret listで両方の名前とsecret_text型だけを確認した。Auth0 Client Secretの正しさは実ログインでのtoken交換成功まで未検証。
3. migrationは適用済み。Workers Rate Limiting binding `BROWSER_LOGIN_LIMITER`（namespace `2026102001`、60 requests/60s）と15分間隔の期限切れ情報削除を配備済み。試験経路全体の固定キーで制限し、IP・ユーザー情報をrate keyにしない。これはCloudflare拠点単位の概算制限で、世界全体の厳密な費用上限ではない。実Cron発火・削除の受入はまだ行っていない。
4. 本番ログイン画面にはGoogleとメール/パスワードが表示された。予定するメールOTPは未設定。Google connectionの本番用資格情報またはメールOTP providerを設定する。Auth0既定connectionや開発用キーを本番受入済みと扱わない。
5. `WEB_LOGIN_ENABLED=true`で配備済み。本人のブラウザーでログイン・logout・再ログインを実測する。2026-10-20 20:42 JST、未認証の`/manage`表示とAuth0 Universal Loginへのブラウザー遷移まで確認済み。パスワード・Googleアカウント操作は利用者へ引き継ぐ。
6. 証明書用API audience/scope、CLIとの所有者接続、送信許可、発行/公開のWeb承認、運用鍵・カタログを別途接続する。

`ISSUANCE_ENABLED=false`と`PUBLICATION_READ_ENABLED=false`を維持する。カスタムドメインのready、アプリ作成、ローカル試験の合格は、実ログインや証明書発行の本番合格を意味しない。

## 検証

- `npm run typecheck`：PASS。
- `npm run build`：PASS。生成後の`npm test`は34ファイル357件すべてPASS。`npm run deploy:check`もPASS。いずれもローカル検証であり、今回の変更は未配備。
- 認証接続の対象試験：3ファイル42件PASS（新規ブラウザー接続16件を含む）。
- 新規試験はPKCE対応、cookie属性、token非保存、管理権限なし、誤issuer/audience/nonce/azp、期限切れ、headerによる鍵指定、callback再利用、別ブラウザー、CSRF、logout後のcookie再利用、未設定時の拒否を確認する。
- fixtureは合成ユーザー・合成鍵。外部の実ユーザーでの認証は行っていない。
- 本番secret追加後、既存LP・D1 readiness・未認証発行/preview拒否・公開詳細/鍵非配信・既存MCP initializeの7項目を再確認してPASS。発行・公開・ログインは引き続き無効。実測は[2026-10-20 20:36 JSTの記録](production-checks/certificate-bootstrap-2026-10-20T11-36-34-968Z.json)。ログイン機能のコードは未配備。
- ログイン配備直前：typecheck、認証/cleanup/rate limit/readinessの22件、Worker dry-runがPASS。新しいcleanupは期限切れだけを削除し、有効session/transactionを残すことを検査。
- ログイン配備後：[認証前の本番5項目](production-checks/browser-login-2026-10-20T11-42-25-858Z.json)と[既存機能・発行公開無効の7項目](production-checks/certificate-bootstrap-2026-10-20T11-42-28-078Z.json)がPASS。実ユーザーのログイン成功、正しいClient Secret、logout、rate limit上限到達、実Cron発火はこの試験の範囲外。
- readinessの`authentication: NOT_CONNECTED`は証明書APIの認証・本人承認の未接続を表す。本段階の本人確認だけの試験とは区別し、発行可能という表示へ変更しない。

## 公式資料

- [Auth0 application settings](https://auth0.com/docs/get-started/applications/application-settings)
- [Auth0 PKCE flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce)
- [Cloudflare D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
- [Cloudflare Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
