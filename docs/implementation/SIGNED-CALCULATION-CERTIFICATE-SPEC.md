> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# Open Estimate 計算証明書 — サーバー再計算・電子署名仕様

作成日：2026-10-20 JST  
仕様ID：`oes/signed-calculation-certificate-spec/1.0.0`  
状態：実装のための設計仕様。新API・署名・認証・公開機能の実装済み／本番稼働を意味しない。§13の公開前提には未確定事項がある。  
実装指示：[SIGNED-CALCULATION-CERTIFICATE-IMPLEMENTATION.md](SIGNED-CALCULATION-CERTIFICATE-IMPLEMENTATION.md)

**利用体験の追加要件（2026-10-27）**：[新システム仕様](SYSTEM-SPEC.md)により、通常の見積の開始時・本人用Web結果の表示時にも、計算証明書の価値、証明範囲、提供状態、利用可能時の発行・公開導線を案内する。本人用Web表示だけで署名済みと表現せず、見積や保存への同意を発行・公開へ流用しない。この追加要件は、本書の署名契約や§13の公開前提を変更しない。

## 1. 目的・初版の範囲

利用者が承認した見積り結果をWebで公開し、その固定結果に **AI Orchestration Inc. が電子署名を付ける**。署名の前にサーバーが受領した数値モデルを検査・再計算する。第三者は公開JSONの署名、発行元、現在の公開・失効状態を確認できる。利用者は秘密鍵や証明書を購入・管理せず、既存の測定から公開確認へ進む。

初版は「ローカル候補生成 → 送信確認 → サーバープレビュー → 発行と公開の承認 → 署名付き公開」を完成させる。包括的な管理画面に先行して、公開ページ、検証、JSON取得、所有者による公開停止を提供する。公開しない証明書だけの発行、公開一覧・検索、移転・共同管理、決済、証明書の上書き編集は初版に含めない。発行への同意と一般公開への同意は区別し、一度の確認で両方を明示できるようにする。片方だけの同意では、この公開経路を実行しない。

基盤は既存のCloudflare Workers、静的アセット、D1を基本とする。公開時のLLM呼出し、ソース保管、外部タイムスタンプ局、ブロックチェーン、利用者用PKI、専用署名サーバーは追加しない。追加費用ゼロは保証せず、署名・DB・認証・メール等の利用量を上限制御する。

### 1.1 既存仕様との優先関係

本書は**新しい署名付き公開経路**の契約として、旧`public-estimate`、旧Web APIの無認証管理キー方式、旧証明書の署名対象と衝突する部分に優先する。既存形式を同じversionのまま変更しない。

- [新システム仕様](SYSTEM-SPEC.md)のソース非送信、アカウントによる管理、会話での初回確認を維持する。ログインと発行・公開への同意を分離する。
- [公開候補生成仕様](PUBLIC-RESULT-PROJECTION-IMPLEMENTATION.md)の`PublicResultCandidate`はローカル成果物のまま保持する。`signed:false`を書き換えて証明書にしない。
- [表示時の換算](DISPLAY-VALUATION.md)の「固定結果と表示時FXの分離」を維持する。
- 旧[PH1仕様](../milestones/PH1-SPEC.md)のTEST発行禁止に対し、本経路だけは**TESTを明記した計算証明書の発行・公開**を許す。これはTEST係数を実績値として承認する変更ではない。実績に基づく通常見積りの公開は別の基準承認・仕様改訂を必要とする。
- 0.8.1の配布ZIP、保存run、既存ハッシュ・比較結果は変更しない。今回確認した公開候補生成コードは作業ツリー上の実装であり、配布・実ホスト受入とは別に扱う。

## 2. 「証明」の意味と画面での表現

### 2.1 証明すること

| 項目 | 確認できる内容 | 限界 |
|---|---|---|
| 電子署名 | 信頼した発行元の公開鍵に対応する秘密鍵で、署名対象のJSONが署名されたこと | 署名だけでは法人実在性やサーバー処理の実行を独立証明しない |
| 発行元の表明 | 発行元が、受領した数値モデルに記載の規則・基準を適用して結果を再計算したと表明すること | 発行サーバー自体への信頼は残る。実行環境のリモートアテステーションは行わない |
| 内容の整合性 | 固定結果、基準、注意事項、公開説明が署名後に変更されていないこと | 表示画面のスクリーンショットだけでは検証できない |
| 入力との対応 | 私有の再現用バンドルを持つ人は、入力コミットメントと再計算結果を照合できること | バンドルのない第三者は非公開入力からの再計算を実行できない |
| 現在の状態 | オンラインで発行記録・鍵状態・失効・公開停止を確認できること | オフライン署名検証だけでは最新状態を確認できない |

ソースの実在性・真正性・所有権・網羅性、AIによる意味解釈、実際の開発工数、売買価格・市場価値、特定モデルの実行、第三者監査を証明対象にしない。`COMPLETE`も、申告された対象と規則における計算状態であり、独立監査済みを意味しない。`issued_at`は発行元サーバーの時計による記録であり、外部の時刻証明ではない。

### 2.2 必須表示

名称は「Open Estimate 計算証明書」。発行者は`AI Orchestration Inc.`、問い合わせ先は`https://ai-orchestration.jp/security/`とする。連絡先ページの強化は予定であり、受付体制・返信期限・専用メールの整備済みとは扱わない。

公開画面の結果と同じ視認範囲に、次を表示する。

> 受領した数値モデルをサーバーで再計算し、その結果にAI Orchestration Inc.が電子署名しています。ソースコードの内容・網羅性やAIの解釈を独立に検証したものではありません。

TESTの場合は「TEST基準による参考値 — 実績に基づく工数・価格の証明ではありません」を常時表示する。PARTIALの場合は未確認・暫定項目の集計と理由コードの説明を隠さない。未算出値は「算出不可／未算出」と表示し、0や空の成功表示に置き換えない。

検証結果は「署名一致」「発行記録・現在の状態」「計算の適用範囲」を別々に表示する。「すべて証明済み」「認証済み価格」「監査済みソフトウェア」等の総合バッジにしない。

## 3. データ境界

| データ | ローカル | サーバー処理 | 永続保存 | 一般公開 |
|---|---|---|---|---|
| ソース・Assessment・根拠・パス・元run情報 | 保持 | 送信しない | しない | しない |
| 数値モデル、skill申告、規則参照 | 保持 | 再計算・整合検査 | 入力全体は保存しない | 数値モデル・skill申告全体は公開しない |
| ランダムnonce | 自動生成・保存 | 入力対応を検査 | 保存しない | 公開しない |
| 公開候補 | 保持 | 厳密検査・再計算比較 | 候補ファイル自体は保存しない | 後述の署名用結果へ明示変換 |
| 公開結果・承認したメタデータ | 保持 | プレビュー・署名 | 公開中は保存 | 公開中だけ配信 |
| 所有者・承認・発行受付情報 | 最小限の再開情報 | 認証・認可 | 最小限保存 | 公開しない |
| 証明書ID・署名対象ハッシュ・鍵ID・状態 | 保持 | 検証 | 最小限の検証記録として保持 | ID指定の状態照会で公開 |
| 表示時FX | 任意の表示用 | 既存取得・換算処理 | 元レートの共有キャッシュのみ | 固定結果と区別して表示 |

数値モデルにも機能構造の情報があるため、送信前に用途を説明する。リクエスト本文、nonce、認証情報、非公開ファイル名、私有の再現用バンドルはアクセスログ・例外・APM・解析サービスへ出さない。公開前のメタデータもログに出さない。

## 4. 入力検査と再計算

### 4.1 FrozenInput

`FrozenInput`は次の必須キーのみを持つstrict objectとする。

| キー | 契約 |
|---|---|
| schema_version | `oes/certificate-input/v1` |
| model | 現行`oes/remote-model/v1`または`v2`の厳密Schema。名前・パス・自由文なし |
| candidate | `oes/public-result-candidate/v1`。生成元runと同じ保存基準の候補 |
| skill_integrity | 現行skill申告Schema。公式登録との整合を検査するが、実行の証明にしない |
| ruleset_ref | 現行`oes-measurement`のID・revision。サーバー登録済みで発行可能なものに限定 |

入力の追加キー、重複JSONキー、不正Unicode、非有限数、unsafe integer、上限超過を拒否する。bodyは非圧縮UTF-8で最大1 MiB、プロセス最大1,000、movement合計最大10,000とし、既存数値モデルのより厳しい制限も維持する。複数の巨大配列を個別上限だけで許可しない。

### 4.2 計算手順

1. 認証・権限・サイズ・Schemaを検査する。
2. 発行用の対応カタログでskill、規則revision、候補projection、計算契約、mapping、profileの組合せを検査する。未登録・失効・非対応は拒否し、現在版へ黙って置き換えない。
3. 候補のbasisを、サーバーに登録した不変の公開`CalculationBasis`と**全フィールドで照合**する。ID一致だけでは不十分。クライアントが送った係数をそのまま計算根拠にしない。
4. `src/remote/model.ts`の数値モデル検査・計数と、既存`measureAssessment`／`estimateAssessment`を再利用し、サーバー所有の基準で再計算する。この固定計算ではFX・外部API・LLMを呼ばない。
5. 再計算したmeasurement、effort、reference_usd、計算から導くlimitation_codesを候補とJCS比較する。TESTの固定注意コードを含む比較ルールを明示する。不一致は`RESULT_MISMATCH`で停止する。
6. 品質集計のSchema、内部合計、モデルとの状態整合を検査する。qualityをサーバーがソースから再測定した扱いにはしない。
7. サーバー側で署名対象の公開結果を新規構成し、承認用プレビューを生成する。

初版の登録基準は`profiles/local-test.json`と対応する公開basisの固定スナップショットに限定する。具体的にはsample_size=0、hours_per_cfp={p25:2,median:3,p75:5}、hourly_wage_usd=50のTEST基準であり、数値は契約に従う十進文字列として比較する。サーバーの既定profile更新で過去の値を再解釈しない。

`CalculationBasis`は`{schema_version,environment,effort_scope_id,hours_per_day,basis}`のstrict objectとする。schema_versionは`oes/calculation-basis/v1`、残りは候補calculation内の同名フィールドと同じ構造で、サーバー登録値から生成する。`calculation_basis_hash = SHA256(UTF8(JCS(CalculationBasis)))`とし、hashを基準自身に埋め込まない。数値・ID・計算契約の変更は新しいhashとカタログ項目にする。

### 4.3 品質情報と状態

`quality`は既存候補の明示された集計フィールドのみを使用する。サーバーで確認できるのは、受領したモデルとの整合と集計内の矛盾までである。未読ファイル数、境界確認、暫定判断の実体はクライアント申告として表示する。

- model.analysis_completeとquality.analysis_completeは一致させ、partial／applicability_limit／未採用件数を含む既存計数結果と候補measurementを一致させる。
- rerun／continuationのunknown、暫定・未解決、範囲不明等を理由ごとに扱い、該当する未確認事項がある候補をCOMPLETEへ昇格させない。詳細な理由コードの許可リストは公開候補契約を再利用する。
- v2のunadopted_process_countを除去してv1として送信したり、架空のtriggerを補ったりしない。非対応サーバーでは明示エラーにする。
- COMPLETE／PARTIAL／UNSUPPORTED／INCOMPLETEは、有効な計算結果の状態として署名できる。後二者の証明書は「算出できなかった状態の記録」であり、金額の証明として表示しない。

## 5. 公開証明書と署名

### 5.1 Envelope

新契約を`oes/signed-calculation-certificate/v1`とする。公開JSONは次の3キーだけを持つ。

```text
CertificateEnvelope = {
  signed_object: SignedObject,
  signed_object_hash: Sha256Hex,
  signature: Base64Url64Bytes
}
```

`SignedObject`は次の必須フィールドを持つstrict objectとする。

| キー | 内容 |
|---|---|
| schema_version | `oes/signed-calculation-certificate/v1` |
| domain | `oes/server-recomputed-certificate/v1` |
| algorithm | `Ed25519`固定 |
| key_id | サーバーの発行鍵ID |
| issuer | legal_name=`AI Orchestration Inc.`、service=`Open Estimate`、origin、contact_url=`https://ai-orchestration.jp/security/` |
| certificate_id | `cert_`＋暗号学的乱数16 byteの小文字hex32桁 |
| issued_at | UTC、`YYYY-MM-DDTHH:mm:ss.sssZ`。サーバーで設定 |
| deployment_environment | `production`または`test`。計算基準のTESTと分離 |
| status_generation | DB復旧時の状態確認世代。§10.3 |
| approval | approved_draft_hash、policy_version。所有者ID・承認トークンは含めない |
| input_commitment | §5.3のdomain・algorithm・digestのみ |
| result | §5.2の固定結果 |
| metadata | §5.4の承認した公開説明 |
| calculation_basis_hash | 不変の公開CalculationBasisのJCS/SHA-256 |
| ruleset_ref | 再計算に使用した規則のID・revision |
| server_engine_ref | 発行サーバーが選んだengine_version、artifact_sha256。承認済み配布物を指す |

本番issuer.originは`https://open-estimate.ai-orchestration.jp`とする。テスト環境は別origin・鍵・DBを使い、productionとして検証しない。share_id、published_at、現在の状態、閲覧時刻、現在のFXは署名対象に入れず、現在状態レスポンスに分離する。証明書発行と公開処理の成功は同一トランザクションで確定する。

key_idは`key_prod_`または`key_test_`＋16 byteのCSPRNG小文字hex32桁、status_generationは`sg_`＋同じ形式の乱数とする。key_idの環境とdeployment_environmentを一致させる。policy_versionは`oes/certificate-publication-policy/v1`を初版とし、サーバーの既知値に限定する。

### 5.2 result

| フィールド | 作成方法 |
|---|---|
| schema_version | `oes/server-recomputed-result/v1` |
| measurement | 再計算したstatus、cfp、counts |
| quality | 検査した候補の許可リストによる集計。自由文を含めない |
| calculation | サーバー登録済みのenvironment、effort_scope_id、hours_per_day、basisと、再計算したeffort、reference_usd |
| assurance | input=`CLIENT_REPORTED`、calculation_check=`SERVER_RECOMPUTED_MATCH`、quality_check=`CLIENT_REPORTED_CONSISTENCY_CHECKED`、semantic_assessment=`NOT_INDEPENDENTLY_VERIFIED` |
| limitation_codes | 再計算と状態に対応する既存公開enum。重複なし・辞書順 |

署名の成否はEnvelopeの検証から得る。クライアントが指定する`signed:true`フラグを信頼しない。候補basisのengine_versionは計算契約版を表し、実際に署名したサーバーのビルド版はserver_engine_refで別に記録する。skillのファイルハッシュ一致を計算エンジンの実行証明に転用しない。

工数・USD額は既存の十進演算・丸め規則を維持する。整数はsafe integer、十進値は候補Schemaと同じ通常表記文字列とする。未算出nullを保持する。p25／median／p75を別の意味へ変更しない。人日・現地通貨は表示用の派生値であり、署名済みフィールドであるかのように表示しない。

### 5.3 非公開入力との結び付け

ローカルで32 byteのCSPRNG nonceを生成し、paddingなしbase64url43文字で保存する。初回ネットワーク送信より先にFrozenInput・nonce・再試行IDをローカルへ耐久保存する。利用者の手作業は要求しない。

```text
commitment_document = {
  domain: "oes/certificate-input-commitment/v1",
  nonce: <base64url>,
  frozen_input: <FrozenInput>
}
digest = SHA256(UTF8(JCS(commitment_document)))  // 小文字hex64桁
input_commitment = {
  domain: "oes/certificate-input-commitment/v1",
  algorithm: "SHA-256",
  digest: <digest>
}
```

サーバーは各送信時に計算し、署名にはdigestだけを入れる。nonce・数値モデルはリクエスト処理中のメモリ以外に保持しない。入力を限定列挙して推測されることを防ぐため、nonceなしのモデルハッシュ、元Report hash、Assessment hash、run_idを公開しない。nonceを紛失すると入力対応の再検証はできないが、公開JSONの署名検証はできる。

### 5.4 公開メタデータ

全キー必須、未入力はnull。文字数はUnicode code pointで数え、上限はtitle=80、description=240、publisher_label=80、scope_note=500、project_url=2,048、model_label=80とする。titleだけは1文字以上必須。他のテキストは任意。HTML・Markdownの実行は許さず、プレーンテキストとしてescapeする。project_urlはuserinfoを含まないHTTPS URLだけを許可し、サーバーから取得・OGP生成しない。model_label・publisher_labelは自己申告であると表示する。

利用者が公開のために入力し、プレビューで確認した内容だけを採用する。ソース、根拠、元scope.description、機能名から自動転記・AI要約しない。自由文には機密を入れない案内を示す。自由文だけで「コード混入が絶対にない」とは保証せず、元データからの自動混入を実装で防止する。編集時は新しいプレビューと承認を必要とする。

### 5.5 正規化・署名・検証

```text
bytes = UTF8(JCS(signed_object))
signed_object_hash = SHA256(bytes)                 // 小文字hex64桁
signature = base64url(Ed25519.Sign(privateKey, bytes)) // paddingなし86文字
```

署名対象はhash文字列ではなく、上記bytesそのものとする。Ed25519phは使わない。Envelopeのhashとsignatureを署名対象へ再帰的に含めない。改行・表示用整形は対象外だが、文字列の内容・配列順は対象である。未知フィールドを除去して検証したり、Unicodeを検証時に正規化したりしない。[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)、[RFC 8032](https://www.rfc-editor.org/rfc/rfc8032.html)に従う。

公開鍵はraw Ed25519の32 byteをpaddingなしbase64url43文字で配布する。Workersは標準`Ed25519`のWeb Crypto APIを利用し、独自実装や旧`NODE-ED25519`へ依存しない。[Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)

検証器は、事前に信頼した公式originの鍵カタログ、または利用者が明示的に信頼した公開鍵を使う。証明書に書かれた任意URLや同梱鍵だけを信頼根拠にしない。鍵カタログのoriginが法人名と鍵を結び付ける運用上の信頼点となる。第三者認証局による身元証明を付加した扱いにしない。

## 6. 承認フローと認証

### 6.1 標準フロー

1. ローカルrunから候補・数値モデルを生成する。端末での準備だけでは送信・保存・公開しない。
2. プラグインを所有者アカウントへ関連付ける。送信項目と一時プレビュー保存を説明し、当該送信について確認を得る。同じ操作について既に有効な承認があれば重ねて確認しない。
3. サーバーが検査・再計算し、承認用の公開プレビューを返す。ここでは公開・署名発行をしない。
4. 結果、TEST／PARTIAL、公開説明、公開範囲、署名の意味を確認する。「計算証明書の発行」と「URLを知る第三者への一般公開」の両方を承認する。一度の操作で明示できるようにする。
5. サーバーが承認と同じ入力・公開内容であることを再検査し、署名・保存・公開を確定する。ローカルに公開JSONと再現用バンドルを保存する。

承認前に表示するものを`ApprovedDraft`とする。キーはschema_version=`oes/certificate-approved-draft/v1`、operation=`issue_and_publish`、issuer、deployment_environment、certificate_id、share_id、input_commitment、result、metadata、calculation_basis_hash、ruleset_ref、server_engine_ref、policy_version、status_generation、expires_at。すべて必須である。certificate_idとshare_idはプレビュー時にサーバーが予約する。issued_atとkey_idは発行時に選択し、承認は発行元と署名方針に対して行う。

`approved_draft_hash = SHA256(UTF8(JCS({domain:"oes/certificate-approved-draft-hash/v1",draft})))`。デフォルトの有効期限は15分。期限後は発行しない。失効した鍵・規則を回避するための無断の再計算、値・説明・注意事項の差し替えを禁止する。

### 6.2 認証と承認証跡

所有者は認証基盤が返す内部user_idで管理する。リクエストbody、メール文字列、公開者名を所有者IDとして信頼しない。Google認証とメール認証を想定するが、プロバイダー・メール方式・プラグインとの関連付けは公開前に確定する。メール一致だけのアカウント自動統合はしない。

承認証跡は`principal_id + operation + approved_draft_hash + expires_at + one_time_id`に結び付け、サーバーが検証できる**実ユーザーの承認経路**から生成する。モデルが本文へ書いた`confirmed:true`や自然言語の「承認済み」、通常のアクセストークンだけでは承認証跡としない。[共通セキュリティ仕様](https://ai-orchestration.jp/security/)の利用者・対象・操作内容に結び付ける方針に合わせる。

会話ホストに信頼できる承認イベントの受渡しがあるかは未検証である。認証／承認adapterを分離し、ダミーadapterでは本公開を禁止する。ホストだけでは成立しない場合は「一回のWeb承認へ集約する」案を別途判断する。会話とWebの二重承認を黙って追加したり、会話承認を偽装したりしない。§13のG2が未解決でも、計算・署名・DB・画面のローカル実装は進められる。

送信許可には同じadapterで検証できる`transfer_authorization_id`を用いる。本人、用途`prepare_certificate_preview`、input_commitment、metadataのJCS hash、policy_version、有効期限に結び付ける。既存の測定時に得た許可がこの送信と一時保存を明示的に包含する場合は、その証跡を再利用してよい。承認証跡を作るためだけの追加クリックは要求しない。公開停止の承認はoperation=`withdraw_publication`とし、本人・share_id・signed_object_hash・status_generation・有効期限に結び付ける。

### 6.3 冪等性と再試行

発行リクエストにUUIDv4の`Idempotency-Key`を必須とする。所有者とキーの組合せに一意制約を設け、preview_id、approved_draft_hash、input_commitment、承認証跡IDから受付fingerprintを作る。同じ内容の再試行は同じcertificate_id・発行時刻・署名を返す。同じキーの別内容は409。同じ承認・プレビューの別キー利用も二重発行しない。

応答喪失時は所有者向け受付照会から確定結果を復元する。ローカル保存失敗で新規発行し直さない。公開停止済みの再試行は停止状態を返し、署名JSONの再配信や再公開をしない。最初の処理が未確定なら完了扱いにしない。

確定済みreceiptの照合は、期限・未消費検査より先に行う。同じ受付の回復に、消費済み承認や期限切れpreviewの再承認を要求しない。ただし所有者・受付fingerprint・現在の配信可否は毎回検査する。receipt未登録の404は「確定記録なし」であり、通信中の処理が失敗した証明ではない。同じキーで再試行し、別キーを生成しない。初版は未確定受付をDBへ事前保存しない。

## 7. Web API契約

base pathは`/api/v1`。APIはJSON、全object strict、認証付き応答・状態依存の公開応答は`Cache-Control: no-store`。以下は新設予定であり、現在のエンドポイントを表さない。

| Method / path | 権限 | 入出力・効果 |
|---|---|---|
| POST `/certificate-previews` | 所有者、送信許可の検査 | 入力`{frozen_input,nonce,metadata,policy_version,transfer_authorization_id}`。200で`{preview_id,approved_draft,approved_draft_hash}`。結果のプレビューだけを一時保存 |
| GET `/certificate-previews/:preview_id` | 所有者 | 同じプレビュー。期限切れ410。他人のものは404 |
| POST `/publications` | 所有者＋一度限りの承認 | 入力`{preview_id,approved_draft_hash,frozen_input,nonce,approval_receipt_id}`とIdempotency-Key。201で`{certificate,publication,receipt_id}`。確定済み再試行200。停止後の再試行ではcertificate=null |
| GET `/issuance-requests/:idempotency_key` | 所有者 | 確定済みは200で`{outcome,certificate_id,share_id,signed_object_hash,publication_state}`。確定記録なし404。公開JSONは公開中に別APIから取得 |
| GET `/shared-estimates/:share_id` | 公開 | `{certificate,publication,current_status}`。公開中だけ返す |
| GET `/shared-estimates/:share_id/certificate.json` | 公開 | CertificateEnvelopeそのもの。署名JSONダウンロード |
| GET `/shared-estimates/:share_id/display-quote?currency=JPY&locale=ja-JP` | 公開 | §8.2の表示用換算。公開中だけ返す |
| POST `/publications/:share_id/withdraw` | 所有者＋操作確認 | 入力`{approval_receipt_id}`。公開停止。初回・同じ操作の再試行とも停止状態200 |
| POST `/operator/certificates/:certificate_id/revoke` | 運営専用の別権限 | `{reason_code}`の固定enumだけ。一般アカウントには許可しない |
| GET `/certificates/:certificate_id/status` | 公開 | 最小限の検証状態。結果・説明・所有者を返さない |
| GET `/calculation-bases/:sha256` | 公開 | サーバー公開カタログの不変CalculationBasis。未知hashは404 |

署名鍵は`GET /.well-known/oes-signing-keys.json`で公開する。これはversion付き鍵定義であり、現在の鍵状態はstatus APIから得る。公開鍵の既知定義を削除・差し替えない。カタログ更新時は再検証するキャッシュ方針とし、古いカタログだけで未知鍵を「偽造」と断定しない。

鍵カタログは`{schema_version,issuer_origin,keys}`、schema_version=`oes/signing-keys/v1`。keysの各項目は`{key_id,algorithm,public_key,created_at,deployment_environment}`だけとする。public_keyは§5.5のraw形式。現在の失効状態をこの不変項目に混在させない。通常の公開APIにlist／検索や所有者情報は追加しない。

publicationは`{share_id,certificate_id,state,published_at,withdrawn_at,public_url}`。stateはPUBLIC／WITHDRAWN、withdrawn_atは公開中null、停止時はその有効時刻、public_urlは公式originから構成した`/e/:share_id`とする。鍵・証明書失効時は有効な配信状態をWITHDRAWNとして返す。current_statusは§8.3の状態DTOと同じもの。receipt_idは`req_`＋16 byteのCSPRNG小文字hex32桁、受付照会の成功時outcomeはISSUED固定。送信許可と承認のIDは認証adapterが発行する不透明値で、最大256文字、ログ・公開応答には含めない。

認証と承認receipt生成の外部経路はG1／G2で確定する。一般クライアントに「任意のreceiptを発行するAPI」は提供しない。プレビューIDは`pv_`、share_idは`sh_`に、それぞれ16 byteのCSPRNG小文字hex32桁を連結する。URLはアクセス制御の代替ではなく、公開URLを知る第三者は閲覧できる。

### 7.1 エラー

共通形は`{error:{code,request_id,retryable}}`。request_idはランダムな相関ID。入力本文や例外詳細を返さない。

例外として、構文が正しい証明書IDのstatus照会は、404／503でも§8.3の状態DTOを返し、NOT_FOUND／UNKNOWNを表現する。他のAPIと、ID自体が不正な400は上記エラー形を使う。

| HTTP | 主なコード・処理 |
|---|---|
| 400 / 413 | INVALID_INPUT / INPUT_TOO_LARGE |
| 401 / 403 | AUTH_REQUIRED / APPROVAL_REQUIRED / AUTH_CONSENT_NOT_READY |
| 404 | NOT_FOUND。所有者向け他人のIDも同じ |
| 409 | RESULT_MISMATCH、BASIS_MISMATCH、DRAFT_CHANGED、IDEMPOTENCY_CONFLICT、ALREADY_CONSUMED |
| 410 | PREVIEW_EXPIRED、PUBLICATION_WITHDRAWN。本文に過去の結果を含めない |
| 422 | MODEL_UNSUPPORTED、BASIS_UNSUPPORTED、RULESET_NOT_ISSUABLE、SKILL_NOT_ISSUABLE |
| 429 | RATE_LIMITED。Retry-Afterを返す |
| 503 | ISSUANCE_DISABLED、SIGNING_UNAVAILABLE、STATUS_UNAVAILABLE。状態不明を有効扱いしない |

所有者の操作はサーバー側で認可する。ブラウザcookie経路にCSRF・Origin検査、プラグインにaudienceとscopeを限定した資格情報を適用する。GETで更新しない。秘密情報をURLやCLI引数へ入れない。認証情報や本文を含むURLへのredirectを行わない。

## 8. 公開Webと検証

### 8.1 最小画面

| 画面 | 必須内容 |
|---|---|
| `/e/:share_id` | 固定結果、TEST・PARTIAL、品質集計、対象作業・除外、基準と規則、署名確認、発行元・日時、JSON取得、表示時換算 |
| `/verify/:certificate_id` | 最小限の発行記録と現在状態。非公開化した金額・説明は表示しない |
| `/manage/publications/:share_id` | ログインした所有者の状態確認・公開停止。元会話を失っても停止できる |
| 公開JSONのローカル検証 | ブラウザ内ファイル読込またはCLI。JSON自体をサーバーへアップロードしない |

公開ページは署名データを唯一の固定結果ソースとし、別途保存した表示値を正本にしない。JSONを受け取るクライアントはSchema/hash/署名を検証する。Web側にも検証結果を表示し、実ブラウザで検証する。検索一覧・sitemap追加は初版に含めず、`noindex`を設定するが、秘密のページとは説明しない。OGPは共通のサービス説明と画像だけにし、固有の数値・説明画像を生成しない。印刷は証明書IDと公式検証URLを含むHTML/CSSとし、サーバーPDF生成は不要とする。

### 8.2 表示時換算

公開DisplayQuoteは`schema_version,certificate_id,signed_object_hash,conversion_policy_version,quoted_at,locale,display_currency,person_days,localized_reference,fx,limitation_codes,signed`のみ。schema_version=`oes/public-display-quote/v1`、conversion_policy_version=`frb-display-time-v1`、signed=false固定。quoted_atは既存displayed_atに対応する。person_daysは固定basisの未丸め人時÷8を既存規則で丸めた派生表示。非公開`source_report_hash`等をspreadしない。

localized_referenceは`{status,currency,currency_per_usd,amount}`で、statusはAVAILABLE／UPSTREAM_UNAVAILABLE／FX_UNAVAILABLE／FX_STALE。AVAILABLE時だけrateとamountを埋め、他はnullとする。person_daysとamountはp25／median／p75の十進文字列、未算出時はobject全体がnull。fxはnullまたは既存FxSnapshotの`currency,source_url,source_sha256,observed_on,published_on,fetched_at,checked_at,raw_value,quote_direction,currency_per_usd`だけとする。source_urlはサーバーのFRBカタログ値、source_sha256は公開FRB資料のhashであり私有入力のhashではない。limitation_codesは既存計算・FXの既知enumのみとし、任意の例外文を含めない。

金額は同じ固定basisとCFPの未丸め値から既存規則で計算し、表示済みUSD額へ二重に丸めを加えない。FXの基準日・取得日時・鮮度・出典・失敗状態を示す。取得失敗で固定証明書を変更せず、換算額だけ算出不可にする。「円額は閲覧時換算で署名対象外」と表示する。過去証明書に最新のbenchmarkやwageを適用しない。

### 8.3 検証結果の分離

ローカル検証は`schema: VALID|INVALID`、`hash: MATCH|MISMATCH`、`signature: VALID|INVALID|UNKNOWN_KEY`、`issuer_trust: TRUSTED|UNTRUSTED`を返す。オンライン状態は別に`registration,certificate_state,publication_state,key_state,status_checked_at`を返す。接続失敗・DB障害・世代不明はUNKNOWNである。

status APIは`certificate_id,signed_object_hash,key_id,registration,certificate_state,publication_state,key_state,status_generation,status_checked_at,reason_code`だけを返す。registrationはREGISTERED／NOT_FOUND／UNKNOWN、certificate_stateはACTIVE／REVOKED／UNKNOWN、publication_stateはPUBLIC／WITHDRAWN／UNKNOWN、key_stateはACTIVE／RETIRED／REVOKED／UNKNOWN。未知IDは404、基盤障害は503でUNKNOWN。失効理由は固定公開enumのみ。数値や説明、入力コミットメント、所有者は返さない。

未登録・障害で取得できないhash／key_id／世代はnull、理由なしのreason_codeもnullとする。reason_codeは§9.2の失効理由にNOT_FOUND／STATUS_UNAVAILABLE／STATUS_GENERATION_MISMATCH／KEY_STATUS_UNKNOWNを加えた固定enumだけを使う。オフラインEnvelopeとの照合では、状態応答のID・signed_object_hash・key_id・世代の一致も検査する。存在する別証明書のACTIVE応答で対象の状態を代用しない。

署名が一致しても、発行記録なし・鍵失効・証明書失効・世代不明の場合は「現在有効な発行記録を確認」と表示しない。WITHDRAWNだけでは暗号署名をINVALIDにしない。オフラインでは最新状態を「未確認」とする。

## 9. 永続化・公開停止・失効

### 9.1 最小テーブルと原子性

| 論理テーブル | 保存するもの |
|---|---|
| certificate_previews | 所有者、承認用draft/hash、期限、予約ID、消費状態。モデル・nonceなし |
| approval_receipts | 所有者、operation、draft_hash、期限、信頼した承認経路、消費先受付ID |
| certificates | 証明書ID、署名対象hash、鍵ID、発行時刻、状態、世代。最小検証記録 |
| publications | share_id、certificate_id、所有者、公開状態・日時 |
| publication_contents | 公開中のCertificateEnvelope。publicationと1対1 |
| issuance_receipts | 所有者、冪等キー、受付fingerprint、確定ID・結果。秘密入力なし |
| signing_keys / issuance_policy | 鍵の公開定義・現在状態、発行可否・policy世代。秘密鍵なし |
| audit_events | 操作ID、主体の内部ID、対象ID、固定イベントコード、時刻。本文なし |

認証基盤のユーザーデータは別管理とする。`(owner_id,idempotency_key)`、preview消費、approval消費、certificate_id、share_idに必要な一意制約を設ける。発行確定は、未消費承認・未期限切れpreview・有効鍵・policy世代をDB内で検査し、承認消費、証明書、公開内容、公開状態、受付、監査を1トランザクションで保存する。

署名はトランザクション前のメモリ内で生成してよいが、DB確定前に外部へ返さない。競合の負け側の署名・IDを返さない。条件付きUPDATEの0件を成功扱いしない。D1ではprepared statementsのbatchと制約／検証statementで全体を失敗させる構成を採用し、独立した複数リクエストを擬似トランザクションにしない。[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

### 9.2 停止・失効

公開停止は所有者の操作。PUBLIC→WITHDRAWNは初版では終端とし、同じshare_idを再公開しない。再公開・訂正は新しいプレビュー・承認・IDで行う。停止トランザクションでpublication_contentsと残存previewの公開内容を削除し、最小検証記録を残す。サーバーからの証明書再ダウンロードも停止し、所有者は保存済みのローカルバンドルを使う。

証明書失効は運営の操作で、署名対象JSONの書換えではなく現在状態の変更とする。理由enumは`ISSUER_ERROR`、`OWNER_REQUEST`、`ABUSE`、`KEY_COMPROMISE`。初版は証明書失効と同時に公開も停止する。鍵失効の場合は、その鍵の全証明書を状態照会・配信時に失効相当として扱い、順次の個別更新が終わるのを待たない。

公開停止・失効後は詳細HTML、JSON、換算、OGP固有情報、印刷用経路のすべてから数値・説明を配信しない。状態確認は主DB相当の最新整合性で行い、CDN・ブラウザ・アプリの古い成功キャッシュや304で旧結果を再利用させない。公開ページにService Workerの結果キャッシュを設けない。ダウンロード済みファイル・スクリーンショット・第三者の保存物・既存バックアップからの即時消去は保証しない。

### 9.3 保存期間の初期案

previewは15分で失効し、期限後1時間以内の定期処理で内容を削除する。発行成功時にもpreviewの内容を削除し、消費IDとhashだけを残す。承認証跡は操作との対応に必要な最小情報へ縮小する。発行receiptと最小検証記録はサービス提供中の重複防止・状態確認のため保持する設計案とする。技術監査ログは30日を初期案とする。

保存期間、アカウント削除時の最小記録の扱い、バックアップ保持はG3で運営方針を確定して公開する。上記初期案を、法令要件・利用者との契約・既に運用中の方針とみなさない。

## 10. 鍵と復旧

### 10.1 鍵管理

Ed25519秘密鍵はWorker secretで保持する。環境ごとに別鍵・key_idを使い、Git、公開ディレクトリ、ZIP、ログ、チャット、DBに保存しない。鍵生成・公開鍵抽出・secret登録・検証の手順をスクリプト化し、通常利用者へ鍵管理を求めない。運営用の復旧コピーを保持する場合の保存先・権限はG4で定める。[Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

鍵状態はACTIVE／RETIRED／REVOKED。ACTIVEのみ新規署名可能。通常ローテーションでは旧鍵をRETIREDとし、旧公開鍵とその発行記録の検証は継続する。RETIREDから再発行に使わない。漏えい疑いではREVOKEDにし、署名一致と現在の信頼状態を分けて表示する。署名時刻は自己申告時計なので、漏えい鍵で作られた「古い日時の署名」をそれだけで救済しない。

### 10.2 障害

署名鍵未設定・署名失敗・DB失敗では発行しない。未署名の成功レスポンスへ降格しない。鍵漏えい疑いでは新規発行を停止し、鍵を失効させ、公開状態照会で反映し、securityページの窓口で案内する。既発行データの再署名・内容変更を自動では行わない。

### 10.3 DB復旧による状態巻き戻りの防止

初版は独立した履歴保管サービスを増やさず、復旧時は保守的に停止する。`status_generation`をD1バックアップとは別のWorker設定で保持し、発行時に証明書とDBへ記録する。

DBを過去へ復元する際は、先に外部配信・発行を停止し、Worker設定の世代を新しい乱数値へ更新してから復元する。現在世代と一致しない記録は、署名が一致しても「現在状態不明」とし、詳細を配信しない。復元したDBの世代値をそのままWorker設定へコピーしない。全読み取り経路で検査する。

この方式では、巻き戻り前の公開停止が無断で復活することを避ける代わりに、旧世代の証明書全体がオンライン状態未確認になり得る。必要な再発行は利用者の新しい承認で行う。元の最新状態を完全復元できる保証はない。復旧後も全件の状態を維持する要件が必要になれば、独立した耐久的な停止・失効記録を別工程で追加する。G4でこのトレードオフを確認する。

## 11. ローカル再現用バンドル

新しい私有の成果物として、FrozenInput、nonce、公開CertificateEnvelope、承認したdraft、使用した公開CalculationBasis、規則定義、engine配布物の識別情報をまとめる。既存runへ後書きせず、別のsubmissionディレクトリへ保存する。元runとの対応はローカルreceiptだけに保持する。バンドルは自動公開しない。

検証CLIは、署名・input_commitment・basis/hash・規則revisionを照合し、固定した数値計算実装で結果を再現する。ネットワークなしで再現可能な必要ファイルを同梱するか、検証済み配布物をローカルに保存する。任意URLから実行コードを取得して実行しない。過去規則の現在の発行可否と、過去計算の再現可否は分離する。

再現成功は「この入力と基準から同じ結果が出る」ことを示す。ソースや意味解釈の正しさを証明するものではない。バンドル喪失時にサーバーから元入力を復元する機能は提供しない。

## 12. 負荷・運用の最小構成

初期値として、所有者ごとにpreviewは1分5件、発行は1日20件、同時の未消費previewは5件までとする。値は運営設定で変更できる。IPだけを所有者の代替にしない。集計カウンターは期限付きとし、発行受付の一意制約と組み合わせる。公開読み取りにはエッジのrate limitを適用し、超過時に過去の成功レスポンスで代替しない。

署名ごとのLLM・FX取得、専用PDF・個別OGP生成、数値モデル保管を行わない。公開basis・静的UI・不変の公開鍵定義をキャッシュし、現在状態と結果配信はキャッシュしない。全体の発行停止flag、日次上限、Cloudflareの費用通知を用意する。認証・メール・rate limit機能の利用可能枠と費用は実装前に確認し、予算値はG5で設定する。

## 13. 公開前提と完了条件

| ID | 公開前に決める／確認すること | 本書での扱い |
|---|---|---|
| G1 | Google／メールの認証基盤、プラグイン関連付け、アカウント回復 | adapterまで実装可能。実サービスの選定・秘密情報設定は別途確定 |
| G2 | 会話の本人承認をサーバーが検証できる経路 | 実ホストで検証必須。不成立なら一回のWeb承認案を判断 |
| G3 | 保存期間・退会・バックアップからの消去時期 | §9.3は提案値。公開説明と設定を確定 |
| G4 | 運営担当・鍵の復旧方針・世代切替による保守的なDB復旧 | 手順と停止／復旧の受入が必要 |
| G5 | Cloudflare権限・環境・D1・予算通知と停止上限、連絡窓口 | 法人名と連絡先URLは指定済み。実設定・窓口追記は別作業 |
| G6 | skill／rules登録、数値モデルv2の受信、実ホストでの全経路 | ローカルの版・テストだけで本番対応済みとしない |

署名方式や基準の選択を利用者へ毎回問う運用にはしない。G1〜G6は開発者・運営側の初回整備事項である。未解決の間も独立した実装とローカル試験は進めるが、`ISSUANCE_ENABLED=false`を維持する。

本仕様の完了条件は、入力検査、サーバー再計算、内容に結び付いた承認、原子的な発行・公開、署名の独立検証、公開停止・失効・障害時の非配信、ローカル再現、実ホストとWebの受入が揃うこと。詳しい作業範囲・テスト・段階別完了条件は実装指示書で定める。
