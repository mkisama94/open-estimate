# 取得範囲・容量・充足判定（2026-10-27）

Webを変更せず、ローカルCLIとローカルMCPの取得・結果表示を更新した。

## 範囲の固定

CLI `scan` の `scope` に `{path, role}` の配列を渡す。roleは `measurement` / `supporting` / `excluded`。相対パスの完全一致またはディレクトリー配下に適用し、最長パスが優先される。省略時はソースがmeasurement、それ以外の取得可能な資料がsupporting。秘密・依存関係等の除外は解除できない。ルートの `release/` は既定で配布物として除外するが、明示指定できる。`packages/application/src/release/` と `tests/release/` は名前だけでは除外しない。

走査では本文を開かず、パス・サイズ・更新時刻から計画と指紋を作る。対象外ファイルもメタデータだけ集計する。保護ディレクトリー内部やシンボリックリンクは列挙せず、集計不能な範囲を `protected_metadata_not_enumerated` に記録する。件数・深さ・権限による走査不足は全体取得の準備完了にしない。

同意後はセッションに保存した範囲と計画を使う。`prepare` でscopeを変更することは拒否する。同じ範囲での再走査は `refresh_preflight:true`、分割は `split_acquisition:true`。範囲を広げるときは新しいscanと確認が必要。旧スナップショットを残し、再取得をprevious_snapshot_idで関連付ける。

## 取得と停止

measurementを先に、supportingを後に取得する。単一ファイル上限は2 MiB、バッチ上限は100 MiB。計測対象が1バッチに収まらなければ、通常取得は本文コピー前に停止する。splittableがtrueなら分割取得が可能。各バッチのパス一覧・容量を同じ取得記録に保存し、全体で一つのmanifestとsnapshotを作る。共通ファイルは1回だけ取得する。見積は統合manifestから一つの機能モデルを作り、バッチ別の工数は足さない。

前後のメタデータ指紋、各ファイル読取前後のサイズ・更新時刻を照合する。分割時は取得後に全取得ファイルと元ソースの内容hashも照合する。取得一覧の重複・欠落を検査し、変更・消失・権限不足は記録する。動き続ける作業ツリーを完全に原子的に取得する仕組みではなく、変更検出時は再取得が必要。

`analysis_ready:false` なら本文読取とAssessment評価を拒否する。利用者が部分試算を明示的に希望したときだけCLI `prepare` に `user_requested_partial:true` を渡して取得する。取得済み部分の解除にはCLI `authorize-partial` またはMCP `authorize_partial` を使う。これは全体充足をCOMPLETEに変更しない。

## 記録と表示

各snapshotの `acquisition.json` に範囲、事前計画、取得観測、バッチ、統合manifest hash、原因、未取得パス、次操作を保存する。正常exportでは取得記録を不変のrun.jsonに含める。原因はAGREED_EXCLUSION、SAFETY_EXCLUSION、POLICY_EXCLUSION、CAPACITY_LIMIT、SINGLE_FILE_LIMIT、FILE_PERMISSION、SOURCE_CHANGED等に分ける。

`input.acquisition.scope_coverage` と計数判断の状態は別。summary.coverageとローカルHTMLは、充足COMPLETEのときだけ対象全体の参考工数を示す。MISSINGや旧データのUNKNOWNは、プロジェクト全体を未算出とし、取得済み部分の値を別ラベルで保持する。計算係数・工数計算・Web側の表示や契約は変更しない。チャットの報告順序は同梱Skillにも規定した。

## 受入確認

再現テストは、85 MiBの対象外データ、releaseを含む実装パス、単一ファイル上限、古い事前計画、保護除外との衝突、補助資料より主要ソースを優先する場合、100 MiB超の2バッチ、取得中のソース変更、全体／部分のローカル表示を対象とする。

指定された `C:/git/subsidy_ai_plugin` でも取得確認を実施。`.wrangler`、`output`、`releases`、`.agents` を取得対象外とした検証条件で、計測対象71件・752,113 bytes、補助資料52件・641,751 bytes、合計123件・1,393,864 bytesを取得。計測対象の欠落0、対象外コピー0。この実プロジェクトには例示されたpackages/application/src/release等がないため、そのパス構成は再現テストで検証した。これは取得処理の受入確認であり、このプロジェクトの機能規模や工数の再見積ではない。

検証用に選んだ除外条件は受入試験の条件であり、今後の別見積に自動適用する既定の合意ではない。実プロジェクトの元ファイルは変更していない。リリース・インストール済みプラグイン更新・本番反映は別工程。
