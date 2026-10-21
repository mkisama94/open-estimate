# 公開用結果データ生成 — 仕様・実装指示書

作成日：2026-10-20 JST  
対象基準：Open Estimate 0.8.1  
状態：実装指示。本文に記載した新機能・契約・受入試験は未実装。公開API・認証・署名の仕様確定を意味しない。

## 1. 目的と完了条件

検査済みローカルrunから、第三者に提示可能な数値・品質集計だけを持つ公開候補JSONを決定的に生成する。元runを変更せず、公開候補の確認と後続のAPI設計に使える成果物を作る。

本工程の完了は「公開候補をローカル生成・検証・再読込できること」。送信、サーバー保存、公開URL発行、同意取得、署名、Web画面、為替取得は実装しない。生成成功を公開成功と表示しない。

公開の可否は後続サービスが判断する。本工程ではCOMPLETE／PARTIAL／UNSUPPORTED／INCOMPLETEすべてを表現する。未算出を0に置換しない。COMPLETEは独立監査済みを意味しない。

## 2. 現行実装との関係

- `src/local/runs.ts` の `readRun` でチェックサムとAssessmentの整合を確認する。`show-run`全体や`summary.json`を公開JSONとして返さない。
- `src/core/records.ts` の `recordState`、`src/core/measure.ts`、`src/core/evaluation.ts` の既存判定・計算を利用する。新しいCFP判定や換算係数を作らない。
- `src/remote/model.ts` の数値モデルは送信契約であり、公開用データではない。本工程で変更しない。
- 旧`contracts/public-estimate.schema.json`と`src/core/public-estimate.ts`は証明書前提の別契約として保持する。今回のJSONを旧型へ型アサーションで押し込まない。
- 0.8.1 ZIP、元run、既存比較結果、既存ハッシュは書き換えない。実装時の配布版更新は別工程とする。

## 3. 入出力と信頼境界

### 3.1 ローカル入力

新CLIコマンド：`prepare-public-result`。stdinは`{run_id}`のみ。未知キーを拒否する。run_idは既存UUID規則に従い、呼出側から任意のrunディレクトリを指定させない。

内部入力は検査済みAssessment、保存時の`summary.calculation.basis`、保存時のmeasurement／effort／reference_usd。呼出側が与えた合計値、remote応答、最新の既定プロファイルを正本にしない。

初版の対応入力はAssessment v2＋`oes/quality-records/v1`＋対応する0.8.1品質計算basis。旧形式・品質記録不足・未対応engine／mappingは明示エラーにする。欠けた記録を0やCOMPLETEで補わない。旧成果物の読み取り機能自体は変更しない。

保存basisは既存のTESTプロファイル構造を厳密検査し、既知のengine／mapping版との組合せを許可する。保存basisで再計算し、保存時のmeasurement／effort／reference_usdとJCS比較する。不一致なら候補を生成しない。現在の係数への更新は別の新runとして行う。

### 3.2 三つの成果物を混ぜない

| 成果物 | 用途 | 外部送信・公開 |
|---|---|---|
| PublicResultCandidate | 数値・品質集計の候補 | 後続の明示確認とAPI契約が成立した後だけ許可 |
| LocalProjectionReceipt | 元run、元ハッシュ、生成時刻、候補ハッシュとの対応 | ローカル専用 |
| PublicMetadata | アプリ名・紹介文・公開者名等 | 本工程では生成しない。後続の利用者入力・確認対象 |

元scope.description、機能名、未解決点の自由文から公開紹介文を自動転記・AI要約しない。初版の対象範囲説明は、固定注意文と数値集計のみ。具体的な公開用範囲説明の入力は後続メタデータ契約で定める。

## 4. PublicResultCandidate契約

新Schema：`contracts/public-result-candidate.schema.json`。すべてのobjectで`additionalProperties:false`。下表のフィールドを必須とし、欠落とnullを区別する。

| フィールド | 型・内容 |
|---|---|
| schema_version | 固定`oes/public-result-candidate/v1` |
| projection_version | 固定`oes/public-result-projection/1.0.0` |
| measurement | status、cfp、counts。countsはentry／exit／read／write／total_processes／accepted_processes。既存計算結果を明示コピー |
| quality | §5の集計。自由文・元ID・パスを持たない |
| calculation | environment=`TEST`、effort_scope_id=`oes-design-implementation-test-v1`、hours_per_day=8、basis、effort、reference_usd |
| assurance | input=`CLIENT_REPORTED`、calculation_check=`LOCAL_RECOMPUTED_MATCH`、semantic_assessment=`NOT_INDEPENDENTLY_VERIFIED`、signed=false |
| limitation_codes | §6の固定enum配列。重複なし、辞書順 |

公開候補にはshare_id／certificate_id／issued_at／published_at／公開URLを付けない。非公開Report hash、Assessment hash、run_id、manifest hash、numeric_model_hash、workspace_hash、実行者、実行日時、対象repo情報も入れない。

`calculation.basis`はprofile_set_id、engine_version、mapping_version、benchmark、wageのみ。benchmarkはid／is_test=true／sample_size／min_cfp／max_cfp／hours_per_cfp、wageはid／is_test=true／hourly_wage_usdのみ。ID・版は実装が承認する公開カタログ値との完全一致で検査する。任意の文字列をID欄に通さない。対応カタログにない保存基準は`PUBLIC_BASIS_UNSUPPORTED`。架空の出典・実績分布の説明を補わない。

effortとreference_usdは既存結果の構造・状態enumを維持し、各フィールドを明示コピーする。数値は既存の十進文字列。非負・有限・通常十進表記を検査し、nullは既存の未算出規則に従う。AVAILABLE時は四分位値すべて必須でp25≦median≦p75。工数・金額・内訳の意味検査は再計算結果との一致で担保する。

人日・円額・FX・DisplayQuoteはこの固定候補に含めない。後続の公開表示用換算で、同じ固定basisと未丸め値から既存計算規則を用いる。現在のDisplayQuoteをspreadしない。非公開source_report_hashを除き、公開候補の識別情報に結び付ける契約は次工程で定める。

## 5. 品質集計の定義

qualityの必須キー：record_format=`RECORDED_V2`、quality_version=`oes/quality-records/v1`、analysis_complete、scan_complete、provisional_process_count、provisional_cfp_subtotal、unresolved_process_count、candidate_counts、unread_counts、unknown_boundary_counts、partial_reason_codes、record_gap_codes。

- analysis_complete／scan_completeはrecordStateの同名値。取得完了と測定完了を混同しない。
- provisional_process_countはprovisional_processesの件数、小計はprovisional_cfp_subtotal。小計はCFP合計の内数であり、誤差幅でも追加工数でもない。0≦小計≦cfpを検査する。cfp=null時は暫定計上0件・小計0のみ許容。
- unresolved_process_countはAssessmentのstatus=unresolved件数。未確定規模は算出せず、この件数からCFPを推定しない。
- candidate_countsはidentified／counted／outside／merged／unresolvedのみ。recordStateの各件数をコピーする。候補とプロセスの件数を同一視しない。
- unread_countsはin_scope／outside／supporting／scope_unknownの4項目。recordStateの対応配列の長さをコピーする。in_scopeは実装上、範囲内だが取得除外されたものも含むため、表示は「範囲内の未確認ファイル」とする。scope_unknownは未読に限らない範囲所属不明件数。4項目の単純合計を総未読件数にしない。
- unknown_boundary_countsはrerun／continuation。quality.boundariesの各unknown件数。両方unknownのプロセスは双方へ1件ずつ計上する。和をプロセス総数として扱わない。
- partial_reason_codesはrecordState.partial_reasonsを下表で固定コードへ変換し重複排除・辞書順にする。コロン以降を公開しない。汎用的な「コロン前なら何でも許可」は禁止。

| 入力の完全一致コードまたは認識済みprefix | 公開コード |
|---|---|
| SCAN_INCOMPLETE_SCOPE_IMPACT_UNKNOWN | SCAN_SCOPE_IMPACT_UNKNOWN |
| ACQUISITION_IN_SCOPE: | ACQUISITION_IN_SCOPE |
| ACQUISITION_UNKNOWN: | ACQUISITION_SCOPE_UNKNOWN |
| BOUNDARY_RERUN_UNKNOWN: | BOUNDARY_RERUN_UNKNOWN |
| BOUNDARY_CONTINUATION_UNKNOWN: | BOUNDARY_CONTINUATION_UNKNOWN |
| IN_SCOPE_UNREAD: | IN_SCOPE_UNCONFIRMED |
| FILE_SCOPE_UNRESOLVED: | FILE_SCOPE_UNRESOLVED |
| CANDIDATE_UNRESOLVED: | CANDIDATE_UNRESOLVED |
| PROCESS_CANDIDATE_MISSING: | PROCESS_CANDIDATE_MISSING |
| JUDGMENT_RECORDED:／JUDGMENT_PROVISIONAL:／JUDGMENT_UNRESOLVED: | JUDGMENT_PENDING |
| DATA_GROUP_UNCONFIRMED: | DATA_GROUP_UNCONFIRMED |
| PROCESS_UNRESOLVED: | PROCESS_UNRESOLVED |
| COMPONENT_SCOPE_IMPACT: | COMPONENT_SCOPE_IMPACT |
| FINDING_OPEN: | FINDING_OPEN |

record_gap_codesも明示辞書を使用する。`EVIDENCE_INSUFFICIENT:<id>`と`EVIDENCE_MISSING:<id>`だけを`EVIDENCE_INSUFFICIENT`へ、`PROCESS_CANDIDATE_MISSING:<id>`は同名固定コードへ変換する。品質欠落・旧形式は入力段階で拒否する。未知の理由・gapは黙って消さず`PUBLIC_REASON_UNSUPPORTED`で停止する。

件数とCFPは非負の安全な整数、cfpのみ既存状態に応じてnullを許可する。公開コード配列は固定enum・uniqueItemsを設定する。認識済みprefixの後ろが空の理由は不正入力として拒否する。

quality_warnings、acquisition_limitations、pending_judgments、excluded_candidates、未解決点の本文は出力しない。必要な注意文は公開コードから固定辞書で表示する。取得・本番稼働上の注意を独自に測定PARTIALへ昇格させない。

境界unknownが1件以上ならCOMPLETEを許容しない。測定状態は既存計算の結果を維持し、UNSUPPORTED／INCOMPLETEをPARTIALに書き換えない。COMPLETE時にpartial_reason_codesが残る等の矛盾はエラーとする。

## 6. 注意事項と表示側への契約

limitation_codesの初版enumは、TEST_DATA_ONLY、AI_SEMANTICS_UNVERIFIED、COMMUNITY_CLAIMS_UNATTESTED、REFERENCE_NOT_MARKET_VALUE、PARTIAL_MEASUREMENT、BENCHMARK_UNAVAILABLE、BENCHMARK_OUT_OF_RANGE、WAGE_UNAVAILABLEに限定する。保存結果に未知コードがあれば`PUBLIC_LIMITATION_UNSUPPORTED`。TEST_DATA_ONLYは算出不能時も必須。PARTIAL_MEASUREMENTはstatus=PARTIAL時に必須。

表示側は「TEST係数・TEST時給による参考試算」「AIの意味解釈は独立検証していない」「対象として計上した機能のみ」「未署名」を明示する。PARTIALの理由、暫定小計の内数性、未採用機能の規模が未確定であることを隠さない。TEST四分位を実績の分布・信頼区間として説明しない。これらはページ・共有文・印刷・OGP共通の後続受入条件とする。

## 7. 実装構成と処理順

追加ファイル：

- `src/core/public-result.ts`：型、許可リスト、純粋な投影関数、意味検査。Node fs・ネットワーク・時計に依存させない。
- `src/local/public-result.ts`：run読込、対応版確認、保存basis再計算・照合、候補とreceiptの保存。
- `contracts/public-result-candidate.schema.json`：公開候補Schema。
- `tests/unit/public-result.test.ts`、`tests/integration/public-result-cli.test.ts`。

既存変更は`src/local/cli.ts`のコマンド分岐とcapability、契約生成・配布スクリプトで必要な同梱、利用手順の追記に限定する。新capability名は`local_public_result_candidate:true`。`publishing:false`を維持する。既存appendOperationのkindを無理に流用しない。

処理順：①入力Schema→②readRun→③対応形式と保存basis検査→④保存basisで再計算・数値一致→⑤recordStateから品質集計→⑥全フィールドを明示構築→⑦公開Schema・意味検査→⑧JCSハッシュ→⑨ローカル保存。

候補ハッシュは`jcsSha256({domain:"oes/public-result-candidate-hash/v1",candidate})`。候補自身にハッシュを埋め込まない。receiptにrun_id、元assessment_hash、元checksums_hash、candidate_hash、projection_version、generated_atを保存する。時刻やランダムIDは候補に含めず、同一入力・同一投影版なら候補とhashを同一にする。

保存先は既存runsRootの兄弟ディレクトリ`public-result-candidates/<新UUID>/`とする。既存privateDirectory・安全パス検査・排他的作成・完了マーカー方式を再利用し、元run配下は変更しない。candidate.jsonとlocal-receipt.jsonを別ファイルにし、成功応答は全ファイル保存後だけ返す。失敗時の不完全成果物を完成済み扱いしない。

CLI応答は`status:LOCAL_CANDIDATE_READY`、candidate_path、receipt_path、candidate_hash、transmitted:false、published:false。receiptや元runを公開候補ファイルへ混ぜない。ネットワーク呼出しを追加しない。

## 8. エラーと漏えい防止

新規エラー：PUBLIC_SOURCE_UNSUPPORTED、PUBLIC_BASIS_UNSUPPORTED、PUBLIC_RESULT_MISMATCH、PUBLIC_REASON_UNSUPPORTED、PUBLIC_LIMITATION_UNSUPPORTED、PUBLIC_CANDIDATE_INVALID、PUBLIC_CANDIDATE_WRITE_FAILED。既存runエラーは意味を維持する。

ログ・stdoutのエラーには固定codeと固定メッセージのみ。入力値、元パス、根拠本文、Ajvエラーの入力断片を返さない。成功時のローカル保存先はローカルCLI応答にのみ許容する。

禁止：オブジェクト全体のspread、JSON.stringify後の文字列置換による秘匿、任意自由文の自動要約、元IDの単純ハッシュ化による公開。許可フィールドから新規構築する。公開候補は集計情報を含むため機密性がないとは断言せず、生成しただけで送信同意が得られたと扱わない。

## 9. 必須受入試験

| ID | 確認内容 |
|---|---|
| P01 | 正常runの候補がSchema・意味検査を通り、CFP・E/X/R/W・工数・USDが保存結果と一致 |
| P02 | rerunだけ／continuationだけ／両方unknownの妥当な暫定入力でPARTIALと該当コード・件数・暫定内数を保持 |
| P03 | 計上済み＋未解決プロセス、未解決候補、範囲内未確認・範囲外未読を区別。候補数から架空CFPを作らない |
| P04 | UNSUPPORTED／INCOMPLETE／換算未提供でnullと状態を保持。0表示へ変換しない |
| P05 | 名前・パス・symbol・根拠・scope説明・未解決文・元IDに識別用canaryを入れても、候補全体とエラー出力に出現しない |
| P06 | 未知キー・未対応basis・旧形式・品質欠落・未知理由／制約コードを明示拒否 |
| P07 | チェックサム不一致と、チェックサムを整えた保存数値の不整合をそれぞれ拒否 |
| P08 | 最新既定profileを変えても対応済み保存basisから同じ結果を生成。未対応の旧計算版は再計算で書き換えず拒否 |
| P09 | 同じ入力を別時刻に生成して同一candidate/hash。receipt時刻や出力UUIDだけが変わる |
| P10 | 元run全ファイルのbytes/hashが不変。ネットワーク呼出しが0回。published/transmittedがfalse |
| P11 | 実CLIで保存→再読込→Schema/hash検査。書込み失敗時に成功応答・完了マーカーが出ない |
| P12 | 入力オブジェクトを変更しない。数値の負値・非有限・矛盾した四分位・COMPLETEとunknownの共存を拒否 |

型検査、上記単体・CLI試験、既存品質・比較・run保存・リモート投影の回帰を実行する。配布変更時はビルド・同梱物・移設CLIを確認する。本番API送信やデプロイは本工程の検証に含めない。

## 10. 次工程への引渡し

実装報告には生成例（COMPLETE／PARTIAL／未算出）、候補Schema、公開項目一覧、canary検査、元run不変性、実行コマンドと試験結果を添付する。

後続APIは候補を受け取っただけで検証済み・公開済みにしない。サーバー再計算、ローカル候補との照合、公開用メタデータ、承認対象hash、所有者認証、公開状態・取り下げ、公開用DisplayQuote、サーバー側記録との対応は別仕様とする。候補のsigned=falseは証明書を将来不要と決定するものではない。
