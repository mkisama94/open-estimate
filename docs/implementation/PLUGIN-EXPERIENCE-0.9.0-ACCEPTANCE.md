> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# Open Estimate 0.9.0 — 全工程の確認と本番反映

日付：2026-10-27 JST。

## 実装範囲

通常依頼を「開始案内 → 範囲同意 → ローカル解析 → 数値送信・本人用Web表示の同意 → 再計算とWeb結果 → 希望時だけ30日保存」へ統合。計算証明書は価値と提供状態を案内するが、未提供の発行・公開を有効にしない。

通常経路は証明書用公開候補を送らない。数値モデル、数値の品質集計・理由コード、通貨、スキル・測定規則版、結果照合hashを固定し、ブラウザー同意後に送信する。対象名・パス・根拠本文・自由記述説明を送らない。

## 確認済みの証跡

- ビルド成功。全43ファイル・408テスト成功（2026-10-27 18:45開始のリリース準備実行）。
- `tests/integration/estimate-experience.test.ts`：未承認拒否、PARTIALのWeb生成、他人の閲覧拒否、保存、期限切れ、入力改変拒否、応答喪失から同じ受付で復旧、機能照会失敗、UIへの任意URL・私的情報の混入拒否。
- `tests/fixtures/estimate-experience-browser-host.ts`：合成データ・合成本人確認による実コントローラー／CLI／対話カードの結合環境。本番Auth0や実ホストの代わりに合格判定しない。
- ブラウザーでカードの解析開始ボタン → 確認ページを開くボタン → 照合コードと同意 → 自動遷移 → 本人用Web結果 → 30日保存を実操作した。
- 画面で6 CFP、PARTIAL、工数12／18／30時間、合成為替150 JPY/USD、参考額90,000／135,000／225,000円、未署名・未公開、期限、証明書未提供を確認。利用者のプロジェクト見積ではない。
- ブラウザー記録：`.cache/experience-browser/68e0046a-078d-4b3c-bc88-8e425a0f8a8e/` の `browser-observations.json` と `cli-result.json`。ローカルポートや一時URLは配布先ではない。
- カードのWeb遷移はMCP Appsの `ui/open-link` を利用。ホストが拒否・未対応の場合はチャットのリンクへ戻る。仕様参照：[MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)。

## 本番反映の順序

以下は実行手順であり、この文書を追加しただけでは本番へ反映されない。公開済み0.8.1を同版のまま差し替えない。

1. 配布候補を生成・検証する。実施済みなら同じ凍結候補を再利用する。

   ```powershell
   Set-Location C:\git\open-estimate
   npm run release:prepare -- --version 0.9.0
   ```

2. DBに新しい同意種別を追加する。既存の同意履歴は保持する。

   ```powershell
   npx wrangler d1 migrations list open-estimate-certificates --remote --config wrangler.jsonc
   npx wrangler d1 migrations apply open-estimate-certificates --remote --config wrangler.jsonc
   ```

   `0006_estimate_preview_consents.sql` の適用を確認。0004／0005だけでは新版の同意を保存できない。

3. 検証済みのMCPとスキル登録・marketplaceを正式リリースする。

   ```powershell
   npm run release:publish -- --version 0.9.0
   ```

   受信側登録の確認後に `release/desktop-marketplace` が昇格する。未公開候補のスキルを先に本番接続で使わない。

4. Webを専用の配備処理で反映する。

   ```powershell
   npm run deploy
   ```

   実バンドルのhashと版を設定し、本人用Webを有効化する。単独の `npx wrangler deploy` は使用しない。既存の認証・プレビュー秘密値を維持。発行と一般公開は無効のまま。

5. 更新された配布登録を含めてGitに反映する。Cloudflare自動ビルドはMCPが `npm run ci:mcp:build`／`npm run ci:mcp:deploy`、Webが `npm run build`／`npm run deploy`。未公開0.9.0を先にpushすると登録整合性チェックが停止するため、公開処理と順序を合わせる。

6. 更新後の `release/desktop-marketplace` からプラグインを再インストールし、新規チャットで0.9.0と新ツール `get_estimate_experience`／`show_estimate_step` を確認。旧チャットのツール定義を流用しない。

## 実ホストでの最終確認

「Webに掲載して」は追加せず、「このプロジェクトを見積もってください」と依頼する。

- 初回にWeb・保存・計算証明書・提供状態・プライバシーと段階を示すカードが出る。
- 対象同意は選択式。解析後に公式Webの確認ボタンと照合コードが出る。
- 本人ログイン後に送信同意するとWeb結果へ移動。チャットにも実結果URL・期限・開く操作が戻る。
- 数値とPARTIAL／TEST／未署名表示が一致。任意で30日保存し、一覧から再び開ける。
- UI非対応・失敗時も同じ全体像と代替の選択肢・リンクが残る。実カード成功とは別に記録する。

製品名・版、埋込UI可否、日時、本人ログイン、カード操作、最終URL閲覧を記録し、仕様AC-01〜16へ照合する。

本番デプロイ、実インストール更新、実ホスト内カード、実Auth0ログインによる新経路の受入は未実施。ローカル確認だけで本番受入を合格としない。
