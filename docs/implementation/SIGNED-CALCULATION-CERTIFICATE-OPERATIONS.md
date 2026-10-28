> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# 計算証明書 運用への引継ぎ

状態：開発段階の引継ぎ。運用環境・担当・鍵・認証は未設定。本書を運用済みの証拠にしない。

2026-10-20 12:31 JST更新：発行・公開を無効に保った本番Workerと専用D1の基盤接続試験を実施済み。[本番基盤の接続試験](SIGNED-CALCULATION-CERTIFICATE-PRODUCTION-BOOTSTRAP.md)を最新の環境・migration適用状況とする。以下の初回引継ぎにある「DB作成/デプロイ未実施」は、この接続試験に関して更新される。運用鍵・実Auth0・発行/公開は引き続き未設定。

2026-10-20追記：認証・本人承認の方式は[Auth0 + Webで1回の承認](SIGNED-CALCULATION-CERTIFICATE-AUTH-DECISION.md)を選定した。実tenant・メールprovider・browser session・本番routingは未接続。以下のG1/G2の運用条件は引き続き実環境での確定・受入が必要。

## 現在の安全な初期状態

`wrangler.jsonc`の発行・配信flagはfalse。default Workerの証明書経路は403で停止し、通常の静的LPだけをassetsへ渡す。flagをtrueにするだけではserviceへ接続されない。認証・本人承認・D1・鍵・engineカタログの接続はレビュー対象のdeployment adapterで行う。

`migrations/0001_certificates.sql`は新しいDB用のmigration。既存DBの有無・構造を確認してから適用先を決める。現段階ではDB作成・migration実行・本番デプロイを行っていない。

## 公開前に確定する項目

- G1/G2：認証provider、audience/scope、本人承認の信頼経路、プラグインとの関連付け・回復。自然言語の承認やAPI tokenだけでreceiptを生成しない。
- G3：preview削除、監査30日という初期案、退会とバックアップの保持方針。
- G4：担当者・鍵復旧コピーの保管先と権限、鍵事故、保守的なDB世代切替の受入。
- G5：隔離したWorker/D1、料金上限・通知、読取/発行rate limit、窓口の実体。
- G6：skill/rules/engine/basisの発行用登録、実ホストでの送信・公開承認・発行・停止。

## 鍵の登録・通常ローテーション

運用鍵の生成・secret登録スクリプトは未実装。tests内のRFCテスト鍵を流用しない。運用秘密鍵はWorker secretへ渡し、Git・DB・ZIP・ログ・チャットへ出さない。登録時には公開鍵と秘密鍵の対応、環境別origin/key_id、既知buildを照合する。

新しい公開鍵定義を先に配布し、第三者検証を確認する。その後にACTIVEの発行鍵を切り替え、旧鍵をRETIREDにする。旧公開鍵は保持する。RETIREDで新規署名しない。現在の状態を不変鍵カタログへ混ぜない。

## 公開停止・失効・鍵事故

所有者の公開停止は認証と操作内容に結び付いた承認を検査し、publicationをWITHDRAWNにし、publication_contentsを同じbatchで削除する。再公開は新しいpreview・承認・IDで行う。既存ファイルや第三者保存物の遠隔消去は保証しない。

運営失効のrepository処理はあるが、運営API・権限adapter・操作スクリプトは未接続。運用上の直接SQLを日常操作として採用せず、専用権限の経路を完成させる。

鍵漏えい疑いでは発行停止 → 鍵REVOKEDと配信停止 → 影響確認・窓口案内 → 新鍵の事前配布と検証 → 新規発行再開の順。過去日時の署名で救済したり、本人承認なしに自動で再署名しない。

## 応答喪失

サーバーserviceは同じowner/idempotency_key/fingerprintの確定受付を、preview期限と承認消費の検査より先に回復する。確定受付なしの404は、送信中の処理が失敗した証明ではない。同じキーで再試行し、別キー・nonceを生成しない。WITHDRAWN後はEnvelopeを再配信しない。

CLIのネットワーク送信・受付照会・発行後ローカル保存回復は未実装。現在の`prepare-certificate`で保存したsubmissionを消去せずに保持し、接続実装後の回復試験を行う。手作業で発行済みと書き換えない。

## DB復旧

1. 外部配信と発行を停止する。
2. DBバックアップとは別のWorker設定でstatus_generationを新しいCSPRNG値へ更新する。
3. DBを復旧する。DBに残る旧世代をWorker設定へ戻さない。
4. 旧世代のPUBLICを全詳細経路で配信しないことを確認する。
5. 現在の鍵・発行policy・窓口を確認し、運営承認後に再開する。

旧世代全体のオンライン状態がUNKNOWNになる場合がある。再発行は新しい本人承認による。この手順の実環境演習は未実施。

## 定期削除と監視

repositoryにpreview期限後の内容削除と監査期限削除を用意したが、稼働するWorkerへのscheduled接続は未配備。期限後1時間以内の削除を実現するcronと受入が必要。費用・異常発行数・署名失敗・状態照会失敗を本文やnonceを記録せず監視する。具体的な予算・通知先はG5で確定する。
