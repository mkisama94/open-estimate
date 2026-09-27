# Open Estimate — 見積詳細・SNS共有 実装仕様・受入基準書
## 仕様ID: OES-SHARE-0.1.0-draft.1

作成日：2026-09-27  
改定日：2026-09-27 (根拠情報・測定対象分離・出典リンク拡充)  
対象：日本語の見積詳細ページ、公開要約、SNSプレビュー、公開確認・撤回  
正本：本仕様書、`contracts/public-estimate.schema.json`。表示確認：`mock/estimate-detail.mock.html`。  
**注意：本パッケージはモックと設計契約であり、稼働済みの公開API・署名サービスではない。**

---

## 1. 概要とアーキテクチャ

### 1.1 目的
利用者がAI等を用いて開発したアプリケーションのCOSMIC機能規模測定結果および参照工数換算レポートを、第三者やSNSへ安全・誠実・客観的に共有できるようにする。
特に「この数字は何を対象に、何を根拠に出したのか」を第三者が客観的に追跡・検証できる情報構造を提供する。

### 1.2 コア設計原則
1. **Source-first & Private-by-default**:
   原本ソースコード、リポジトリURL、コミット情報、私的Bundle、詳細な機能名・ファイルパス等の機密情報は一切公開しない。公開されるのは事前に定義された固定の要約プロジェクション（`PublicEstimatePayload`）のみ。
2. **「対象作業」と「測定対象」の明確な分離**:
   - **測定対象（このアプリのどこまで測ったか）**: ソフトウェアの測定状態（COMPLETE/PARTIAL）、公開粒度での測定対象モジュール、対象外・未確認部分の有無、未解決・未読件数、および適用範囲。
   - **対象作業（どの作業に相当する工数か）**: 詳細設計・実装・単体テスト等の作業範囲定義（`oes-standard-dev-v1`）。
3. **客観性と出典の完全な追跡性**:
   - 参照工数比率（3値: p25 / median / p75）、標本数、適合規模、算出方法、出典リンク。
   - 参考賃金（BLS OEWS、職種SOC 15-1252、全国、時給中央値、公表年月、出典リンク）。
   - 基準為替レート（提供元、観測日時、公表日時、通貨ペア、出典リンク）。
4. **不変な公開単位（URLごとの固定性）**:
   1つの共有URL（`/e/{share_id}`）は1つの不変な公開内容を指す。再見積や新しい為替・賃金での暗黙の自動更新は行わない。
5. **発行と公開の分離**:
   証明書の発行（私的）と公開（公的要約）は独立したステップ。利用者が明示的に3つの同意を行った場合のみ公開される。

---

## 2. ライフサイクル仕様

```text
[ PRIVATE_RESULT ]  (元の署名付き証明書・詳細Bundle)
         │
         ▼  (所有クライアントによるPOST /api/v1/share-previews)
   [ PREVIEW ]      (有効期限15分、非公開プレビュー、preview_hash算出)
         │
         ▼  (明示的な3つの同意 + POST /api/v1/shared-estimates)
  [ PUBLISHED ]     (固定URL /e/{share_id}、公開要約Ed25519署名、OGP画像)
         │
         ▼  (所有クライアントによるPOST /api/v1/shared-estimates/{id}/withdraw)
  [ WITHDRAWN ]     (不可逆な撤回、公開配信停止、410 Gone返却)
```

- **撤回 (Withdrawal)**:
  撤回された共有URLは即座に 410 Gone を返し、アプリ名や数値などの元データを一切返却しない。ただし、原本の証明書（Certificate）自体は失効（Revoke）させず、元の署名履歴は私的台帳に保持される。

---

## 3. データ契約と公開投影 (Projection Mapping)

公開DTOスキーマは `contracts/public-estimate.schema.json` で定義される（Draft 2020-12, `additionalProperties: false`）。

| 新payloadフィールド | 既存の取得元 / ルール | 変換・処理 |
|---|---|---|
| `share_id` | PublicationService | `sh_` + 16バイト乱数のhex（小文字32文字） |
| `certificate_id` | PublicManifest.certificate_id | 元証明書ID固定 |
| `issued_at` | PublicManifest.issued_at | UTC ISO8601日時 |
| `published_at` | PublicationService | 公開確定時のUTC ISO8601日時 |
| `metadata.app_name` | ユーザー申告 | 1〜80文字、プレーンテキスト |
| `metadata.description` | ユーザー申告 | 0〜240文字、プレーンテキスト |
| `metadata.publisher_label`| ユーザー申告 | 任意（nullまたは1〜60文字） |
| `metadata.app_url` | ユーザー申告 | 任意（nullまたはHTTPS URL、最大2048文字） |
| `metadata.include_model_label` | ユーザー申告 | boolean（既定 false） |
| `metadata.scope_description` | プレビュー時合意 | 公開可能な粒度での測定対象説明 |
| `metadata.unmeasured_description`| プレビュー時合意 | 対象外・未確認部分の説明 |
| `metadata.result_scope_statement`| プレビュー時合意 | 「測定対象として識別された機能プロセスのみの換算」等の限定文 |
| `presentation.hours_per_day` | 固定値 | `8`（1人日＝8人時） |
| `presentation.convention_label` | 固定値 | `OESの表示規約 (1人日＝8人時)` |
| `presentation.locale` | 固定値 | `"ja-JP"` |
| `presentation.display_currency` | 固定値 | `"JPY"` |
| `measurement.status` | Report.measurement.status | `"COMPLETE"`, `"PARTIAL"`, etc. |
| `measurement.cfp` | Report.measurement.cfp | 整数値 |
| `measurement.counts` | Report.measurement.counts | Entry, Exit, Read, Write, Processes, Unresolved |
| `inferred_movement_count` | Report.measurement | AI推論を含むデータ移動件数 |
| `excluded_component_count` | Report.measurement | 除外コンポーネント件数（ID・パス非公開） |
| `unread_file_count` | Report.measurement | 未読・未解析ファイル件数 |
| `effort_scope_id` | Report.effort.effort_scope_id | 開発工数スコープ識別子（`oes-standard-dev-v1`） |
| `effort_scope_name` | 固定値 | `OES標準開発作業定義 第1版` |
| `rules_and_standards` | 固定値 | COSMIC v5.0 / OES Mapping Rules v0.1.0, oes-ja-result/0.1.0 |
| `assurance` | Report.assurance | Community版、コンテキスト非隔離注釈、未独立検証 |
| `model_label` | Assessment.assessor.model_name | `include_model_label=true` の場合のみ実名 |
| `conversion.effort.hours` | Report.effort.person_hours | `p25`, `median`, `p75`（人時） |
| `conversion.effort.days` | 計算導出 | `hours / 8`（ROUND_HALF_UP 1桁） |
| `conversion.usd.amounts` | Report.reference_usd.amount_usd | `p25`, `median`, `p75` |
| `conversion.local.amounts` | Report.localized_reference.amount | `p25`, `median`, `p75` |
| `basis.benchmark` | CalculationContext.benchmark | 3値比率（2.0, 3.0, 5.0）、標本数、適合規模、集計方法、出典URL |
| `basis.wage` | CalculationContext.wage | BLS OEWS、職種SOC 15-1252、全国、時給中央値、公表年月、出典URL |
| `basis.fx` | CalculationContext.fx | 提供元、観測日時、公表日時、通貨ペア、出典URL |
| `verification_links` | PublicationService | 元証明書台帳URL（`/verify/...`）、公開要約JSON URL |
| `limitation_codes` | Report.limitation_codes | 安全な公開コードへのマッピング |

---

## 4. 数値・計算・表示規約

### 4.1 人日相当（Person-Days）
- 計算式: `hours / 8`
- 規約表記: **「OESの表示規約（1人日＝8人時）」**（日本の一般的な開発実務に基づく表示用導出。正本は人時として保持）
- 丸め: 小数点第1位 `ROUND_HALF_UP`。末尾が `.0` の場合は省略（例: `360 / 8 = 45.0` → `45`、`362 / 8 = 45.25` → `45.3`）。
- 極小値: 正の値でかつ 0.05 人日未満の場合は「`0.1人日未満`」と表示し、ゼロ工数と誤認させない。
- 正本は人時（hours）であり、人日は表示用導出値。金額計算には元の人時正本を使用する。

### 4.2 工数分布（四分位）の表現
- 分布の名称は工数の多寡を表す表現とする：
  - `第1四分位 (p25 / 少工数側)`（2.0 人時/CFP 換算）
  - `中央値 (median / 基準工数)`（3.0 人時/CFP 換算）
  - `第3四分位 (p75 / 多工数側)`（5.0 人時/CFP 換算）
- 注意事項:
  「工数比率のばらつき分布（25%〜75%範囲）であり、開発期間（暦月・納期）の長短や対象案件がこの期間内に完成することを保証する予測区間ではありません。」

### 4.3 日本円（JPY）
- 10,000円未満: カンマ区切りの円（例: `9,800円`）
- 10,000円以上 1億円未満: `約` + 万円単位（小数第1位丸め、例: `約270万円`）
- 1億円以上: `約` + 億円単位（小数第1位丸め、例: `約1.5億円`、`約1億円`）
- 境界繰り上げ: 丸めによって次の単位に達した場合は繰り上げ（例: 99,999,999円 → `約1億円`）。

### 4.4 米国ドル（USD）
- `USD` + 英語標準の3桁カンマ区切り（例: `USD 18,000`）。

---

## 5. コピー基準と禁止表現

### 5.1 推奨表現・ラベル
- 主ラベル: `参照開発工数`、`人日相当`、`参考労務換算額`
- サブコピー: `つくったものに、ちょっと誇れる数字を。`、`その数字、どう出した？`
- 単位併記: `360 人時 ／ OESの表示規約（1人日＝8人時）`、`USD 18,000 ／ 市場価値ではありません`

### 5.2 禁止表現（厳格遵守）
- 「このアプリの価値270万円」「市場価格」「売却相場」
- 「45日で作れる」「AIにより45日節約」
- 「ISO認証取得」「絶対に正確」「完全保証」
- ソフトウェア作者の能力順位付けや優劣評価

---

## 6. SNS共有とOGP仕様

### 6.1 共有テキストテンプレート
```text
「{app_name}」の工数換算レポート。
{partial_prefix}{days}人日相当（1人日＝8人時、参照実績による換算）。
参考労務換算額 {local_or_usd}。市場価値ではありません。
{canonical_url}
#OpenEstimate
```

### 6.2 OGPメタデータ（`<head>` に静的出力）
- `og:type`: `website`
- `og:site_name`: `Open Estimate`
- `og:title`: `{app_name}｜{days}人日相当の工数換算 — Open Estimate`
- `og:description`: 「{app_name}」の工数換算レポート。{days}人日相当（1人日＝8人時）。参考労務換算額 {local_or_usd}（市場価値ではありません）。
- `og:image`: `https://open-estimate.ai-orchestration.jp/og/e/{share_id}.png` (1200×630)
- `og:url`: `{canonical_url}`
- `twitter:card`: `summary_large_image`
- `robots`: `noindex,nofollow`

---

## 7. 状態とエラーハンドリング

| 状態コード | 主結果表示 | SNS共有・OGP |
|---|---|---|
| `AVAILABLE` (正常) | 人日相当（濃緑98px）+ 参考円額（270万円） | 通常テンプレート |
| `PARTIAL` (部分測定) | 数字の前に「部分測定」バッジ、警告文、測定対象欄も部分対象へ動的更新 | タイトル・文面にも【部分測定】付与 |
| `BENCHMARK_UNAVAILABLE` | CFPのみ表示、工数・金額は未提供 | CFPのみ共有 |
| `WAGE_UNAVAILABLE` | 人日相当のみ表示、金額は未提供 | 人日のみ共有 |
| `FX_UNAVAILABLE` | 人日相当 + USD表示、円参考額は未提供 | USD額のみ共有 |
| `UNSIGNED` (未署名) | 「SAMPLE · 架空値 · 未署名」バッジ明示 | 本番共有不可、ローカルプレビューのみ |
| `WITHDRAWN` (撤回済み) | 410 Gone 表示、アプリ名・数値を完全秘匿 | 410、OGPは汎用画像 |
| `REVOKED` (元証明書失効) | 失効警告表示、数値非表示 | 数値非表示の汎用OGP |

---

## 8. アクセシビリティ・印刷対応

- **WCAG 2.2**:
  - テキストコントラスト比 4.5:1 以上、大型テキスト 3:1 以上。
  - タップターゲット 44×44px 以上。
  - キーボード操作完結（Escapeキーでモーダル閉じる、Focus trap、フォーカス復帰）。
  - スクリーンリーダー用 `aria-live="polite"` による通知。
- **印刷 (@media print)**:
  - A4 1ページ目に主要結果（人日、金額、対象範囲、主要注意事項、発行時点、共有URL）が綺麗に収まる設計。
  - ナビゲーション、共有ボタン、モックコントロールは自動非表示。
  - `window.onbeforeprint` でアコーディオン（`<details>`）を自動展開、`onafterprint` で復元。
