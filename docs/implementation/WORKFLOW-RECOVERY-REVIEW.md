# 0.12.0 復旧レビュー対応（2026-10-29 JST）

対象コミットは `9285a12c6c6c901667ef4ffdb59ffaa3ec1afa76`。この対応はそのコミットに対する作業ツリーの修正であり、新しいコミット・インストール・配備の完了を示さない。実ChatGPTでの開始カードからWeb結果までのM0/M5は引き続き未完。

## 復旧処理の変更

`workflow-store.ts`の排他処理を`workflow-lock.ts`へ分離した。ロックはPID・ホスト名・所有者トークンを含む非空ディレクトリーとして原子的に配置する。時刻が古くても生存中の所有者から取得しない。OSのプロセス照会で終了を確認できた所有者のマーカーだけを削除し、再取得する。並行する回収処理が新しい所有者のロックを削除しないよう、所有者ごとに異なるマーカー名を使う。プロセス照会の権限不足・別ホスト・不正な情報は安全側で拒否する。

旧版の空ファイルにはPIDがないため、自動回収はしない。旧版プロセスの終了を運用者が確認した上で保管する手順は[運用手順](PUBLICATION-OPERATIONS.md)に記載した。PIDが再利用されて生存中なら回収を見送る。時刻だけで推定する復旧は行わない。

取消後、送信中だった公開要求の照会で`NOT_FOUND`が返っても、`CANCELLED_PUBLICATION_UNCONFIRMED`と`publish_inflight:true`、元の操作ID・管理秘密を保持する。後の再開で読取専用照会を続ける。取消後の登録POST・証明再発行は行わない。遅れて公開が成立すればURLを確認でき、確定した停止・期限切れでは照会待ちを解除する。

追加試験は、実行中のロック保護、コールバック異常時の解放、旧形式・別ホスト・不正ロックの保護、公開応答待ちの子プロセスを強制終了して同じworkflowを再開する操作、回収競合、404を繰り返した後の照会障害と遅延登録を扱う。強制終了後も証明、要求、操作ID、管理秘密が同一であることを確認する。

## 実行ごとの検証記録

環境はWindows x64 / Node.js v24.18.1 / Vitest 3.2.7。現在のpackage-lock SHA-256は`90e66e035cb3cd4b9cdf898385b535e543692a98a1a1bb82046b50f8bfbc053a`。権限制限のある実行と、ローカル一時ファイル・子プロセス・Wranglerの実行を許可した検証を区別する。

| 日時（JST） | 対象 | 実行条件・結果 |
|---|---|---|
| 2026-10-28 22:50 | コミット前の作業ツリー。対応コミットを特定するスナップショットなし | 過去記録で58ファイル457件合格、123.03秒。これをコミット自体の検証結果へ読み替えない |
| 2026-10-28 23:46–23:49のコミット報告チャット | `9285a12`として保存された0.12.0 | `npm test -- --maxWorkers=2`：451件合格・6件失敗、終了コード1。保存ログの権限拒否と下表の失敗を確認 |
| 2026-10-29 00:32以降のレビュー | `9285a12` | `.cache`へのログ出力拒否、その後contract-workerの`.wrangler/tmp/dev-*`作成EPERMを確認。実行中断につき全体合否は未確定 |
| 2026-10-29 00:40:38–00:42:52 | `9285a12`、追跡ファイル変更なし、既存distを使用 | 許可されたローカル実行。58ファイル457件すべて合格。`baseline-9285a12/execution.json`、`vitest.json`、`output.log` |
| 2026-10-29 00:50:17–00:50:29 | 復旧修正の作業ツリー | 強制終了を含む重点2ファイル8件合格。`recovery-focused-r2/`。初回は子プロセスが待機中に終了する試験不備と、Windowsのrenameが旧空ファイルを置換する問題で2件失敗。子プロセスを維持し、rename前の旧形式検査を追加して再実行。初回記録も`recovery-focused/`に保持 |
| 2026-10-29 00:51:23開始 | 復旧修正後、旧試験の保存先設定を保持 | 権限制限下の診断3ファイル：16件合格・4件失敗。4件ともCLI子プロセスのホーム内保存先mkdir EPERMを捕捉（後述） |
| 2026-10-29 01:03:38開始 | 保存先を試験専用の一時フォルダーに分離した作業ツリー | 同じ権限制限・診断フックで3ファイル20件すべて合格（92.15秒）。fsの権限拒否出力なし |

上記のローカル生ログは`C:/git/open-estimate/.cache/review-recovery/`以下。`.cache`は配布対象外。新しい実行は別ディレクトリーに保存し、以前の結果を上書きしない。後続の最終確認と機械可読の要約は、この文書の末尾に追記する。

## コミット時の失敗6件と再確認

コミット報告チャット`01a182ba-2247-7c72-b76f-730d85aee144`の実行記録（turn `01a182fa-4d93-75e0-9914-9f1c9356ab75`）から回収した。元ログは表示上限で一部省略されており、全失敗の内部例外が残っているわけではない。権限を変えた新しい実行の成功だけを理由に、過去の原因を確定しない。

| ファイル / 試験名 | 当時のログで確認できる原因 | 今回の再確認 |
|---|---|---|
| `contract-worker.test.ts` / `validates UI and Web transfer contracts inside the actual Worker request context` | `.wrangler/tmp/dev-*`のmkdir EPERMでWorkerが起動できない。取得結果undefined | 変更前コミットの許可実行で合格。レビューでも同じ作成拒否を確認済み |
| `rules-release.test.ts` / `builds and runs a real rules-only Worker candidate while leaving plugin inputs unchanged` | Wrangler/esbuildがディレクトリー読取をAccess is deniedで拒否され、候補Workerを解決できずビルド失敗。Wranglerログ書込EPERMも併発 | 変更前コミットの許可実行で合格。前行とは拒否された場所・処理が異なる |
| `desktop-migration.test.ts` / `one-shot helper > keeps confirmed scope and ledger across processes, rejects unread/tampered evidence, and purges` | `HELPER_EXECUTION_FAILED`のみ。内部原因は当時のログから未確定 | 今回の権限制限下で同じ失敗を再現し、`<home>/.open-estimate/runs/<id>`のmkdir EPERMを捕捉。許可実行では合格 |
| `measurement-context.test.ts` / `keeps a fixed revision after current changes, saves immutable context, and rejects withdrawal` | 同上。当時の内部原因は未確定 | 今回の同条件診断でホーム内runsのmkdir EPERMを捕捉。許可実行では合格 |
| `measurement-context.test.ts` / `checks judgment references and ignores no caller override of the fixed revision` | 同上。当時の内部原因は未確定 | 今回の同条件診断でホーム内runsのmkdir EPERMを捕捉。許可実行では合格 |
| `recorded-helper.test.ts` / `saves invalid drafts and recorded exports across helper processes; only model crosses remote boundary` | 同上。当時の内部原因は未確定 | 今回の同条件診断でホーム内runsのmkdir EPERMを捕捉。許可実行では合格 |

診断では一時的なNodeプリロードでfsの拒否コード・操作名・パスだけを取得し、CLIの一般化されたエラーの内側を確認した。ソース本文や管理秘密は診断出力へ出していない。診断用フックは`.cache/fs-denied-diagnostic.mjs`であり、製品・配布へ含めない。

この4件を含むCLI試験3ファイルは、`OES_HELPER_STATE`だけでなく`OES_RUNS_ROOT`も各試験専用の一時フォルダーに固定するよう変更した。製品の既定保存先やエラーの機密情報保護は変更していない。修正後に同じ権限制限下で再確認し、許可実行の全回帰とは別に記録する。

保存先の分離途中は、セッションのフォルダー内へrunsを置いたため、purge後にセッションが空であるという2件の確認が失敗した。`verified-recovery-full`は459件合格・2件失敗で、試験ファイルの修正も実行中に重なったため`source_unchanged:false`。この実行を最終合格とは扱わない。セッションと保存結果を同じ一時ルートの別ディレクトリーへ分け、元のpurge確認を維持して再実行した。関連する試験失敗を環境障害へ読み替えない。

## 配布設定と実ホストの境界

以前の`plugin:smoke`は、`.mcp.json`の内容を検査しても、起動時には絶対パスの実行ファイルへ差し替えていた。今回、読み取った`command`と`args`をそのまま使い、宣言された`cwd`を移設先プラグインルート基準で解決して起動するよう修正した。空白を含む別ディレクトリーへ移設して検証する。実際の起動値を結果へ記録する。

これは配布設定を使うSDK起動試験である。実ChatGPTに新ツールが公開されて開始カード・PDF・同意・証明・保存・ブラウザーまで通ったことを示さない。このチャットで利用可能なOpen Estimateツールは旧版の6件で、`show_estimate_start`・`start_estimate_workflow`・`resume_estimate_workflow`等は未公開。`actual_host_tool_exposure:false`を維持する。M0/M5の実ホスト受入と本番完成判定は未完。

## 最終のローカル確認

2026-10-29 01:04:12 JST開始、148.65秒、`accepted-recovery-full`。ベースは`9285a12`、上記修正を含む未コミットの作業ツリー。Windows x64 / Node.js v24.18.1、許可されたローカル実行で、59ファイル461件すべて合格した。試験開始・終了時の対象11ファイルのSHA-256を照合し、実行中の変更なしを確認した。CLI試験の保存先修正も含む最終の全回帰として、この実行を採用する。

`npm run build`で生成後、最終ロック変更は`npx tsc`で再コンパイルし、`npm run typecheck`も合格。配布生成と、配布の`command:node`、`args:[./server/dist/index.js]`、`cwd:.`を使用する移設SDKスモークも合格。スモークは固定結果・PDF取得までを検査し、実ホスト受入とは区別した。

機械可読の記録は[evidence/workflow-recovery-2026-10-29.json](evidence/workflow-recovery-2026-10-29.json)。ベースコミット、実行日時・許可条件、件数、ソースのハッシュ、ローカル生ログのハッシュを保持する。生ログは`.cache/review-recovery/`に残し、要約はこの文書と共に配布へ含める。検証はコミット前のスナップショットを対象としており、保存コミットはこの文書のGit履歴で確認できる。配備は未実施、実ホストM0/M5は未完。
