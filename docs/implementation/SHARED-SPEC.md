# Open Estimate — 登録なし公開・削除 共通仕様

> **改訂基準（2026-10-11）**：[製品構成とデータの扱い](PRODUCT-ARCHITECTURE.md)を優先します。継続管理をWebに設けるため、管理画面・認証の一律禁止、ローカル管理キーを唯一の管理手段とする前提は現行方針ではありません。認証・復旧・プラグインとの関連付けは再設計します。状態更新の整合性、秘密情報の保護、公開取り下げに関する原則は継続します。
> **認証方針の確定（2026-10-11）**：Google認証・メール認証によるWeb登録を採用します。保存・発行する記録の所有者は内部利用者IDで管理します。本文の登録なし契約は旧案であり、ChatGPT認証は将来構想として扱います。

仕様ID：**OES-ACCOUNTLESS-0.1.0**／作成日：2026-09-27

> **表示仕様更新（2026-10-14）**：[表示時の為替換算と見積対象作業](DISPLAY-VALUATION.md)を優先する。プラグインとWebの現地通貨額はFRB直接取得による表示時換算とし、固定評価・基準USD額・換算方針への同意と、可変DisplayQuoteを分離する。対象作業は設計・実装・テスト、企画・運用を除外。ローカル評価経路は0.2.0で実装済み。本文の公開・削除・Web連携は未実装。

この文書のMUST／禁止はOES内部の実装契約である。既存のPh1算定仕様・詳細ページ仕様を変更する範囲は、登録、認可、公開確認、管理キー、再送、削除である。算定値・公開許可リスト・署名アルゴリズムは変更しない。実装状況は確認しておらず、以下は実装要求である。

## 1. 製品上の約束

### 1.1 登録なしの意味
利用者には会員登録、ログイン、メール認証、OAuth連携、運営者への個人APIキー申請を要求しない。
新規インストールから測定・発行・公開・公開削除まで進められる。
運営用の署名鍵、DB資格情報、管理者権限は別であり、利用者へ配らない。

登録不要は「認可不要」「完全匿名」「無制限利用」ではない。
ネットワーク上のIP等は濫用対策の対象になり得る。作者の実在性、ソースの所有権、モデル実行の真正性を本人認証済みと表示しない。

### 1.2 利用者から見える流れ
1. AIへ対象コードの測定を依頼する。ここでは外部公開しない。
2. 発行・非公開保存について確認し、署名付き証明書を取得する。
3. アプリ名・概要・任意の作者表示・任意のアプリURLを自己申告する。
4. 公開される内容と削除・保管の条件をAI会話上で確認する。
5. 「この内容を公開して」と依頼するとパーマリンクが返る。
6. SNS投稿は利用者が行う。サービスが勝手に投稿しない。
7. 「この公開見積を削除して」と依頼すると、管理キーで公開を撤回する。

### 1.3 WebとAPIの区別
Web **UI** は閲覧専用。HTTP **API** は発行・公開・削除の書込みを扱う。
UIにアカウント／設定／公開申請／管理画面を追加しない。
ローカルMCPが公開プレビューと同意取得を担当する。モックの公開フォームは本番UIへ移植しない。

## 2. 用語・権限

| 名称 | 性質・操作 |
|---|---|
| `certificate_id` | 発行済み評価記録の公開識別子。知っていても公開準備はできない |
| `certificate_management_secret` | 証明書ごとの公開準備・同一発行再取得を認可する秘密。`oec_`接頭辞 |
| `preview_id` | 公開候補を識別するID。管理権限ではない |
| `share_id` | `/e/{share_id}`のID。プレビューで予約するが、公開前は404 |
| `publication_management_secret` | 一つのshareの公開確定・状態確認・削除だけを認可する秘密。`oep_`接頭辞 |
| `preview_hash` | 利用者が確認した公開候補を固定する値。認可情報ではない |
| `Idempotency-Key` | 通信再送を同一操作として扱うUUID v4。認可情報ではない |
| `CertificateBundle` | 共有可能な評価記録。管理キーを一切入れない |
| `Recovery File` | 管理キーを含む暗号化バックアップ。証明書ではなく、他人に共有しない |

ここでのsecretは**Bearer capability（所持者に権限があるランダムトークン）**であり、Ed25519署名秘密鍵ではない。
「申告者だけが削除できる」の技術的な意味は「対応する管理キーを保持する者が削除できる」。
キーを盗まれた場合まで本人限定を保証しない。

証明書キーから既存の公開ページ削除キーを再発行しない。
公開ページの削除キーから他のshareや非公開Bundleにアクセスさせない。
いずれも元証明書の失効・他人の公開の管理・署名鍵の利用を許さない。

## 3. 管理キーの生成・保存・送信

### 3.1 共通書式
- secret本体：OSのCSPRNGで生成する32バイト（256bit）。
- 表示形式：`oec_`または`oep_`＋base64url（パディングなし、43文字）。
- 入力はbase64urlを復号して32バイトであること、再エンコードが同じであることも確認する。
- `share_id`は`sh_`＋16バイトの小文字hex、`preview_id`は`pr_`＋同形式。いずれもサーバー生成。
- LLMに乱数、秘密値、ハッシュを生成させない。時刻・app名・repo hashから導出しない。
- 公開IDとsecretは独立生成する。一つからもう一つを計算できる構造にしない。

### 3.2 ローカル先行保存
**送信前に**プラグインがsecretと操作記録を永続化する。
保存に失敗したらAPIを呼ばない。
公開応答が失われても管理キーが残るため、再送・状態照会・削除ができる。
サーバーは生成済みsecretをTLS経由で受け取り、検証用digestだけを保持する。secretを応答へ返さない。
サーバーは形式を検査するが、クライアントが実際にCSPRNGを使ったことまで独立に証明しない。
安全なキー生成は公式プラグインの責任であり、改変クライアントが弱い値を選ぶ危険は残る。

### 3.3 HTTP上の扱い
- 通常の認可は`Authorization: Bearer <secret>`。
- 新規公開キーをプレビューへ結び付ける際だけ、`X-OES-Publication-Key: <oep_secret>`を併用する。
- 管理系APIは`X-OES-Protocol: accountless-0.1.0`を要求する。
- 本番HTTPS・サーバー証明書検証を必須にする。管理系HTTPリダイレクトを自動追跡しない。
- URL、query、fragment、Cookie、HTML、OGP、AIの引数・結果・チャットへsecretを出さない。
- リクエスト全体のdebug log、Authorizationログ、例外オブジェクトへのヘッダー混入を禁止。
- サーバー側の保存digest：
  `SHA256(UTF8("open-estimate/capability/v1\0" + kind + "\0" + secret))`
  `kind`は`certificate`または`publication`。digestは小文字hex64桁。
- 高エントロピーのランダムsecret用の設計であり、人が作るパスワードへ同じ保存方法を転用しない。
- 照合はconstant-time。digestだけを知る者は操作できない。
- `kind`・対象ID・状態を毎回確認する。キーの接頭辞が合うだけでは認可しない。

### 3.4 保管期間と紛失
公開ページの削除キーに、短い有効期限や定期ログイン条件を設けない。
公開中の結果は、元のprivate payloadの365日保持期限と独立して削除できる。
削除後も再送に応答する最小digestとtombstoneを保持する。
ローカルのキーを失い、復旧ファイルもない場合、名前・URL・Bundleだけによる自動再発行は行わない。
運営者の不正・権利侵害対応は別の管理者手続であり、本人復旧保証ではない。

## 4. 状態モデル

### 4.1 共有オブジェクト
```
PREVIEW --publish--> PUBLISHED --withdraw--> WITHDRAWN
   |                     |
   +--withdraw---------->+
   |
   +--expires-----------> EXPIRED --withdraw--> WITHDRAWN
```
`WITHDRAWN`から戻せない。同じ内容を再公開する場合も、新しいプレビュー・share_id・管理キーにする。
`PREVIEW→PUBLISHED`は一度のみ。公開後のmetadata、数値、表示規約の上書きは不可。
期限15分はENGINEERING_DEFAULT。期限切れの参照や同意を黙って延長しない。

### 4.2 別の状態
元証明書失効、署名鍵失効、運営による表示停止は共有の撤回とは別軸。
これらで数値配信を止める場合も、正しい削除キーによるwithdrawを妨げない。
原本が非公開DBから削除済みでも、既に公開されたshareのwithdrawは可能。

### 4.3 公開GETの判定順
1. withdrawal tombstone確認：存在すれば410。旧payloadを読まない。
2. 対象なし／PREVIEW／EXPIRED：404。アプリ名・数値を返さない。
3. 状態や鍵の確認不能：503。古い画面へfallbackしない。
4. 運営停止・元証明／鍵失効・署名不成立：公開数値を返さない。
5. 正常PUBLISHED：署名された公開要約のみを返す。

原則HTTP、JSON、OGPを同じPublicReadServiceで分岐させる。
既存の署名Registryはこの共有状態を格納・列挙する場所にしない。

## 5. API共通契約

標準パスは既存の`shared-estimates`を維持する。`public-estimates`との二重APIは作らない。
HTTP側の値の正本は`contracts/accountless.schema.json`と既存依存Schema。
すべての非公開応答・共有readは`Cache-Control: no-store`。運営者設定originだけをURL生成に使う。

| Method / Path | 認可 | リクエスト／結果 |
|---|---|---|
| POST `/api/v1/certificates` | `oec_`／初回は新規キーの登録 | 既存IssueRequest → 同じ署名処理＋IssueResponse |
| POST `/api/v1/share-previews` | 元証明書の`oec_`＋新規`oep_` | PreviewRequest → PreviewReadyまたは再送時TerminalStatus |
| POST `/api/v1/shared-estimates` | 当該previewへ結び付けた`oep_` | PublishRequest → ManagementStatus |
| GET `/api/v1/shared-estimates/{id}/management` | 対応する`oep_` | 状態・日時・URLだけ。非公開原本を返さない |
| POST `/api/v1/shared-estimates/{id}/withdraw` | 対応する`oep_` | WithdrawRequest → WithdrawResult |
| GET `/api/v1/shared-estimates/{id}` | 不要 | 既存の公開envelope＋live_status |
| GET `/e/{id}` | 不要 | SSRの公開要約 |
| GET `/og/e/{id}.png` | 不要 | 状態確認済みOG画像 |
| GET `/verify/{certificate_id}` | 不要 | 従来の公開証跡のみ |

POSTの最初の3操作にUUID v4の`Idempotency-Key`を必須とする。
withdrawは対象・状態遷移そのものを冪等とし、キー必須にはしない。2回目も同じ撤回時刻を返す。
GETによる公開・削除等の状態変更を禁止する。
匿名コミュニティ経路に旧全体API tokenを追加要求しない。

### 5.1 初回の証明書発行
新規`oec_`は「本人が認証された」意味ではなく、発行する結果の管理権限を結び付ける材料。
初回受付は一般公開の作成APIであり、濫用対策・本文上限・Schema検証・サーバー再計算を必須にする。
`IssueRequest`、保存Document、PublicManifest、署名の構造は変更しない。
権限digestは**署名対象の外の私的テーブル**に保存する。

初回成功でcertificate_idとdigestを一対一に結び付ける。
同一digest＋同一Idempotency-Key＋同一requestであれば同一Bundleを再取得する。
同じdigestを別の発行要求に流用する場合は409 `CAPABILITY_ALREADY_BOUND`。
再送では現在のベンチマーク・為替を再取得して再発行しない。
既存private payloadが消去済みなら410 `PRIVATE_PAYLOAD_PURGED`。新しい証明へ置換しない。

### 5.2 公開プレビュー
入力：
```
{ certificate_id, metadata:{app_name,description,publisher_label,app_url}, include_model_label }
```
Web/API側は以下を行う。
1. certificate_idとoec digestの一致を確認する。
2. 元Bundle・署名・保存Report・公開可能性を確認する。
3. metadataと任意開示設定を検査する。
4. 新share_id、新preview_idを予約し、oep digestを結び付ける。
5. 既存PublicProjectionで公開候補を作る。clientの数値は入力として受け付けない。
6. 公開候補は既存PublicEstimatePayloadから`published_at`を除き、schema_versionを
   `oes-public-estimate-preview/0.1.0`にしたものとする。公開時に元の
   `oes-public-estimate/0.1.0`へ戻してpublished_atを加える。
7. `preview_hash = SHA256(UTF8(JCS({domain:"open-estimate/share-preview/v2",
   policy_version:"oes-publication-consent/0.2.0",
   expires_at, public_candidate})))`。
8. 期限と認可を保存し、公開候補と確認用テキストを返す。
9. まだ公開HTTPルートからは何も見えない。

新oepキーは既存shareに再利用不可。同じプレビュー要求の再送だけは同じキーを使う。
アプリ名の正規化・trimをするなら、正規化後の値をプレビューで示しhashへ含める。
プラグインはこの結果を保存してから公開を許す。プレビュー通信断の間は公開は発生しない。

### 5.3 公開確定
入力：
```
{ preview_id, preview_hash, consents:{
  policy_version:"oes-publication-consent/0.2.0",
  publish_summary_and_social_card:true,
  authorized_to_publish:true,
  understands_retention_and_external_copies:true,
  understands_management_key_loss:true
}}
```
- oepキーとpreviewの結び付け、期限、hash、元証明書状態を確認する。
- AIが返したtrueだけで本人確認をしたとは主張しない。公式プラグインは明示同意を必須にする。
- 予約済みshare_idを使い、published_atを付け、公開payloadに署名する。
- 元証明の固定評価を再計算・再見積しない。現地通貨の表示額は表示時FXを使うDisplayQuoteで別計算する。固定評価のhash・元署名は変更しない。
- 署名・OG生成後、最終トランザクション内でもPREVIEW／期限／撤回を再確認する。
- 公開content・画像・同意・再送記録とstate変更を原子的に保存する。
- COMMIT前にURLを「公開済み」と返さない。
- 公開中の管理ステータスは`PUBLISHED`。表示停止は別の`visibility`で表す。

### 5.4 管理状態
返却はshare_id、preview_id、publication_state、visibility、日時、canonical_urlだけ。
管理キー、作者名、非公開Bundle、元コード、同意記録を返さない。
状態照会はLLMに公開結果の全文を再入力するためのAPIではない。

### 5.5 公開削除
入力`{reason_code:"PUBLISHER_REQUEST"}`。
正しいoepならPREVIEW/PUBLISHED/EXPIRED/表示停止状態から撤回可能。
同じshareがWITHDRAWNなら状態を変えず同じ結果を返す。
削除は公開関連のpayload・署名・OG・preview・埋込JSON等の削除を含む。CSSで隠すだけではない。
元CertificateのREVOKEDイベントを生成しない。
秘密の自由文理由は受け付けない。

## 6. 再送と競合

| 操作 | 再送の名前空間 | 同一判定 |
|---|---|---|
| ISSUE | certificate digest＋Idempotency-Key | 正規化IssueRequest |
| PREVIEW | certificate digest＋Idempotency-Key | 正規化PreviewRequest＋新publication digest |
| PUBLISH | publication digest＋Idempotency-Key | 正規化PublishRequest |

request内容はサーバー秘密によるHMACで保存する。生のbody／preview／metadataを再送テーブルへ複製しない。
HMACの版をレコードへ保存し、鍵更新後の過去再送で同じ比較を行う。
認可・入力上限・基本構文検査の後、再送判定を高コスト処理より先に行う。

- 同一キー／同一内容：同じIDを返す。
- 同一キー／別内容：409 `IDEMPOTENCY_CONFLICT`。
- 消費済みpreviewへ別の公開キー：409 `PREVIEW_CONSUMED`。
- 期限切れpreview：410 `PREVIEW_EXPIRED`。
- 撤回後の過去publish再送：410 `SHARE_WITHDRAWN`。以前のsuccess bodyを保存して再返却しない。
- プレビュー再送時、公開済みならTerminalStatusのみ、期限切れならEXPIRED、撤回済みならWITHDRAWN。旧公開候補を再返却しない。
- 同時publish／withdraw：最後のトランザクションの状態確認で直列化する。withdraw成功後の新しいreadは旧値を返さない。
- publishの応答断：保存済みshare_id＋oepで状態照会／withdraw可能。public writeを新IDで再試行しない。
- PREVIEW通信断：保存済みの同じoec/oepとIdempotency-Keyで再送する。public化はまだ行われない。

## 7. エラー契約

既存ErrorResponse `{error:{code,message,request_id,details:[]}}`を使用する。
detailsに秘密・元body・ヘッダー・コード・app情報をechoしない。

| HTTP | code | 意味 |
|---|---|---|
| 400 | INVALID_PROTOCOL / INVALID_JSON / INVALID_CAPABILITY_FORMAT | 通信形式不正 |
| 401 | AUTHORIZATION_REQUIRED | 必須認可ヘッダーなし。WWW-Authenticate: Bearer |
| 404 | RESOURCE_NOT_ACCESSIBLE | 不存在または誤った管理キー。存在の有無を区別しない |
| 409 | CAPABILITY_ALREADY_BOUND | 新規キーが別リソースへ既に割当済み |
| 409 | IDEMPOTENCY_CONFLICT / PREVIEW_CHANGED / PREVIEW_CONSUMED | 再送・確認内容不整合 |
| 409 | SOURCE_CERTIFICATE_REVOKED | 公開準備／確定時に元証明失効。削除は拒否しない |
| 410 | PREVIEW_EXPIRED / SHARE_WITHDRAWN / PRIVATE_PAYLOAD_PURGED | 終了状態 |
| 413 | PAYLOAD_TOO_LARGE | 上限超過 |
| 415 | UNSUPPORTED_MEDIA_TYPE | JSON以外の書込み |
| 422 | SCHEMA_INVALID / PUBLIC_PROJECTION_INVALID / SOURCE_SIGNATURE_INVALID | 検査不成立 |
| 429 | RATE_LIMITED | Retry-Afterを付ける。無限自動再送しない |
| 503 | PUBLICATION_UNAVAILABLE / WITHDRAWAL_DURABILITY_PENDING | 状態／保存障害。成功偽装なし |

プラグイン内の`LOCAL_CREDENTIAL_UNAVAILABLE`、`LOCAL_SAVE_FAILED`、
`CONFIRMATION_REQUIRED`、`CONFIRMATION_EXPIRED`はHTTP前に発生し得る。
private削除済みや署名失効の詳細は、認可成立後にのみ返す。

## 8. 削除の保証範囲

### 8.1 今回の「削除」
利用者の既定の削除操作は**公開見積ページと配信データの削除**である。
対象は本文・head・公開JSON・OG画像・公開ダウンロード・配信用preview／複製。
撤回したshare IDの再使用は禁止。削除完了後の新しい取得は410となる。

### 8.2 自動削除しないもの
- 元Certificateの公開発行／失効履歴。
- 既存方針に基づく元の非公開Assessment／Bundle／分析データ。
- 利用者の端末に保存した証明書。
- SNS、検索エンジン、スクリーンショット等、外部に既にコピーされたもの。

公開削除を「全データを完全消去」と表示しない。
privateデータ消去・分析同意撤回を求められた場合は、この公開削除と区別し、既存の消去窓口／別機能へ案内する。本仕様で未実装の消去APIを成功扱いにしない。

### 8.3 削除操作の応答
```
{
  protocol_version:"oes-accountless/0.1.0",
  share_id, state:"WITHDRAWN", withdrawn_at,
  removal:{
    public_serving_removed:true,
    source_certificate_revoked:false,
    source_private_payload_deleted:false,
    external_copies_recalled:false
  }
}
```
`public_serving_removed:true`は配信停止・配信元の論理削除を意味し、SSDやバックアップから全ビットが即時消えるという意味ではない。

### 8.4 再生を防ぐ
DBだけを古いバックアップへ戻して公開結果が復活しないよう、最小の撤回tombstoneを別の永続ジャーナルへ記録する。
新規readはtombstoneを優先する。復旧時は公開配信を止め、ジャーナル適用が完了してから再開する。
削除ackは配信停止とジャーナル耐久化後。ジャーナル障害は503だが、既に削除した公開内容を戻さない。
バックアップ世代の廃棄期限は運営のデータ取扱方針へ明示する。全ストレージ喪失時まで回復保証しない。

## 9. 公開・同意・出典の境界

metadataは既存の`app_name`、`description`、`publisher_label`、`app_url`を使用する。
author_display_name等の別名を並行導入しない。モデル名の公開は既存どおり既定false。
CFP・人時・金額・注意事項は元の記録と公開投影器から生成し、自己申告しない。

公開同意では次を明示する。
- アプリ名・概要・任意作者名・任意URL・数値・根拠集計・選択したモデル名が公開される。
- 一般公開URLであり、検索noindexでも秘密のリンクではない。
- 公開期間は撤回まで。キー紛失時の自動復旧はない。
- 公開削除は元の証明書履歴・非公開詳細・外部複製の全消去ではない。
- 数値の参考性、AIの判断・自己申告、部分測定等の注意は隠せない。

同意はクライアントからの実行記録であり、本人認証・法的権限の独立確認ではない。
レポート／Certificateへ実際の管理キーや同意取得画面の個人情報を埋め込まない。

## 10. 不変性と未変更範囲

- 公開後の同じURLは同じ数値・metadataを指す。再評価は新URL。
- 撤回で暗号署名の数学的な有効性を「無かったこと」にしない。公開提供状態を変える。
- 登録なしでも、AI評価の正しさ・作者本人性を保証する機能は追加されない。
- モデル/CFP等の内部分析データは実績工数の教師データと混同しない。
- 新しいユーザー、セッション、パスワード、メール、SSOテーブルは作らない。
- 現行ローカルstdio MCPが対象。共有リモートMCPで全利用者に一つのキー保管領域を使う拡張は対象外。

## 11. Schema利用上の注意
`contracts/accountless.schema.json`のrootはAPI messageとして受け付けない。
各`$defs`または`contracts/PreviewRequest.schema.json`等のwrapperから検証する。
既存の依存Schemaの$idをローカルregistryへ登録し、リクエストごとにネットワーク取得しない。
Schemaは形式検査であり、対象キー照合、状態遷移、base64url正規性、URL安全性、参照関係、
preview hash、署名、同意フローは別の意味検査で確認する。
IssueResponseのcertificate_idはbundle.public_manifest.certificate_idと一致させる。
PreviewReadyのshare_id/certificate_id等はpublic_candidateと一致させる。
PreviewTerminalのstatusとmanagement.publication_stateは一致させる。
ManagementStatusのcanonical_urlは運営者設定origin＋/e/share_id以外を拒否する。
