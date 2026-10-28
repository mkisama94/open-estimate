# 0.11.1 レビュー対応・ステージング受入

2026-10-28（JST）。完了は再同意修正・ローカル/ステージングの試験。実ChatGPTのカードから始まる全工程は未完。本番Worker・本番DB・本番信頼鍵・正式公開カタログは変更していない。

## 再同意

同意記録を要求hashと文書・送信先・目的の組に分離した。未証明で同意済みでも、証明追加後の要求へ明示同意すれば続行する。以前の記録は残す。同一要求の再送は元の記録を返す。tests/unit/document-consent.test.tsとtests/integration/document-system.test.tsで、並行保存、旧形式の記録、不一致、新同意なし停止、再同意後復旧を確認。

## 分離したステージング

| 項目 | 実環境 |
|---|---|
| 発行MCP | https://open-estimate-proof-staging.mkisama.workers.dev/mcp |
| 保存なし表示 | https://open-estimate-preview-staging.mkisama.workers.dev/preview |
| DB | open-estimate-document-proofs-staging / 9076c6c2-4047-47c4-b072-ecf0e5c3573c |
| 表 | document_proof_issuances / document_proof_guards（ほかはCloudflare内部_cf_KVのみ） |
| 鍵 | doc_test_675445bfe73203861868b8f45f3f61bb / Ed25519 / environment:test |
| 秘密鍵 | 生成プロセスのメモリ・標準入力pipe経由で発行Worker secretへ。Git・配布・ローカルファイルへ保存していない |
| 公開鍵 | 専用配布と表示Workerの信頼カタログにだけ追加。本番には追加していない |
| 発行制限 | ステージング全体20件/分。通常の最小記録容量制限も有効 |
| 発行Worker版 | 8fa01a3a-8c44-4795-8e46-c95103aff99f |
| 表示Worker版 | 7c5f933b-d298-464d-b426-a0445c59b1c8 |
| 配布 | release/document-staging/0.11.1-staging.2/marketplace |

再配備ではテスト鍵を維持し、.1のスキル登録も保持した。.1の成果物・記録を上書きしていない。発行表の移行は新しい専用DBへ0008だけを適用。表示WorkerにはDB・OAuth・発行秘密鍵のbindingなし。observability:falseとno-storeを設定したが、アカウント全体の監視/CDNルールの運用確認は別の未実施項目。

## 実施した確認

1. scripts/smoke-document-staging.mjsを専用配布へ実行。合成6 CFP・18時間の文書だけを使用し、ソースや実利用者データは送っていない。
2. 実MCPで公式ルール取得→匿名の証明発行→同じ要求を再送して同一証明→ローカル署名添付を確認。
3. 未証明のWeb同意→証明追加→旧同意では停止→変更後の合成回答で再同意→表示準備を確認。
4. ローカルMCPのカードデータ・UI resource・PDF・証明JSON取得をSDKから確認。これは実ChatGPTのカード描画/ダウンロードの確認ではない。
5. 実表示WorkerへのPOSTは署名確認付きHTMLとno-storeを返した。この時点はHTML受信まで。
6. 別途、実ChatGPT IABでHTTPSページを開き、estimate.mdを選択、proof.jsonを選択、表示を押した。signature VALID / document MATCH / issuer TRUSTED / current_status NOT_CHECKEDの実表示を確認。使用証明は.1試験のdocp_5e556151d4175346301f80cea05be9cb。

初回の同一要求2送信後、専用DBの発行記録は1件だった。現在は.2試験の別操作が追加されている。最小記録以外の本文/モデル保存表は設けていない。

実画面：C:/Users/yamamotoma/.codex/visualizations/2026/10/27/01a17dcf-30d6-77e0-8751-ee56cdd57566/staging-iab-preview.png 。.2のプロトコル結果はrelease/document-staging/0.11.1-staging.2/ACCEPTANCE-LATEST.json。回答記録は試験用の合成回答であり、実対話の利用者同意とは区別する。

## 標準方式の判断

IABのURLポリシーがfile://を拒否した。ブロックを回避せず、HTTPSファイル選択で実表示した。利用者は2026-10-28に「ファイル選択方式で受入を進める」と回答したため、この方式を標準とする。未証明はページを開く→Markdown選択→表示の3操作、証明付きは証明選択が加わる4操作。ファイル取得/ダウンロードは別途必要。URLだけでは再表示できず、準備完了やURLを開いた時点では送信済み・表示済みとしない。

## 実ホストで残っている確認

このチャットの接続ツールは旧構成で、show_document/get_document_pdf/issue_document_proofを新配布物から読み込めていない。CLIのplugin listも未登録だったが、CLI登録と実ChatGPT接続は別の事実として扱う。Computer Useのguidance.mdはWindows版ChatGPTデスクトップUIの自動操作を禁止しているため、設定画面からの読込を自動化していない。

残りは、ステージング配布を対象ホストへ読み込んだ状態で、カード実表示→PDF取得→実対話の同意→証明取得→別の表示同意→ファイル選択表示を通すこと。未証明・未同意の開始用文書を以下へ準備した。

`C:\git\open-estimate\release\document-staging\0.11.1-staging.2\acceptance\971b9331-b714-46d5-a6d6-9109d8a14834\host-start-document`

同じacceptance実行ディレクトリーのHOST-ACCEPTANCE.mdに手順を置いた。新解析や実プロジェクトの読取は不要。正式な完了判定はこの記録の未確認欄が解消してから行う。

ローカルCodexプラグインを使うホスト向けには、実機CLIのhelpで以下の登録構文を確認した（未実行）。この登録だけで実ChatGPTの接続が完了したとしない。

```powershell
codex plugin marketplace add "C:\git\open-estimate\release\document-staging\0.11.1-staging.2\marketplace"
codex plugin add open-estimate@open-estimate-document-staging
```

## 運用・復旧

prepare-document-staging.mjs --deploy [revision]は専用リソースにだけ配備する。.2以降は直前のSTAGING.jsonの公開鍵情報とWorker内secretを再利用し、旧スキル登録を保持。秘密鍵は再取得・表示しない。新発行を止める場合は当該ステージングのDOCUMENT_ISSUANCE_ENABLEDをfalseにして配備する。発行記録・公開検証鍵は削除しない。本番環境のフラグやテーブルを操作しない。
