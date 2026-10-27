# ローカル見積りから所有者限定Webプレビューまでの実装指示書

作成日：2026-10-21 JST  
状態：次工程の実装指示。ここで追加するAPI・所有者関連付け・送信経路は未実装。  
上位文書：[計算証明書仕様](SIGNED-CALCULATION-CERTIFICATE-SPEC.md)、[全体実装指示](SIGNED-CALCULATION-CERTIFICATE-IMPLEMENTATION.md)、[認証・承認方針](SIGNED-CALCULATION-CERTIFICATE-AUTH-DECISION.md)。

**標準経路の改訂（2026-10-27）**：[プラグイン体験仕様](PLUGIN-EXPERIENCE-SPEC.md)では、本人用Web結果の作成とURL提示を通常見積の到達点とする。本書の既存経路は証明書候補の構造を扱うため、通常の数値モデル用の新契約と同一視しない。新経路でも本人確認・明示同意・期限・再開の境界を維持し、解析前の全体像と結果UIを接続する。実装済みの範囲と残作業は[実装状況](PLUGIN-EXPERIENCE-IMPLEMENTATION-STATUS.md)を参照。

## 1. 目的と今回の完了条件

検査済みローカルrunを用いて、利用者が送信を許可した数値モデルをサーバーで再計算し、Auth0でログインした所有者だけが結果をWebで確認できる状態を作る。

完了する操作は「ローカル準備 → ブラウザーで本人確認・送信許可 → CLI送信 → サーバー再計算 → 所有者限定プレビュー表示」。この工程では署名・証明書発行・一般公開・公開停止の操作権限を与えない。署名鍵を設定しなくても試験可能とする。

`ISSUANCE_ENABLED=false`、`PUBLICATION_READ_ENABLED=false`を維持し、新しい`OWNER_PREVIEW_ENABLED`で本工程だけを制御する。初期値はfalse。本書の作成は本番デプロイや実データ送信の承認ではない。

2026-10-21、利用者からログイン、再読込での認証維持、ログアウト、再ログインの確認成功が報告された。本工程ではその認証を再利用する。この報告をCLI関連付け・証明書機能・メールOTPの受入済みという意味には広げない。

## 2. 現状と必要な変更

| 現行実装 | 今回の変更 |
|---|---|
| `prepareCertificate`が元runを変更せずFrozenInput・nonceを保存 | 再利用。保存済みmodel.jsonのID順を維持 |
| `readCertificateSubmission`はPREPAREDとチェックサムを検査 | 元成果物は不変に保ち、送信・回復情報を別ファイルへ追加 |
| CLIのpreview／publish／resumeは未接続エラー | previewとプレビュー受付回復だけを実装。publishは無効のまま |
| browser sessionは`scopes: []` | セッション全体へmanage権限を追加しない。本人確認結果から限定操作を認可 |
| `CertificateService.preview()`がissuance_enabledを検査 | preview専用serviceへ分離、または独立したpreview gateを導入。発行gateを緩めない |
| service構築にkey_id／sign関数等が必要 | previewの依存から秘密鍵・署名器を除外。架空の鍵で穴埋めしない |
| default Workerは証明書経路を拒否 | preview関連の限定経路だけ接続 |
| `WebPublicationApproval`には発行・公開の確認ボタンがある | 今回の所有者プレビューとは別画面にする。既存confirmへroutingしない |

全体指示書P2／P3／P4／P5のうち、本書の範囲を先行実装する。既存の発行用契約を黙って変更しない。Auth0 + Webで一度の公開承認という選定は維持する。

## 3. 所有者の関連付け方式

### 3.1 この工程の設計判断

初版は**今回のsubmissionだけに有効な短期の関連付け**を採用する。既存Auth0のブラウザーセッションを使い、CLI用の恒久ログイン・refresh token・Auth0 Native Applicationの追加は後続に分ける。この仕組みはOAuth Device Flowを実装したものとは呼ばない。

CLIはローカルで32 byteのCSPRNG秘密値を生成し、送信状態ファイルへ耐久保存する。サーバーにはそのdomain付きSHA-256だけを登録する。秘密値をURL・標準出力・会話・ブラウザーへ渡さない。CLIが知る秘密値と、Webで確認した所有者の両方が揃った場合だけ、そのsubmissionを送信できる。

関連付けは入力commitment、metadata_hash、policy_version、環境・originに固定する。ownerはbrowser sessionの検証済みissuer/sub由来の内部IDから取得し、CLI指定owner_id・メール一致・表示名を信頼しない。

### 3.2 操作手順

1. `prepare-certificate`で既存のPREPAREDを作る。まだネットワーク通信しない。
2. `preview-certificate`で、送信される内容と保存範囲をローカル表示する。ソース・元run情報は送らず、数値モデルを再計算し、公開候補と公開用説明を本人限定で一時保存することを案内する。
3. CLIが関連付け要求を作成する。この段階で送るのはcommitment、metadata hash、policy版、秘密値のhash、再試行IDだけ。モデル、nonce、metadata本文は送らない。
4. CLIが公式Webの確認URLと8桁の照合コードを表示する。ブラウザーは既存Auth0でログインする。照合コードはURLに含めない。
5. 利用者がブラウザーでCLI表示のコードを入力し、「このローカル結果を送信し、本人限定のプレビューを作成する」に同意する。発行・一般公開の承認ではないことを明記する。
6. サーバーが所有者と関連付けを固定する。CLIは秘密値で保護した状態照会により承認を検知し、同じ入力だけを送信する。
7. サーバーは再計算・比較し、成功時にpreview ID・hash・期限・所有者限定URLを返す。CLIは応答を保存し、ブラウザーで結果を開けるようにする。

ブラウザーを開けないホストでもURLとコードの手動入力で進められるようにする。コードは関連付け確認用であり、Auth0の認証コードやAPI tokenではない。秘密値・cookie・Auth0 tokenの手動コピーを利用者に要求しない。

### 3.3 期限と乗っ取り防止

関連付け承認期限は作成から10分、承認後の入力送信期限は承認から5分かつ作成から10分以内。preview自体の期限は作成成功から15分。期限を応答へ明示し、暗黙に延長しない。

照合コードは暗号学的乱数による8桁数字（先頭0も保持）。DBにはコードのHMACだけを置き、検証用secretはWorker secretで管理する。平文コードや再試行用秘密値は保存・ログ出力しない。関連付けIDは16 byteのCSPRNGによる`pt_`＋hex32桁とする。

コード入力は関連付けごとに最大5回、超過は終端LOCKED。1回の成功でownerを固定し、別sessionから上書きできない。照合コードだけではCLI状態照会・送信を許可しない。URLだけを開いても関連付けを自動承認しない。

未認証の要求作成にはエッジ制限、D1内の全体上限、10分での失効、定期削除を用意する。初期値は要求作成を拠点ごと毎分10件、DB上の未失効要求100件まで。拠点単位制限を世界全体の厳密上限と説明しない。全体上限はDBの原子的guardで検査する。承認・入力送信にも所有者別の既存preview上限を適用する。

## 4. APIと認可

全objectはstrict、最大bodyサイズと文字列長を定義する。本文・Authorization・Cookieをログに残さない。以下は新設予定。

| API | 認可・動作 |
|---|---|
| POST `/api/v1/preview-transfers` | 未認証でも作成可だが§3.3の上限必須。本文はinput_commitment、metadata_hash、policy_version、client_secret_hash。Idempotency-KeyはUUIDv4。応答はtransfer_id、verification_url、user_code、expires_at、poll_interval_seconds=5 |
| GET `/manage/preview-transfers/:id` | Auth0 session必須。送信目的、コード入力欄、同意欄を表示。元データは表示しない |
| POST `/manage/preview-transfers/:id/approve` | 同一Origin、session、対象ID・bindingに結び付くCSRF、コード、同意を検査。ownerを一度だけ固定 |
| POST `/api/v1/preview-transfers/:id/status` | `Authorization: PreviewTransfer <秘密値>`、本文は空object。状態と期限、作成済みならpreview ID・hash・URLを返す。owner情報やモデル本文は返さない |
| POST `/api/v1/preview-transfers/:id/preview` | 同じ秘密値＋Web承認済みbindingを検査。本文はfrozen_input、nonce、metadata、policy_versionだけ。再計算後にpreviewを一度だけ作成 |
| GET `/manage/certificate-previews/:preview_id` | Auth0 sessionからownerを導出してDB照会。本人限定の結果画面 |
| GET `/api/v1/owner-certificate-previews/:preview_id` | 同じbrowser sessionとowner検査。所有者限定のpreview DTO。CORSで外部公開しない |

要求作成の冪等性：同じIdempotency-Keyでも、既存要求の秘密値を証明できないクライアントへ情報を再配信しない。初回応答喪失時は秘密値を添えた同じ要求で回復する。平文コードは保存しないため、回復時は新コードへ原子的に更新し、旧コードを無効にする。承認済みならコードを再発行せず承認済み状態だけ返す。秘密値のhash、bindingの不一致は409。

秘密値のhash式は`SHA256(UTF8(JCS({domain:"oes/preview-transfer-secret/v1",secret})))`、bindingは`SHA256(UTF8(JCS({domain:"oes/preview-transfer-binding/v1",origin,input_commitment,metadata_hash,policy_version})))`。algorithm・hash形式は既存commitment契約を再利用する。

`PreviewTransfer`資格情報はこの3つの機械向け経路（回復付き作成、status、preview）だけに適用する。既存の一般AuthAdapterや`certificates:manage`に昇格させない。発行API、公開承認grant発行、他のpreview閲覧には使えない。既存`POST /certificate-previews`は本工程で一般に有効化せず、専用経路から共通の計算・保存処理を呼ぶ。

状態はPENDING／APPROVED／READY／DENIED／LOCKED／EXPIRED。PENDING照会は200で状態を返す。未認証は401、他ownerのWeb URL・未知IDは404、binding変更409、期限切れ410、上限429、DB障害503。権限不足と不明なIDの区別で他人の情報を漏らさない。入力内容や内部例外をエラーへ含めない。

ログイン前に確認URLを開いた場合は、任意のreturnToを使わず、検証したtransfer IDだけを暗号化ログインtransactionへ関連付け、callback後にサーバー側の固定ルートへ戻す。既存`/manage`のログイン動作を壊さず、外部URL・任意pathへのredirectを拒否する。

## 5. 再計算と保存の境界

入力送信時に現在の承認期限・owner・binding・秘密値を確認し、input_commitmentとmetadata_hashを再計算する。入力が変わった場合は新しい関連付けからやり直す。数値モデルv1／v2、candidate、basis、skill／rules登録の検査は既存`recomputeCertificateResult`／`createApprovedDraft`を再利用し、登録不足をテスト用許可で迂回しない。

既存ApprovedDraftが予約するcertificate_id／share_idは未発行の予約値である。画面には公開URLや署名済みという表示を出さない。engine・rules・basisは実際に対応する不変カタログ値を使う。発行鍵を要求するためだけのdummy keyを登録しない。

新migrationで`preview_transfers`を追加する。保存項目はID、作成冪等キー、秘密値hash、binding情報、コードHMAC、試行回数、状態、owner ID（承認前null）、作成・承認・失効時刻、preview ID／draft hash（成功前null）。モデル・nonce・metadata本文・生token・Auth0 tokenはこの表に保存しない。

Webで確認した送信許可は操作`prepare_certificate_preview`の証跡として保存する。既存stored approvalを再利用する場合も、生grantをCLIへ渡さずサーバー内部で照合する方式、または同じbinding検査を行う専用adapterへ分離する。公開承認用のgrantとして再利用しない。

再計算はメモリ内。preview保存とtransferのREADY更新を同じD1 batchで確定する。未使用・期限・owner・binding・上限検査はDB内guardで失敗時に全rollbackする。二重POSTでは同じpreviewを返し、preview枠を二重消費しない。送信失敗でモデルをqueueやDBへ退避しない。

READYは送信期限を過ぎても、秘密値一致ならpreview有効期限内に受付情報を回復できる。ただし期限切れpreviewは再生成せず410。同じ受付の回復を、承認期限の検査より先に行う。previewができる前に期限が切れた場合は再承認が必要。

preview内容は既存certificate_previewsに本人限定で保存し、15分で表示不可、期限後1時間以内に削除する。transferと送信許可の情報はpreview期限＋1時間で削除する。Cronへ既存browser session削除と併設し、有効sessionや他の発行記録を削除しない。停止flagは新規作成・承認・送信・閲覧を無効化するが、期限切れデータの削除は継続する。

## 6. CLIとローカル保存

`preview-certificate`のstdinは`{submission_id}`のみとする。本工程では利用者やモデルへtransfer_authorization_idの手入力を求めず、内部のWeb関連付けで取得・検証する。この点は全体指示書P3のコマンド案を本工程に限って具体化する変更である。

待機は5秒間隔、期限までの有限pollingとし、429のRetry-Afterを守る。Ctrl+Cではサーバー作成済みpreviewを取り消さず、再開可能な状態を残す。既定ではブラウザーを自動操作せずURLを表示する。任意ブラウザー起動を実装する場合も公式originの固定ルートだけを許す。

再開は`resume-preview {submission_id}`として追加し、未実装の証明書発行回復`resume-certificate`と区別する。送信内容・秘密値・受付IDを先に耐久保存し、保存失敗では送信しない。元submission.json／COMPLETE.jsonを書き換えず、別のprivate送信状態ファイルと応答ファイルをatomic writeで管理する。再開時に元チェックサムとbindingを再検査する。

出力は状態、submission_id、確認URL・照合コード（PENDING時のみ）、preview_url、期限、保存成否の許可リストだけ。秘密値、認証cookie、owner ID、非公開hash、モデル本文を標準出力へ出さない。発行・公開状態は常にfalse。応答後のローカル保存失敗は「プレビュー作成済み・ローカル保存未完了」と表示し、同じ受付から回復する。

## 7. 所有者プレビュー画面

タイトルは「公開前プレビュー」。本人限定・未発行・未公開を明記する。結果は保存したdraftから読み、クライアントから渡された値やquery文字列を正本にしない。

必須表示：アプリ名・公開用説明、CFPと内訳、計算状態、工数と基準USD額、TEST注意、PARTIALの理由と品質集計、未算出の理由、対象作業・除外、基準・規則版、プレビュー期限。ソースの真正性・網羅性とAI解釈を独立監査していないことを示す。生JSONのpre表示だけで完了にしない。

この工程では為替取得を追加せず、固定USDと工数を表示する。署名バッジ、公開リンク、発行・承認ボタンは表示しない。説明の修正は新submissionで行う。スマートフォン幅で主要結果と注意が読めることを確認する。

ページとJSONはno-store、noindex、同一owner認可。別ownerのID指定は404。全テキストescape、外部画像・OGP取得なし。期限切れページでは金額・説明を再配信しない。

フォームページのReferrer-Policyはsame-origin、OAuth callbackのredirectはno-referrerを維持する。OriginとCSRF検査を弱めてnullを通す修正はしない。今回のログアウト不具合と同種の設定が既存`web-publication-approval.ts`にもあるため、フォーム共通処理を再利用する場合は実ブラウザーのPOSTで検証する。

## 8. ファイル別の作業順序

| 順序 | 対象 | 作業 |
|---|---|---|
| 1 | `src/core/certificate-contract.ts`または専用contract | transfer、状態照会、preview DTO、エラーのstrict Schema。contracts生成へ追加 |
| 2 | 新`src/web/preview-transfer.ts`とrepository、migration | 期限・秘密値hash・コード確認・owner固定・原子的保存／再試行 |
| 3 | `src/web/certificate-service.ts` | preview依存を署名・発行gateから分離。計算規則は共用 |
| 4 | `src/web/browser-login.ts`、新owner-preview controller | 制限されたログイン復帰先、送信許可フォーム、所有者限定表示 |
| 5 | `src/web/worker.ts`、`wrangler.jsonc` | preview専用flag、rate limit、専用routing、Cron。既存ログインと/mcpを保持 |
| 6 | `src/local/certificate-submissions.ts`、`src/local/cli.ts` | 通信adapter、private送信状態、preview／resume-preview、固定origin検査 |
| 7 | testsと受入記録 | 下記試験と実ブラウザー確認。実行環境とデプロイ有無を分けて記録 |

所有者Webに発行用manage scopeを一律付与しない。preview用認可は「ログイン済み本人の対象だけ」という専用検査で実装し、発行用authと混同しない。専用flagだけで発行・公開の既存拒否を解除しない。

## 9. 必須受入試験

| ID | 確認内容 | 合格条件 |
|---|---|---|
| OP01 | PREPARED作成 | ネットワークなし、元run・checksum不変 |
| OP02 | 未認証で確認URLを開く | ログイン後に正しい対象へ戻る。外部returnTo拒否 |
| OP03 | 正しいコード・同意・CSRF | ownerが一度だけ固定される |
| OP04 | 誤コード5回、期限切れ、同意なし | 承認不可。ownerが付かない |
| OP05 | URLだけ、別sessionの上書き | 自動承認・owner変更不可 |
| OP06 | 秘密値なし・別秘密値・URLだけで照会／送信 | 拒否。owner・結果を漏らさない |
| OP07 | 許可前にモデル送信 | 拒否し永続保存しない |
| OP08 | metadata／model／nonce／policy変更 | binding不一致で停止、新しい許可が必要 |
| OP09 | v1／v2、PARTIAL、未算出 | 既存の再計算状態・null・理由を保持 |
| OP10 | profile同IDの係数改変、未登録skill／rules | 発行同様の基準検査で拒否 |
| OP11 | 同時送信・再送 | 1つのpreview、同じhash・期限、枠の二重消費なし |
| OP12 | DB batch途中の失敗 | READYだけ／previewだけが残らない |
| OP13 | 応答喪失・ローカル保存失敗・CLI中断 | 同じ受付から回復、入力・nonceを再生成しない |
| OP14 | 作成応答喪失 | 秘密値で回復でき、旧コードを無効化。別秘密値で取得不可 |
| OP15 | 本人・別owner・未認証のHTML／JSON | 本人だけ表示、他owner404、キャッシュによる漏えいなし |
| OP16 | preview期限・削除Cron | 期限後410、本文削除、有効sessionを保持 |
| OP17 | 不正Origin・null・CSRF、通常ブラウザーform POST | 不正操作拒否、通常送信成功。fetch合成テストだけで済ませない |
| OP18 | ログイン・再読込・ログアウト・再ログイン | 既存成功経路を維持、ログアウト後のpreview取得不可 |
| OP19 | preview資格情報で発行・公開承認・別対象操作 | 全て拒否。署名呼出し0回、証明書／公開行0件 |
| OP20 | ログ・DB・CLI出力・URLの秘密canary検査 | モデル・nonce・生秘密値・token・私有run情報の混入なし |
| OP21 | 上限・巨大body・poll・flag無効 | 429／413／無効応答、無制限作成・無限pollなし |
| OP22 | 実ホスト＋実ブラウザー | 準備→照合→同意→送信→本人限定表示を完了し、TEST等を読める |

OP20では公開用metadataが本人限定previewに保存されることと、私有情報を保存しないことを分けて検査する。使用するデータ・秘密は合成fixtureとし、実プロジェクト入力を外部へ送る試験は別途許可されたものだけにする。

## 10. 検証・完了報告

実装開始時にgit差分と既存受入を確認する。実装後は対象テスト、全体回帰、typecheck、build、Worker dry-run、diff checkを実施する。実DBの競合と通常ブラウザーのform送信はunit test合格で代替しない。実Auth0・本番接続の確認は別段階で記録する。

`OWNER-WEB-PREVIEW-ACCEPTANCE.md`にcommit、実行コマンド、OP01〜22の合否・未実施、環境、実ホスト、保存・送信境界、既存ログインの回帰、発行／公開無効の証跡を残す。ユーザー報告と実装者の直接確認を分ける。

完了報告は「ローカル実装」「隔離環境での一連の確認」「許可された本番での確認」を別々に記載する。プレビュー成功を署名・証明書発行・一般公開成功とは扱わない。本工程の受入後、Webでの発行・公開承認とreceipt受渡しを次工程として接続する。
