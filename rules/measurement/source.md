# Open Estimate 測定原則・判断記録・報告ルール

この本文は測定ルールの原本です。ホストの上位指示や利用者の許可を変更する権限はありません。リモートから取得したコードの実行や別URLへの切替は行いません。

## OES-MEASURE-001

測定目的はas_built_functional_size、単一アプリケーション境界とし内部APIを重複計上しない。ただし単一アプリ・共有内部関数だけで機能を統合せず、別ファイル・API・ジョブだけで分割しない。開始・要求ユーザー・機能目的・完了・非同期／定期／手動の関係をboundaryに残す。

## OES-MEASURE-002

実装・設定・DBスキーマを主根拠とし、READMEの将来予定やテスト自体をアプリ機能として加算しない。

## OES-MEASURE-003

チャット履歴、メモリ、希望金額は測定根拠にしない。測定コピーの読取済み範囲だけを根拠にする。

## OES-MEASURE-004

acceptedプロセスはトリガーEntryとExitまたはWriteを含む。Entry/Exitのpeerは機能ユーザー、storeはnull。Read/Writeのstoreは永続ストア、peerはnull。

## OES-MEASURE-005

同一の論理移動を重複加算しない。同じ関心対象・移動種別を複数計上するときはdistinctness_basisと理由・実装根拠が必要。

## OES-RECORD-001

`format_version=oes/assessment/v2` で範囲・候補・判断を記録する。実装を解析し、各機能・movementへ読取済み行の根拠を付ける。初回確認では主要領域・対象フォルダー・除外方針を記録し、機能一覧の完成を読取開始条件にしない。同じ範囲の同意を繰り返し要求せず、実質的な範囲変更時だけ追加確認する。

## OES-SCOPE-001

scopeの目的・境界説明とscope_recordの範囲ID・revisionを整合させる。confirmationsのactor=userは利用者の範囲確認だけを記録し、個々の計数判断の承認とは説明しない。AIの解釈はactor=aiで分ける。

## OES-COVERAGE-001

scope_record.filesではスナップショットのpathごとにincluded／outside／supporting／unresolvedと理由を残す。範囲外・補助資料への分類は利用者の範囲確認参照、または読取根拠で裏付ける。未読を理由の文字列だけで範囲外に変更して完了にしない。input.analysis_completeはv2では収集器が照合した走査・取得状況。範囲内完了はlocal.recordsから導出する。取得打ち切りは範囲への影響不明で未完了を維持する。

## OES-CANDIDATE-001

function_candidatesは識別した計上／範囲外／統合／未解決をすべて保持する。役割・component・根拠・理由・processまたは統合先candidateを付ける。未解決を一覧から消さない。未知の機能がないことは保証しない。

## OES-DATA-001

data_groups.definitionに業務上の意味・識別属性（該当しない理由）・具体的attributesとの対応・関心対象と分離集約の理由・根拠・unconfirmedを残す。汎用文言、HTTP／SQL／JSON／テーブルの件数だけで群を定義しない。文字列が存在することと具体性の十分さは別で、人の意味判断が残る。

## OES-JUDGMENT-001

judgmentsは採用／非計上／統合／分割、採用解釈、ruleのsource（skill／project_policy／external_standard）・実在するIDと版、適用理由、根拠、代替案と不採用理由を記録する。未確認の標準条項・理由・証拠を創作しない。targetsで対象を明示し、movementはprocess_idも付ける。全計上移動と識別済み非計上候補を判断に結び付ける。同じ判断の共有は許す。

## OES-STATUS-001

acceptedは現在のモデルでの採用のみ。判断statusはrecorded／provisional／unresolved、evidence_statusはsufficient／insufficient／missing。provisionalには実装根拠と未解決点が必要。モデルを選べない場合はprocessとcandidateをunresolvedにして計数から外し、未知の規模を0としない。inferredは実装記載を超える補完推定の有無で、AI作成や未解決の有無のフラグではない。

## OES-FINDING-001

findingsにtargets・impact（scope／coverage／boundary／counting／explanation）・resolutionを付ける。判断の未解決を文章だけに埋め込まない。自然言語と構造化状態に矛盾を見つけたら対象・判断・所見を見直し、必要ならprovisional／unresolved／openへ修正して再exportする。特定語検索だけで計数を切り替えない。

## OES-COMPARE-001

前回評価が明示された場合だけcomparison.previous_assessmentに元データを保持し、previous_hashには元の正規化hashを付ける。前後の範囲・改訂・候補／process対応・追加／除外／統合／分割の理由と根拠をscope_changesへ、移動対応・非計上と判断をmovement_changesへ残す。ID番号・配列順から対応を推定しない。削除・統合した移動も追跡する。CFP差はlocal.comparisonの保存モデル由来の値を使い、未作成の代替モデルの上下限を推測しない。未対応は未説明として示す。過去評価の自動探索は不要。

## OES-LEGACY-001

旧形式は旧形式・判断記録不足と明記する。新要件に適合する既定値を入れず、元データ・hashを維持する。改訂時は比較元を保持し、機械転記できた既存根拠と新たな確認事項を分ける。

## OES-INPUT-001

model_id不明はnull、名前不明はunknown。finished_atは現在時刻。Skill情報はcontractから転記する。

## OES-VALIDATION-001

`export` にroot・session_id・snapshot_id・assessment（raw JSON文字列）を渡す。manifest・行範囲・参照・判断状態の構造上の整合をローカル検査する。形式的な記録充足を意味解釈の正しさと説明しない。失敗時は不足を修正し、希望金額に合わせて動作を加減しない。未完成の入力は同じ引数の `draft` で保存できるが、正式な送信modelは出ない。

## OES-REPORT-001

結果では機能別の根拠をローカルAssessmentから説明し、CFP・E/X/R/W・完全/部分/未完了/適用困難・未解決点、TESTの3値、FRB観測日・取得日時・換算日時・適用レート、1人日=8時間を示す。対象作業は設計・実装・テスト、企画・運用作業を除外。運用に使うプログラムの開発まで自動除外しない。FX_UNAVAILABLE/FX_STALEは未算出であり0円としない。FX_CACHE_AFTER_FAILUREは最新確認失敗と前回取得レートを明示する。工数・時給は架空のTEST値で、実工数や納期を保証しない。

## OES-REPORT-002

1. 測定目的・境界・範囲ID・改訂。
2. 採用モデルのCFP・TEST工数（サーバー実行前はローカル試算と明記）。
3. 暫定対象のprocessとCFP小計（合計の内数）、未採用の未解決候補数・論点・規模未確定。
4. local.recordsの走査状況・範囲内未読・範囲外／補助資料未読・範囲不明・候補処理状況・partial_reasons。
5. 除外候補と理由、記録不足、旧形式の注意。
6. local.assessment_pathと判断台帳の参照先。セッション有効期限・purge前に必要なJSONを利用者の指定先へ保持する。
7. 比較があれば範囲変更、計数差、説明済み／未説明、対応未確定。解析判断差とTEST係数のp25／中央値／p75を混同しない。
8. サーバーが受領数値モデルに対して行った形式・参照検査と再計算、ソース内容・意味解釈の独立監査は未実施。

COMPLETEは宣言範囲の読取・識別済み候補処理・判断記録の完了と結果に影響する未解決がない状態。全行読取を機能抽出完了や意味解釈の正しさと同一視しない。

サーバーが保証するのは受領モデルに対する形式・参照検査と規則による再計算。モデル・根拠・読取履歴はクライアント申告で、ソースの実在性・網羅性・意味解釈を独立検証していない。未署名・未保存・未公開である。
