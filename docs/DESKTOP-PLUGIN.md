# Open Estimate 0.13.0

通常の配布・インストール先は `open-estimate@open-estimate-desktop` に一本化する。0.13.0は開始カードへの確認一本化、保存済み下書き・評価runからの復旧、取得要約と詳細ページを含む。旧ローカル版・ステージング版の別登録を新規の利用入口にしない。正規URLの証明・Web保存は配備状態を確認し、ローカル検証の成功と区別する。

本文を読まない対象確認後、読取・検証・365日のWeb公開を一度に選び、固定した参考工数・結果カード・PDF・希望した公開URLを得ます。読取は必須、検証と公開は任意、公開には検証が必要です。選択済み工程の正常系では追加の製品側同意を要求しません。

ソースはOpen Estimateへ送らず、AI解析ではモデル提供元で処理される場合があります。MCPには匿名数値等の検証入力、Webには集計結果・計算/為替条件・品質コード・証明だけを送ります。ログイン不要のURLは知る人が閲覧でき、最初の公開から365日で終了します。手元のPDFはその後も利用できます。

Node.js 24以上が必要です。show_estimate_start / start_estimate_workflow / issue_estimate_proofが接続先にあることを確認してください。操作は同梱implementation/PUBLICATION-OPERATIONS.md、対応表はPUBLICATION-IMPLEMENTATION-MAP.md、受入状態はSYSTEM-IMPLEMENTATION-ACCEPTANCE.mdを参照。ローカル・ステージング・本番・実ホストの確認状態を区別します。

取得は一度行い、状態確認や入力修正でやり直しません。通常はprepare-summary → snapshot-page/read → save-draft → evaluate-draft → complete-estimate-workflow。MCPの対応操作と旧形式の互換方針はimplementation/DRAFT-RECOVERY-API.md、今回の検証と既存見積の回収結果はDRAFT-RECOVERY-ACCEPTANCE.mdに記録しています。

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
