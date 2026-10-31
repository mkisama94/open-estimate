# Open Estimate 0.12.0 一括同意・Web保存の運用

> **2026-10-31の仕様変更**：目標の利用手順は[ローカル利用体験と外部送信の確認](LOCAL-UX-AND-TRANSMISSION-SPEC.md)へ変更しました。依頼済みのローカル読取には再同意を求めず、任意の外部送信だけを確認します。この変更は未実装です。以下は旧契約の運用記録であり、新仕様への移行を既存の`read`フラグや`explicit_answer`の偽装で代替してはいけません。実装・配布時に本手順も新契約へ更新します。

2026-10-28（JST）。目標仕様はSYSTEM-SPEC.md、実装計画はSYSTEM-IMPLEMENTATION-PLAN.md。実装・ローカル・ステージング・本番・実ホストの受入を区別する。

## 通常手順

1. Node.js 24以上でCLI contractとskill-integrityを検査し、正規MCPから公式ルール全文・版を取得する。
2. scanで本文を読まず対象・計測/補助/除外・容量を確認し、bind-rulesで版を固定する。
3. show-estimate-startへroot・session_id・表示通貨を渡し、対象、取得計画と上限、送信先・項目・目的、365日の公開範囲、品質と部分試算の扱いを説明する。ローカルMCPはdiscover_workspace → show_estimate_startへrules_response。
4. 初期未選択の読取・検証・公開を一度に選ぶ。読取必須、公開には検証が必要。start-estimate-workflowへroot・session_id・workflow_id・terms_hash・selection・実際のexplicit_answerを渡す。MCPはstart_estimate_workflow。別のconfirmは不要。UI非対応なら同じ説明で「ローカルのみ／検証まで／Web公開まで」を一度の回答で選択する。
5. prepare/read/exportで承認範囲を解析する。範囲内の分割・取得方法調整、説明済みの部分試算に追加回答を要求しない。主要不足は全体工数未算出とする。取得一覧を統合し、共通処理を二重計上しない。
6. complete-estimate-workflowへworkflow_id・保存run_id。対象・取得記録と承認を照合し、確定結果とPDFを作り、選択済みの証明・Web保存を続行する。MCPはevaluate_assessmentで得たrun_idをcomplete_estimate_workflowへ渡す。
7. show-estimate-workflowまたはshow_estimate_workflowで結果カード、get_estimate_workflow_pdfでPDFを取得。公開時はHTTPS結果URLと終了日を提示。API成功とブラウザー実表示は別に記録する。

ソースはOpen Estimateへ送らず、AI解析ではモデル提供元（OpenAI、Anthropicなど、利用中のAIサービスのモデル提供元のこと）で処理される場合がある。MCPだけへ匿名数値モデル・配布整合性情報・ルール/計算条件・集計結果、Webへ集計結果・計算/為替条件・品質コード・証明を送る。名称・パス・根拠・判断台帳・自由記述は送らない。

## 再開・取消・差分確認

resume-estimate-workflowは未完工程だけを元の操作ID・要求・確定数値・係数・為替で再試行する。429/通信障害は1呼出しで最大2試行。形式・不正署名・計算不一致は自動再送しない。証明取得済みならWeb登録だけを再開。PDF生成失敗でも結果を失わない。

cancel-estimate-workflowは未送信工程を止める。取消後は登録POSTを再送しない。公開応答消失時は秘密付きの読取専用照会で確認し、完了分を正確に報告する。通信結果不明を公開なしと断定しない。

取消後の照会が404/NOT_FOUNDでも、送信済みの登録がまだ処理中の可能性がある。`CANCELLED_PUBLICATION_UNCONFIRMED`と`publish_inflight:true`を保持し、後のresumeで同じ操作IDと管理秘密による読取専用照会を行う。自動的に登録POSTを再送せず、一度の404や時間経過で「公開されなかった」と確定しない。PUBLISHEDを確認したらURLを案内し、停止を希望する場合だけwithdrawを使う。WITHDRAWN/EXPIREDの確定応答では照会待ちを解除する。

同一workflowへの書込は所有プロセス付きの`workflow.lock/owner-<token>.json`で排他する。実行中なら`WORKFLOW_BUSY_RETRY`。終了をOSへ照会して確認できた所有者だけを回収するので、クラッシュ後も同じworkflowをresumeできる。時刻が古いことを根拠に回収しない。所有者不明・権限不足・別ホストのロックは自動削除しない。PIDが再利用されて稼働中なら安全側で待機する。

0.12.0以前の空の`workflow.lock`ファイルには所有者情報がなく、自動回収できない。`WORKFLOW_LEGACY_LOCK_REQUIRES_CHECK`の場合、運用者がその保存先を使用する旧版プロセスをすべて終了したと確認した後に限り、空ファイルを別名で保管して再開する。新旧版を同じworkflow保存先で同時実行しない。状態・証明・管理秘密を消去して作り直す復旧は行わない。

withdraw-estimate-workflowは利用者の明示希望で公開を停止する。管理秘密は32バイト以上の乱数をローカル非公開ファイルへ送信前に保存し、モデル向け出力・URL・本文・PDF・通常ログへ含めない。Webはハッシュだけを保持する。

後から未選択の検証・公開を希望した場合はextend-estimate-workflowへ同じterms_hash・追加選択・実回答を渡す。解析はやり直さず、旧承認履歴も保持する。対象・送信先・項目等の変更には承認を流用しない。機密混入や不正署名を同意で迂回しない。ホストの確認と製品側の同意を別に記録する。

## 保存・期限

正本はoes/estimate-result/v1。新証明はoes/estimate-proof/v1、ドメインoes/calculation-verified-estimate/v1。Markdown/PDFの読取・選択は送信条件ではない。署名対象は構造化結果でありPDF全体への署名ではない。

公開は最初の保存から365×24時間。HTML・Web PDF・管理操作照会と再送に共通して期限を検査し、期限/停止後は本文を返さず410。閲覧・再送で延長しない。毎時の削除ジョブは最大100件の期限切れ本文・証明を消し、操作ID・指紋・状態・日時の墓標を残す。ジョブ停止でも読取期限を守る。証明の失効とは区別し、手元のPDFは終了後も読める。

結果URLはログイン不要で共有可能。本人限定と表示しない。noindexはアクセス制御ではない。保存データを再解析・再計算せず、同じ結果をUI・Markdown・PDF・Webで描画する。

## 設定と検証

profiles/estimate-services.jsonは運用者が固定する送信先。入力から任意URLへ上書きできない。本番は正規ドメイン、TESTはHTTPS workers.dev。信頼公開鍵はprofiles/document-signing-keys.jsonへ配置し、入力中の鍵や任意鍵URLを信頼しない。

MCPはESTIMATE_PROOF_DBと0009、発行鍵、制限が必要。WebはPUBLIC_RESULTS_DBと0010、信頼鍵、PUBLIC_RESULTS_ORIGIN・PUBLIC_RESULTS_ENVIRONMENT・PUBLIC_RESULTS_LIMITERが必要。新規登録停止でも既存の期限内読取・公開停止は維持する。DBは互いの起動条件にしない。

新設test:publicationとbuild:publication-webを実行する。typecheck、build、全test、plugin:pack、plugin:smokeも実行。独立WebはDB/PDFを含むが、数値エンジン・issuer・local・remote・OAuthを含まない。build:document-webとtest:documentは旧互換用。

フォントは公式Noto Sans JPから必要文字を同梱し、profiles/report-font-OFL.txtを保持する。embed-report-font.mjsが同じフォントをWorkerへ埋め込む。

## 互換機能と撤去条件

旧文書/文書証明、要求別同意、/preview保存なし表示、ファイル選択は既存文書だけの互換機能。新標準からopen-web-previewを呼ばない。旧同意を新公開へ読み替えない。

旧本人限定保存・Auth0・owner-preview・preview-transfer・旧公開API/URL/鍵/データを保持する。自動公開・自動移行・削除は行わない。実ホスト受入後に残存呼出元と旧データの利用を確認し、別に撤去を判断する。
