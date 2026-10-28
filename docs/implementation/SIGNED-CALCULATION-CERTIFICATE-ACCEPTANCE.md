> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# 計算証明書 実装・受入記録

確認日時：2026-10-20 08:45 JST（2026-10-19T23:45:08Z）  
対象：commit `2192ea3cd8de1140f4181016855efd4c39d1b7d4` に対する未コミット作業差分  
package/plugin版：0.8.1の開発作業ツリー。新しい配布版・ZIPではない。  
状態：**L1の部分実装。L1全体、L2、L3、L4は未完了。デプロイなし。**

**2026-10-20 12:31 JST更新**：上記は初回ローカル受入時点の状態。その後、利用者の本番試験指示に基づき、発行/公開を無効に保った本番Workerと専用D1への接続を実施した。[本番基盤の接続試験](SIGNED-CALCULATION-CERTIFICATE-PRODUCTION-BOOTSTRAP.md)の7項目がPASS。最終の全体試験も33ファイル341件PASS。認証・本人承認・発行/公開の実受入は未実施で、L1全体/L2全体/L3/L4は未完了。

## 2026-10-20 08:56 JST 認証・承認の追加受入

利用者から選定を委ねられたため、[Auth0 + Webで1回の公開承認](SIGNED-CALCULATION-CERTIFICATE-AUTH-DECISION.md)を採用方針にした。G1/G2は方式選定済み・実接続/受入待ち。以下の初回記録にある未選定の記述は、この追記で更新する。

- OIDC/JWKSの署名・issuer/audience/期限/client/scope検証を追加。issuer/subからownerを識別し、メール一致で統合しない。`jose 6.2.12`を直接依存として固定。
- 公開前のWeb承認フォーム、発行/一般公開の両チェック、Origin/session/CSRF/draft照合、保存grantの検証、grant用migrationを追加。
- 認証22件、保存grant7件、Webフォーム/SQLite10件の追加39件を確認。
- **最終の単一実行`npm test`で32ファイル337件すべてPASS**。`npm run typecheck`、`npm run build`、`npm run deploy:check`、`git diff --check`もPASS。
- 実Auth0 tenant・Google OAuth・メール送信・ログインcallback・browser session/CSRF adapter・CLI関連付けは未接続。Webフォームのsessionは合成テストadapterを使用。
- default Workerは引き続き証明書経路を拒否し、発行/公開flagはfalse。本番接続・メール送信・公開・新ZIP生成なし。旧ZIPのchecksumを再確認し不変。

この追記はA01–A05のローカル証拠を追加するが、実ホスト本人承認やL1全体/L2以降の完了を示さない。以下の298件という件数は08:45時点の初回記録である。

## 実装した動作

- `src/core/numeric-model.ts`へ厳密モデル検査・決定的再計算を抽出。既存MCPは同じ処理を使い、既存report_hash/evaluation_context_hashの式を維持。署名用再計算にはFX・ネットワークを含めない。
- FrozenInput、ApprovedDraft、SignedObject、Envelope、状態、公開換算、APIのstrict Schemaを追加。未知キー、重複キー（Unicode escapeによる別表記も含む）、不正Unicode/UTF-8、unsafe integer、非有限数、深さ、1 MiBとmovement合計上限を検査。
- 固定TEST基準の全内容照合、入力commitment、承認draft hash、JCS bytes、標準Web Crypto Ed25519署名、信頼済み鍵によるオフライン検証、入力再現を実装。失効して新規発行できなくなった版の再現と、新規発行の登録検査は分離。
- AuthAdapter/ApprovalAdapterのinterface、preview/発行/冪等回復/停止service、D1 batch向けSQL repositoryとmigrationを追加。条件不成立をCHECK違反にして全体をrollbackする。previewの内容は発行時に削除し、公開停止では公開Envelopeを削除する。モデル・nonceはDBに保存しない。
- API factory、署名を確認した固定結果のHTML/JSON、最小状態HTML/API、公開鍵カタログ、署名対象と分離した表示FXを追加。no-store、Origin検査、所有者認可を適用。FX取得後にも現在状態を再検査。
- CLI `prepare-certificate`で保存済みrunのmodel.jsonを使い、nonce・冪等キーをfsync付きで先に私有保存。正規化済みAssessmentからID順序を再生成しない。元runを変更しない。
- CLI `verify-certificate`で明示的に信頼した鍵ファイルを使い、オフライン署名検証と保存submissionからの入力再現を実行。
- デプロイ対象のdefault Workerは本番adapter未接続のため証明書経路を403で拒否。`ISSUANCE_ENABLED=false`、`PUBLICATION_READ_ENABLED=false`を維持。テストadapterをdefault Workerへ組み込んでいない。

## 実行結果

| コマンド | 結果・限界 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS。初回のmanifest書込みEPERMは権限付き再実行で解消。旧ZIPの再生成なし |
| `npm test` | 制限環境では289/294通過、5件失敗。失敗はhelper/Workerビルドのファイルアクセス制限 |
| `npx vitest run tests/integration/desktop-migration.test.ts tests/integration/recorded-helper.test.ts tests/integration/measurement-context.test.ts tests/integration/rules-release.test.ts tests/unit/certificate.test.ts tests/integration/certificate-service.test.ts tests/integration/certificate-cli.test.ts` | 必要な権限で7ファイル83件PASS。先の5件を含む。rules-onlyの既存Worker実行試験もPASS |
| `npx vitest run tests/unit/certificate.test.ts tests/integration/certificate-service.test.ts` | 最終追加ケース込み49件PASS |
| `npx vitest run tests/integration/certificate-cli.test.ts` | 最終CLIの準備・署名検証・入力再現1件PASS |
| `npx vitest run tests/unit/certificate.test.ts tests/unit/display-quote.test.ts` | 最終の公開換算入力型の分離と保存fixtureの検証を含む36件PASS |
| `npm run deploy:check` | PASS。Wrangler 4.140.0、最終bundle 439.01 KiB、gzip 92.23 KiB。dry-runのみ |
| `git diff --check` | PASS |

異なる実行を突き合わせた最終の対象は29ファイル298件。証明書の追加分は50件（unit 31、SQLite/service 18、実CLI 1）。最終全298件を同じ1回で通した記録ではない。

暗号試験は[RFC 8032 §7.1](https://www.rfc-editor.org/rfc/rfc8032.html#section-7.1)の固定TESTベクトルと、Node crypto/標準Web Crypto間で検証した。実Workersランタイムと実ブラウザの相互検証は未実施。固定TEST鍵はunit test内だけにあり、運用鍵ではない。

## 受入IDと証拠の範囲

| 受入ID | 現在の確認範囲 |
|---|---|
| C01–C09、C11–C13 | 合成fixtureで計算・基準差替え・PARTIAL/v2/null・品質矛盾・厳密JSON・既知署名・改変・nonce・任意鍵不信頼を確認。C09は整形・キー順を変えた再検証も含む |
| C10 | PARTIAL：Node cryptoとNode Web Cryptoは一致。実Worker/ブラウザは未実施 |
| A01/A02/A04/A05 | PARTIAL：他owner、偽receipt、confirmed追加、同じ受付での内容変更、Cookie OriginをローカルHTTPで拒否。実認証・実receipt binding全体の受入ではない |
| A03 | 未完了：実adapterによる主体/対象/期限/一度限りの承認検証が必要 |
| T01/T02 | Node SQLite adapterで同じキーの並行呼出し、別内容/別キーを確認。実D1の並行要求は未実施 |
| T03/T04/T05 | SQLiteの実SQLでbatchの9保存段階へ障害注入。preview/key/policy/generation guard不成立時に全rollback。実D1/Workerと運用secretは未実施 |
| T06 | serviceの応答再取得と期限後の同一Envelope回復を確認。ローカル送信・保存失敗後の自動回復は未実装 |
| P01/P03/P05 | serviceで停止後の内容削除/再試行、鍵retired/revoked、世代差を確認。実ブラウザ/全経路の競合受入は未実施 |
| P06 | 公開HTML escape、DBへの私有canary/nonce/model/receipt非混入を確認。ZIP/assets/APMを含む全体検索は未実施 |
| F01/F02 | 固定TEST basisで150/160のFX変更、取得失敗、私有hash非投影、Envelope不変を確認 |
| O02 | 保存runの不変とCLI再読込、既存MCP/測定/リリースの回帰試験、旧ZIP checksum不変を確認 |
| その他、H01–H03 | 未実施。実ホスト・ブラウザ・運営受入が必要 |

## 未完了の実装と公開前提

1. P0：承認済みengineの実build artifactと公開manifest、skill/rules/basis/engineの発行用組合せカタログ。現在のservice試験は合成engine識別子であり承認済み配布物ではない。
2. P2：実D1 binding/最新整合性adapterでの競合・rollback・障害試験、運営側失効API、上限設定・費用通知・読取rate limit、削除scheduleの配備。SQLite試験をD1受入と扱わない。
3. P3：CLIの送信・発行・受付回復と認証token保管adapter、発行後のローカル保存失敗回復、完全な再現用engine同梱。`preview-certificate`/`publish-certificate`/`resume-certificate`は現在`AUTH_CONSENT_NOT_READY`で停止する。
4. P4：ブラウザ内の独立検証、所有者の管理/停止UI、公開品質理由コードの日本語説明、FX UI、モバイル/印刷/支援技術の実ブラウザ検査。現在のHTMLはサーバー検証結果を表示し、ブラウザ内検証済みとは表示しない。
5. P5/G1/G2：Google/メール認証基盤、プラグイン関連付け、実ユーザー本人承認の経路。存在しないホスト承認APIや自然言語からのreceipt生成を追加していない。
6. P6/G3–G6：保存/退会/バックアップ方針、運営担当、鍵・復旧、予算・窓口、実登録/実ホスト、次版ZIPとリリースの受入。

したがってL1全体も完了宣言しない。L2/L3/L4、実サービスへのデータ送信、公開、運用鍵生成・登録、課金契約は実施していない。

## 旧ZIPの保全

開始時と終了時に同じSHA-256を確認。既存0.8.0/0.8.1 ZIPを変更していない。

| ファイル | SHA-256 |
|---|---|
| `release/open-estimate-desktop-0.8.0-local-validation.zip` | `a79ebf50f3367a1be02568c968037416259e0b4425546c45d3ef17a1371de770` |
| `release/open-estimate-desktop-0.8.1-local-validation.zip` | `7a32464102c9276c9ac81dbb23c2ae1a9ae51d1df0f7a163dd1738e83b951c07` |

開始時点の公開候補生成関連の差分を保持。LPのキャッチコピー・保存run・過去の測定結果を変更していない。機械可読記録は同名の`.json`を参照。
