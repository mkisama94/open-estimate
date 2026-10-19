# Open Estimate 0.5.0（Work／Codex・ローカル実行向け）

**現行（0.7.0）**：測定ルール全文はget_measurement_rulesで取得し、scan後・confirm前でもbind-rulesで固定できます。prepare前の固定は必須です。contractは入口とSchemaだけを返します。評価にはruleset_refも含め、新方式で版を省略した旧方式への降格は認めません。数値モデル・表示通貨・配布スキルのID/版/整合性確認用ハッシュ・固定した測定ルールのruleset_refを送信します。対象ソース、対象パス、Assessment、判断台帳、ルール本文、ローカルcontextは送信しません。 [現行運用](implementation/CENTRAL-MEASUREMENT-RULES-OPERATIONS.md)。以下の0.4〜0.6の記録と手順は、中央ルールの取得・固定・提出を追加して読みます。


**ソースコードの解析には、対象フォルダーを読み取り、補助スクリプトを実行できるWorkまたはCodexのローカル実行環境が必要です。Chatモードでフォルダーパスを指定するだけでは解析できません。補助スクリプトにはNode.js 24以上を使用します。** Work／Codexでも、クラウド実行などでPCの対象フォルダーにアクセスできない環境では解析を開始できません。

## 導入して評価を始める

1. Node.js 24以上を利用できるようにし、対象フォルダーを開きます。
2. プラグイン一覧で **「オープン工数見積（Work／Codex向け）」** を選びます。新形式の利用には0.5.0の配布物を使い、新しいチャットで開始してください。インストール先キャッシュを直接書き換えないでください。
3. 対象フォルダーを利用できるWorkまたはCodexで、ローカル実行可能な新しいチャットを開始します。画面のモード名だけで判断せず、ファイル読取・ローカル実行の権限と環境を確認します。
4. 「Open Estimateでこのプロジェクトを評価してください。まずファイル読取・補助CLI・リモートMCPが使えるか確認してください」と依頼します。
5. AIが対象へアクセスできるか、Node.js 24以上と補助CLIのcontractが動くか、evaluate_modelが見えるかを確認します。ツールが見えることとHTTP接続成功は別です。接続は送信同意後の実呼出しで確認します。
6. AIが示した対象範囲を確認してから解析を進めます。送信モデルの内容を確認し、送信に同意した後にリモートMCPで再計算します。

現在のChatでローカル処理を実行できない場合の案内：

> この見積りには、PC上のソースを読み取る処理が必要です。現在のChatでは必要なローカル処理を実行できないため、解析は開始していません。対象フォルダーを利用できるWorkまたはCodexのローカル実行環境で、同じ依頼を送ってください。

自動でモードを切り替えたり、同意なく別チャットへ引き継いだりしません。ZIP添付による評価は現行の読取記録・根拠検査と同等の代替手段として提供していません。

## ソース解析用プラグインと再計算専用接続

| 表示・接続 | 役割・必要条件 |
| --- | --- |
| オープン工数見積（Work／Codex向け） | ソース解析用プラグイン。同梱Skill・CLI・リモート接続を使う。対象フォルダーの読取とNode.js 24以上のローカル実行が必要 |
| オープン工数見積（数値モデル再計算専用） | /mcpを直接登録したテスト・再計算用接続に付ける名前。作成済み数値モデルを再計算する。PC上のフォルダーの走査やソース解析は行わない。フォルダーパスを渡さない |

直接登録した接続は上記の「数値モデル再計算専用」として識別してください。Workerのserver titleとツール説明にも役割を明記していますが、既存接続のユーザー設定の名前が自動で変更されるとは限りません。ツールの識別子evaluate_modelは維持します。旧get_assessor_contractを探す手順は新Skillに使いません。

## 失敗した時に分けて案内する内容

| 状態 | 未実行・未完了の範囲と再開方法 |
| --- | --- |
| ローカル実行不可 | ファイル読取、対象アクセス、実行ツール、Node.jsのどれが不足かを明示。解析を開始したことにせず、利用可能なWork／Codexのローカル環境へ移る |
| ツール未検出 | evaluate_modelが見えず、リモート再計算は未実行。プラグイン接続とツール一覧を確認する |
| HTTP接続失敗 | ツールは見えるが呼出しに失敗。リモート再計算は未完了。ローカル解析・exportが完了していればその範囲のみ説明する |
| 入力検査エラー | isErrorとエラーcodeを確認。モデルは受け付けられておらず、結果は未確定 |
| 為替取得失敗 | 算出済みCFP・工数・USDと、未算出の現地通貨を分ける。FX_UNAVAILABLE/FX_STALEを0円にしない。警告付きキャッシュなら前回取得レートと明示 |

現行版は評価ID・評価保存／ID照会・確認用HTML・証明書を提供しません。session_idとsnapshot_idはローカルの作業用識別子です。同じ数値modelがあれば再計算できますが、評価IDからの復元ではありません。

ローカルMCPへの依存を外し、ホスト標準ツール、短時間で終了するNode.js補助CLI、HTTPリモートMCPに分離した版です。認証・サーバー保存・証明書発行・公開は含みません。

## ビルドと検証

Node.js 24以上で以下を実行します。

```powershell
npm ci
npm run build
npm test
npm run deploy:mcp:check
npm run plugin:pack
npm run plugin:smoke
```

新配布先は `release/desktop-marketplace`。旧 `release/local-marketplace` と旧ZIPは置き換えません。プラグインはNode.jsをPATHから起動し、作成者PCの実行ファイルパス・評価対象を設定に埋め込みません。

MCP接続先は `https://open-estimate.ai-orchestration.jp/mcp`。2026-10-18にMCP Workerと `/mcp*` の専用ルートをデプロイし、実際のMCPクライアントで初期接続・tools/list・evaluate_modelを確認しました。初回の配信確認ではFRB取得がFX_UNAVAILABLEでしたが、同日19:59 JSTにWorkers互換性修正を本番反映し、合成試験モデルの6 CFP・18人時・900 USD・142,506 JPY（158.34 JPY/USD）とAVAILABLEを確認しました。利用者の240 CFPモデルの再送はこの配信確認に含みません。

再デプロイは `npm run deploy:mcp`、事前検証は `npm run deploy:mcp:check`。開発時は `npm run dev:mcp` でHTTP MCPを起動できます。Webサイト用の既存wrangler.jsoncとは別のwrangler.mcp.jsoncを使います。`npm run deploy` だけではMCP Workerは更新されません。

## 処理の流れ

補助スクリプトは `node <Skill配置先>/scripts/oes.mjs <command>`。JSONをstdinへ渡し、stdoutにJSONを1件返します。リポジトリ内での開発用起動は `node dist/local/cli.js <command>`。

| コマンド | 入力・動作 |
| --- | --- |
| contract | `{}`。Assessment Schema・Skill情報・読取上限を返す |
| scan | root絶対パス。本文を読まず構成・session_idを返す |
| confirm | root・session_id・user_confirmed。会話で対象の同意を得た後に実行 |
| prepare | root・session_id。測定コピー・manifest・Assessment初期値を作る |
| read | root・session_id・snapshot_id・file_id、任意のstart_line/max_lines。行番号付き読取と台帳更新 |
| draft | root・session_id・snapshot_id・assessment。構造不備のある下書きもローカル保存し、検査エラーを返す。送信modelは作らない |
| export | root・session_id・snapshot_id・assessment（JSON文字列）。根拠と読取台帳を検査し、送信用modelをプレビュー。ネット送信しない |
| purge | session_id。当該sessionのコピーと台帳を削除 |

送信同意後にホストがリモートMCPのevaluate_modelへmodel・skill_integrity・display_currencyを渡します。読取対象の同意、送信の同意、将来の保存の同意は別です。

## 送信契約 v1

`contracts/remote-model.schema.json` が許可リストです。元のAssessmentはローカルに保持し、サーバーへは送信しません。数値モデル内で送るのは、連番のユーザー・ストア・データグループ・関心対象・意味バリアント、プロセスの状態、トリガー、E/X/R/W、完全性・適用困難の申告、表示通貨です。名前、説明、パス、根拠本文、原ID、ソースhashを含みません。任意文字列の説明欄はありません。数値モデルと、利用する配布スキルのID・版・整合性確認用ハッシュを送信します。対象ソースコード、名称、説明、ファイルパス、根拠本文、対象ソースのハッシュは送信しません。

サーバーは未知フィールド・値域・件数・参照・peer/store・トリガー・重複を検査し、サーバー同梱のTESTプロファイルからCFP・工数・USD額・表示時FRB換算を算出します。HTTP本文は1MiB、全movementは1万件まで。計算済みCFP・金額・任意プロファイルは受け付けません。

この検査はモデルの意味の正しさやソースの存在を証明しません。形式上整合する虚偽申告は見抜けません。応答にはCLIENT_REPORTED、NOT_INDEPENDENTLY_VERIFIED、未署名・未保存・未公開を含みます。自由記述を除外しても機能構成の情報は送られます。

サーバーでは入力・応答の独自ログ・DB保存は行いません。Workerのobservabilityは無効。公開時のエッジログ・アクセス制限・レート制限等は配信環境で確認する必要があります。本版に所有者認証はありません。サーバー保存操作は提供しません。

## ローカル保持

既定はOS一時領域のopen-estimate-helper。OES_HELPER_STATEで変更できます。コピーと読取台帳を24時間有効とし、期限後の処理は拒否します。自動削除は行わずpurgeで削除します。クラッシュでlockが残った場合は実行中プロセスがないことを確認し、当該sessionのlockを削除します。

0.5.0ではdraftの下書きとexportの検査済みAssessmentを同じセッションディレクトリへJSON保存します。exportは`local.assessment_path`、`assessment_hash`、`records`、`comparison`、ローカルTEST試算の`report`を返します。保存物には正規化Assessmentと提出時の入力を残し、判断台帳をhashに含めます。purgeでこれらも削除されるので、長期保持が必要なJSONは事前に指定先へコピーしてください。サーバー保存・評価ID照会とは別です。

## Assessment v2と検査の境界

新規作成は`format_version: "oes/assessment/v2"`。contractのSchemaがフィールドの必須性を定義します。`scope`の目的・アプリ境界に加え、`scope_record`に範囲ID・改訂、ユーザー／AIの確認記録、各snapshotパスのincluded／outside／supporting／unresolvedと理由を記録します。ユーザーの範囲確認は計数判断の承認を意味しません。

`function_candidates`に計上・範囲外・統合・未解決を残し、統合先とprocessを追跡します。各processの`boundary`に開始・要求ユーザー・目的・完了・実行形態・統合分割理由を記録します。各data_groupの`definition`に業務上の意味・識別属性（または該当しない理由）・実装属性との対応・集約分離理由・根拠・未確認事項を記録します。

`judgments`のtargetsはcandidate／process／data_group／movementを参照し、movementはprocess_idで識別します。判断種別はadopt／not_counted／merge／split、statusはrecorded／provisional／unresolved、evidence_statusはsufficient／insufficient／missingです。適用した規則のsource・ID・版、解釈・適用理由・根拠・未解決点・代替案を保持します。acceptedは現在の計数モデルへの採用だけを意味し、inferredは実装記載を超える補完推定の有無です。

存在しない根拠・無効な行範囲・統合先不明・判断状態の矛盾はexportエラーです。各計上移動には実装根拠と明示的な判断が必要です。根拠があり未解決点を明示したprovisionalは計数でき、PARTIALになります。未採用のunresolved機能の規模は未確定で、0 CFPではありません。暫定対象のCFP小計は合計の内数で、誤差幅ではありません。

findingsは構造化targets（judgmentも可）・impact・resolutionを保持します。自由文の単語検索で状態を判定しません。所見と判断の状態矛盾を検査しますが、文章の意味を自動監査するものではありません。具体的属性や規則の適用が妥当かは意味判断が残ります。

v2の`input.analysis_complete`は収集器が照合した走査・取得状況です。範囲内の読取完了は別に導出します。リモートv1の`analysis_complete`へは`local.records.analysis_complete`、`partial`へは同じ判定規則の部分測定状態を投影します。範囲外・補助資料の未読だけでは範囲内未完了にしません。所属不明・走査打ち切り・範囲内未読・候補未解決・暫定判断は完了にしません。範囲外への分類は利用者の範囲確認参照、または読取根拠を要します。COMPLETEも未知の機能がないことや意味解釈の正しさを保証しません。

0.5.0時点の記録：当時はリモート送信Schema v1を変更せず、追加台帳・名称・パス・根拠・hashは送信しませんでした。現行はmodel.versionを維持し、外側の契約へskill_integrityを追加しています。`analysis_complete`の送信側での導出元を明確にし、受信側の「申告されたモデルの完了状態」という扱いを維持します。この実装に伴う本番デプロイは行いません。

比較対象を明示した場合は`comparison.previous_assessment`に元データを保持し、`previous_hash`で照合します。scope_changesに前後のcandidate／process対応、追加／除外／統合／分割の理由と根拠、movement_changesに移動の追加／削除／統合／分割／対応未確定と判断参照を記録します。CFP差は保存モデルから計算し、未対応移動・未説明差分を分けて返します。IDや配列順から同一性を推定しません。比較履歴は最大12段、CLI入力は8MiBです。

旧形式（版なし、または`oes/assessment/v1`）は読み取れます。`LEGACY_JUDGMENT_RECORDS_MISSING`（旧形式・判断記録不足）と表示し、従来の数値とhashを維持します。新要件の既定値を補って適合扱いにしません。v2へ改訂するときは元データをcomparisonに保持し、転記可能な根拠と追加確認が必要な項目を区別してください。

## 検証の境界

自動テストはCollector再利用、別プロセスでの確認・コピー・行読取・履歴復元・根拠検査、改変検出、送信投影、HTTP MCP、FRB fixture、移設した配布物の起動を確認します。Work/Codexへ実際にインストールした会話操作、クリーンOS、公開ドメインのリモート接続、審査通過は別の受入項目です。旧ローカル評価保存・HTML表示のコードは比較用に残しますが、新Skillの実行フローは使用しません。

0.4.1のWork／Codexそれぞれでの会話受入は[会話テスト手順](implementation/WORK-CODEX-ACCEPTANCE.md)に記録します。「対応対象」と「評価完了まで実機確認済み」は別です。0.4.1のリモート側の案内変更は、上記FRB修正とともに公開MCPへ反映済みです。紹介サイトの案内変更は未デプロイです。

FRB実取得の再確認は `node scripts/check-remote-frb.mjs https://open-estimate.ai-orchestration.jp/mcp`。リポジトリの合成数値モデルだけを送ります。既定URLはローカルWorkerです。HTTP失敗・リダイレクト拒否・タイムアウト・解析エラー等はlimitation_codesのFRB_*コードで区別します。為替取得に失敗しても、算出済みCFP・工数・USDを0に置き換えません。

## 0.6.0時点のスキル整合性と公開操作

数値モデルと、利用する配布スキルのID・版・整合性確認用ハッシュを送信します。対象ソースコード、名称、説明、ファイルパス、根拠本文、対象ソースのハッシュは送信しません。

解析前にget_skill_policyとCLIのskill-integrityで実計算値を照合します。AI向けコピーとserver側コピーを検査し、prepare・exportで開始時との変更を拒否します。exportは送信せず、modelとskill_integrityを別フィールドで返します。認証や実行証明ではありません。旧モデルの生成履歴を証明せず、過去Assessmentへの遡及記入は行いません。

移行期間は初回公開日を起点に14日以上とし、申告なしだけLEGACY_UNCHECKEDを返します。不一致は移行中も拒否します。単独plugin:packはrelease/local-marketplaceへのローカル検証用で、正規公開は統合release経路です。[公開・復旧手順](implementation/SKILL-INTEGRITY-OPERATIONS.md)。過去の本番配信確認は、今回追加した照合の本番確認を意味しません。

## 0.8.0 品質記録・実行保存への更新

現行の追加契約は`oes/quality-records/v1`です。7項目の差分、契約の互換性、保存物、更新・再インストール・実使用版確認、受入結果、Web工程への引継ぎは[0.8.0実装・運用記録](implementation/PLUGIN-QUALITY-0.8.0.md)を参照してください。過去節のセッション内保存・手動コピーの説明は旧版の記録です。0.8.0のexportは毎回別UUIDの対象外runへ標準成果物を自動保存し、purge後も利用できます。サーバー保存は行いません。

show-run／record-remote／compare-runsの入力はstdin JSONです。詳細根拠を含むrunはローカルに保持し、数値モデルへ混ぜて送らないでください。中央ルール本文の変更は本リポジトリで準備したもので、この作業による本番反映・証明書発行は行っていません。


## 0.8.1 境界未確認と比較の修正

0.8.0レビューの2件を修正しました。rerun／continuationのunknownには対応する暫定・未解決の境界判断を必須とし、完全測定にしません。比較はソース内容・読取取得状況・測定範囲・根拠・実行履歴を分離し、比較記録をoes/run-comparison/v2に更新しました。[修正内容・受入・移行作業](implementation/PLUGIN-QUALITY-0.8.1.md)を参照してください。

0.8.1もローカル受入用です。新スキルの本番登録が未実施のため、数値モデルv1を使う通常経路を含め、本番で一連の評価ができる状態とは扱いません。新スキル登録・v2受信側反映・実ホスト確認は移行作業として残します。
