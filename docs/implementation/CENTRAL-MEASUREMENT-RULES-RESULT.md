> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# 中央測定ルールの実装記録

実装日：2026-10-19（JST）。対象はCLI・HTTP MCP・通常／ルール専用リリースです。計数エンジン、TEST係数、USD、FRB換算は変更していません。本番反映・外部提出・Work／Codex実機受入の完了記録ではありません。

原本は [source.md](../../rules/measurement/source.md)、互換宣言は [contract.json](../../rules/measurement/contract.json)、入口は [SKILL.md](../../skills/open-estimate-assessor/SKILL.md)、運用は [運用手順](CENTRAL-MEASUREMENT-RULES-OPERATIONS.md) です。

## 最終候補と実行結果

配布候補：0.7.0、`release/staging/0.7.0/`。配信bundleは同ディレクトリの`measurement-rules.json`、固定した成果物・履歴hashは`candidate.json`にあります。

- ruleset_id：`oes-measurement`
- revision：`4d61a60ce5983f4bdd6fa33504b30bca6697336d2c2a5b30b12df561d3cbb1b0`
- 19規則、本文UTF-8で8,422バイト。
- client_protocol：`oes/measurement-client/v1`、Assessment：`oes/assessment/v2`、model：`oes/remote-model/v1`、engine：`oes-cosmic-ph1-v1`。
- Windows／Node.js 24.18.1。最終の`npm test -- --reporter=dot`は **20ファイル／196件PASS**。
- 通常リリースのprepare、移動した配布物のCLI smoke、生成WorkerのローカルHTTP試験、no-bundle dry-runはPASS。
- 同じprepareの再実行は`Existing frozen candidate`。原本・実スキルと固定候補の版／hashが一致し、試験後の成果物も不変。

日常の「原本編集 → rules:release」は、内容由来の自動revisionと登録履歴生成を使い、hash入力0回です。ルール専用の候補生成・失敗／再開・履歴保存と、実Worker生成／ローカル配信を隔離環境で検証しています。実本番のrules:releaseを実行済みという意味ではありません。

| 状態 | 今回の到達点 |
| --- | --- |
| 実装・ローカル検証 | PASS |
| 配布候補 | 0.7.0生成・固定済み。正規配布先への昇格は未実施 |
| 本番配信・移行期限確定 | NOT_RUN |
| 外部ストア提出 | NOT_RUN |
| Work／Codexの新しいチャットでの実機受入 | NOT_RUN |

## 旧スキルからの移植対応

旧0.6.0の測定上の文言を移植し、安定IDを付けました。計数上の意味を追加・削除する改訂ではありません。通信・同意・版の記録方法は新仕様へ変更しています。

| 旧スキルの箇所 | 原本でのID／残す場所 |
| --- | --- |
| 測定の原則：as-built・アプリ境界 | OES-MEASURE-001 |
| 実装・設定・DBを主根拠とする | OES-MEASURE-002 |
| 履歴・メモリ・希望額を根拠にしない | OES-MEASURE-003 |
| トリガーとE/X/R/Wの参照先 | OES-MEASURE-004 |
| 重複・distinctness | OES-MEASURE-005 |
| 対象と読み取り8：v2記録・初回確認 | OES-RECORD-001 |
| scopeと利用者／AI確認 | OES-SCOPE-001 |
| 取得状況と範囲内読取 | OES-COVERAGE-001 |
| 機能候補 | OES-CANDIDATE-001 |
| データ群の定義 | OES-DATA-001 |
| 判断台帳と代替案 | OES-JUDGMENT-001 |
| 採用・暫定・未解決・規模不明 | OES-STATUS-001 |
| findingsと整合する状態 | OES-FINDING-001 |
| 指定された前回との比較 | OES-COMPARE-001 |
| 旧形式の非補完 | OES-LEGACY-001 |
| model情報・finished_at・スキル情報 | OES-INPUT-001 |
| exportの構造検査・draft | OES-VALIDATION-001 |
| CFP・TEST・FRB・1人日・作業対象の説明 | OES-REPORT-001 |
| 報告順序・COMPLETE・独立監査の境界 | OES-REPORT-002 |
| 実行条件・対象同意・送信同意・秘密・固定接続・失敗・キャッシュ | 入口SKILL.mdとCLIに維持。規則本文へ責任を移していない |

source=skillというラベルは維持し、新方式のid/versionだけを中央の規則ID／revisionへ対応させます。過去のAssessmentやhashへ遡及記入しません。既存Assessmentの形式と数値モデルv1は維持しています。

## 検証の対応

| 受入ID | 証拠となる自動試験・範囲 |
| --- | --- |
| A01–A02 | measurement-rules.test.ts：同一生成、BOM／改行、ID重複・未定義・空節、UTF-8／JSON上限、互換宣言 |
| A03–A06 | 同ファイル：全文・明示旧版・非互換・停止・未知・直接評価の拒否。HTTP textとstructuredContentも一致 |
| A07–A12 | measurement-context.test.ts：固定前停止、同版bind、異版／破損、current更新と旧版継続、停止、判断参照、内容アドレス保存・既存ファイル改変拒否 |
| A13–A15 | measurement-rules.test.ts：旧／新方式で数値とreport_hash不変、版ごとにcontext hash変更、固定時計による期限判定 |
| A16–A19 | rules-release.test.ts／skill-release.test.ts：プラグイン不変、旧版・停止保持、失敗・再開・保存失敗、基準履歴、未確認配信の保護、排他、初回昇格遅延時の期限確保 |
| A20 | 通常buildとbuild:workerは生成前段をコンパイルしてからルール生成。初回にも未生成dist／JSONへ先行依存しない |
| A21–A22 | 入力schema、export投影、HTTPエラーに計算結果なし、同意・情報非送信の案内。実ホストの追従は未確認 |

実際のルール専用Worker候補を一時リポジトリで生成し、ローカルWorkersランタイムのHTTP MCPで全文・revision・正常評価・不一致／未知版拒否を確認します。この試験でpackage.json、plugin.json、スキルmanifest、模擬配布ディレクトリの不変も比較します。公開失敗・中断・履歴保存についてはデプロイ／確認アダプターを使う故障試験であり、実本番への故障注入ではありません。

## 未確認の範囲

本番のget_measurement_rules配信、初回移行期限の確定、正規配布先への昇格、外部ストア提出、Work／Codexの新しいチャットでの取得→分析→表示は未実施です。AIが取得本文や相反する資料へどう追従するかは、モデル・ホスト・試験条件を記録する別の実機受入が必要です。

## 公開前レビュー修正の検証（2026-10-19）

P1：skill_integrityとruleset_refを送らない旧要求は、スキル検査のLEGACY_UNCHECKEDをルール検査へ引き継ぎ、両方の期限内だけLEGACY_LOCAL_RULESとして受け付けます。いずれかの期限到達・超過・未設定では拒否し、登録済み新方式クライアントの版省略や申告不一致は引き続き拒否します。直接評価とHTTP MCPで検証しました。

P2：通常／ルール専用の両経路で、candidate.json全体の内容hashに結び付くvalidation.jsonを成功時だけ保存します。公開直前の検査を必須化し、記録なし・不一致ではデプロイ呼出し前に停止します。未検証候補のprepare再利用はWorker試験を再実行し、失敗後も同じ候補を再ビルドせず再試行できます。EPERM／ENOENTを含む連続失敗・再試行・直接公開拒否・候補変更後の記録無効を回帰試験で確認しました。

最終全体試験は20ファイル／196件PASSです。Wranglerの実Worker試験は通常ユーザー権限（サンドボックス制約外）で成功を確認しました。制限環境で報告されたログ書込EPERMを製品の判定不具合として扱ったり、試験を除外して成功扱いにしたりしていません。

旧0.7.0候補はrelease/review-backups/0.7.0-before-p1-p2へ退避し、修正したWorkerを含む未公開0.7.0候補を再生成しました。移行中の旧要求の受理と新方式の版省略拒否も、生成WorkerのローカルHTTP試験に含めています。検証成功記録を保存した後のprepare再実行とdeploy:mcp:checkもPASS。本番反映・正規配布先への昇格は未実施です。
