> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# 公開結果のブラウザー表示 — 実装・受入記録

確認日：2026-10-22 JST。対象：0.8.1作業ツリー。配布版・本番デプロイの更新ではない。

## 実装した範囲

署名・状態検査を通った公開中の証明書を、`/e/<share_id>`で日本語の見積内容として表示する。既存の静的デモHTMLではなく、D1の公開内容を既存`CertificateService.shared`で読み取る。

- CFP、Entry／Exit／Read／Write、計上数、参考工数（人時）、基準USD額を表示する。
- 人日は署名された人時と1日8時間からDecimalで算出する表示用の派生値。小数第2位まで四捨五入。為替換算は画面に追加しない。
- TESTと発行環境を区別し、TESTの注意を結果の直前に表示する。PARTIALの暫定内数、未解決候補、未読数、境界未確認、理由コードを日本語で表示する。nullは「算出不可／未算出」とし、0で補完しない。
- 公開説明と自己申告の公開者・モデル、基準、発行元、発行時刻、技術情報を表示する。公開自由文はescapeする。
- JSON取得、公式鍵カタログ、最小状態の検証URL、印刷ボタンと印刷CSSを用意する。
- ブラウザーは同一サイトのJSON・公式鍵カタログだけを取得し、JCS/SHA-256/Ed25519を検証する。画面の証明書ID・hashに拘束し、その後の状態取得で署名一致と現在の公開・有効状態を区別する。未知鍵・不一致・通信失敗・非対応を成功表示にしない。
- 公開停止・証明書失効・鍵失効は410、未知IDは404、DB障害・旧世代・不正署名・設定不足は503。HTMLのエラー画面にも過去の見積内容を入れない。結果・JSON・状態はno-store。検索一覧・数値入りOGP・Service Workerは追加しない。

`public-result-runtime.ts`を本番Workerへ接続した。閲覧用adapterは公開鍵だけで動作し、発行・公開のwrite操作と署名はできない。`ISSUANCE_ENABLED`を変更してもこのadapterでは発行できない。

## ローカルで見る

```powershell
npm run dev:public-result
```

表示された`http://127.0.0.1:<port>/fixture`を開く。COMPLETE／PARTIAL／INCOMPLETE／公開停止を選べる。隔離されたSQLiteと実行時生成の合成鍵のみを使用する。fixture内でproduction形式のorigin・鍵IDを使うのは本番用read adapterを通すためであり、本番発行の証拠ではない。テストデータであることを画面に表示する。このハーネスはWorkerからimportせず、public/へも配置しない。

## 本番の閲覧設定

既存D1に正規の承認経路で発行・公開された記録があることを前提とする。

| 設定 | 内容 |
|---|---|
| PUBLICATION_READ_ENABLED | `true`。既存wrangler設定は`false`のまま |
| PUBLIC_STATUS_GENERATION | 運営が現在の世代として管理する`sg_`＋小文字hex32桁。古いDB内の値だけから自動復元しない |
| PUBLIC_SIGNING_KEYS_JSON | 下記の公開鍵配列。運営の信頼済みカタログから供給する。秘密鍵は設定しない |
| CERTIFICATES_DB | 既存の証明書D1 binding |

鍵配列の各要素は`key_id`、`algorithm:"Ed25519"`、`public_key`（raw32byteのbase64url）、`issuer_origin:"https://open-estimate.ai-orchestration.jp"`、`deployment_environment:"production"`、`created_at`（ISO日時）のみ。未知キー・重複ID・test鍵・不正形式を拒否する。過去の署名検証に必要な公開鍵は保持する。鍵の現在状態はD1を別途確認する。

## 検証結果

| 確認 | 結果 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS。初回はplugin manifestへの書込権限制限。許可された再実行で完了 |
| 公開結果Web・証明書core・serviceの試験 | 3ファイル55件PASS（うち新規Web6件） |
| `npm test` | 38ファイル399件中394件PASS、5件は環境のファイルアクセス制限で失敗 |
| 制限で失敗した4ファイルの再実行 | 35件すべてPASS。全体試験と合わせて399件の成功を確認 |
| `npm run deploy:check` | PASS。初回のWranglerログ・一時ディレクトリ制限を解消してdry-run成功。デプロイなし |
| `git diff --check` | PASS |
| 実ブラウザー | ローカルIABの狭幅（約304px）でPARTIAL・工数表・理由・署名検証成功・停止画面を確認 |

署名の1フィールド改変、偽署名、未知鍵、異なるissuer、閲覧flag無効、test鍵混入、DBなし、DB障害、旧世代、鍵失効、不正保存JSON、未知IDを自動試験で検査した。停止後はHTML・JSON・換算・印刷クエリー・条件付き再取得を410とし、公開説明やasset fallbackが出ないことを確認した。

## 未実施・残る工程

本変更は公開済み結果の**閲覧経路**を完成させる。既存本人限定previewから発行・一般公開までのCLI／ブラウザー承認の接続は別工程として残る。`publish-certificate`／`resume-certificate`の既存拒否動作、本人限定preview、配布ZIPは変更していない。

本番への秘密鍵登録、実ユーザーの発行・公開承認、本番記録の新規作成、閲覧flagの有効化、Workerデプロイ、実ホストでの第三者閲覧・停止受入は未実施。PC幅・複数ブラウザー・実際の印刷PDFの全ページ確認も未実施（印刷機能とCSSは実装済み）。既配信の画面や保存物の遠隔消去は保証しない。
