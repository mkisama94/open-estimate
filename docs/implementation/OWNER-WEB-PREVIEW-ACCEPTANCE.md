> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# 所有者限定Webプレビュー 実装・受入記録

実施日：2026-10-21 JST  
対象：OWNER-WEB-PREVIEW-IMPLEMENTATION.md  
実装開始時のHEAD：`e75f09df80c8a72db778c4e8893218429d92455e`（このHEAD上の未コミット変更）  
判定：ローカル実装と隔離環境での確認は完了。本番受入は未実施。

## 実装した操作

`prepare-certificate`で検査済みのPREPAREDを保存し、`preview-certificate`が今回の入力に限定した関連付けを作る。利用者が公式Webでログインし、CLIに表示された8桁のコードを入力して送信に同意すると、CLIが同じ入力を送信する。サーバーは既存の計算・基準・登録検査を再利用して再計算し、所有者だけが15分間閲覧できるHTMLとJSONを作る。

再開コマンドは`resume-preview`。入力は両コマンドとも`{submission_id}`だけ。既存の`publish-certificate`と`resume-certificate`は未接続エラーを維持する。これはOAuth Device FlowでもCLIの恒久ログインでもない。

```powershell
'{"submission_id":"PREPAREDのUUID"}' | node dist/local/cli.js preview-certificate
'{"submission_id":"同じPREPAREDのUUID"}' | node dist/local/cli.js resume-preview
```

現時点の配備設定はpreview無効のため、これらを本番へ接続してもプレビュー成功にはならない。ここにある操作例を実データ送信の承認として扱わない。

## 変更の所在

- `src/core/preview-transfer-contract.ts`と生成した6契約：作成、作成応答、状態、送信、エラー、所有者previewの厳密な契約。
- `migrations/0004_preview_transfers.sql`、`src/web/preview-transfer-repository.ts`：短期関連付け、専用送信許可証跡、D1の原子的guardと保存。
- `src/web/preview-transfer.ts`：秘密値・binding・期限・owner・コード検査と共通の再計算。署名器と発行鍵は依存に含めない。
- `src/web/owner-preview.ts`：送信許可フォーム、所有者限定HTML/JSON、Origin・CSRF・入力サイズ制限。
- `src/web/browser-login.ts`：暗号化transactionに検証済みtransfer IDだけを保持し、固定ルートへ復帰。既存セッションのscopesは空のまま。
- `src/local/preview-transfer.ts`、`src/local/cli.ts`：通信前のprivate状態保存、有限poll、429待機、Ctrl+C・応答喪失・保存失敗からの回復。
- `src/web/worker.ts`、`wrangler.jsonc`：専用の無効フラグ、ルーティング、拠点ごとの作成制限、既存Cronとの併設。

開始時からあった全体実装指示書の変更と、本工程の実装指示書はそのまま保持した。コミット、配布ZIP更新、スキル登録、デプロイ、remote migrationは行っていない。

## 環境と直接確認した範囲

Windows/PowerShell、Node.jsのnode:sqlite、Vitest 3.2.7、Wrangler 4.140.0。DB競合試験にはWranglerに同梱されたMiniflare 5/workerdの実ローカルD1を使用した。SQLiteの模擬adapterだけをD1の証拠とはしていない。

実ブラウザーはCodexのin-app browserを使用した。ループバックの隔離ホスト`http://127.0.0.1:52602`で合成fixtureだけを処理し、実プロジェクト・Auth0・本番Workerには送っていない。関連付け、再計算、HTMLの本体は実装したcontroller/serviceを使い、ログイン部分だけを明示的な合成ownerセッションにした。このfixtureはWorkerにimportせず、productionでtest sessionを使おうとすると拒否する。

ブラウザーでは次を直接確認した。

1. 合成本人としてログインし、コード入力・チェックボックス・送信ボタンを通常操作。
2. ブラウザーの通常form POSTがOrigin付きで200になり、CLIの実装関数がREADYへ進む。
3. 同じ所有者で結果を表示。6 CFP、部分測定、参考工数12/18/30時間、基準USD額600/900/1500、独立再実行の未確認理由、TEST注意を表示。
4. 390×844のviewportで主要結果と注意を視認。document幅390、viewport幅390で横にはみ出さない。
5. 合成ログアウト後の同じURLではAUTH_REQUIREDになり、金額・説明を表示しない。再ログイン・再読込後に同じ結果を表示。

[モバイル表示の画像](assets/owner-preview-mobile.png)と[通常フォームPOSTの記録](assets/owner-preview-browser-observations.json)を保存した。記録のコードやデータは合成用で、fixtureは確認後に停止した。

再確認用の明示起動：`npx vite-node tests/fixtures/owner-preview-browser-host.ts`。ループバック限定で、ログインfixtureを本番のAuth0受入に代用しない。このホストは通常テスト対象の`.test.ts`ではなく、必要な時にだけ起動する。

利用者による2026-10-21の実ログイン・再読込・ログアウト・再ログイン成功報告は指示書記載の事実として扱った。今回の実装者が実Auth0で再確認した証拠ではない。

## OP01〜22

PASSは下記の環境に限定する。実Auth0・本番接続を含む受入は未実施。

| ID | 結果 | 証拠・範囲 |
|---|---|---|
| OP01 | PASS（ローカル） | 既存certificate-cliおよび新preview-transfer-cli。通信前PREPARED、元submission/COMPLETEのバイト不変、状態保存失敗なら送信0件 |
| OP02 | PASS（隔離）／実Auth0未実施 | browser-loginの署名済みJWK fixtureで暗号化transactionと固定復帰先、任意returnTo拒否。URLだけでは未承認 |
| OP03 | PASS（隔離） | 実ブラウザーform POSTとcontroller試験。コード・同意・CSRF、owner一度固定 |
| OP04 | PASS | 誤コード5回LOCKED、期限、同意なし、owner未設定 |
| OP05 | PASS | URLだけでは承認しない、別ownerの上書き404 |
| OP06 | PASS | 秘密値なし・別秘密値・URLだけでの照会/送信拒否 |
| OP07 | PASS | 承認前の送信拒否、preview・入力保存なし |
| OP08 | PASS | metadata/model/nonce変更はbindingで拒否、別policyは契約で拒否 |
| OP09 | PASS | v1/v2、PARTIAL、未算出のmeasurement/qualityを保持。ブラウザーでもPARTIAL確認 |
| OP10 | PASS | 同ID係数改変、未登録skill/rulesを拒否、previewなし |
| OP11 | PASS（実ローカルD1） | 同時承認は1owner、同時送信は1preview、同じhash/期限。READYは承認期限後も元受付だけ回復 |
| OP12 | PASS（実ローカルD1含む） | DB batch第2文の実際の主キー競合と各段階の注入失敗で全rollback |
| OP13 | PASS | 作成/送信応答喪失、保存失敗、CLI中断から同じ秘密値・入力・nonceで回復 |
| OP14 | PASS | 同じキーでも秘密値を要求、回復時コード更新・旧コード拒否、期限/試行数は延長しない。乱数が旧コードと衝突した場合も再抽選 |
| OP15 | PASS | HTML/JSONの本人認可、別owner404、未認証401、no-store/noindex、escape |
| OP16 | PASS（ローカルCron） | 15分で410・本文なし、期限後45分を削除対象にして15分間隔Cronで1時間以内に削除。flag無効でも動作し、有効session・無関係のpreviewを保持 |
| OP17 | PASS（通常ブラウザー含む） | 通常form成功。missing/null/foreign Originと破損CSRFを拒否。Origin検査を緩めない |
| OP18 | PASS（隔離）／実Auth0未実施 | 合成ログイン・再読込・ログアウト・再ログインを直接操作。既存browser-login全27件も通過 |
| OP19 | PASS | preview資格情報で発行・公開・承認・別対象の操作は拒否。署名器への依存なし、signing_keys/certificates/publications/web_approval_grantsは0件 |
| OP20 | PASS（合成canary） | fixtureの生秘密値/nonce/モデル/私有識別情報がDBやCLI表示に混入しない。公開用metadataは本人用previewだけに保存。確認URLにコードなし。Auth0 tokenは既存署名fixtureで検査 |
| OP21 | PASS（実ローカルD1含む） | 全体100件をDBで競合制御、作成limiter、巨大body413、poll429/Retry-After、有限待機、flag/設定不足で閉じる |
| OP22 | PASS（隔離ホスト＋実ブラウザー）／本番未実施 | PREPARED→コード・同意→CLI処理→再計算→本人限定表示をループバックで完了。実Auth0と本番ホストを通す一連の試験は未実施 |

主な追加試験は`owner-preview.test.ts`19件、`preview-transfer-cli.test.ts`5件、`preview-transfer-d1.test.ts`1件、既存browser-loginへの復帰先試験1件。全体は37ファイル393件。

## 実行コマンドと結果

| コマンド | 結果 |
|---|---|
| `npm run build` | PASS。型出力・測定規則・整合情報・契約生成 |
| `npm run typecheck` | PASS |
| `npm test -- --maxWorkers=2` | PASS。最終コードで37ファイル393件、69.74秒 |
| `npm run deploy:check` | PASS。Worker 566.95 KiB、gzip 124.85 KiB。配備はしない |
| `git diff --check` | PASS |
| `npx vite-node tests/fixtures/owner-preview-browser-host.ts` | 隔離HTTPホスト起動、実ブラウザーで上記操作を確認 |

最初の無制限並列の全体実行は、既存のquality-cli/recorded-helper/desktop-migration各1件が30秒のタイムアウトになった。同時実行数2ではすべて通過した。検証途中、ビルドとCLI試験を同時実行した際には、ビルドによるdist削除と競合してCLI試験がENOENTになったため、ビルド完了後に全体を再実行した。製品コードの試験制限や既存のタイムアウト値は変更していない。

## 保存・通信・停止境界

サーバーのtransfer表にはcommitment、hash、HMAC、ownerと操作状態だけを置く。生秘密値・平文コード・モデル・nonce・metadata本文・Auth0 tokenを置かない。承認後のモデル/nonceは再計算中のメモリだけで処理する。certificate_previewsに保存するのは再計算したdraftと公開用metadataで、元model・元nonceは含まない。owner向けDTOはその明示投影で、予約certificate/share IDを出さない。

CLIの秘密値と応答は元PREPAREDの横にprivate別ファイルとして保存する。通信前にsecret/再試行ID/bindingをfsyncし、元submissionとCOMPLETEを変更しない。Ctrl+Cや応答喪失でも再計算入力を作り直さない。保存不完了はREADY_LOCAL_SAVE_INCOMPLETEと明示する。stdoutへ秘密値、owner、非公開hashを出さない。ブラウザーのHTML/JSONはno-store/noindexで、期限後は本文を返さない。

作成制限は拠点ごと10件/分で、世界全体の厳密制限とは扱わない。DBの未失効要求100件は原子的に検査する。所有者別preview制限は承認・保存双方で検査する。Cronが正常に15分間隔で実行される前提で、期限後45〜60分に削除する。Cron障害等の運用監視は配備後の責任範囲となる。

## 本番移行に残す作業

`OWNER_PREVIEW_ENABLED=false`、`ISSUANCE_ENABLED=false`、`PUBLICATION_READ_ENABLED=false`を設定に保持した。dry-runでもこの3値を確認した。既存/mcpの配備物・受信経路は今回変更していない。

本番への反映は別途承認された移行作業とする。その際にmigration 0004、専用の32byteコード検証secret、レビュー済みの実engine artifact hash/version/generation、既存Auth0/セッション設定、rate limiter、Cronを確認する。現在のskill/rulesレジストリは未登録なので、そのままでは再計算受付を拒否する。新スキル登録・受信側v2対応・実ホスト確認という既存の移行課題も残る。test用登録catalogやdummy署名鍵で迂回しない。

実Auth0でのログイン復帰、実ホストでの通常フォーム送信、ログアウト後の取得拒否、再ログイン、所有者限定HTML/JSON、Cron削除を、許可された合成データから確認する。プレビュー成功は署名・証明書発行・一般公開の成功とは扱わない。Webの発行・公開承認とreceipt受渡しは後続工程。
