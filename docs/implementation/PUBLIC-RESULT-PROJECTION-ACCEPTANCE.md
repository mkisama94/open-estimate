# 公開用結果データ生成 — 実装・受入記録

確認日：2026-10-20 JST。対象は`PUBLIC-RESULT-PROJECTION-IMPLEMENTATION.md`。完了範囲は公開候補のローカル生成・検証・保存・再読込であり、公開サービスの提供完了ではない。

## 実装

- `src/core/public-result.ts`：許可フィールドからの純粋な投影、公開カタログID／版と保存basisの厳密検査、既存計数・換算の再利用、固定コード変換、Schema・意味検査、決定的ハッシュ。
- `src/local/public-result.ts`：検査済みrunの読込、候補とローカルreceiptの分離保存、排他的作成・完了マーカー、再読込・整合検査。元runは変更しない。
- `src/local/cli.ts`：`prepare-public-result`と`local_public_result_candidate:true`。`publishing:false`を維持。
- `contracts/public-result-candidate.schema.json`：新規公開候補契約。すべてのobjectを`additionalProperties:false`とし、全プロパティを必須化。
- `scripts/build-contracts.mjs`：純粋な投影モジュールのSchema定義から新契約を生成。既存の配布スクリプトはcontracts／distを一括同梱するため追加変更不要。

旧public-estimate契約、リモート数値モデル、既存run・比較操作・配布ZIPの仕様と内容は変更していない。package／pluginの版も0.8.1のまま。本変更は作業ツリーの実装とローカルビルドであり、既存0.8.1配布物への差替え・新版配布は行っていない。

## 利用手順

ビルド済みローカルCLIへ、検査済みrunのIDのみをstdinで渡す。

```powershell
'{"run_id":"既存runのUUIDに置き換える"}' | node .\dist\local\cli.js prepare-public-result
```

任意のrunパス、公開名、説明、合計値、remote応答等の追加引数は受け付けない。未知キーは拒否する。対応入力はAssessment v2＋quality-records/v1＋0.8.1品質engineと既知mapping／TESTプロファイルIDの保存basis。

成功応答は`LOCAL_CANDIDATE_READY`、candidate_path、receipt_path、candidate_hash、transmitted=false、published=falseのみ。保存先は`OES_RUNS_ROOT`（未設定時はユーザーホームの`.open-estimate/runs`）の兄弟`public-result-candidates/<新UUID>/`。

- candidate.json：公開候補。元ID、パス、自由文、日時、run情報を含めない。
- local-receipt.json：元run ID／assessment hash／checksums hash／候補hash／投影版／生成日時。ローカル専用。
- COMPLETE.json：両ファイルのチェックサムと候補hashを照合する完了マーカー。すべての保存・再読込照合後に作る。書込失敗時は成功応答を返さず、新規ディレクトリのマーカーを取り除く。

候補ファイルは`validatePublicResult`と`publicCandidateHash`で再検査できる。ローカルの`readPublicResultCandidate(出力UUID)`は、任意のパスを受け取らず完了マーカーと両ファイルを照合する。保存物は自動削除せず、不要になれば利用者が該当UUIDディレクトリを削除する。元runのpurgeとは別の保持単位。

生成自体は送信同意・公開承認に相当しない。集計情報にも機密性があり得る。後続APIと確認手順が確定するまで送信・公開しない。

## 公開項目と計算の境界

| 項目 | 公開候補に含める値 |
|---|---|
| schema_version／projection_version | 公開候補v1／投影1.0.0の固定値 |
| measurement | 状態、CFP、E/X/R/W、総process数、採用process数 |
| quality | 測定完了／走査完了、暫定件数・CFP内数、未解決process件数、候補処理件数、未確認ファイルの区分別件数、境界unknownの項目別件数、固定の理由／記録不足コード |
| calculation | TEST、設計・実装・テストのscope ID、1日8時間、保存basisの許可されたID・版・数値、工数・USDの状態と値 |
| assurance | CLIENT_REPORTED、LOCAL_RECOMPUTED_MATCH、NOT_INDEPENDENTLY_VERIFIED、signed=false |
| limitation_codes | 指示書の8種類の固定enumのみ。重複なし・辞書順 |

保存basisのID／版はコード内の明示カタログで検査する。初版はprofile_set=oes-local-test-2026-10-v1、engine=0.8.1-quality、mapping=oes-cosmic-ph1-v1、benchmark=oes-test-benchmark-design-implementation-test-v1、wage=oes-test-wage-50usd-v1。係数・時給・範囲等は厳密な数値構造を検査した保存値で再計算し、最新既定profileを読み直さない。未知IDや版を既知版へ置き換えない。

既存`measureAssessment`と`estimateAssessment`を再利用する。保存measurement／effort／reference_usdとJCSで一致しない場合は停止する。保存limitation_codesも既知コードだけを許可し、再計算結果との一致を確認する。表示用円額、人日、FX、DisplayQuoteは含めない。basisの自由な説明文やnoticeも転記しない。

in_scopeは取得除外も含む「範囲内の未確認ファイル」、scope_unknownは読取済みも含み得る所属不明件数。未確認区分を合算して総未読と表示しない。rerunとcontinuationの和をprocess数にしない。未解決候補の規模は不明であり、件数からCFPを補わない。

## 生成例

すべて既存の合成テストモデルから生成した例であり、実アプリの測定結果ではない。ファイル内容はSchema・意味検査済みの候補そのもの。

| ファイル | 状態・数値 | 候補hash |
|---|---|---|
| examples/public-results/complete.json | COMPLETE、6 CFP | 66443685bde6682df3169d306892dc7a37a1435d87aa04caa30c64cf80fa3e2e |
| examples/public-results/partial.json | PARTIAL、6 CFP、暫定1 process／3 CFPは合計の内数、rerun・continuation unknown各1件 | 9e3332a12bdf543c770b42cb102b5aa5ab11fa1401275266678d96e2f5992e80 |
| examples/public-results/unavailable.json | INCOMPLETE、CFP／工数／USDはnull | de82e11599dac350951bdf1c4bab66ea8b15c7432cad265a25f9da8cb33dd079 |

候補hashは`SHA256(JCS({domain:"oes/public-result-candidate-hash/v1",candidate}))`。候補自体にはhashを埋め込まない。時刻・UUIDの異なる生成でも候補とhashは一致する。hashは署名でも第三者の真正性保証でもない。

## 受入結果

型検査・ビルド成功。追加2ファイル／25テストが通過し、既存回帰を含む全26ファイル／248テストが通過した。Worker検証はテスト用ローカルWorkerとfixtureのみ。本番APIへ測定を送信していない。

| 指示書の受入 | 確認内容 |
|---|---|
| P01・P12 | Schema・意味検査、保存数値一致、入力のdeep-freeze／不変性、候補の負値・非有限・指数表記・四分位矛盾・安全整数上限・未知キー・COMPLETEとunknownの共存を拒否 |
| P02・P03 | rerun／continuation／両方unknown、暫定内数、採用と未解決の区別、範囲内の未読・取得除外、範囲外／補助未読・所属不明を区別 |
| P04 | UNSUPPORTED／INCOMPLETEとnull、基準範囲外の換算未提供を保持。PARTIALや0へ置き換えない |
| P05・P06 | 元ID・名前・パス・symbol・根拠・scope・未解決文の識別用canaryが候補に現れない。実CLIエラーもcanary／入力断片を出さず固定コードのみ。未知理由・空suffix・未知gap／制約・旧形式・未対応basisを拒否 |
| P07・P08 | 改変チェックサムを拒否。チェックサムを整えた数値不整合も再計算で拒否。最新profileの読込を失敗させても保存basisから同じ候補。未対応0.8.0 engineは拒否 |
| P09・P10 | 実CLIの別時刻生成でcandidate／hash一致、receipt日時と出力UUIDは異なる。元run全ファイルのhash不変。fetch／HTTP／HTTPS／netの呼出しを子プロセスで監視し0件。published／transmittedはfalse |
| P11 | 実CLI保存・Schema／hash検査・再読込成功。実CLIの書込不能を固定エラーで検出。UUID衝突で既存出力を保持。receipt／完了マーカー書込後の故障注入でも成功扱いせずマーカーなし |

実行コマンド：

```text
npm run build
npm run typecheck
npx vitest run tests/unit/public-result.test.ts tests/integration/public-result-cli.test.ts
npm test
git diff --check
```

Windowsのテスト用ネットワーク監視preloadはfile URLで指定して実行。検証中の旧0.8.1 ZIPのSHA-256は7a32464102c9276c9ac81dbb23c2ae1a9ae51d1df0f7a163dd1738e83b951c07で、元の受入記録と一致した。

## 次工程へ残す事項

サーバー側の再計算・候補照合、公開用メタデータ入力、承認対象hash、所有者認証、公開状態・取り下げ、公開用DisplayQuote、保存先と公開URL、署名・証明書、Web画面は未実装。配布版更新と移設した新版配布物での確認も別工程。

後続のページ・共有文・印刷・OGPは、TEST参考試算、計上対象機能のみ、意味解釈の独立監査なし、未署名を明示し、PARTIAL理由・暫定内数・未採用規模が不明であることを隠さない。TEST四分位を実績分布・信頼区間と説明しない。ローカル候補の生成成功を公開成功・サーバー検証済み・公開同意済みと表示しない。
