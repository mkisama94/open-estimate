# 算定根拠・不確実性の記録改善（0.5.0）

## 実装内容

新規Assessmentは `format_version: oes/assessment/v2`。版なし／明示v1は旧形式として読取可能。旧数値・hashを変える移行処理や、根拠を推測して補う処理は入れていない。

| 指示書の要件 | 実装 |
| --- | --- |
| 範囲と確認記録 | scopeの既存目的・境界＋scope_recordのID／revision、user／ai確認、snapshotパスごとの所属・理由・確認／根拠参照 |
| 機能候補 | function_candidatesにcounted／outside／merged／unresolved。役割・component・根拠・理由・process／統合先を記録 |
| 機能境界 | process.boundaryに開始・機能ユーザー・目的・完了・実行形態・統合分割理由・根拠・判断参照 |
| データ群辞書 | data_group.definitionに業務上の意味・識別属性／該当なし理由・具体的attributesとの対応・集約分離理由・根拠・未確認事項 |
| 判断台帳 | judgmentsに対象・種別・解釈・規則source／ID／版・適用理由・証拠・判断／根拠状態・未解決点・代替案 |
| 所見 | findingsのtargets・impact・resolution。judgmentへの直接参照も可能 |
| 比較 | previous_assessment原本とhash、範囲変更と移動対応、保存モデル由来CFP差、未対応移動と未説明差 |
| 正規化 | v2追加レコードの集合を正規化しhash対象へ。旧形式に新フィールドや既定値を挿入しない |
| CLI | contract更新、draft保存、export時の検査済みAssessment＋提出時入力保存、local集計／比較／TEST試算とmodelの分離 |
| Skillと配布 | 0.5.0、記録・解析・報告手順、manifest生成、配布物と移設smokeの版整合 |

契約は `contracts/oes-ph1.schema.json`、型は `src/core/types.ts`。記録の参照／整合検査は `src/core/validate-records.ts`、状態／比較は `src/core/records.ts`。具体例は `examples/recorded-assessment.json`（構造検証用の合成例であり、実測の根拠ではない）。

## 検査できる範囲

- 必須フィールド・値域・重複ID、根拠参照とsnapshot上の行範囲。
- 候補・process・componentの参照、統合先の存在と循環、計上／非計上と判断状態の矛盾。
- 計上移動ごとの実装根拠、明示的な移動判断、対象範囲内の根拠。
- recordedの根拠充足・未解決なし、provisionalの根拠と未解決点、unresolvedを計上対象にしない整合。
- 未確認のデータ群を計数するときの明示的なprovisional判断。
- 所見と同じ構造化対象に対する判断状態の矛盾。
- 範囲外／補助資料への分類に確認参照または読取根拠があること。
- 比較元hash、範囲所属変更時の改訂、変更時の対応記録、移動対応の重複・件数と種別。

根拠の実際の意味、属性や関心対象の適切さ、規則IDが実在する標準条項か、対応理由が妥当か、利用者の確認申告の真正性は機械検査では保証しない。既存のソース行・必須証拠検査は維持する。文章の意味を自動評価する機能は追加していない。

## 状態と網羅性

v2の `input.analysis_complete` はsnapshot取得完了を収集器から導出する。v1では従来の意味を維持。`local.records` で走査状況と範囲内読取、範囲外／補助資料の未読、所属不明、候補処理、判断未解決を分離する。所属不明・範囲内未読・走査打ち切り・暫定判断・候補未解決があれば、採用モデルがある場合はPARTIAL。採用モデルがない場合はCFP=nullでINCOMPLETE／UNSUPPORTED。

COMPLETEは宣言範囲の読取・識別済み候補処理・判断記録が完了し、結果に影響する未解決がない状態。未知の機能がないことや意味解釈の正解を保証しない。暫定プロセスのCFP小計は合計の内数で、重複加算も誤差幅への読み替えも行わない。未採用候補とprocessのCFPはnullとして規模未確定を示す。

## 比較と旧形式

前回評価が指定された場合だけ比較元Assessmentをそのまま保持する。IDや配列順の自動照合は行わない。移動対応はadd／delete／merge／split／retained（明示的1対1）／unmatched。未対応移動は結果に残す。同じIDでも明示対応がなければ比較未確定で、総CFP差が0でも説明完了とはしない。採用モデルが片側に存在しない場合は総CFP差をnullとし、未知の規模を0にしない。

比較元は元データと正規化hashで照合し、改訂前の範囲ID・改訂も返す。未作成の代替モデルの数値影響は生成しない。比較履歴は12段、CLI入力は8MiBが上限。

旧形式のexportには `LEGACY_JUDGMENT_RECORDS_MISSING` と日本語の注意を返す。v2へ改訂する場合は元データをcomparisonへ保持し、既存根拠の転記と新規確認事項を区別する。過去Assessmentの探索・自動修正は行わない。

## ローカル保持と送信契約

draft／exportのJSONは既存のsessionディレクトリへ保存する。検査済みAssessmentはhash付きファイル名で追記し、元入力も保持する。exportのlocal.reportはローカル試算。判断台帳・比較元・名称・パス・根拠・hashはlocalだけに含め、送信するのはmodelだけ。

セッションは24時間で操作期限切れになり、purgeでJSONも削除される。長期保管・別端末復元は今回の機能に含まない。必要なJSONは期限・purge前に指定先へコピーする。

リモートSchema `oes/remote-model/v1` のフィールドは追加しない。analysis_completeには宣言範囲・候補・判断から導出した完了を、partialには同じ共通規則から得た部分状態を投影する。受信側はこれらをクライアント申告として既存の規則で集計する。リモート契約改訂は不要。旧Assessmentは従来通り投影する。

未採用の未解決processについて、トリガー移動のモデル自体を選べていない場合はリモートv1の必須トリガーを表せないため、そのprocessを送信配列に含めない。ローカル台帳・未解決機能数とpartialに保持し、架空の群や移動を作らない。この場合リモートのtotal_processesはローカルより少なくなる。採用モデルのCFP・工数・状態の一致を維持し、全未解決機能数の報告にはlocal.recordsを使う。

v2ローカル試算のengine_versionを `0.5.0-records` とし、旧形式の計算basisは従来版を維持する。為替・TEST係数・工数換算の方式は変更していない。

## 検証と実施範囲

既存テストに加えて、`tests/unit/records.test.ts` と `tests/integration/recorded-helper.test.ts` で新形式、旧hash保持、追加台帳のhash、暫定／未採用、参照不備、範囲内外の未読、走査打ち切り、所見矛盾、差分計算、CLIの下書き・改訂保存、リモート非送信項目、CFP・TEST工数・USDの一致を確認する。

ビルド、全テスト、Worker dry-run、配布生成、移設パッケージsmokeを実行する。これは実際のWork／Codexへの再インストールや会話受入、公開サーバーでの今回の変更の動作検証を意味しない。

本番デプロイ、過去モデルの自動修正、293／244 CFPの正解認定、独立回帰計画、独立監査、証明書・公開・サーバー保存・新Web画面は未実施。

### 今回の実行結果（2026-10-18）

| 検証 | 結果 |
| --- | --- |
| npm run typecheck | 成功 |
| npm run build | 成功。SchemaとSkill manifest／hashを生成 |
| npm test | 15ファイル・120テスト成功（追加17単体＋1 CLI統合を含む） |
| npm run deploy:mcp:check | dry-run成功。実デプロイなし |
| npm run plugin:pack | 成功。release/desktop-marketplaceに0.5.0を生成 |
| npm run plugin:smoke | PASS。別ディレクトリへ移設した配布物のcontract・scan・confirm・prepare・read・purge成功、local_mcp_required=false |
| git diff --check | 成功 |

既存の別作業の未コミット変更を保持した状態で検証した。コミット、インストール先キャッシュの更新、本番への送信は行っていない。
