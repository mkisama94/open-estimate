> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# プラグイン品質改善 0.8.1 — 0.8.0レビューの2件修正

対象は境界の未確認状態と比較の分類に限定する。0.8.0の配布物・受入記録・既存runは保持し、同一版の差替えを行わない。CFPを過去結果へ合わせる追加開発は行わない。

## P1：境界未確認と判断・測定状態の整合

quality.boundariesのrerunまたはcontinuationがunknownなら、そのprocessのboundary.judgment_refsに紐づく判断をprovisional／unresolvedにする必要がある。その判断は当該processを対象にし、既存の検査により具体的なunresolved_pointsを要求する。他のprocessの暫定判断では代用できない。計上済みprocessでは既存規則どおりprovisionalと実装根拠を要し、unresolved判断で採用を正当化できない。

recordStateはBOUNDARY_RERUN_UNKNOWN:<process_id>／BOUNDARY_CONTINUATION_UNKNOWN:<process_id>を出す。検査を通す前の要約でもunknownをCOMPLETEにしない。妥当な暫定モデルはPARTIALとしてローカルと数値投影へ同じ状態を反映する。計数影響なしとみなす例外は追加しない。

旧版でunknownなのにrecordedだった入力は新版の検査エラーとなる。元入力・結果・hashを変更せず、不足を補った新しい実行として保存し、必要ならhuman_amendmentsで元hashを参照する。新版が旧成果物を黙って適合済みに書き換えることはない。

## P2：比較する事実の分離

新規compare-runsの出力は`oes/run-comparison/v2`。旧v1の比較操作は元のまま保持する。元のrun／Assessment／manifest hash／scope_recordは変更しない。

| 表示 | 比較する情報 | 含めない情報・不明の扱い |
|---|---|---|
| identity.source_content | パスと取得済みの実ファイルSHA-256 | disposition、除外理由、確認記録は含めない。ゼロhashはnullとしてUNKNOWN。取得が未完了で未発見領域があり得る場合も内容一致を断定しない |
| identity.acquisition | パス別のdisposition・除外理由、収集器の取得制限とdiscovery／scan状態 | ソース変更の判定と分離する。本文のハッシュはこの判定に使わない |
| identity.scope | scopeのアプリ境界・目的・視点・説明、ファイルの範囲所属、componentの対象パス・除外／影響状態、パス別の範囲規則 | 実行ごとのscope ID・revision、確認ID・日時・確認者・確認文、規則IDや説明の言い換えは含めない。元記録は履歴に残す |
| identity.evidence | 保存された根拠記録 | 根拠の追加・変更をコード変更や範囲変更に置き換えない |
| execution_records | 前後のassessment ID、開始終了、元manifest hash、元scope_recordとscope_rules | 実行履歴として表示し、SAME／DIFFERENTのソース内容判定に流用しない |

取得済みの共通パスで実hashが異なる場合はDIFFERENT。発見が両方完了しており取得済みファイルのパスに追加・削除がある場合もDIFFERENT。それ以外に未取得・未発見が残る場合はUNKNOWNとし、unknown_content_before／after、only_before／afterなどの対象を示す。ゼロhashの除外ディレクトリが増えたというだけでは、実内容の変更を確認したとは表示しない。既知の差があり、別の未取得もある場合はDIFFERENTと未取得一覧の両方を残す。

scopeのSAMEは記録された対象・境界・規則の構造的一致であり、自然言語の意味の独立監査ではない。範囲記録や品質規則がない、所属がunresolvedのまま同じ、といった場合はUNKNOWN。配列順は同一性に影響しない。ファイルhash自体もクライアント申告／ローカル収集の証拠であり第三者の真正性保証ではない。

## 再発防止と受入

quality.test：rerunのみunknown、continuationのみunknown、両方unknownでrecordedの入力を拒否。他processの暫定判断で代用できないこと、対応するprovisionalでPARTIALとなること、unresolvedの保存、既知境界のCOMPLETE維持、リモート計数・状態との一致を確認する。

comparison-identity.test：補助資料の追加読取、範囲ID・確認日時・確認者・確認文・配列順だけの違い、実際のコード・パス・範囲所属・アプリ境界・範囲規則の変更、ゼロhash、片側のみ取得、未発見領域、取得制限・根拠の追加を分離して確認する。

quality-runs.test：実保存した前後runをcompare-runsで比較し、ソース／範囲SAME・取得状況DIFFERENTと元履歴の差を確認する。比較操作を再読込して出力と照合し、元成果物が変わらないことを検査する。既存の保存・応答・為替・比較の回帰テストも維持する。

最終のテスト件数・配布識別情報は別添`PLUGIN-QUALITY-ACCEPTANCE-0.8.1.json`に記録する。

2026-10-20 JST、全24テストファイル／223件が通過した。最終の旧形式・範囲規則欠落の扱いを含め、関連3ファイル／26件も再確認して通過。typecheckとbuildも成功。外部サービスの検証はfixtureまたはテスト内ローカルWorkerを使用し、本番への送信は実施していない。

## 配布・本番への移行

0.8.1も**ローカル受入用の配布物**。通常の数値モデルv1経路も含め、本番で一連の評価が可能であるとは扱わない。残す移行作業は次の3点。

1. 新版スキルの本番登録と対応する中央測定ルールの反映。
2. 数値モデルv2の受信側反映。
3. 実ホストへ再インストールし、実使用版・読取・保存・送信同意・評価・再表示を確認。

本修正では本番デプロイ、公開MCPへの測定送信、証明書・署名・公開を行わない。Web証明書機能の実装は別工程。更新時は旧版のrunと配布物を保持し、新しいチャットで新版のcontract／skill-integrityを確認する。skill_version=0.8.1、run_comparison_format=oes/run-comparison/v2を確認し、未登録によるサーバー拒否を旧版や別ルールへの自動切替で回避しない。
