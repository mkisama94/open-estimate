# 0.15.0 ローカル開始と外部承認の分離

実装日：2026-10-31〜2026-11-01 JST。対象：[SYSTEM-IMPLEMENTATION-PLAN.md](SYSTEM-IMPLEMENTATION-PLAN.md)、[LOCAL-UX-AND-TRANSMISSION-SPEC.md](LOCAL-UX-AND-TRANSMISSION-SPEC.md)。既存の構造化結果・新証明・Web保存を再利用する。全工程の完了判定は実ホスト受入後とし、SDK試験をその代替にはしない。

## 実装した契約と対応

| 責務 | 実装 |
|---|---|
| 依頼に基づくローカル開始 | `begin_estimate_workflow` / CLI `begin-estimate-workflow`。`local_request`に実際の依頼を記録。追加の読取回答・チェック・開始クリックは不要 |
| ローカル作業根拠 | `state_version=oes/workflow-state/v2`、`local_work.schema_version=oes/local-work/v2`。依頼、時刻、対象・計画・条件hashを保存 |
| 任意の送信条件表示 | `show_estimate_transmission` / CLI `show-estimate-transmission`。送信先、項目、送らない情報、品質、365日・ログイン不要の閲覧範囲を表示。表示だけでは承認しない |
| 外部承認 | `approve_estimate_transmission` / CLI `approve-estimate-transmission`。`oes/workflow-consent/v2`は`verify,publish`だけを受け付ける。公開には検証が必要。実回答・説明済み条件hashを記録 |
| 算定後の適用 | `authorizeRequest`で対象・条件・選択操作を検査し、要求hash・操作ID・段階を記録。承認済みの数値確定・再試行に新しい回答を要求しない |
| 外部だけの取消 | `cancel_estimate_transmission` / CLI `cancel-estimate-transmission`。別の取消記録を送信直前に検査。ローカル取得・評価・固定結果・PDFを保持 |
| 全体の取消 | 既存`cancel_estimate_workflow`。ローカル作業も停止。既送信・公開不明を未送信扱いしない |
| 開始・再開・引継ぎ | `workflow-start-methods.ts`で同意のないv2ローカル作業も履歴・再開対象にする。新規・再計算は新workflow、旧外部承認を継承しない |
| CLI / MCP / カード | 同じローカル関数を使用。標準導線は読取同意・開始カードを使わない。任意カードは外部操作の2項目だけ |
| 結果 / PDF / 証明 / 保存 | 既存の固定`EstimateResult`、`estimate-proof`、`public-results`を再利用。外部未選択でも結果とPDFで完了。取消後のPDF再生成も外部送信から独立 |

新しい開始は準備済みworkflowに実依頼を記録してから取得する。プロジェクトを開いたことやホスト権限の存在だけを依頼にしない。MCPの対象有効化には既存bindingの検査を使い、架空の`user_confirmed:true`を新経路から作らない。依頼内の分割・再取得・部分試算は既存の取得・品質検査を通し、充足フラグを無条件に変更しない。

## 互換と状態移行

| 残した互換 | 理由と撤去条件 |
|---|---|
| `start_estimate_workflow` / `extend_estimate_workflow`とv1のread項目 | 既存クライアントと実際の同意記録を保持する。新Skillから呼ばない。v1利用者・再開対象がなくなった後に撤去を検討 |
| `confirm_workspace` / CLI `confirm`、旧部分許可 | 旧取得クライアントの互換。標準v2では利用しない。旧取得経路の利用終了後に撤去を検討 |
| 旧document / preview / saved-estimates / OAuth | 過去の文書・証明・URL・所有者データを保持。今回の新規導線から呼ばない。旧データの保持条件を確認せず削除しない |

未開始の記録は`begin`時にv2へ移す。既存のv1同意があるworkflowは書き換えず、そのまま同じ固定要求・条件で再開する。新しい結果へv1外部承認をコピーしない。`selection.read=true`や定型のチャット回答を新規ローカル開始のために生成しない。

## 検証の範囲

`workflow-reuse.test.ts`ではMCP SDKを経由し、実際の合成ソース読取、下書き、評価run保存、結果固定、PDF取得、再接続後の復元を確認する。これは実ChatGPTの操作受入ではない。

`estimate-workflow.test.ts`では算定前・算定後の外部承認、未承認送信0、固定結果と要求の適用、同じ操作の再試行、取消後のローカル継続を検査する。証明と公開はテスト鍵・合成入力・試験DBを使用する。

`public-results-worker.test.ts`と既存の契約・D1試験で、実Workerランタイム・試験DBの登録、並行性、署名、日本語PDF、期限、停止を回帰検証する。入力に利用者のソースや本番DBを使わない。

`start-widget.test.ts`では未選択、表示だけで送信しないこと、二重クリック、保存後の通知失敗による二重承認を検査する。`smoke-desktop.mjs`は移設した配布物のCLIで追加読取確認なしのローカル全工程とPDF、stdio設定どおりの起動、新ツール宣言を検査する。

初回全回帰では旧テストの開始カード前提3件と実行環境のアクセス制限によるWorker試験2件が失敗した。前者は新仕様と互換試験を区別して修正し、後者は権限条件を整えて再試験した。初回の失敗を合格記録へ読み替えない。

| 検証 | 結果 |
|---|---|
| `npm run typecheck` | 合格 |
| `npm run build` | 合格。0.15.0の契約・Skillハッシュを生成 |
| `npm test -- --maxWorkers=2` | 最終全回帰：66ファイル512件合格、失敗0。2026-10-31 23:45:43 JST開始、170.40秒。ログ：`.cache/local-ux-full-tests.log` |
| `npm run test:publication` | 全回帰後の最終確認：6ファイル20件合格。算定後の外部条件表示と、外部取消後に公開成否不明なら完了扱いしない検査も含む |
| `npm run build:publication-web` | 合格。243依存、DB/PDFあり、OAuth・数値計算・issuer・MCP接続なし |
| `node scripts/ci-mcp.mjs check` | 合格。ただし検証に使う公開済みSkillは0.14.0であり、0.15.0の本番登録済みを意味しない |
| `npm run plugin:pack` | 0.15.0生成、同梱両Skill・版・ハッシュ一致。`release/local-marketplace`。公開・インストール更新とは別 |
| `npm run plugin:smoke` | 合格。移設パッケージを配布設定のcommand/args/cwdで起動、新4ツール・ローカル開始から評価・結果カード/PDF・purge後のrun保持を確認。未選択の外部送信0。`actual_host_tool_exposure=false` |

カードの宣言・進行表示とMCP共通契約の最終調整後、MCP/再開/UIの3ファイル35件も合格。旧互換の`test:document`相当も全回帰に含まれる。`test:publication`と独立`build:publication-web`は基準コードに既設であり、今回新設したものではない。

## 実ホストと配備の未達

この実装作業中に公開されている接続ツール一覧では、旧`start_estimate_workflow`はあるが、新`begin_estimate_workflow`・`show_estimate_transmission`・`approve_estimate_transmission`・`cancel_estimate_transmission`はない。現在の接続ではLUX12 / M0 / M5の実ホスト受入は未実施。

実ファイルをCLIで検査した0.15.0の整合性情報（package SHA-256 `df62c0448e66a050441e4f4a4214a2069fa3f13384ac29e54479a61f887ac58b`、client protocol `oes/measurement-client/v1`）を現行の公式`get_measurement_rules`へ送って確認したところ、`SKILL_VERSION_UNSUPPORTED`が返った。対象ソース・対象hash・見積値はこの照会へ送っていない。旧版の整合性情報やローカルルールを代入して新規解析を通さない。これは現在の利用切替に必要なサーバー側登録が未完である具体的な根拠であり、ローカル試験の失敗とは区別する。

1. 0.15.0の配布物・ハッシュを正規のリリース手順で候補登録し、公式ルール取得先がその整合性を受け付ける状態にする。整合性検査やルール取得の代替値で迂回しない。
2. 対象ホストのプラグインを更新し、接続を再開する。ツール一覧に上記4ツールがあることと、Skillが0.15.0であることを確認する。キャッシュの直接書換えで更新しない。
3. 実ホストでローカルのみ、検証まで、公開まで、再開を操作する。合成データとテスト鍵・ステージングDBを使い、カード・PDF・証明・保存・HTTPS URLのGET表示を確認する。
4. 製品の読取質問数、外部確認数、ホスト独自の操作承認数と理由、実際の送信件数、結果URL・期限・再試行・停止を別々に記録する。

本番の鍵・DB・配備設定、既存インストールの置換、リリースの公開はこのローカル変更の合格から推定しない。
