# 0.12.0 実装対応表

2026-10-28（JST）。完了範囲はSYSTEM-IMPLEMENTATION-ACCEPTANCE.mdを参照。

| 責務 | 対応ファイル |
|---|---|
| 正本・依頼・証明・公開契約 | src/contracts/estimate-result.ts、estimate.schema.json、生成済みestimate-*-validator.ts、contracts/estimate-*.schema.json |
| 生成と入力制限 | scripts/build-estimate-contracts.mjs。未知項目、自由記述、任意URLを排除。日時UTCミリ秒、非負10進文字列（冗長なゼロなし）、nullは未算出 |
| 新証明・検証 | src/proof/estimate-proof.ts。JCS/SHA-256・Ed25519・新ドメイン。署名/結果一致/発行元/環境を分離。失効はNOT_CHECKED |
| 数値照合と最小発行記録 | src/issuer/estimate-service.ts、validation.ts、0009。モデル・結果本文を記録しない。MCPはWebを呼ばない |
| 開始承認と適用 | src/local/workflow-consent.ts、estimate-workflow.ts、workflow-store.ts。開始条件と算定後要求を分離し、実回答のホスト申告を本人性証明と扱わない |
| 取得との接続 | CLI、MCP server、workspace-session。範囲内の分割・再取得・宣言済み部分試算を承認へ接続 |
| 固定結果・run接続 | create-document.tsのfixedDocumentFromRun、complete-workflow.ts。取得前後・対象・承認を確認。純粋な公開エンジンはファイル未作成の構造化入力でも動作 |
| 通信・復旧 | publication-client.ts。MCP SDKとWeb JSON、固定操作ID、有限再試行、取消後は読取専用復旧。秘密はローカルのみ |
| 開始・結果UI | workflow-widget.ts。未選択3項目、依存検査、中央値/部分値、品質・条件、PDF・URL・コピー・取消・停止 |
| 共通描画 | src/document/estimate-view.ts、estimate-pdf.ts。固定データのみでMarkdown/PDF/Web、日本語フォント埋込 |
| 公開保存・期限・停止 | public-results-repository.ts、public-results.ts、0010。新テーブルだけで原子的登録、ランダムID、365日、墓標を保持 |
| Web API・HTML | public-results-worker.ts、public-result-view.ts。JSON POST、通常GET、管理Bearer、no-store/noindex/CSP、返却直前の期限・DB状態確認 |
| 独立ビルド・配布・配備 | build-public-results.mjs、wrangler.public-results.jsonc、package-plugin.mjs、prepare-publication-staging.mjs |

Web受信上限128 KiB、MCPは既存1 MiB。集計・署名だけの正常fixtureと上限超過・重複JSONキー・未知項目を試験。配列・文字列・深さ・ノード数も制限する。匿名モデル上限は既存契約を維持する。

旧互換の利用理由と撤去条件はPUBLICATION-OPERATIONS.md。利用未確認の鍵・URL・データは削除しない。本番用信頼鍵とDB設定はステージングから独立して配置する。
