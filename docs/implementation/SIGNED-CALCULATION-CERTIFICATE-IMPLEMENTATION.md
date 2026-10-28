> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# Open Estimate 計算証明書 — 実装指示書

作成日：2026-10-20 JST  
対象：0.8.1と、作業ツリー上の公開候補生成実装を基点とする次版  
状態：実装指示。以下の追加ファイル・コマンド・受入結果はまだ存在／合格を前提にしない。  
正本：[サーバー再計算・電子署名仕様](SIGNED-CALCULATION-CERTIFICATE-SPEC.md)

2026-10-21追記：ログイン受入後に先行する「ローカル結果から所有者限定Webプレビューまで」は、[新システム仕様](SYSTEM-SPEC.md)で具体化する。同書の範囲ではpreview専用gateとsubmission単位の短期関連付けを使い、発行・一般公開を無効に保つ。

## 1. 実装する成果

公開候補をローカルで確認した利用者が、サーバーで再計算された結果を承認し、**AI Orchestration Inc.の電子署名付き計算証明書と公開URLを取得できる状態**を作る。第三者はWebで結果・限界・署名・現在状態を確認し、所有者は元の会話に依存せず公開を停止できるようにする。

計算コアだけ、署名関数だけ、画面モックだけの完成を一連の機能完成と報告しない。ローカル実装、テスト環境、実ホスト、本公開の完了を分ける。認証・本人承認が未確定でも独立部分は実装できるが、未確定部分をダミーで埋めて公開しない。

仕様書§13のG1〜G6は公開前提である。本指示は、本番デプロイ、公開MCPへの実データ送信、利用者データの公開、課金サービス契約、秘密鍵のチャットへの提示を依頼するものではない。

## 2. 現在のコードと変更範囲

### 2.1 開始時に確認すること

`git status --short`と作業差分を読み、進行中の公開候補生成実装を保持する。2026-10-20時点では、`src/core/public-result.ts`、`src/local/public-result.ts`、候補Schema、CLI、contracts生成、テスト、関連文書に作業ツリー上の追加・変更がある。これは旧ZIPの内容を示すものではない。実装開始時に現状を再確認する。

既存0.8.0／0.8.1 ZIP、保存run、受入記録、比較用成果物を変更しない。新しい配布物は未使用の版を採番し、既存配布物とは別ファイルにする。

### 2.2 再利用と切り出し

| 現行ファイル | 作業方針 |
|---|---|
| `src/core/public-result.ts` | 候補Schema、数値・品質の意味検査、許可リストを再利用。候補の`signed:false`は維持 |
| `src/local/public-result.ts` | 元runを変えない候補生成を保持。新しいsubmission管理へ接続 |
| `src/remote/model.ts` | 数値モデル検査・再計算を外部通信のない関数へ抽出し、MCPと発行APIで共用 |
| `src/remote/measurement-rules.ts` | 規則登録・版の検査を利用。過去計算再現と新規発行可否を分離 |
| `src/remote/skill-integrity.ts` | 公式登録との整合検査を利用。実行・意味監査の証明に昇格させない |
| `src/core/measure.ts` / `estimate.ts` | CFP・工数・USDの規則を維持。署名用の別計算式を作らない |
| `src/core/canonical.ts` | JCSの同一規則を共用し、Node／Worker／ブラウザで一致させる |
| `src/core/display-quote.ts` | 既存十進演算・FX・未算出状態を利用。公開DTOは別の許可リストで作る |
| `src/local/runs.ts` | `readRun`による検証と保存基準を利用。入力を作るためにrunを再保存しない |
| `scripts/build-contracts.mjs` | 新Schemaの生成を追加。既存候補Schemaの変更を落とさない |
| `wrangler.jsonc` | 静的サイトにWeb API用Workerを接続。asset bindingと動的経路を明示 |
| `wrangler.mcp.jsonc` / `src/remote/worker.ts` | `/mcp`の既存機能を維持。読み取りのevaluate_modelに発行副作用を追加しない |

現行`evaluateRemote`は、再計算に加えてFXと独自report_hashを返す。関数全体を発行処理へ丸ごと呼ぶと、固定計算に外部取得が混ざる。純粋な`validateAndRecomputeNumericModel`を抽出し、その結果を両方のadapterから使う。既存report_hash／evaluation_context_hashの計算式と意味は互換性テストで保持する。ローカルreport_hashとの一致を新たな条件にしない。

## 3. 追加する構成

以下の配置を基本とする。命名を既存構成に合わせて変える場合も、依存方向と責務は保つ。

| 追加先 | 責務 |
|---|---|
| `src/core/certificate-contract.ts` | FrozenInput、ApprovedDraft、SignedObject、Envelope、状態・公開換算Schemaと型 |
| `src/core/certificate.ts` | コミットメント、draft hash、署名対象bytes、公開resultの明示構成。DB・ネットワークなし |
| `src/core/numeric-model.ts` | remote/modelから抽出する厳密検査と決定的再計算 |
| `src/core/certificate-verify.ts` | 署名・hash・入力対応・再現結果の検証。任意URLを取得しない |
| `src/profiles/certificate-basis.ts` | 承認済み基準の不変カタログ、content hashと対応表 |
| `src/web/worker.ts` | HTTP routing、assets、サイズ制限、認証、レスポンス制御 |
| `src/web/certificate-service.ts` | preview、承認検査、発行、受付回復のユースケース |
| `src/web/certificate-repository.ts` | D1の原子的更新、所有者検査、最新状態の読み取り |
| `src/web/auth.ts` / `approval.ts` | AuthAdapter／ApprovalAdapter。テスト用と本番用を明確に分離 |
| `src/web/signing.ts` | Worker secretの鍵読込・署名。private keyを他層へ返さない |
| `src/web/public-views.ts` | 署名固定結果、状態、FXを分けた公開HTML／JSONの投影 |
| `src/local/certificate-submissions.ts` | 入力・nonce・受付IDの事前保存、送信、応答回復、バンドル保存 |
| `migrations/`の新migration | 仕様書§9のテーブル・index・制約。既存DBがあれば差分migration |
| `public/`の専用JS・CSS | 公開証明書UI、ブラウザ内検証、所有者の停止画面 |
| `scripts/`の鍵・カタログ・運用スクリプト | 環境分離、公開鍵更新、ローテーション、失効・停止、受入補助 |
| `tests/fixtures/certificates/` | 合成データ、公開テスト鍵、RFC検証ベクトル。実プロジェクト入力なし |

新Schemaは`contracts/certificate-input.schema.json`、`certificate-approved-draft.schema.json`、`signed-calculation-certificate.schema.json`、`certificate-status.schema.json`、`public-display-quote.schema.json`を生成する。APIリクエスト／レスポンスも同じ定義元からSchemaを生成し、`contracts/certificate-api.openapi.json`へ反映する。未知キーの挙動・null・必須項目・エラーをOpenAPIにも記載する。旧`public-estimate.schema.json`は別契約として保持する。

既存HTMLモックのデータを実データAPIの代わりに返さない。既存キャッチコピー等の無関係な変更はしない。公開証明書のTEST・監査・署名に関する記述だけは本仕様に合わせる。

## 4. 実装順序と各段階の出口

### P0. 契約・基準の固定

1. 仕様書のフィールドをstrict Schema化する。型アサーションによる旧型への押込み、任意objectのspreadを避ける。
2. 現行TEST profileの正確な内容、対応engine契約・mapping・規則revisionを公開CalculationBasisとして固定する。IDの許可だけで数値が変えられないよう、全内容の照合とhashを実装する。
3. 本番用に存在しない係数、出典、検証実績を作らない。通常基準への拡張を暗黙に先取りしない。
4. 公開するengine manifestを作る。実際のbuild成果物にartifact_sha256を付け、source commit、計算契約、配布場所を別の公開カタログで対応付ける。私有runのhashを使わない。
5. AuthAdapter／ApprovalAdapterをinterface化する。署名・公開処理はclient指定のowner_idやapprovedフラグを受け取らない。

出口：Schemaと合成fixtureで、許可項目・拒否項目・互換性が検査できること。本番adapterが未選定でも純粋関数の実装を進める。

### P1. 数値モデル再計算と署名コア

1. 数値モデルのSchema／意味検査を切り出す。CFPの計数、partial、applicability_limit、v2未採用件数を維持する。
2. 公開候補と再計算結果の比較を、比較対象の明示列挙で行う。qualityは申告集計の整合検査に限定する。
3. Node／Workers共通で使えるJCS bytes関数を用意する。ブラウザ側へ`node:crypto`を持ち込まない。SHA-256とEd25519はruntime adapterを分けてよいがbytesは共通にする。
4. strict JSON readerで重複キー、不正Unicode、サイズ・深さ超過を拒否する。JSON.parseだけで重複キーが失われた後に「検査済み」としない。暗号方式は固定Ed25519で、入力のalgorithmに応じた任意方式へ切り替えない。
5. nonce、commitment、ApprovedDraft、SignedObject、Envelopeを実装する。署名payloadには私有の入力hashやIDを含めない。
6. 固定RFCベクトルとNode→Worker→ブラウザの相互検証を用意する。秘密鍵はテスト用固定鍵だけをfixtureへ入れ、production利用を禁止する。

出口：入力が同じなら固定結果が再現され、署名対象の1フィールド変更で検証に失敗すること。署名済みであってもTEST・PARTIAL・未算出の区別が残ること。

### P2. プレビュー・D1・原子的発行

1. APIとD1 repositoryを実装し、初期値`ISSUANCE_ENABLED=false`、`PUBLICATION_READ_ENABLED=false`を設定する。
2. previewに公開draftと承認に必要な最小情報だけを保存する。モデル、nonce、リクエスト本文をDB・logへ保存しない。preview有効期限は15分とする。
3. 発行時に所有者、期限、draft hash、nonce付きcommitment、basis、rules、engine、公開metadataの一致を再検査する。metadataを発行bodyから上書きしない。
4. 承認receiptとpreviewを一度だけ消費し、証明書・公開状態・内容・受付・監査を一括保存する。
5. 失敗時は署名JSONを返さず、DB確定後だけ201を返す。同じ受付の確定結果は200で再利用する。保存後のHTTP切断でも重複発行しない。
6. rate limit、期限切れ内容の削除、公開停止・失効・世代確認を実装する。preview件数上限は期限切れを除外し、所有者をまたいで混同しない。

確定receiptはpreview期限・承認の未消費チェックに先立って照合する。確定後の回復に再承認を要求しない。未確定receiptは初版では保存せず、受付照会の404を「発行失敗」と断定しない。同じ冪等キーを使った再試行で、進行中の発行との競合を一意制約により解決する。

**D1更新の要点**：`batch()`内の条件検査が失敗したときSQLエラーで全体をrollbackさせる。0行UPDATEをJavaScriptでbatch後に発見しても、既にcommitした他の行は戻らない。DB内triggerまたはCHECK制約付きの一時的な操作guardを利用する。guardを使う場合は、条件がfalseでも必ず1行の不正値を書こうとしてCHECKに失敗する形にし、成功時は同じbatch内でguardを削除する。「条件がfalseならINSERTが0件になる」だけでは不十分。

preview・承認・鍵状態・policy世代の検査と状態更新を同じbatchに含める。発行直前の鍵失効、同じpreviewの二重受付、同じ冪等キーの競合を実DB adapterで再現する。read replicaや独立したSELECTとUPDATEでこの検査を代替しない。D1のトランザクション保証は[公式batch説明](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)を基準にする。

出口：同時実行・途中失敗・応答喪失を含め、外部から見える発行と公開が一回だけ確定すること。

### P3. ローカル準備・送信・応答回復

新CLIを次の責務で追加する。stdinは厳密Schema、秘密情報をコマンドライン引数・標準出力へ出さない。

| コマンド案 | 入力・動作 |
|---|---|
| `prepare-certificate` | `{run_id,metadata}`。同じ検証済みrunから候補と数値モデルを作り、nonce・冪等キーを生成してsubmissionを保存。ネットワークなし |
| `preview-certificate` | `{submission_id,transfer_authorization_id}`。認証済みの送信許可を確認し、プレビューAPIへ送信。draft/hashを保存して表示 |
| `publish-certificate` | `{submission_id,approval_receipt_id}`。確定したdraftと同じ入力を再送。発行・公開を確定 |
| `resume-certificate` | `{submission_id}`。受付照会で確定状態を確認し、公開中なら同じJSONを取得してローカル保存を回復 |
| `verify-certificate` | ローカルファイルを指定して署名を検証。既定はオフライン。入力バンドルがあれば再計算も実行 |

認証tokenはOS／既存認証adapterの管理へ分離する。transfer_authorization_idとapproval_receipt_idは標準出力・診断ログへ出さない。CLIの完了出力はsubmission_id、公開URL、証明書ID、保存成否等の許可リストだけとする。

submissionの状態は`PREPARED → PREVIEWED → ISSUED`を基本にし、EXPIRED／REJECTED／WITHDRAWNも区別する。ファイルは一時ディレクトリへ書き、チェックサム・必須ファイルの検査後に完了マーカーを付ける。ネットワーク前の耐久保存が失敗したら送信しない。発行後のローカル保存失敗は「サーバー発行済み・ローカル保存未完了」と表示し、新規発行を促さない。

元runとの対応ファイルは私有とし、公開JSON・HTTPへ入れない。再現バンドルに含む計算実装は既知の配布物と照合する。入力中のURLをコード取得先として実行しない。

出口：ネットワーク切断とファイル保存失敗から、同じ証明書を回復できること。古いrunを変更せずに再現可能なこと。

### P4. 公開画面・検証・所有者の公開停止

1. 公開HTML／JSON／換算のすべてで、配信直前に現在の公開状態・証明書失効・鍵状態・status_generationを検査する。基盤障害時はUNKNOWNまたは503で止める。
2. `/e/:share_id`を署名済み固定結果から構成する。TEST・PARTIAL・未算出と、申告品質の意味を常時表示する。検証結果は署名一致／現在状態／計算の限界に分ける。
3. ダウンロードするJSONは保存したEnvelopeそのものにする。日時やFXを追記して署名対象を変更しない。
4. `PublicDisplayQuote`を仕様書§8.2の許可リストでSchema化する。私有source_report_hashを除去し、certificate_idとsigned_object_hashで対応付ける。FXの失敗で固定結果を隠したり書き換えたりしない。
5. `/verify/:certificate_id`は最小状態だけを返す。停止済み証明書の結果をこのURLやローカル検証画面経由でサーバーから再配信しない。
6. 公開鍵カタログとブラウザ内検証を実装する。未知鍵時は公式カタログを更新して再検証し、それでも未知ならUNKNOWN_KEYとする。任意issuer URLをfetchしない。
7. 所有者の最小画面は状態確認・公開停止に絞る。Cookie認証ではCSRF・Origin、全経路でowner認可、操作確認を実装する。完全な履歴一覧・編集管理UIは後続工程とする。
8. 全結果経路にno-storeを設定し、数値入りOGP、検索一覧、Service Workerの結果キャッシュは作らない。static CSS/JSと不変基準は別のcache方針にする。

出口：実ブラウザで、モバイル幅・印刷・JSON取得・署名表示・停止後の全経路を確認できること。停止後の古いブラウザ表示や保存物を遠隔消去できるとは説明しない。

### P5. 認証・本人承認・実ホストの接続

ここはG1／G2の確定後に進める。先にコードを用意する場合はテスト用adapterを明示し、productionで起動・発行できないチェックを入れる。

- AuthAdapterは検証済みprincipal、認証強度、scope、期限を返す。ownerをbodyから取得しない。
- ApprovalAdapterは信頼したユーザー操作から、主体・操作・内容hash・期限に結び付いた一度限りのreceiptを作成・検証する。通常のAPI tokenやモデルが構成した引数は本人承認として不足する。
- ホストの実際の確認UI・署名付きイベント・トークン連携等が利用可能かを実機で検証し、使った信頼境界を文書化する。存在しないホストAPIを仮定しない。
- 会話ホストだけで承認を検証できない場合は公開機能を有効化せず、一回のWeb承認に変更する判断を依頼する。会話で承認済みというテキストをreceiptへ変換する実装は禁止する。
- 同じ対象・同じ内容について既に有効な承認があれば重ねて尋ねない。内容が変わった場合だけ新しい承認にする。
- MCP経由で操作を提供する場合も同じserviceを呼び、発行・公開のwrite操作をevaluate_modelから分離する。MCPのreadOnlyHint等だけを認可の根拠にしない。

出口：実ユーザー操作がサーバーに結び付き、他人のデータ、失効・期限切れ・別内容・再利用の承認が拒否されること。Google／メールとプラグインの関連付け・回復を確認すること。

### P6. リリース・運営引渡し

1. 次版plugin、skill manifest、rulesの対応表を既存releaseスクリプトへ統合する。0.8.1の既存ZIPは再生成・上書きしない。
2. Web Worker・MCP Worker・静的assetsのroutingを確認する。`/api/v1/*`、`/e/*`、`/verify/*`、`/manage/*`、署名鍵配信はWebへ、`/mcp*`は既存MCPへ残す。未認証の静的asset fallbackから停止済み詳細が出ないことを確認する。
3. テスト／本番でDB、鍵、origin、認証client、secret、status_generationを分離する。鍵未設定やテストadapterの場合は公開を有効にできない。
4. 公開鍵を先に配布し、検証可能なことを確認してから新しい発行鍵へ切り替える。旧公開鍵は保持する。
5. securityページに発行者・証明の範囲・報告方法・公開停止／失効の説明を反映する。文案があることを公開済みと報告しない。
6. 復旧・鍵失効・受付回復・公開停止の運用手順を作り、テスト環境で演習する。
7. G1〜G6、テスト証跡、費用上限、連絡窓口の確認後、別途承認されたデプロイ工程で有効化する。

出口：版・環境・操作主体・実ホスト・実URLを記録した受入結果があり、運営が停止・失効・復旧を実行できること。

## 5. 必須受入試験

単なる実装の写しのテストを増やさず、誤発行・誤公開・誤った証明表示を防ぐケースを優先する。純粋関数はunit、D1競合・HTTP・副作用はintegration、ユーザー経路と見た目は実ブラウザ／実ホストで検証する。

| ID | ケース | 合格条件 |
|---|---|---|
| C01 | 既知モデルv1のCOMPLETE | 既存結果と一致し、固定結果から署名JSONを作れる |
| C02 | v2の未採用プロセス | 未採用数を維持しPARTIAL。triggerの捏造・v1への切詰めなし |
| C03 | unknown境界、暫定・未解決、未読・範囲不明 | COMPLETEへ昇格せず、許可された理由と集計が残る |
| C04 | 同じprofile IDで係数・sample_size等だけ改変 | BASIS_MISMATCH。クライアント値で再計算して発行しない |
| C05 | CFP・内訳・工数・USD・limitationの単独改変 | RESULT_MISMATCHまたは入力拒否 |
| C06 | 有効なUNSUPPORTED／INCOMPLETE・範囲外 | nullと状態を保持。0や成功金額で表示しない |
| C07 | qualityの合計矛盾・モデルとのanalysis_complete不一致 | 発行不可。整合する申告でも独立監査済みと表示しない |
| C08 | JSON未知キー・重複キー・不正Unicode・NaN・unsafe integer・巨大入力 | 署名前に拒否。元本文をエラー／logへ出さない |
| C09 | Unicode・キー順・改行のJCS、RFC署名ベクトル | 正しい同値変換は一致し、文字列変更は不一致 |
| C10 | Node／Worker／ブラウザの相互検証 | 同じbytes/hash/signatureを検証できる |
| C11 | 結果・注意・metadata・issuer・environment・key_id改変 | 署名検証失敗。未知キーを除去して救済しない |
| C12 | 別nonce・別モデル・別basis・別規則の再現バンドル | commitmentまたは再現結果が不一致 |
| C13 | 同梱の偽公開鍵・任意issuer URL | trustedとして検証せず、外部URLを自動取得しない |
| A01 | 未認証・他owner・メール同一の別主体 | 公開・閲覧管理・停止不可。owner情報を漏らさない |
| A02 | confirmed=true、tokenだけ、偽receipt | 承認不足で拒否。本番でtest adapter不可 |
| A03 | 別draft／別主体／期限切れ／再利用receipt | 失敗。発行も公開もされない |
| A04 | 承認後にmetadata・値・基準・規則を変更 | 新preview・新承認が必要。無断の最新値採用なし |
| A05 | CSRF、異なるOrigin、scope・audience不一致 | 更新拒否。GET・redirectによる更新なし |
| T01 | 同じ冪等キーと内容を同時送信 | 1件だけ確定。同じID・日時・署名を回復 |
| T02 | 同じキーで別内容、同じpreviewで別キー | conflict。二重発行なし |
| T03 | batch中の各保存段階へ障害注入 | 全rollback。半端なPUBLIC／消費済み承認を残さない |
| T04 | guardの条件不成立・0件UPDATE | 全rollback。commit後の件数検査だけに依存しない |
| T05 | 署名失敗、鍵未設定、DB失敗、発行途中の鍵失効 | 未署名成功なし。確定前の署名を返さない |
| T06 | 保存成功後のHTTP切断・ローカル保存失敗 | 同じ受付を回復。元nonce・入力の再生成や再発行なし |
| P01 | 公開停止後のHTML／JSON／換算／印刷／OGP／再試行 | 全経路で過去の数値・説明を返さない。304・cache復活なし |
| P02 | 停止・失効と閲覧の競合 | 確定後に開始した取得は停止状態。既配信物の消去は保証しない |
| P03 | 鍵ACTIVE→RETIRED／REVOKED | retiredは過去署名を検証可。revokedは署名一致と現在失効を併記 |
| P04 | DB／状態サービス障害・未知ID・未知鍵 | UNKNOWN／適切なエラー。有効表示に倒さない |
| P05 | 古いDBへ復元しWorkerの世代を更新 | 旧世代のPUBLICが再配信・有効判定されない |
| P06 | 不正metadata・URL・HTML・秘密canary | escape／拒否。自動fetchなし。非公開canaryが公開・log・DB入力欄に混入しない |
| F01 | FX更新、取得失敗、古いレート、丸め境界 | signed_object_hash不変。現地通貨の時点と状態だけ変わる |
| F02 | default profile更新後に旧証明書を表示 | 同じ固定basisから人日・金額を表示 |
| O01 | preview期限・削除・rate limit・全体停止 | 期限後に発行できず、内容削除と上限が機能 |
| O02 | 旧保存run・旧CLI／MCP評価・旧ZIP | 非破壊、既存契約の回帰なし、既存ZIP checksum不変 |
| H01 | 実ホストで初回関連付け→preview→承認→発行 | 送信・本人承認・公開がそれぞれ実測で成立 |
| H02 | 別ブラウザで第三者検証、owner再ログイン停止 | プラグインなしで検証、元会話なしで停止可能 |
| H03 | モバイル／印刷／支援技術による確認 | TEST・PARTIAL・署名限界・未算出が視認・読上げ可能 |

C03では公開用の理由コードだけを検査し、元プロセスID・ファイル名を公開fixtureへ混ぜない。P06では私有フィールドへ合成canaryを仕込み、HTTP response、D1、log、assets、配布ZIPを検索する。実ソースや本物の秘密をテストへ使わない。

## 6. 検証コマンドと記録

実装開始時のpackage scriptsを確認し、実在するコマンドだけを実行する。現行の基本検証は次のとおり。

```powershell
npm run typecheck
npm test
npm run build
npm run deploy:check
```

D1／Workerの統合試験、ブラウザ試験、独立検証CLIの再現試験に必要な専用scriptは本実装で追加し、その実際のコマンドを受入文書へ記録する。`deploy:check`のdry-runだけでD1・認証・本番接続を確認済みとしない。buildはdist等を更新するため、開始前後の差分を確認する。フル検証後の再試験は変更箇所と未解決の失敗に絞る。

受入結果は新しい`SIGNED-CALCULATION-CERTIFICATE-ACCEPTANCE.md`と機械可読JSONにまとめる。少なくとも次を記録する。

- 対象commit／作業差分、plugin・skill・rules・Web・MCPの版、engine artifact hash。
- テストID別の環境・日時・結果、実施コマンド、失敗と未実施。記載日時は実際の確認時刻。
- 署名検証fixtureの公開鍵ID・payload hash。秘密鍵と私有入力は受入公開物に含めない。
- 0.8.0／0.8.1既存ZIPの変更前後checksum、新版ZIPのchecksumと再読込結果。
- デプロイの有無、接続先、実ホスト名、実ユーザー操作の証跡。ローカル試験との区別。
- G1〜G6の確定状況、連絡先ページと公開鍵カタログの実URL確認結果。

## 7. 運営用に残す手順書

鍵生成・secret登録・公開鍵配布・ローテーション、証明書／鍵失効、公開停止、発行停止flag、応答喪失の回復、preview削除、費用通知、DB復旧を文書化する。既存運用に合わせ、日常の手入力や手動hash登録を増やさない。

DB復旧手順は「外部配信と発行を停止 → Workerのstatus_generation更新 → DB復旧 → 旧世代の非配信を確認 → 必要な現在設定・鍵状態を再確認 → サービス再開」の順とする。バックアップ復元だけで公開を再開しない。この方式では旧世代全体が状態未確認になり得ることを運営向けにも明示する。

鍵漏えい時は「発行停止 → 鍵失効と配信制御 → 影響確認・窓口案内 → 新鍵配布・検証 → 新規発行の再開」。既存結果を本人承認なしに新しい証明書へ置き換えない。通常ローテーションと事故対応を別のコマンド／手順にする。

## 8. 完了報告の形式

実装後は、何が動作するようになったかを先に述べ、変更ファイル、受入結果、残る制約を示す。次の四段階を別々に報告する。

| 段階 | 完了の意味 |
|---|---|
| L1 ローカル実装 | Schema・計算・署名・DB・API・画面・CLIをローカルで検証。テストadapter使用の有無を明記 |
| L2 テスト環境接続 | 隔離した実Worker／D1／認証・鍵で受入。費用・停止・復旧手順を確認 |
| L3 実ホスト受入 | 実ユーザーの送信・承認・発行と、第三者閲覧・所有者停止が成立 |
| L4 本公開 | G1〜G6の確定、運営引渡し、別途承認された本番デプロイ・公開確認まで完了 |

「全テスト通過」だけでL3／L4を完了にしない。本指示書作成時点で達成したのは仕様・実装指示の文書化であり、これらの実装段階ではない。
