# 評価下書き・復旧・ページ取得 API（0.13.0）

開始は構成確認の後に開始カード一回で行う。探索の`READY_FOR_START_CARD`は読取同意ではない。通常手順で`confirm_workspace`／CLI `confirm`や別の質問フォームを挟まない。旧確認を先に行っても同じ候補でカードを生成できる。同じカード・開始要求は同じworkflowと保存済み同意を再利用する。対象・条件を広げる操作には新しい選択が必要。

## 標準操作

| 操作 | MCP | 同梱CLI |
|---|---|---|
| 構成走査・開始 | discover_workspace → show_estimate_start → start_estimate_workflow | scan → bind-rules → show-estimate-start → start-estimate-workflow |
| 一度だけ取得 | prepare_repository | prepare-summary |
| 状態・一覧 | get_repository_snapshot / get_repository_snapshot_page | prepare-summary / snapshot-page |
| 未検査下書き保存 | save_assessment_draft | save-draft |
| 保存済み入力の検査・正式保存 | evaluate_assessment_draft | evaluate-draft |
| 応答消失後の照会 | get_workflow_evaluation | get-workflow-evaluation |
| 下書き・診断・試行履歴 | get_assessment_draft_page | draft-page |
| 明示した旧runの関連付け | recover_saved_workflow_run | recover-saved-workflow-run |
| スキーマ区分の参照 | get_assessor_contract_page | contract-page |

下書き保存にはworkflow_id・snapshot_id・assessment（JSON文字列）を渡す。CLIはセッション操作にroot・session_idも渡す。下書きにはAIが判断したcomponents・data_groups・functional_processes・evidence・judgments・scope_record・quality等を入れる。取得元・manifest・取得問題・analysis_completeを含む`input`は渡さない。collectorがローカルで注入する。assessment_idとassessorの既定値も保持済み情報を使う。事実や根拠の不一致を通すために検査を緩めない。

同じsnapshot・読取履歴・入力・表示通貨は同じdraft_idを返す。編集や追加読取後は新しいinput_versionを保存する。検査失敗はVALIDATION_FAILEDで、run_idはnull。先頭5件の診断と総数を返し、全件はsection:validationで読む。未検査下書きは証明・公開・検査成功を表さない。

検査後は保存予定run_idとdraft結合情報を先に記録する。COMPLETE.jsonと全成果物のチェックサムを検証してRUN_SAVEDへ進む。保存後に応答や表示が失われても保存済みrun_idを照会できる。不完全runは残し、SAVE_INTERRUPTEDとして再試行する。更新日時による選択・既存runの上書きは行わない。為替表示失敗はRUN_SAVED_DISPLAY_PENDINGとしてrun_idを保持する。complete_estimate_workflowへそのIDを渡せるが、取得前後の不一致など既存の完了条件は引き続き検査する。

旧runの回収は明示したIDについてCOMPLETE・チェックサム・snapshot・同意済み対象と計画・ルール・範囲を照合する。取得前後が一致しない場合はRUN_SAVED_COMPLETION_BLOCKEDとし、固定・証明・公開へ進めない。回収によって元の取得記録を変更しない。

## 応答量と継続

取得の標準応答はoes/snapshot-summary/v2。ID・件数/容量/区分・取得充足・問題の種類別件数/代表例・未読数を返す。manifestやassessment_inputは展開しない。get_assessor_contractも要約とスキーマ参照を返す。

通常の構成・取得・評価要約と詳細ページはJSON換算64 KiB以内。MCPのstructuredContentとtextの二重掲載を考慮して実データを30 KiBに制限する。ページにはtotal_records・total_items・returned_items・has_more・next_cursor・byte_limitを含む。cursorは区分・内容に結び付き、内容が変わればPAGE_CURSOR_STALEで再開を求める。limitは1〜100。

snapshotのsectionはmanifest・issues・reads・exclusions・scope・acquisition_record。workspaceの一覧もget_workspace_pageで取得できる。draftはhistory・validation・attempts・submissionや入力の各区分。contract-pageはsection:assessment／draft／instructionsと任意のRFC6901 pointer（例 /properties/quality）を指定する。

1行が大きければbase64-json-utf8で分割する。同じindexのfragment_index順にdataをBase64復号したバイト列を結合し、UTF-8 JSONとして復元する。total_recordsとtotal_itemsは原項目と分割片の件数であり、切詰めを不存在と扱わない。本文読取・PDFは既存の専用上限に従う。

## 互換方針

旧confirm_workspaceと旧CLI confirmは互換用。旧MCP prepare/get snapshot/evaluateへresponse_format:legacyを明示すれば小さな旧応答を得られる。巨大な応答はRESPONSE_REQUIRES_PAGINATIONでページ経路へ移る。既に保存されたdraft/runは失わず照会できる。

旧CLI prepare/exportは64 KiB超の応答を非公開のセッション領域へ保存し、response_id・総バイト数・run_id等の要約を返す。response-pageで全内容を復元する。旧draftは診断先頭10件と総数を返す。新しい標準はprepare-summary/save-draft/evaluate-draft。旧フルAssessmentを下書きへ移す場合のみinput_mode:legacyを使い、元の取得事実照合を保つ。

同梱CLI・MCP・スキル・契約を同時配布する。古いsnapshotの再開には記録されたスキル整合性を使い、新しい解析に古い版を装わない。ローカル検証、配布起動、実ホストのカード操作、本番サービスの応答は別々に記録する。
