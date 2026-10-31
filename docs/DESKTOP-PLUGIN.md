# Open Estimate 0.15.0（ローカル検証用配布候補）

許可された対象への見積依頼から、追加の読取チェック・開始ボタン・同じ回答の再要求なしで取得・解析し、結果とPDFを作ります。対象と取得上限・データ取扱いは短く案内し、案内への回答を待ちません。

検証・証明と365日のWeb公開は任意です。希望時だけ送信先・項目・目的・品質・公開範囲を説明し、実際の回答または外部承認画面の操作を記録します。説明済み条件への明示依頼は再質問しません。公開には検証が必要です。外部選択待ちでローカル作業を止めません。

ソース・対象パス・名称・根拠・判断台帳はOpen Estimateへ送りません。ホストAIによる解析では、利用中のAIサービスのモデル提供元で処理される場合があります。公式ルールや為替の取得通信は、見積由来情報の送信と区別して案内します。

Node.js 24以上が必要です。ローカルMCPで次の操作を確認してください。

- `show_estimate_start` → `begin_estimate_workflow`：準備したworkflowへ実際の依頼を記録し、直ちに取得・解析を続行します。
- `show_estimate_transmission` → `approve_estimate_transmission`：外部操作を希望した場合だけ使用します。
- `cancel_estimate_transmission`：未送信の外部操作だけを取消し、ローカル作業を保持します。
- `cancel_estimate_workflow`：見積全体を中止します。

CLIも同じ機能をハイフン区切りのコマンド名で提供します。標準の取得・評価はprepare-summary → snapshot-page/read → save-draft → evaluate-draft → complete-estimate-workflowです。固定結果と同じ操作IDで再開し、旧承認を新しい再計算結果に流用しません。

通常のプラグインIDは `open-estimate@open-estimate-desktop` を維持します。この配布候補の生成とローカル検証は、インストール更新・本番登録・配備・実ホスト受入とは別です。公式ルール取得先への0.15.0の正規登録とホストの更新・再接続後、実ホストで確認してください。未登録版のために整合性検査を迂回しないでください。

仕様・対応表・検証状態と更新手順は同梱の[実装・受入記録](implementation/LOCAL-UX-IMPLEMENTATION-ACCEPTANCE.md)と[ローカル利用体験仕様](implementation/LOCAL-UX-AND-TRANSMISSION-SPEC.md)を参照してください。`test:publication`と`build:publication-web`は保存系の検査コマンドです。`test:document`と`build:document-web`は旧文書・保存なしプレビューの互換検査として維持します。

公開URLを知る人はログインなしで保存結果を閲覧でき、最初の公開から365日で終了します。ダウンロード済みPDFはその後も読めます。証明は固定した数値結果の検査範囲を示し、実工数・意味判断・ソースの網羅性・本人性は保証しません。

---

以下は旧0.11.1の既存文書に限る互換資料です。新規フローの手順ではありません。

# Open Estimate 0.11.1（ローカル実行対応ホスト）

対象確認→ローカル解析→持出しMarkdown・UI・PDF→同意後の数値検証・文書証明→希望時の保存なしWeb表示。

Node.js 24以上、対象ファイルとCLIを実行できるWork/Codex環境が必要です。ローカルMCPはカード・ファイル取得、リモートMCPは公式ルール・匿名文書証明を担当。基本機能にAuth0や本人用Web保存は不要です。

estimate.md・document.json・estimate.pdfを提供し、証明取得後はproof.jsonを付属します。完成文書は元run・Web・MCPの停止後も表示可能。PDF自体は未署名。数値検証送信とWeb表示送信はそれぞれ明示同意を得ます。ソース・対象パス・詳細根拠・判断台帳はOpen Estimateへ送りません。AI解析では利用中ホストのモデル提供元で処理される場合があります。

取得範囲・事前容量・ネストしたrelease実装・分割取得・不足時停止を維持。部分値を総工数にしません。工数・時給はTEST参考値で、AI意味判断・ソース網羅性・実工数・提出者本人性を保証しません。

npm run build:local、plugin:packでrelease/local-marketplaceを生成し、plugin:smokeで移設起動を確認します。生成だけではインストール・本番配備・実ChatGPT受入は完了しません。

Web表示はHTTPSページを開き、estimate.mdと任意のproof.jsonを選んで送信します。未証明3操作・証明付き4操作が標準です。ローカルHTMLのfile://リンクは使いません。URLだけで文書を復元せず、送信・実表示の成功を別に確認します。

0.11.1では同意記録を要求・文書・送信先・目的ごとに保持します。未証明の表示後に証明を添付した場合も、変更後の要求への明示同意で続行でき、以前の記録は残ります。同一要求の再送では元の同意を使います。

操作・鍵管理は[運用手順](implementation/DOCUMENT-OPERATIONS.md)、実施済み・未実施の検証は[受入記録](implementation/SYSTEM-IMPLEMENTATION-ACCEPTANCE.md)を参照。旧保存・旧証明は互換用に維持し、新文書の完了条件にはしません。
