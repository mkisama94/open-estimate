# Open Estimate 0.11.1（ローカル実行対応ホスト）

対象確認→ローカル解析→持出しMarkdown・UI・PDF→同意後の数値検証・文書証明→希望時の保存なしWeb表示。

Node.js 24以上、対象ファイルとCLIを実行できるWork/Codex環境が必要です。ローカルMCPはカード・ファイル取得、リモートMCPは公式ルール・匿名文書証明を担当。基本機能にAuth0や本人用Web保存は不要です。

estimate.md・document.json・estimate.pdfを提供し、証明取得後はproof.jsonを付属します。完成文書は元run・Web・MCPの停止後も表示可能。PDF自体は未署名。数値検証送信とWeb表示送信はそれぞれ明示同意を得ます。ソース・対象パス・詳細根拠・判断台帳はOpen Estimateへ送りません。AI解析では利用中ホストのモデル提供元で処理される場合があります。

取得範囲・事前容量・ネストしたrelease実装・分割取得・不足時停止を維持。部分値を総工数にしません。工数・時給はTEST参考値で、AI意味判断・ソース網羅性・実工数・提出者本人性を保証しません。

npm run build:local、plugin:packでrelease/local-marketplaceを生成し、plugin:smokeで移設起動を確認します。生成だけではインストール・本番配備・実ChatGPT受入は完了しません。

Web表示はHTTPSページを開き、estimate.mdと任意のproof.jsonを選んで送信します。未証明3操作・証明付き4操作が標準です。ローカルHTMLのfile://リンクは使いません。URLだけで文書を復元せず、送信・実表示の成功を別に確認します。

0.11.1では同意記録を要求・文書・送信先・目的ごとに保持します。未証明の表示後に証明を添付した場合も、変更後の要求への明示同意で続行でき、以前の記録は残ります。同一要求の再送では元の同意を使います。

操作・鍵管理は[運用手順](implementation/DOCUMENT-OPERATIONS.md)、実施済み・未実施の検証は[受入記録](implementation/SYSTEM-IMPLEMENTATION-ACCEPTANCE.md)を参照。旧保存・旧証明は互換用に維持し、新文書の完了条件にはしません。
