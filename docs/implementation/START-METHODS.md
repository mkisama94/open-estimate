# 開始方法・見積の版・再開

更新日：2026-10-31（JST）。0.14.0の開始方法・固定結果の保護を維持し、[ローカル利用体験と外部送信の確認](LOCAL-UX-AND-TRANSMISSION-SPEC.md)に合わせた目標仕様へ改訂。今回のUI/承認契約変更は未実装。以下のツール名は既存の接続点であり、新契約の対応済みを意味しない。

対象・開始方法は見積依頼から決定し、読取の再同意や開始ボタンを必須にしない。履歴があるだけで選択を強制しない。「過去を使わず新規」「前の見積を更新」「中断の続き」等が明確なら、その方法で進める。履歴がなければNEW。複数の引継ぎ元や新規/再計算/再開の意図が曖昧な場合だけ選択を求める。

選択が必要な場合の候補には日時、対象と範囲、CFP、全体/部分の参考工数、評価/証明/公開の状態を示す。未算出をゼロと表示しない。検証・公開は別の任意操作とし、その選択待ちでローカル開始を止めない。新規/再計算に旧外部承認を自動流用せず、今回の説明済み条件への明示意思だけを適用する。

## 操作とID

| 開始方法 | 保存・遷移 | 承認と取得 |
|---|---|---|
| NEW（過去の評価を使わず、新規に見積） | 新workflow → 新snapshot → draftの各版 → run → confirmed_run_id | 明示した今回の範囲を設定。対象指定だけを引き継ぎ、旧モデル・判断・根拠・送信選択を入力に使わない |
| RECALCULATE（過去の見積を引き継いで再計算） | 新workflowへsource_workflow_id / source_run_id / source_checksums_hashを記録。新draft/run/確定結果を作る | 今回の依頼に従い旧取得範囲を初期入力にする。読取再承認なしで、ソースとcacheの全対象バイトを検査できた完全snapshotのみ再利用。それ以外は依頼範囲を再取得 |
| RESUME（中断した処理を再開） | workflow/snapshot/draft/runと固定結果を維持。開始方法を書き換えず再開操作を記録 | ローカル作業根拠と外部操作の有効承認をそれぞれ照合。固定前は同じsnapshotで修正可能。固定後は同じrun・要求・操作IDで未完工程を続ける |

MCPは`show_estimate_start`に`start_method`・`start_request_id`・引継ぎ元を明示できる。カードからは`select_estimate_start`へ基点workflow_idと同じ開始フィールドを渡す。CLIは`show-estimate-start` / `select-estimate-start`へroot・session_idを渡す。NEWは引継ぎ元禁止、RECALCULATEはsource_workflow_idとsource_run_idが必須、RESUMEはsource_workflow_idのみ。対象違い、不正組合せ、存在しない/対応しないrunは拒否する。

意図した一つの開始操作にはUUIDのstart_request_idを割り当て、応答消失や再送では同じ値を使う。新しい別見積には別UUIDを使う。開始要求から導くworkflow IDと永続claimを排他で確認し、重複作成を防ぐ。同じ対象内で選択内容・範囲・ルール・通貨が変わった同じrequest IDはSTART_REQUEST_CONFLICT。開始方法と引継ぎ元はローカル作業記録の整合性hashへ含め、外部承認は該当workflow・対象/結果へ関連付ける。現行の一体化した同意hashは版付き移行で分離し、利用者の再クリックで整合性を代替しない。

`get_project_estimates` / CLI `project-estimates`で履歴をページ取得する。履歴の範囲表示は先頭10件であり、MCPではworkflow_id指定の同ツールから全規則をページ取得できる。旧版に開始方法・引継ぎ元の記録がなければnull/記録なしとして表示し、履歴を推測して保存しない。

## 引継ぎの検査

`get_recalculation_input_page` / CLI `recalculation-input-page`は、新workflowに今回の再計算依頼・対象・引継ぎ元を記録して旧モデル・判断台帳・根拠・品質の区分を読む。追加の読取同意は要求しない。section:sectionsで区分名を得る。返却はUNVALIDATED_INHERITED_INPUTであり、取得元input・assessment_id・assessorは除く。部分・暫定・不足・未解決の記録は保持し、再計算だけで解消済みにしない。

snapshot再利用でも旧読取履歴を継承せず、根拠は現在snapshotで再読取・再検証する。取得manifestの同一性と旧評価の読取dispositionは区別する。現在/キャッシュのファイルhash・bytes・取得前後のfingerprint・全件走査・範囲の整合性を検査し、どれかを確認できなければ新しく取得する。追加/削除/変更されたファイルへの旧根拠を自動で有効扱いしない。差分取得は追加していない。

## 確定結果の保護

固定前は同一workflow内で下書きを版管理する。固定後の新規下書き・別run評価・旧runの回収は、入口でWORKFLOW_RECALCULATION_REQUIREDを返し、select_estimate_start / RECALCULATEへ誘導する。最終段階のWORKFLOW_RESULT_FROZENも維持。同じ確定draftの評価再送や状態照会は、固定結果とconfirmed_run_idを返し、為替・計算・runを再生成しない。

旧版で「最新draft」と「確定run」が食い違う記録が残っていても、固定後の画面は確定runだけを参照する。旧draftは診断用履歴として残す。新版は新しい証明・公開操作と新URLを使い、旧URL・公開日・期限・証明を変更しない。lineageはローカル表示だけに使い、外部送信契約には追加しない。選択した工程の再送は固定済み要求・同じ操作IDを維持し、公開不明は照会から復旧する。

今回の目標変更では計測ルール・TEST係数・公開結果の外部契約・DBを変更しない。ローカル開始/承認契約と保存状態の移行は必要。ローカル試験、配布物の起動、本番API、実ホストUIは別々に検証・報告し、0.14.0の受入記録をLUXの合格とみなさない。
