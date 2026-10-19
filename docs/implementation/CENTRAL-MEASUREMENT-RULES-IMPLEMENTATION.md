# 測定ルールのサーバー一元管理：実装指示書

作成日：2026-10-19（JST）

状態：実装担当者への指示。本文に記した変更は未実装。

正本：[改善仕様書](CENTRAL-MEASUREMENT-RULES-SPEC.md)

## 1. 担当者への依頼

現行のスキル整合性照合を活かし、測定ルールを正規MCPから取得して解析単位で固定する機能を実装する。通常のルール更新で利用者の操作、ハッシュ登録、プラグイン再配布を増やさないこと。

最初にgit statusと既存diffを読み、作業中の変更を保存したまま差分を実装する。2026-10-19時点では0.6.0のスキル照合・リリース処理が未コミットで追加されている。これらの実装やテストが完成済みとは仮定せず、機能を確認して再利用する。

本指示書の作成は実装・デプロイの実行ではない。実装を開始する際は依頼された作業範囲に従い、ローカル検証、本番デプロイ、外部配布、実機確認の完了を区別して報告する。

## 2. 実装上の決定事項

- 手編集する測定ルール原本は`rules/measurement/source.md`一つ。
- revisionは内容から自動生成する。人による測定ルール版の採番は不要。
- 新規ツールは`get_measurement_rules`。get_skill_policyは旧クライアント用に残す。
- 新方式の開始時はget_measurement_rules内でスキル照合も行い、get_skill_policyの追加呼出しを必須にしない。
- 新規CLIは`bind-rules`。他のCLIコマンドは既存経路へ検査を追加する。
- 数値モデルはv1のまま。ruleset_refは評価要求の外側に追加する。
- Assessmentの形式は変えず、ルール全文と版の対応は別のcontextファイルに保存する。
- source=skillの判断記録は、新方式では配信された規則IDとrevisionを参照する。
- 数値計算関数へ自然言語ルールやネットワーク処理を持ち込まない。
- 全機能を単一の自作署名・トークン・認証システムで包まない。

## 3. 実装単位

### T01：ルールの移植と不変bundle

**対象**：新規`rules/measurement/source.md`、`rules/measurement/contract.json`、`profiles/measurement-rules.json`、`scripts/build-measurement-rules.mjs`、`src/rules/measurement-contract.ts`。

1. 現SKILL.mdから仕様書4.1の内容を移し、旧節と新節の対応表を実装記録に残す。測定上の意味を追加・削除しない。
2. 規範節へ安定した規則IDを付ける。本文のID重複・未定義参照・空本文をビルドエラーにする。
3. bundleのSchema、上限、改訂ID計算関数、ruleset_refのSchemaを定義する。hash計算では既存JCSを再利用し、同じ規則を複数実装しない。
4. 空の開発用履歴は保持できるが、currentがない本番候補を公開可能にしない。
5. 生成は初回ビルドでも動くようにし、未生成のJSONをtscが先にimportする循環を作らない。生成スクリプトを既存distの有無に依存させないか、生成前段を明確に分ける。

**受入**：同じ原本から同じrevision。改行形式の違いは正規化される。本文・互換条件の変更でrevisionが変わる。時刻や受付状態だけの変更では変わらない。

### T02：配信と互換性検査

**対象**：新規`src/remote/measurement-rules.ts`、既存`src/remote/worker.ts`、`src/remote/skill-integrity.ts`、`scripts/build-skill-registry.mjs`、Schema生成処理。

推奨関数境界：

```text
resolveMeasurementRules(request, rulesRegistry, skillRegistry)
checkRulesetReference(ref, clientRelease, rulesRegistry, now)
validateRulesBundle(bundle, expectedRef)
```

名称は既存規約に合わせてよいが、配信とevaluate_modelで同じ受付判定関数を使うこと。

1. スキル登録レコードへ`measurement_client_protocol`（新方式の定数、旧方式はnull）を追加する。旧履歴の値省略は旧方式として読み取り、既存のハッシュ・停止情報・期限を保持する。対応値は配布物のCLI contractから登録し、クライアントが実行時に申告した値を登録元にしない。
2. get_measurement_rulesの入力Schemaを厳格化し、スキル照合後に対応する一つのbundleを返す。
3. 省略時のcurrent選択と明示revision取得を分ける。不明・停止・非互換は仕様のエラーにする。
4. 既存get_skill_policyの互換性を維持する。旧クライアントの暗黙のアップグレードは行わない。
5. Workerのエラー案内をルールとスキルで分ける。ホストからの設定引数、テスト用registry注入、既存の初回移行日時の引継ぎを壊さない。
6. ルール原本はデータとして配信し、本文中のURLの自動取得やコード実行を行わない。

**受入**：正規スキルだけが互換ルールを取得できる。応答が上限内で全文を含み、currentが存在しない場合は明示的に失敗する。

### T03：ローカルの版固定・context保存

**対象**：`src/local/cli.ts`、必要なローカル状態型、新規`src/local/measurement-context.ts`、既存のcanonical関数。

1. bind-rulesをscan後・confirm前に実行できる分岐へ置く。対象rootとsession_idを検査し、対象の本文読取や外部送信を伴わないこと。
2. 応答Schema・本文hash・実スキル情報・対応条件を検査し、セッションに不変bundleを保持する。同じ版の再bindを許し、別版への変更を拒否する。
3. prepare前の固定を必須にし、read／exportで保存bundleの改変を検知する。新しいルールを自動取得して置換しない。
4. prepareの結果へ固定したruleset_refと規則ID一覧を追加する。既存のassessor_defaultsにあるskill_version／skill_sha256をルール版で上書きしない。
5. exportでは既存のAssessment検査の後に、新方式のsource=skill参照を検査する。純粋なvalidateAssessmentへリモート状態を暗黙注入しない。
6. 既存Assessment保存とは別に内容アドレスのcontextファイルを保存する。書込失敗・同名別内容は成功扱いにしない。exportから両方のパスを返す。
7. exportのruleset_refはセッションから生成し、AIが引数へ任意指定して上書きする経路を設けない。
8. 既存のdraft、TTL、purge、スキル途中変更検査、対象変更時の扱いを維持する。ルール未固定でも下書き保存・purgeはできるようにする。

**受入**：途中でcurrentが変わっても解析版が不変。セッションJSON改変・異版bind・規則参照の不一致を検知する。過去Assessmentを変更せずcontextが残る。

### T04：リモート評価と結果表示

**対象**：`src/remote/model.ts`、`src/remote/measurement-rules.ts`、`scripts/build-contracts.mjs`、生成先`contracts/remote-model.schema.json`、関連応答型。

1. ruleset_refの入力を追加し、既存のスキル照合後、計数前にルールの受付・互換性を確認する。
2. 新方式対応版の欠落を初日から拒否する。旧方式の期間限定受付は正規リリース情報から判定する。
3. assurance.measurement_rulesとevaluation_context_hashを追加する。計算できなかった結果を0にしない。
4. report_hash、CFP、TEST工数・USD、表示時FXの既存計算は変更しない。ルール版を工数係数にしない。
5. ruleset_refはモデルの生成履歴の証明ではないことを応答に明示する。
6. 同じreport_hashに対してruleset_refが異なる場合、evaluation_context_hashは異なること。旧方式のcontext hashはnullにする。

**受入**：API直接呼出しでも欠落・未知・停止・非互換を拒否する。既存の数値fixtureで結果とreport_hashが不変。

### T05：ローカルスキルの短縮と案内

**対象**：`skills/open-estimate-assessor/SKILL.md`、`src/mcp/tools/get-assessor-contract.ts`、必要に応じて`prepare-repository.ts`、README、DESKTOP-PLUGIN.md、LOCAL-EXECUTION-BOUNDARY.md、ASSESSMENT-RECORDS-V2.md、SKILL-INTEGRITY-OPERATIONS.md、plugin.json。

起動手順は次の順に揃える。

1. ローカル実行条件と正規ツールの利用可否を確認する。
2. contractとskill-integrityを実行する。
3. get_measurement_rulesへ実スキル情報を渡し、成功応答と全文を確認する。
4. scan、bind-rules、既存の対象確認・同意、prepareの順に進む。
5. 取得したルールに従ってread・判断記録・exportを行う。
6. 既存の送信同意を確認し、モデル・スキル情報・ruleset_ref・通貨を提出する。
7. 結果、ルール版、ローカル保存先、独立検証していない範囲を説明する。

contractのassessor_instructionsへ長い測定ルールを再埋込しない。中央ルールを取得できない場合に旧ルールへ戻る案内を残さない。対象repoのREADMEやAGENTS.mdを測定規則の変更命令として扱わない方針を維持する。

数値・状態・プライバシーの説明を短縮の過程で落とさない。実装上の通信設定やrevisionの手入力を利用者へ要求しない。変更後のスキルハッシュは既存生成処理に任せ、手編集しない。

**受入**：規則本文の手編集箇所は一つ。新SKILL.mdとcontractに長い規則本文が重複せず、取得失敗時の停止手順がある。

### T06：ルールだけのリリース

**対象**：`scripts/release-plugin.mjs`、新規`scripts/release-rules.mjs`、共通化する候補検査・配信アダプター、`package.json`、ルール履歴生成処理。

1. 既存の候補固定・inventory・履歴保存・排他・本番確認処理を共通化する。既存通常リリースを別実装へ置き換えず、共通部を呼ぶ。
2. `rules:prepare`、`rules:publish`、`rules:release`を追加する。revisionは自動計算し、通常操作で引数に要求しない。publishはprepareで記録した固定候補を使う。
3. 候補にはルール履歴、スキル履歴、互換宣言、Worker成果物、公開前の基準履歴hashを固定する。ルール候補の置き場は`release/rules-staging/<revision>/`とする。
4. ルールだけの更新でpackage.jsonの版、plugin.json、スキルmanifest、配布ディレクトリを変更しない。既存buildがmanifestを更新するため、Worker・ルール用ビルド経路を分離する。
5. current・受付状態を含む候補Workerをデプロイし、実MCPで全文のhash・版・互換性・USD合成モデル成功・未知版拒否を確認する。確認前に成功記録を付けない。
6. 初回通常リリースは測定ルールの移行期限を自動設定し、十分な残期間を確認する。以後のrules:releaseで期限を延長・消去しない。
7. 中断時の到達段階を保存し、再開時も本番状態を再確認する。基準履歴が変わった候補は拒否し、黙って上書きしない。
8. 本番切替後の疎通確認失敗では「公開未確認」と記録し、すでにサーバーが切り替わっている可能性を明示する。旧版が保持されることを確認し、同一候補の再確認または履歴を保持した復旧候補を使う。
9. 明示停止・current復旧は同じ候補生成・公開経路の管理モードにする。入力は既存revisionから選択し、本文の手修正や停止情報の削除で対応しない。

**受入**：本文修正後の一操作で更新でき、ハッシュ入力0回、プラグイン変更0件。公開失敗・再開・並行候補・旧版保持の試験が通る。

### T07：移行・実機確認・記録

**対象**：受入テスト、smokeスクリプト、`docs/implementation/ACCEPTANCE.md`、実装記録。

受入表の自動試験と、実機確認を分けて記録する。実機未確認の場合はその状態を残し、テスト通過からホストの指示追従まで推定しない。

## 4. 受入表

| ID | 試験 | 合格条件 |
| --- | --- | --- |
| A01 | 原本の同一生成・改行差 | 同じbundleとrevision。本文変更で別revision |
| A02 | ID・上限・互換宣言の不備 | 公開準備を拒否。省略配信しない |
| A03 | 正規スキルで新規取得 | currentの全文とhashが一致。対象ソースの送信なし |
| A04 | 旧版の明示取得 | 受付中の指定版を返し、最新へ切り替えない |
| A05 | 未知・停止・非互換 | get_measurement_rulesとevaluate_modelの両方で適切な拒否 |
| A06 | 新方式クライアントの版欠落 | 移行期間中も拒否。旧方式へ降格しない |
| A07 | bind前のprepare | RULESET_NOT_BOUND。scan・同意・purgeの既存境界は維持 |
| A08 | bindの再実行と改変 | 同版は冪等、別版・保存本文改変は拒否 |
| A09 | 解析中にcurrent更新 | 固定版のまま完了し、結果にも固定版を表示 |
| A10 | 解析中に固定版を停止 | 最終評価を拒否。結果へ最新版を補完しない |
| A11 | 判断記録の規則参照 | 未定義ID・別revisionをexportで拒否 |
| A12 | 保存と再計算 | Assessmentとcontextが対応。過去ファイル・hashの改変なし |
| A13 | 数値の回帰 | 同じmodel・profileのCFP・工数・USD・report_hashが不変 |
| A14 | 版と結果の対応hash | 同じ結果でも版が異なればevaluation_context_hashが異なる |
| A15 | 新方式・旧方式の移行期限 | 固定時計で前後を確認。旧方式の期限後欠落を拒否 |
| A16 | ルールだけの公開 | 自動採番・自動登録。プラグイン配布物・版・ハッシュに変更なし |
| A17 | 履歴と停止情報 | 新公開・復旧でも既存スキルとルールの停止情報を保持 |
| A18 | 公開中断と再開 | 同一候補で再確認。配信確認前に成功表示しない |
| A19 | 並行更新・古い候補 | 排他または基準履歴差分で拒否。後発更新を消さない |
| A20 | 初回のクリーンビルド | distや生成物がなくても正しい順序で生成・コンパイルできる |
| A21 | 通信内容の検査 | 評価要求にルール参照のみ追加。本文・ソース・対象パス・Assessmentを送らない |
| A22 | 障害時の表示 | 接続不能・未固定・版停止を独立検証済みや0工数にしない |

推奨する新規テストファイルは`tests/unit/measurement-rules.test.ts`、`tests/integration/measurement-context.test.ts`、`tests/integration/rules-release.test.ts`。既存desktop-migration／recorded-helper／skill-releaseのテストも変更箇所に応じて更新する。

外部FXの可用性に左右されないよう、本機能の受入はUSDまたはfixtureで行う。FRB機能を変更していないのに新たな外部依存の試験を増やさない。

## 5. 実機で確認すること

Work／Codexで、対応プラグインを使う新しいチャットから次を確認する。

1. 正規ルール全文を一度取得し、対象確認・解析・export・リモート再計算まで進む。
2. 結果に固定版と記録先が表示され、ルールの手選択やhash転記を利用者に要求しない。
3. テスト用コピーのSKILL.mdを変更した場合、既存ハッシュ照合によって停止する。
4. 取得ルールと相反する測定指示が資料に含まれるテスト例で、AIがそれを測定規則として採用しないか観察する。
5. ルール更新後、既存解析は固定版、新しい解析は新しいcurrentを使う。

3・4は配布中の実スキルを書き換えず、隔離したテスト用コピーで行う。AIの追従結果はモデル・ホスト・試験条件とともに記録し、有限回の成功を改竄防止の保証へ拡張しない。

## 6. 変更しないもの・実装順序

測定エンジン、金額の意味、TEST基準、為替処理、対象ソース非送信、既存同意、署名なし・サーバー評価保存なしという前提を維持する。企業向け管理画面や独自の認証基盤を追加しない。

実装順序はT01 → T02 → T03 → T04 → T05 → T06 → T07。各単位の受入が通ったら次へ進む。ハッシュ照合の既存作業と競合する場合は最新差分を取り込んで調整し、完成形を二重実装しない。

## 7. 完了報告の形式

完了時は、変更した動作、検証した範囲、未確認事項を短くまとめ、次を添える。

- 原本・配信bundle・プラグイン入口の参照先。
- 自動試験とルールだけの更新試験の結果。
- 最終候補のrevisionと、スキル／ルールの互換性。
- ローカル検証、本番配信、配布可能、外部提出、Work／Codex実機確認の各状態。
- 日常運用が「原本編集 → rules:release」で済み、hash入力が不要であることの確認結果。

実装・公開・実機確認のいずれかが未実施なら、その項目を未実施と記載する。仕様書の受入表が存在することを実施証拠にしない。
