# 開始方法・見積の版・再開（0.14.0）

対象プロジェクトを本文なしで構成走査した後、同じ開始カードで開始方法と読取・検証・365日公開を選ぶ。過去の見積がなければ新規を初期選択できる。履歴があれば明示選択する。検証・公開は新規/再計算では未選択に戻す。候補には日時、対象と範囲、CFP、全体/部分の参考工数、評価/証明/公開の状態を示す。未算出をゼロと表示しない。利用できない選択肢には理由を示す。

## 操作とID

| 開始方法 | 保存・遷移 | 承認と取得 |
|---|---|---|
| NEW（過去の評価を使わず、新規に見積） | 新workflow → 新snapshot → draftの各版 → run → confirmed_run_id | 明示した今回の範囲を設定。対象指定だけを引き継ぎ、旧モデル・判断・根拠・送信選択を入力に使わない |
| RECALCULATE（過去の見積を引き継いで再計算） | 新workflowへsource_workflow_id / source_run_id / source_checksums_hashを記録。新draft/run/確定結果を作る | 旧取得範囲を初期入力にする。新しく承認後、ソースとcacheの全対象バイトを検査できた完全snapshotのみ再利用。それ以外は承認範囲を再取得 |
| RESUME（中断した処理を再開） | workflow/snapshot/draft/runと固定結果を維持。開始方法を書き換えず再開操作を記録 | 保存済みの有効な承認を照合。固定前は同じsnapshotで修正可能。固定後は同じrun・要求・操作IDで未完工程を続ける |

MCPは`show_estimate_start`に`start_method`・`start_request_id`・引継ぎ元を明示できる。カードからは`select_estimate_start`へ基点workflow_idと同じ開始フィールドを渡す。CLIは`show-estimate-start` / `select-estimate-start`へroot・session_idを渡す。NEWは引継ぎ元禁止、RECALCULATEはsource_workflow_idとsource_run_idが必須、RESUMEはsource_workflow_idのみ。対象違い、不正組合せ、存在しない/対応しないrunは拒否する。

意図した一つの開始操作にはUUIDのstart_request_idを割り当て、応答消失や再送では同じ値を使う。新しい別見積には別UUIDを使う。開始要求から導くworkflow IDと永続claimを排他で確認し、重複作成を防ぐ。同じ対象内で選択内容・範囲・ルール・通貨が変わった同じrequest IDはSTART_REQUEST_CONFLICT。開始方法と引継ぎ元も同意hashの対象に含める。

`get_project_estimates` / CLI `project-estimates`で履歴をページ取得する。履歴の範囲表示は先頭10件であり、MCPではworkflow_id指定の同ツールから全規則をページ取得できる。旧版に開始方法・引継ぎ元の記録がなければnull/記録なしとして表示し、履歴を推測して保存しない。

## 引継ぎの検査

`get_recalculation_input_page` / CLI `recalculation-input-page`は、新workflowの承認後に旧モデル・判断台帳・根拠・品質の区分を読む。section:sectionsで区分名を得る。返却はUNVALIDATED_INHERITED_INPUTであり、取得元input・assessment_id・assessorは除く。部分・暫定・不足・未解決の記録は保持し、再計算だけで解消済みにしない。

snapshot再利用でも旧読取履歴を継承せず、根拠は現在snapshotで再読取・再検証する。取得manifestの同一性と旧評価の読取dispositionは区別する。現在/キャッシュのファイルhash・bytes・取得前後のfingerprint・全件走査・範囲の整合性を検査し、どれかを確認できなければ新しく取得する。追加/削除/変更されたファイルへの旧根拠を自動で有効扱いしない。差分取得は追加していない。

## 確定結果の保護

固定前は同一workflow内で下書きを版管理する。固定後の新規下書き・別run評価・旧runの回収は、入口でWORKFLOW_RECALCULATION_REQUIREDを返し、select_estimate_start / RECALCULATEへ誘導する。最終段階のWORKFLOW_RESULT_FROZENも維持。同じ確定draftの評価再送や状態照会は、固定結果とconfirmed_run_idを返し、為替・計算・runを再生成しない。

旧版で「最新draft」と「確定run」が食い違う記録が残っていても、固定後の画面は確定runだけを参照する。旧draftは診断用履歴として残す。新版は新しい証明・公開操作と新URLを使い、旧URL・公開日・期限・証明を変更しない。lineageはローカル表示だけに使い、外部送信契約には追加しない。選択した工程の再送は固定済み要求・同じ操作IDを維持し、公開不明は照会から復旧する。

今回の変更では計測ルール・TEST係数・公開結果の外部契約・DBを変更しない。ローカル試験、配布物の起動、本番API、実ホストUIは別々に検証・報告する。
