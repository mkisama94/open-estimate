# 新システム受入記録

対象0.11.1、2026-10-28。0.11.0の初期検証記録も保持する。上位仕様SYSTEM-SPEC.md、指示SYSTEM-IMPLEMENTATION-PLAN.md。ローカル・ステージング・本番・実ChatGPTは別に記録。

## 状態

0.11.1で再同意不具合を修正し、専用DB・テスト鍵・発行/表示Workerをステージングへ配備した。実MCP発行・再送・証明添付・再同意・HTML受信は合格。ChatGPT内ブラウザーのファイル選択→POST→署名確認の実表示も合格。ただし、新しいプラグインを読み込んだ実ChatGPTでのカード→PDF→対話の同意→証明→表示という全工程は未完。現在のチャットには新ツールが未読込。利用者向けの全体受入完了ではなく、本番反映もしていない。OAuthは新基本経路の不足項目ではない。

## 0.11.1 レビュー対応

- P2：未証明でのWeb同意→証明追加→新しい明示同意→表示準備の復旧を確認。要求・文書・送信先・目的ごとの記録とし、旧記録・最初の同意日時を保持。同一要求再送と変更後再同意を別に検査。旧action-onlyファイルが残る条件、同時保存、不一致記録の上書き拒否も確認した。
- ローカル全体：52ファイル・442件合格。文書関連5ファイル・19件、およびMCP接続7件も合格。型検査・ビルド・移設した0.11.1配布の起動確認も合格。
- ステージング：0.11.1-staging.2、匿名発行・同一要求再送・信頼鍵による添付・再同意・PDF/証明JSON取得を実サービスで確認。実ChatGPTのカード描画/取得操作はこのプロトコル試験から推定しない。
- 実ブラウザー：ChatGPT IABで合成estimate.mdとproof.jsonを実選択してPOST。TEST環境の証明確認、signature VALID/document MATCH/issuer TRUSTED/current_status NOT_CHECKEDを表示した。カードから始まる一連の操作ではない。
- file://受渡しHTMLはIABのURL安全ポリシーに拒否された。回避せずHTTPSファイル選択で確認し、利用者が「ファイル選択方式で受入を進める」と回答。未証明3操作・証明付き4操作を標準に切替え、open-web-previewもHTMLを生成せずURLとファイルを返す。

ステージング配備・実行条件・画面証拠・未実施項目は[詳細記録](DOCUMENT-STAGING-ACCEPTANCE.md)に記載。

## 対応表

| 項目 | ファイル |
|---|---|
| 文書・依頼・証明契約 | contracts/document.ts、document.schema.json、standalone validators |
| 固定テンプレート・表示 | document/markdown.ts、presentation.ts |
| オフライン検証 | proof/verify.ts、crypto.ts |
| 発行・鍵・最小記録 | issuer/service.ts、validation.ts、signing.ts、repository.ts、runtime.ts、移行0008 |
| ローカル・PDF・同意・受渡し | local/create-document.ts、document-result.ts、document-paths.ts、estimate-pdf.ts、document-consent.ts、web-handoff.ts |
| カード・取得 | local/document-widget.ts、mcp/server.ts |
| 独立Web表示 | web/document-preview.ts、document-worker.ts、wrangler.document.jsonc |
| 配布・旧互換隔離 | remote/worker、local/cli、CI・pack・Skill・DOCUMENT-OPERATIONS.md |

## ローカル証拠

2026-10-28、Windows / Node.js 24.18.1。実装パスは特記なければsrc配下。合成fixture・テスト鍵の結果を本番証明や実ホスト受入と呼ばない。

| 確認 | 結果・証拠 |
|---|---|
| 全体回帰 | npm test -- --maxWorkers=2：51ファイル・439件すべて合格（最終実行109.07秒）。旧保存・旧証明・85 MiB対象外資料・ネストしたrelease・分割取得を含む |
| 契約・改変 | 固定LF/BOMなし/末尾改行、キー順序非依存、数値・為替・ルール不一致、未知形式・追加項目、独立署名ベクトル、環境/未知鍵/文書改変を確認 |
| 発行DB・競合 | Miniflareの実Worker・新D1表だけで匿名発行・並行再送・単一記録・競合拒否を確認。OAuth・旧Web表・所有者セッションなし |
| 独立署名確認 | Web Crypto署名を独立したキー順序処理とNode Ed25519検証でも照合。tests/fixtures/document-vector.jsonに固定の文書・依頼・証明・公開テスト鍵を保存 |
| ローカル分離 | 元runを切り離した表示/PDF再生成、完成文書readerの数値エンジン非依存、同意前送信0、目的/送信先/要求hash不一致拒否、PDF破損検出・復旧を確認 |
| 独立ビルド | build:local / typecheck合格。build:document-webは12依存・約309 kBで、発行/DB/OAuth/数値計算/PDFを含まない。build:issuerと表示単独wrangler dry-runも合格。表示単独はbindingsなし |
| 実ブラウザー・ローカル | Edge headlessで全体/部分のファイル選択→native POST表示、改変バッジ拒否、カード詳細・Markdown/PDF取得・希望選択・430px幅を確認。カードホストは合成shimで実ChatGPTではない |
| フォーム受渡し | 実生成したローカルHTMLからnative POSTを行い、隔離ローカルサーバーへrouteして検証。UTF-8をbase64url運搬し、ブラウザーフォームのCRLF変換を回避。元バイト一致・URL本文なし・モデル送信なし。実サービスへの送信0 |
| PDF | 全体/部分の合成PDF各3ページ、計6ページをpypdfium2で描画し全ページ目視確認。証明ページ、番号・ハッシュ・検証方法、PDF自体未署名、全体未算出/部分値の区別を確認 |
| 配布 | plugin:pack成功（0.11.0、production依存115、同梱5137ファイル）。plugin:smoke成功：別ディレクトリーへ移設しCLI・purge後run・文書カード・hidden metadata経由PDF取得を確認。インストールは未実施 |

ローカルブラウザー/PDFの証拠ディレクトリ：C:/Users/yamamotoma/.codex/visualizations/2026/10/27/01a17dcf-30d6-77e0-8751-ee56cdd57566/document-system-qa 。browser-report.json、画面PNG、PDF、公開テスト鍵を保持。18時間は合成値で、subsidy_ai_pluginの再見積ではない。テスト秘密鍵はtests内の固定seedだけで、配布・本番信頼カタログへ含めない。

## 段階別の判定

M1/M2はローカル実装・独立試験済み。M3/M4/M5はローカル接続・ブラウザー・依存境界まで確認済み。M0の実ホスト境界とM6の実環境全工程は未達。模擬カード、ローカルHTTP成功、署名単体の合格を実ChatGPTの標準体験成立と読み替えない。

初期版のローカルHTML方式は標準から除外した。現在の標準は同意後にHTTPS表示ページを開き、Markdownと任意証明を選んで送信する方式（未証明3操作・証明付き4操作）。ファイル選択経路の実表示は確認済みで、新カードから始まる全工程の受入が未達。

## 削減と互換

基本MCPの旧保存ツール・Web能力照会・進捗UIの宣言/呼出元を除去。CLI旧掲載操作は退役エラー。旧Web保存API・保存結果・ログイン・旧証明URL・旧ローカルプレビューは互換用に残し、新しい文書/証明/表示から到達しないことを検査した。旧暗号検証のweb逆依存を純粋cryptoへ変更。既存データ・公開鍵は削除していない。旧モジュールを無理に新発行へ流用していない。

## 外部受入の残項目

1. ステージング配布物を実ChatGPT/対応ホストへ読み込み、新しいカードの表示とPDFの取得操作を確認。
2. 用意した未証明・未同意の合成文書で、実際の対話による同意→MCP証明→署名添付→別の表示同意→HTTPSファイル選択表示を同じホストで通す。
3. 発行停止・Web停止等の実環境での失敗復旧と、プラットフォームの本文ログ/CDN設定を確認。未確認をACTIVEや保存なしの運用保証へ読み替えない。
4. 本番反映は別途実施し、本番環境の鍵・カタログ・配布整合性と同じ合成fixtureを確認する。

最終状態は見積作成・証明取得・Web表示・任意保存を分ける。自動受渡しが成立しなくても旧保存へ戻さない。
