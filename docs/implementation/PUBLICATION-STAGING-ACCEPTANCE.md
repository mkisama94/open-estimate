# 0.12.0 一括同意・365日Web保存の受入証拠

2026-10-28（JST）。実装・配布版0.12.0、隔離した配備/インストール版0.12.0-staging.2。合成データだけを使用。本番のWorker・DB・信頼鍵・公開登録は変更していない。

## 確認済み

- 2026-10-28 22:50 JSTの作業ツリーでtypecheckとbuild成功、全回帰58ファイル457件合格（123.03秒）。固定ベクトル追加後の署名2件と型検査も合格。これはコミット時の別実行（451件合格・6件失敗）とは区別する。コミット`9285a12`と復旧修正の再検証は[復旧レビュー対応記録](WORKFLOW-RECOVERY-REVIEW.md)を参照。
- 新設test:publicationは6ファイル15件合格。独立WebビルドはDB/PDFを含み、数値エンジン・発行・ローカル状態・MCP接続・OAuthを含まない。旧独立プレビューのビルド/互換試験も合格。
- 移設配布物スモークは開始時のローカルのみ選択→取得→実例解析の保存→セッション削除→固定結果/PDF/カード読取を確認。検証・公開未選択時のOpen Estimate送信は0。
- 合成UIホストでは初期未選択、検証なし公開の拒否、検証解除に伴う公開解除、一度の開始保存を確認。部分試算カードの375px幅はscrollWidth 360pxで横あふれなし。これは実ChatGPTのMCP Appではない。
- 実ステージングで新方式の証明発行、同一要求の実ネットワーク再送、Webの原子的保存、同一URL/期限の再送、内容競合409、PDF、停止後HTML/PDFの410を確認。
- ChatGPT内ブラウザーで通常GETの結果URLを実表示し、修正版PDFをダウンロード。取得したPDFの全2ページを描画確認した。全体/部分サンプルも各2ページを確認。PDF生成時の二重サブセットによる文字欠落を修正し、フォントを完全埋込した。

最終ステージングAPI記録：
`C:\git\open-estimate\release\publication-staging\0.12.0-staging.2\acceptance\a8ed7cc3-097c-4cc6-8e4c-da83a24d9aaa\REPORT.json`。

通常GETで実表示した合成結果：
https://open-estimate-results-staging.mkisama.workers.dev/results/res_0085702bd29818c810790798f7301f4b

公開終了は2027-10-28T13:52:51.807Z。これは合成18時間/6CFPの動作確認であり、実案件の見積ではない。API記録のactual_user_consentとactual_chatgpt_full_journeyはfalseを維持する。

## 配備と分離

| 対象 | 専用ステージング |
|---|---|
| MCP | open-estimate-proof-staging /mcp |
| MCP版 | eacf2b1d-91a4-4834-a2b6-94296de4d076 |
| 発行DB | open-estimate-document-proofs-staging、9076c6c2-4047-47c4-b072-ecf0e5c3573c。旧0008を保持し新0009だけ追加 |
| Web | open-estimate-results-staging /api/results、/results/{id} |
| Web版 | a2d7d4cf-9547-4d6e-af43-e915fcbc52a5 |
| Web専用DB | open-estimate-public-results-staging、37bd7550-0eff-4696-8bd1-71727d70284d。0010のみ |
| 制限 | 発行・登録/管理は各20回/分の隔離制限。Workerの本文ログ/observability無効 |
| 定期削除 | 毎時17分、最大100件。読取時にも期限を検査する |
| 信頼鍵 | doc_test_675445bfe73203861868b8f45f3f61bb。既存のTEST鍵を保持。秘密鍵は既存Worker Secretのみ |

Webには発行秘密鍵も発行DBもなく、MCPにはWeb DBも公開URL管理もない。既存preview-staging、旧URL・旧記録・鍵は保持した。

## 実ホストの残作業

ユーザーの明示依頼で受入用チャット `01a182ba-2247-7c72-b76f-730d85aee144` を作成した。初回0.12.0-staging.1ではSkillだけが見え、開始・進行・証明ツールは公開されなかった。実ホストの開始カード表示・同意・解析は実施していない。

その後、ホストの実設定で、旧ローカル起動パスの`${PLUGIN_ROOT}`が展開されず、cwdへ文字列のまま追加されること、既存本番MCPとサーバー名が重なることを確認した。0.12.0-staging.2はcwdを相対の`.`、引数を`./server/dist/index.js`とし、stage専用のopen-estimate-local-staging / open-estimate-proof-stagingへ分離した。公式の配布元更新/インストール手順で更新し、キャッシュを直接編集していない。

`codex mcp list --json`は、修正後の実在するインストール先cwdとstage HTTPS先を返し、既存本番open-estimate接続も保持している。ただし、既存チャットの実行可能ツール一覧は旧版のままで、これを実ツール利用可能と読み替えない。受入チャットで修正版の接続を読み込み直し、新ツールを確認してから開始カードを提示する必要がある。

さらに、ホストに登録されたその起動設定をそのままSDKへ渡して起動し、0.12.0-staging.2の24ローカルツールと契約読取、指定されたリモートのissue_estimate_proofを確認した。結果は配布ルートのINSTALLED-PROTOCOL.json。ソース本文/見積データは未送信であり、actual_host_tool_exposureはfalseのまま。この検査を実チャットでのツール公開・UI表示と混同しない。

M0/M5は未完。必要なのは、合成対象examples/quality-checkに対して、実利用者の一回の開始選択から、実解析・結果カード・PDF・証明・保存・URL実表示を同じホストで通し、製品側追加同意とホスト独自確認を別々に記録すること。CLIや模擬ホストで代用しない。

## 証拠の場所と復旧

`C:\Users\yamamotoma\.codex\visualizations\2026\10\27\01a17dcf-30d6-77e0-8751-ee56cdd57566\publication-qa` にstaging-browser.png、synthetic-start.png、synthetic-partial.png、全体/部分PDFの全ページ画像、staging-downloadedの2ページ画像を保存した。合成開始状態はsynthetic-ui-stateにあり、実利用者同意とは扱わない。

Cloudflareの認証エラー10000は利用者の再認証後に解消した。初期版の不具合と記録は削除/上書きせず、修正版と関連付ける。本番配備は未実施。新規発行/登録の停止時も、既存公開の期限内読取・停止・検証鍵を保持する。

フォントの出典は公式notofonts/noto-cjkのNotoSansJP-VF.ttf。取得元SHA-256はf4b373b226668ee33a6e54b02823dcd2d1209f17159f777421ae8c2275160369、配布サブセットはae86f0280d210b29929785658d3ee8efef04a1b02de97f0ffa5e8e92fb66b1df。OFLを同梱し、PDF生成時の再サブセットは行わない。
