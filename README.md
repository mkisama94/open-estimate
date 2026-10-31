> **0.15.0 実装状況**：依頼からのローカル開始と任意の外部承認を分離し、ローカル配布候補を生成しました。全回帰66ファイル512件合格。公式サーバーの0.15.0登録・ホスト更新・実ホスト受入は未完です。詳細は[実装・受入記録](docs/implementation/LOCAL-UX-IMPLEMENTATION-ACCEPTANCE.md)を参照してください。

> **仕様更新（2026-10-31）**：構成・責務・利用フローは[システム仕様](docs/implementation/SYSTEM-SPEC.md)を基準とします。[ローカル利用体験と外部送信の確認](docs/implementation/LOCAL-UX-AND-TRANSMISSION-SPEC.md)では、許可された対象への見積依頼から読取の再確認なしで進め、任意の検証送信・Web公開だけを説明した条件に基づいて確認します。この改訂は仕様のみで、実装・配布更新は未実施です。以下は旧版の記録であり、対象読取への追加同意、Web保存必須、表示時の再計算、認証との結合等の旧前提を新規設計へ適用しません。過去の合格記録は新仕様の受入完了を意味しません。

# Open Estimate (OES) — Work／Codex・ローカル実行向け 0.9.0

**通常の見積から本人用Web表示までを実装しました。** 開始案内・対象への同意・解析・数値送信とWeb表示への同意・結果URL・任意の30日保存を一続きにします。対話カードと非対応環境の代替導線、計算証明書の説明を含みます。本番反映と実ホスト受入は未実施です。[新システム仕様](docs/implementation/SYSTEM-SPEC.md)／[実装状況](docs/implementation/PLUGIN-EXPERIENCE-IMPLEMENTATION-STATUS.md)／[検証・本番反映手順](docs/implementation/PLUGIN-EXPERIENCE-0.9.0-ACCEPTANCE.md)。以下の旧版記録より本節を優先します。

)
