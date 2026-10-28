# チャット内プレビュー・PDF・認証済み掲載（0.10.0）

標準フローは、対象範囲の確認 → 解析 → ローカルのチャット内プレビューとPDF → チャットで一度の掲載同意 → 本人用Web結果の30日保存。一般公開・証明書発行は含まない。

## 共通の確定結果

`oes/estimate-snapshot/v1` は数値モデル、確定した数値結果・品質集計、取得範囲の充足、測定日、計算条件と為替条件を持つ。ソース・名称・対象パス・根拠本文・判断台帳を受け付けない。プレビュー・PDF・Webは同じsnapshotを使う。媒体の表示時に金額や工数をAIが転記したり別の条件で計算し直したりしない。取得充足がMISSING/UNKNOWNなら、全体工数を未算出と表示する。計数状態のCOMPLETE/PARTIALとは別の状態である。

ローカル専用の対象範囲・取得制約はsnapshot外のlocal_detailsに持ち、掲載requestに混入させない。詳細の展開は送信しない。標準PDFに詳細パスやソースを入れない。PDFは日本語フォントを埋め込み、掲載前と明示する。フォントはNoto Sans JPのサブセットで、profiles/report-font-OFL.txtに再配布ライセンスを同梱する。

## ローカル操作

- `prepare-result-preview {run_id,display_currency}`：保存済みrunを検査し、固定snapshot・PDF・ローカルHTMLを生成。Open Estimateとの通信はしない。必要な為替取得先はFRBのみ。
- `show-result-preview {preview_id}`：同じ結果とPDFを読む。再計算・送信はしない。
- `regenerate-pdf {preview_id}`：同じ結果からPDFを再生成。失敗はPDF_INCOMPLETE。旧成果物を保持する。
- ローカルMCP `preview_saved_estimate`：結果カードを表示。`get_result_pdf`：検査済みPDFを返す。リモートMCPに結果を送って表示しない。
- `consent-estimate {preview_id,snapshot_hash,user_confirmed:true}`：明示回答後だけ実行。結果hash、項目、送信先、本人限定、30日保存、規約版、日時を固定する。
- `publication-input {preview_id}`：同意済みの同じrequestを返す。remote `publish_estimate`へそのまま渡す。ログインが必要ならホストOAuthへ移り、同じ操作に戻る。
- `record-estimate-publication {preview_id,result}`：URL・期限・内容対応を検査し、応答を追記保存する。
- `publish-result {preview_id}`：ホスト管理のOES_ESTIMATE_ACCESS_TOKENを使える実行環境向けの同一API代替。3回以内の限定再試行。同じJSONと操作IDを再使用。資格情報を引数やチャットへ渡さない。

ローカルUIはMCP Apps標準ブリッジとOpenAI互換ブリッジを備える。詳細の開閉・再描画は表示のみ。掲載ボタンは明示的な選択をチャットへ返し、表示だけで送信しない。未対応時は本文・PDF・ホスト標準の確認操作へフォールバックする。ローカルブラウザーでの合成ブリッジ試験は、実ChatGPT受入の代わりではない。

## 掲載APIと認証

`publish_estimate` と `POST /api/v1/estimates` は同じEstimatePublicationServiceを使う。OIDC署名・固定issuer・audience・期限・許可client・estimates:write scopeを検証し、issuer/subから所有者を決める。owner_idを本文から受け取らない。MCPはOAuth protected resource metadataとツールのsecuritySchemesを公開し、必要時だけ認証チャレンジを返す。認証の方式は[公式認証仕様](https://developers.openai.com/plugins/build/auth)に従う。

入力・計算条件・モデルからの算術結果・品質の整合性・固定した為替条件を検査する。サーバーが現在レートや別の数値へ差し替えることはない。不一致は保存前に拒否する。FXの出所・ソース網羅性・意味解釈の独立監査を保証するものではない。

保存はD1の同一トランザクションで行う。認証済みownerとoperation_idに対して内容指紋を固定し、同一再送は同じURL、異なる内容は拒否。保存後に応答を失っても同じrequestで復旧する。所有者別・全体の件数上限とレート制限を維持する。保存一覧、延長、削除は既存の本人用画面を使い、変更操作のOrigin/CSRF検査を維持する。ログイン後の戻り先は本人用結果URL等の許可パスだけとし、任意URLを受け付けない。

## 移行と廃止

通常見積の旧prepare-estimate/preview-estimate/resume-estimate、リモートのevaluate_model/show_preview_confirmation、数値転送の作成・承認・送信を廃止。未送信の旧受付は `migrate-estimate {submission_id}` で保存済みrunから新しい確認を作る。自動送信しない。READY済みの旧一時URLと旧保存済み結果は従来の期限まで閲覧可能。証明書用の転送・承認は分離して残し、発行・公開を新たに有効化しない。

## 配布・運用

配布物はローカル表示用stdio MCPと、認証済み掲載用remote MCPを持つ。PLUGIN_ROOTによる相対参照で移設可能。Node.js 24以上、ローカル実行・ローカルMCP・MCP Appsを使えるホストが対象。対応しないホストにIntelligent UIの成功を約束しない。

0007_direct_estimate_publications.sqlを適用し、WebとMCPで同じD1を使用する。両WorkerへAUTH0_ISSUER、AUTH0_API_AUDIENCE、AUTH0_MCP_CLIENT_IDSと掲載用rate limiterを設定する。Auth0で対象APIのaudience、estimates:write scope、ホストclient、PKCE・OAuth接続を設定する。API audienceと許可client IDは秘密ではないが、既存Webログインclient IDから推測して設定しない。Webログインの検証済みissuer/subと一致するアカウントを使う。

ESTIMATE_PUBLICATION_ENABLEDは初期状態で無効。設定・移行・配布カタログの更新・実ホスト試験を確認して有効化する。CIは設定不足や旧ツールへの依存を検出する。D1の保存結果と操作記録は期限後の定期処理で削除する。旧URLの失効処理は互換用に残す。
