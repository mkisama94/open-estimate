# 仕様文書の基準

2026-10-31更新。

正式な目標仕様は[Open Estimate システム仕様](implementation/SYSTEM-SPEC.md)。実装済み状態を表す文書ではない。

実装対象・移行順序・単体／契約／実ホスト受入は[新システム実装指示書](implementation/SYSTEM-IMPLEMENTATION-PLAN.md)に定める。

ローカル利用体験と外部送信確認の詳細は[ローカル利用体験と外部送信の確認](implementation/LOCAL-UX-AND-TRANSMISSION-SPEC.md)。許可された対象への見積依頼から読取の再確認なしで進め、外部送信だけを説明した条件への明示意思で実行する。開始方法は[開始方法・見積の版・再開](implementation/START-METHODS.md)に従う。

2026-10-31の変更は仕様更新のみ。0.14.0の実装・同梱Skill・配布済みプラグインには旧読取同意が残る。LUX01〜LUX12の実装・受入は未実施であり、過去の合格記録を新仕様の合格とみなさない。2026-10-28の改善仕様案の開始画面と同意条件は設計履歴として扱う。

## 削除した旧仕様

- `PRODUCT-ARCHITECTURE.md`
- `PLUGIN-EXPERIENCE-SPEC.md`
- `PLUGIN-EXPERIENCE-IMPROVEMENT-PROPOSAL.md`
- `OWNER-WEB-PREVIEW-IMPLEMENTATION.md`
- `ESTIMATE-PREVIEW-PUBLICATION.md`
- `MCP-CHATGPT-PLUGIN.md`
- `PLUGIN-IMPLEMENTATION.md`
- `WEB-API-IMPLEMENTATION.md`
- `SHARED-SPEC.md`

旧仕様本文はGit履歴で参照する。測定・取得・計算・暗号検証の個別仕様、運用手順、受入記録・JSON・画像は技術資料と証跡として保持する。矛盾する構成・認証・保存の前提は新システム仕様を優先する。既存実装との互換性を確認せず、残存技術仕様のAPIを新仕様の完成契約と扱わない。
