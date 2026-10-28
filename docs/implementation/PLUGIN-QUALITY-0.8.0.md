> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# プラグイン品質改善 0.8.0

## 着手時の確認（2026-10-20 JST）

作業開始時は0.7.0、未コミット変更なし。0.5.0の記憶は参考に留め、現行コード・契約・スキル・配布スクリプトを確認した。

| 改善 | 既存実装 | 不足と今回の変更 | 互換性・リモート影響 |
|---|---|---|---|
| 1 走査と範囲 | v2の範囲所属・未読集計とremote投影 | snapshotに取得事実、qualityにパス規則と制限の影響。recordsで走査と測定を別導出 | 既存フラグを保存。旧データの結果は維持し、新記録不足を注意表示 |
| 2 非同期等 | boundaryの開始・ユーザー・目的・完了・実行関係 | quality.boundariesに再実行・継続・キュー境界／規則／対象移動／重複レビュー。構造検査と重複疑い注意 | ローカルのみ。単一の事実で正解モデルを自動決定しない |
| 3 台帳具体性 | 候補、判断、属性、根拠・統合先の検査 | quality.attributesに属性別の実装項目・根拠参照。曖昧な定型句・理由反復は注意 | 旧v2に推測の既定値を追加しない。意味の正しさは自動保証しない |
| 4 実装と稼働 | 所見のimpact・resolution | quality.findingsでimplementation/boundary_counting/configuration/deployment/productionを分類。後二者はexplanation必須 | 未配備だけでCFPを変えない。実装の不足は別の影響所見として保持 |
| 5 実行保存 | セッション内hash名Assessment/context、draft | runs.tsで毎回UUIDの対象外保存、実装・依存識別、checksum、最後にCOMPLETE。操作履歴は別UUID | exportのlocal.assessment_path/context_pathは永続run内へ変更。session_*_pathも返す。リモート保存なし |
| 6 要約 | recordsの理由・候補数・暫定内数とlocal report | summary.jsonに計数・TEST基準・状態・警告、操作に原応答・照合・FX。show-runで履歴確認 | ローカルとサーバー値を上書き統合しない。送信結果はCLIENT_REPORTED |
| 7 比較 | Assessment内comparisonと移動差検査 | セッション不要のcompare-runs。明示案のprocess/移動対応、判断遷移、原因複数選択、相殺と未対応 | 原成果物不変。AIの対応案と独立性未確認を明示。高度な自動対応なし |

## 契約と移行

Assessment本体は`oes/assessment/v2`を維持し、ローカル追加契約`quality.version=oes/quality-records/v1`を版管理する。qualityがある場合、input.acquisitionと全品質記録をSchema／意味参照検査で要求する。新規解析は追加契約を使用する。既存v1/v2は読取可能だが`QUALITY_RECORDS_MISSING`、旧形式では従来の記録不足も表示する。過去の入力・数値・hashへ既定値を足さない。既存改訂はhuman_amendments.previous_hash等で元を参照する。

input.acquisitionは収集器の事実。CLIはsnapshotの事実と置換照合する。discovery_complete=falseは未発見領域を含み得るためPARTIALを維持する。既知ファイルのサイズ／形式／権限制限が範囲外規則と整合する場合、その制限だけでPARTIALにしない。未読・除外をincludedへ分類した場合は不足として残す。unknownには具体的不足を要求する。範囲規則の業務上の妥当性は機械検査の保証外。

通常の数値投影は従来の`oes/remote-model/v1`。未採用かつトリガー未確定のprocessはv1では表せず、従来は総process数がローカルとずれていた。この場合だけ`oes/remote-model/v2`で`unadopted_process_count`（整数）を追加し、PARTIALのまま総数も一致させる。存在しないトリガーや移動を創作しない。受信側はv1/v2を検査し、v2にはpartial=trueとanalysis_complete=falseを要求する。送る情報の種類は数値・列挙値・真偽値のままで、quality、対象hash、パス、名称、根拠、台帳は送らない。

新クライアントの版登録およびv2受信コードの本番反映は本納品に含めない。既存サーバーがv2非対応なら応答エラーとして保存し、v1へ黙って降格しない。将来公開する際は既存の統合release経路で新スキル登録と対応Workerを同時に反映する。中央ルールの互換性宣言v1は従来の数値モデル経路について維持し、CLI contractにv1/v2両形式を明示する。

## 保存と操作

標準保存先はユーザーホームの`.open-estimate/runs/<UUID>`。`OES_RUNS_ROOT`で変更可能。対象repo配下は拒否する。セッションキャッシュとrun保存先を混同しない。runは期限なし、自動削除なし、purge対象外。利用者が不要なUUIDフォルダーを削除する。ソースコピーやツール全体コピーは必須成果物に含めず、本版では追加保全コピー機能を実装しない。

run.json、manifest.json、assessment.json、ledger.json、validation.json、model.json、summary.json、context.json、implementation.json、checksums.json、COMPLETE.jsonを保存する。run.jsonに開始・終了・保存日時、対象と改訂、モデル申告元、実スキル本文hash、スキルパッケージ申告hash、実行distのhash、同梱ファイル群のhash、lock hashと実インストール依存版・metadata hashを分ける。implementation.jsonはhash一覧でソースのコピーではない。checksumは署名ではなく、全ファイルを整合するよう書き換えた虚偽を防ぐ保証ではない。

保存はUUIDディレクトリを排他的に作り、全ファイルをwxで新規作成し、checksum後にCOMPLETEを作る。失敗したディレクトリは救出用に残るがCOMPLETEがなく、show-run／比較は拒否する。既存ディレクトリやsymlink/junctionへ書かない。セッションのcontent-addressed記録も既存内容との一致を検査する。

全CLI入力はstdin JSON。以下は引数の形であり、シェルに本文を直接展開しない。

```json
{"run_id":"<UUID>"}
```

`show-run`は元summaryと検証済みoperations／execution_historyを返す。元summaryのremote=NOT_SENTは保存時点を意味する。送信後の状態は個別操作に保持する。セッションが期限切れでも削除済みでも利用できる。

`record-remote`: run_id、status=SUCCESS/FAILED、response（ツール応答原本、structuredContentも対応）、失敗時error、再表示ならkind=displayを渡す。ネットワーク操作そのものは行わない。原応答のmeasurement／effort／reference_usdを保存ローカル値と照合する。CLIENT_REPORTEDであり送信の第三者証明ではない。毎回operations/<操作UUID>/operation.jsonとCOMPLETEを保存し、以前の応答・表示為替を維持する。

`compare-runs`: before_run_id、after_run_id、process_changes、movement_changes、judgment_transitions、prior_information_consulted（真偽）、proposal_source。changesはkind=add/delete/merge/split/retained/unmatched、before/afterのTargetRef配列、reason、causes。causesはcode/scope/evidence/interpretation/tool_rules/unknownの複数選択。judgment_transitionsはbefore/afterの判断ID配列、state=resolved/continued/new/merged/not_counted/unmatched、reason。両側の存在参照・重複・対応件数・遷移状態・CFP差合計を検査する。未対応やunmatchedを許容し、その分を明示する。相殺があっても安定性を断定しない。

比較は利用者指定時のみ、モデル確定と保存の後に行う。IDや順番による自動同定はしない。対応案の意味の正確性と独立性は確認しない。前後run ID・assessment hash・checksum hash、スキル／ツール／規則／ソースmanifest／scopeの同一性と不明、判断・証拠と遷移を保存する。

## 更新と実使用版の確認

1. 旧測定のrunと、必要な旧セッションを保持する。過去スキルcacheを直接書き換えない。
2. 本納品の0.8.0配布物をローカルmarketplaceとして追加し、旧版を無効化／削除して0.8.0を再インストールする。ホストの操作表示は環境によるため固定UI名は保証しない。
3. 新しいチャットで、インストール先の`skills/open-estimate-assessor/scripts/oes.mjs`のcontractとskill-integrityを実行する。skill_version=0.8.0、quality_records、immutable_local_runs、offline_run_comparisonを確認する。
4. 配布物BUILD.jsonのplugin_versionとファイルhash、AI向け／server側スキルの一致を確認する。版名だけで同一実装と判定しない。
5. 本番公開前は新スキルがサーバーに未登録の場合がある。実機でget_measurement_rulesが拒否したら停止し、旧版や別ルールへ自動切替しない。本納品のローカル検証完了と実ホスト会話・本番受入は区別する。

## Web証明書機能への引継ぎ

run.jsonのrun_id／assessment_hash／numeric_model_hash、assessment.jsonのscope／scope_record／quality／judgments、summary.jsonのmeasurement／records／calculationを使用する。規則全文と版はcontext.json、serverが検査・再計算した結果と保証範囲・report_hash・表示時FXはoperationsの原応答にある。元ローカル値と受信値を区別し、reconciliationが一致の場合だけ一致と記載する。

この工程では証明書、署名、Web実装、一般公開、本番デプロイを行わない。計算・構造検査をソース網羅性や意味解釈の監査へ拡大しない。

## 受入結果

2026-10-20 JST、typecheck・build成功。全23テストファイル／205件が通過した。テストの実行はローカル環境、為替・外部サービスはfixtureまたはテスト内のローカルWorkerを使用した。初回は環境の権限制限によるWorker検証失敗があり、必要権限で再実施して解消した。

| 指示書の確認 | 主な受入根拠 |
|---|---|
| 1 範囲外／範囲内不足／影響不明 | quality.test、quality-cli.test。実収集器のサイズ制限を使い、走査false・測定COMPLETEをCLIで確認。未発見領域はPARTIAL |
| 2 根拠付き統合／分割 | quality.test。異なる解釈と未解決を保存しhashが異なることを確認。キュー通知／読取はレビュー注意 |
| 3 欠落・無効参照・矛盾 | quality.test、records.test、validate.test。属性対応・範囲規則・境界参照・判断矛盾を拒否 |
| 4 未配備と実装不足 | quality.test。deploymentのexplanationは規模不変、実装・境界不足はPARTIAL |
| 5 衝突・途中失敗 | quality-runs.test。UUID衝突を注入しEEXISTを確認。書込失敗はCOMPLETEなし、元成果物不変。パス検査も確認 |
| 6 暫定内数と要約 | quality.test、quality-runs.test、records.test。複数判断が同じprocessを参照しても一回だけ集計。原応答との一致／不一致とFX履歴を保持 |
| 7 比較 | quality-runs.test。追加・削除・統合・分割、相殺、未対応、無効／重複参照、判断遷移矛盾と元ファイル不変 |
| 8 ローカル／リモート整合 | quality.test、records.test、recorded-helper.test。状態・CFP・E/X/R/W・工数・USD、未知トリガー時の総プロセス数も照合 |
| 9 セキュリティ境界 | safe-paths.test、collector.test、desktop-migration.test等の既存回帰。quality-cli.testで秘密ファイルを読まず、数値投影にパスを含めないことも確認 |

quality-cli.testではセッション期限切れ後・purge後のshow-run、同モデルの別run保存も確認した。配布物はBUILD.jsonと別添の受入結果で識別する。

実ホストへのインストール会話、公開MCPへの送信、本番FX取得、クリーンOSは未実施。判断文や属性対応の意味、AIによる対応案、ホストからの実通信を独立監査する機能はない。コード・ローカル受入の完了と、本番受信側の反映・実機受入を区別する。
