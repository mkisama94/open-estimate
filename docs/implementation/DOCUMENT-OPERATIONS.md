# 現行0.12.0の操作手順

新規フローは[一括同意・365日Web保存の運用](PUBLICATION-OPERATIONS.md)を使う。旧方式の文書証明・ファイル選択を新規手順へ持ち込まない。

---

実ホスト受入の現在地はPUBLICATION-STAGING-ACCEPTANCE.mdを参照。

以下は0.11.1の旧文書を扱う場合だけの互換手順。

# 持出し文書・証明・保存なし表示の運用

対象0.11.1。上位仕様はSYSTEM-SPEC.md。ローカル実装と配備・実ホスト受入は別。測定係数は変更しない。

## ローカル操作

CLIはJSONをstdinで受ける。create-document {run_id,display_currency} → 応答dirをdocument_dirとして使う。show-document、render-document-pdfは{document_dir}。必要な通貨換算は生成時にFRBへアクセスして固定し、再生成時は取得しない。

標準成果物はestimate.md（UTF-8、BOMなし、LF、末尾改行1個）、document.json、estimate.pdf。proof.jsonは取得後に追加。validation-input.json、local-reference.json、proof-request.json、consent-*.jsonはローカル管理用でWebへ渡さない。estimate.mdと任意proof.jsonだけで表示・署名検証でき、元runを要求しない。

ローカルMCPのshow_document、get_document_pdf、get_document_markdownでカードと取得を提供する。カード表示と「希望」ボタンは送信同意ではない。非対応時は本文とファイルに代替し、実UI確認済みとしない。

prepare-proof-request {document_dir}で実際のrequest・送信先・目的・hashを示す。consent-document-action {document_dir,action:"proof",request_hash,destination,user_confirmed:true,explicit_answer:<実回答>}後、proof-request-input {document_dir}から得たrequestをそのままissue_document_proofに渡す。attach-document-proof {document_dir,proof:<実応答>}は信頼鍵・文書hash・ルール・操作・発行元を検証して添付する。PDFは付属証明の番号等を記載するがPDF自体は未署名。障害時に元成果物は消さない。同一要求の再送は操作IDを作り直さない。

prepare-web-preview {document_dir} → 別の表示同意（action:"web"）→ open-web-preview {document_dir}。返却はWEB_PREVIEW_FILES_READY、HTTPSのurl、選択するfiles、operation_count。通常は「ページを開く→estimate.md選択→任意proof.json選択→表示」のファイル選択方式。未証明3操作・証明付き4操作を2026-10-28に利用者が選択した。get_document_markdown/get_document_proofからも取得できる。file://リンクやローカル送信HTMLの生成には依存しない。文書をURL・クエリ・fragmentへ入れず、事前サーバー保存もしない。準備・HTTP応答を表示成功と記録しない。

同意はconsent-{action}-{binding_hash}.jsonへ追記保存する。binding_hashはaction・document_sha256・destination・purpose・request_hashのJCS SHA-256。同じ要求では最初の同意を再利用し、異なる要求/送信先/目的への明示同意は別ファイルにする。完成した一時ファイルを排他的なハードリンクで確定し、競合時も先行記録を上書きしない。旧consent-{action}.jsonと要求hashだけの旧記録は一致する場合だけ読める。旧記録は削除・上書きしない。証明追加後の新同意なしでは送信準備を止め、新同意後にだけ進む。

本番とステージングの送信先はパッケージ内profiles/document-services.jsonで運用者が固定する。ツール引数による送信先変更は受けない。本番は正規originだけ、testはHTTPSのworkers.devだけを許可する。ステージング用の信頼鍵・スキル登録は専用配布内に閉じ、本番のカタログへ追加しない。専用DB/Worker/現在の証拠はDOCUMENT-STAGING-ACCEPTANCE.mdを参照。

## 独立ビルド・配備

- build:local：ローカル・契約・配布資材。
- build:document-web：表示専用bundleと依存一覧を.cache/document-webへ。DB・OAuth・数値計算・秘密鍵・ローカル実行を含めない。
- build:issuer：MCP Workerのdry-run。発行設定不足でもルール読取を止めない。
- test:document：契約・発行・表示・ローカル・依存境界。
- plugin:pack / plugin:smoke：配布生成と移設起動。インストール・配備はしない。

wrangler.document.jsoncはDB・OAuthなしの表示単独Worker。既存ホスト/previewはwrangler.jsoncのrun_worker_firstから独立アダプターへ分岐する。表示単独リリースに旧保存用配備スクリプトのDB・Auth0・スキル登録を要求しない。単独Workerへの/previewルート割当ては既存ホストとの競合を確認する。コードは本文をログせずno-store、observability無効だが、プラットフォームのHTTP bodyログ・監視・CDN設定は配備時に別確認する。

表示入力契約はcontracts/document-display.schema.json。format=oes/document-display/v1、ブラウザーフォームはencoding=utf8-base64urlを指定し、Markdownと任意proofを元UTF-8バイトから運ぶ。HTMLフォームによるLF→CRLF変換を避ける運搬形式であり、サーバーで文書を正規化し直す方式ではない。復号後Markdown256 KiB、proof32 KiB、HTTP受信全体1 MiB。未知形式・不正文字コード・BOM・CRLFは拒否する。

文書生成をcreate-document.ts、完成文書の読取・再表示をdocument-result.tsへ分離した。ローカルのdocument-ready.jsonとpdf-ready.jsonで固定文書・PDF・付属証明の対応を照合し、破損したPDFを取得済みと扱わない。持出し先に管理用markerがなくても文書自体は読め、PDFは固定文書から再生成できる。旧runがある場合の移行は旧ローカル参照のrun_idを確認しcreate-documentで新文書を作る。旧掲載同意は引き継がず自動送信もしない。

## 発行・鍵・保持

発行DBに0008_document_proof_issuances.sqlだけを適用しDOCUMENT_PROOF_DBへバインドする。旧Webテーブル不要。物理DB共用も可能だが新表を旧30日削除へ加えない。操作ID・要求指紋・証明番号・署名済み証明・日時・状態だけを保持し、本文・モデル・対象名・ログイン情報を保存しない。初期契約は無期限で自動削除・自動失効しない。

発行WorkerへDOCUMENT_ISSUER_ORIGIN、DOCUMENT_ENVIRONMENT（test/production）、DOCUMENT_SIGNING_KEY_ID（doc_test_/doc_prod_＋32桁hex）、DOCUMENT_SIGNING_PUBLIC_KEY、DOCUMENT_ISSUANCE_LIMITERを設定。秘密鍵PKCS8 base64urlはDOCUMENT_SIGNING_PRIVATE_KEYというWorker secretだけに置き、Git・配布・チャットへ入れない。検証後のみDOCUMENT_ISSUANCE_ENABLED=true（初期false）。初期制限は全体100件/分・記録100万件。

信頼公開鍵はprofiles/document-signing-keys.jsonへ運用者が別経路で検証して追加する。形式は{key_id,algorithm:"Ed25519",public_key,issuer,environment}。入力内の鍵・任意URLは信頼しない。テスト/本番を分け、旧鍵を維持。公開鍵配布→新発行鍵への切替の順とし、新発行停止でも文書・旧鍵・記録は保持する。オンライン失効照会は初期未提供、常にNOT_CHECKED。VALIDをACTIVEと読み替えない。

## 互換・廃止

remote基本ツールからpublish_estimate、get_estimate_experience、show_estimate_stepと旧UI resourceを除去。新経路はestimate-publishing・experience・Web保存へ到達しない。CLI旧掲載操作は退役エラーとし同名で意味を変更しない。旧ローカル表示MCP・旧保存API・保存結果・旧証明URLは互換として保持。core/certificate-verifyのweb/signingへの逆依存は純粋cryptoへ変更。旧公開鍵・データは削除しない。期限・利用状況を確認できない互換コードは残し、新経路からの非到達を依存テストする。任意保存の新機能は追加しない。Auth0は保存互換だけに残り、新基本機能の設定課題ではない。
