> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# 中央測定ルールの運用

対応プラグインは正規MCPから測定ルール全文を取得し、解析セッションに固定します。本文を編集する原本は `rules/measurement/source.md` 一つです。内容由来のrevisionは自動計算し、利用者や運用者によるhash転記・版の採番・顧客登録は不要です。AIが本文を実際に正しく適用したことの証明ではありません。

## 初回対応と通常運用

初回対応やCLI変更時は `npm run release -- --version <次の配布版>` を使います。`release:prepare` はローカル検証まで、`release:publish` は固定候補の公開・本番確認・プラグイン昇格を行います。スキル受付履歴とルール履歴を同じWorkerへ同梱します。初回publishがスキル移行期限とは別のrules_enforcement_atを14日＋処理余裕1時間後に設定し、初回配布可能時に14日以上を確保します。昇格前に中断した場合は再確認し、公開済みの期限は以後延長しません。

初回対応版が公開された後の日常操作は次の一操作です。

```sh
# rules/measurement/source.mdを編集した後
npm run rules:release
```

ルールだけの更新はpackage.jsonの版、plugin.json、skill.manifest.json、配布先プラグインを変更しません。既存の受付中のスキル版を使って疎通を検査します。初回の正常公開履歴がない場合は `INITIAL_PLUGIN_RELEASE_REQUIRED` で停止します。未公開の候補を公開済み履歴として登録して進めません。

## 公開前の検査と再開

- `npm run rules:prepare`：本文・規則ID・サイズ・互換性を検査し、関連テスト、Workerのdry-runとローカルHTTP試験を行います。ネット公開はしません。
- `npm run rules:publish`：最後にprepareした固定候補を再検査し、デプロイ、実MCPの全文・版・互換性・USD合成モデル・未知版拒否を確認して履歴を保存します。再ビルドしません。
- `npm run rules:release`：上記を順に実施します。通常操作にrevision引数は不要です。

候補は `release/rules-staging/<current_revision>/<候補内容hash>/` に保存します。同じ本文の停止・current復旧を区別するため、版の下で履歴と状態を含む候補を固定します。`PREPARED.json` がpublish対象を示し、各候補の `publication.json` が到達段階を示します。

通常リリースとルール専用リリースは `release/operation.lock` を共有し、スキル／ルール両方の基準履歴hashを検査します。別の公開で履歴が変わった古い候補は拒否します。公開済み・停止済みの履歴は `profiles/skill-releases.json` と `profiles/measurement-rules.json` に保存され、通常のバージョン管理・バックアップに含めます。候補の削除で公開履歴は消えません。

デプロイまたは本番確認で失敗した場合はPUBLICATION_UNCONFIRMEDです。**サーバーは既に切替済みの可能性があります。** 同じ候補でrules:publishを再実行してください。`release/PENDING.json` が残る間は、別候補の公開で未確認の配信版を落とさないよう、新しい候補への切替を拒否します。履歴保存に失敗した場合も成功扱いにせず、同じ候補から再開します。

## 例外操作：停止とcurrent復旧

本文を手で改変して過去版に上書きしません。既存の完全なrevisionを指定し、同じ準備・公開経路を使います。

```sh
npm run rules:prepare -- --withdraw <停止する既存revision> --current <受付中の復旧先revision>
npm run rules:publish
```

current以外を停止する場合はwithdrawだけ、currentを受付中の別版へ戻す場合はcurrentだけを使えます。withdrawnをcurrentへ指定したり、通常生成で再有効化することはできません。Workerコードを前版へ戻す場合も、現在のスキルとルールの受付・停止履歴を保持して新しい候補を作ります。古いWorker成果物の直接復元を通常手順にしません。

## 利用・保存・保証の境界

CLIはcontract／skill-integrity → get_measurement_rules → scan／bind-rules → 対象確認・confirm → prepare／read／exportの順です。bind-rulesには `rules_response` として取得成功応答のstructuredContentを渡します。固定前のprepareは停止し、同版bindは冪等、別版bind・保存bundle破損・判断の未定義規則ID／別revisionは拒否します。draftとpurgeは救出用に維持します。

exportはmodel、skill_integrity、ruleset_ref、Assessmentとcontextのローカル保存先を返します。送信するのは数値モデル・通貨・スキル情報・ルール参照だけです。対象ソース・対象パス・Assessment・判断台帳・ルール本文・ローカルcontextは送信しません。読取と送信の既存同意を維持し、追加同意画面を設けません。

進行中は固定版、新規解析はcurrentを使います。停止された固定版は再解析し、最新版へ黙って差し替えません。過去モデルは保存した版を使い、不明な版を現在版で補完しません。新方式は初日からruleset_ref必須、登録済みの旧方式版はルール移行期限前の省略をLEGACY_LOCAL_RULESとして扱います。スキル申告のない従来要求も、スキル側がLEGACY_UNCHECKEDを返し、スキル・ルール両方の移行期限内である場合に限り同じ旧方式として受け付けます。旧方式のcontext hashはnullです。

source=skillは互換用ラベルで、OESの配信規則を意味します。idは配信したrule_ids、versionは完全なrevisionです。既存Assessmentは変更せず、別の内容アドレスファイルにbundle・ruleset_ref・assessment_hashとcontext_hashを保持します。長期保存時はAssessmentとcontextを一緒に保持してください。保存期間は既存24時間セッションとpurgeに従います。

report_hashは既存の数値結果の値を維持し、evaluation_context_hashは数値結果と申告ルール版を対応付けます。署名・認証・実行証明ではありません。本番配信・プラグイン昇格・外部提出・Work／Codexの新しいチャットでの実機受入は、ローカル自動試験と別に記録します。

## 公開前レビューへの修正（2026-10-19）

候補のWorker試験が成功した後だけvalidation.jsonを原子的に保存します。成功記録はcandidate.json全体の内容hashに結び付け、candidate.json内の配布物・Worker・各履歴hashも従来どおり実ファイルと照合します。通常／ルール専用のどちらも公開前に成功記録を必須とし、未検証・失敗・候補変更時はCANDIDATE_NOT_VALIDATEDで停止します。prepareで同じ未検証候補を再利用する場合は、再ビルドせずWorker試験を再実行します。成功記録のない旧候補も同様です。失敗を成功扱いにする手動フラグは設けません。
