# 0.9.0 本番テストで判明した入力検査の不具合

2026-10-27。通常依頼の実テストで確認カードが失敗し、Web受付作成がSTATUS_UNAVAILABLEとなった。

## 原因と証拠

- 本番のshow_estimate_stepを正しいstage/error_codeで呼んでもREMOTE_EVALUATION_FAILEDを再現。
- 本番機能照会はAVAILABLE、受付APIのGETは正常な404。しかしPOSTによる不正入力検査は期待する400/INVALID_INPUTではなく503/STATUS_UNAVAILABLE。
- 利用者のローカル状態はattempted=true、transfer_id=null。ローカルのsubmissionは保存済みだが、サーバー受付IDは取得できていない。「受付を保持」はこの二つを区別する必要がある。
- 同じcheckContractを実Workerのリクエスト中に実行すると `Code generation from strings disallowed for this context` を再現。AJVが最初のリクエスト時に検査関数を生成する実装が原因。
- Node上の結合試験では動作する。従来のWorker試験は起動時に検査関数を作る再計算経路を検査しており、この問題を捕捉しなかった。機能照会とGETだけの配備後検査も不十分だった。

## 修正

最初に起動時コンパイルへ変更したが、Web Workerが起動CPU制限（10021）で拒否されたため、この方式は撤回した。

最終修正では、MCPカード、機能照会、Web受付、承認後送信、結果読出し、保存結果、証明書関連の30契約をビルド時にAJV standaloneで生成する。prepareContractsは生成済みの関数を対応付けるだけにする。登録済み契約が欠けていれば失敗とし、リクエスト中の動的コンパイルへ戻らない。配備前には生成済みファイルと現在の契約が一致するかも検査する。入力検査の省略や実行制限の緩和は行わない。

実Worker回帰試験を追加。修正後にscopeと受付契約が成功し、不正な送信入力・結果DTOがINVALID_INPUTで拒否されることを確認する。MCPの配備後検査にも実カードツール呼出し、Webには保存を発生させない不正入力POSTを追加する。

## 反映

起動CPU検査：2026-10-27、修正したWebをversions uploadで候補アップロード。起動時間406msでCloudflareの検査を通過。候補ID `cb928bb7-614d-406a-9159-19555772180e`、engine `0.9.0+web.705e5eca0d3c`。本番へのトラフィック切替は行っていない。

MCPの前回修正が既に反映されている現在の環境では、残る操作は `npm run deploy` によるWeb反映。以下は両Workerを新規に揃える場合の手順。

スキル本文と接続先、通常見積の入力契約は変更しない。既存の正式登録済み0.9.0クライアントを継続使用できる。DB追加更新と再インストールは不要。

```powershell
Set-Location C:\git\open-estimate
npm run ci:mcp:build
npm run ci:mcp:deploy
npm run deploy
```

この修正には現在のソースからビルドする上記コマンドを使う。既存の0.9.0凍結候補をrelease:publishで再配備すると修正前のWorkerとなるため使用しない。公開済み凍結候補は書き換えない。

反映後は現在のローカルrunを保持したまま、同じsubmission_idでresume-estimateを試す。受付の期限切れが確認された場合だけ同じrunから新しい送信準備を作る。再解析は不要。数値送信と15分Web保持は本人のブラウザー同意後に実行する。

ローカルHTMLやPDFは本人用Web結果の代わりにしない。URLが未作成なら原因と再開手順を提示する。UIが失敗したときに自由記述だけへ戻った挙動も、実ホスト受入の未達として残す。

この記録はローカル修正・検証であり、本番反映後の実結果表示まで完了した記録ではない。

検証結果：2026-10-27 22:12開始の全44ファイル・409テスト成功。追加した実Worker回帰試験、既存の本人用Web／保存／復旧試験を含む。MCPのdry-runとci:web:checkも成功。スキル本文・配布hash・DBスキーマは変更していない。

事前生成方式への変更後も、22:25開始の全44ファイル・409テストが成功。Cloudflare起動検査を通過した候補と、最終ソースのWebバンドルhash `705e5eca0d3cafbcb2904f09c01c72bdf33402705b1c1ccdb2e604bd1a7f79e6` の一致を確認した。
