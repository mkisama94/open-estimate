> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# MCP・プラグイン実装の計算・検証アルゴリズム

> **改訂基準（2026-10-11）**：[新システム仕様](SYSTEM-SPEC.md)に合わせて接続先・操作経路・データ契約を整理します。計数・換算・丸め・決定性の原則は維持します。公開プレビューの型・バージョン・ハッシュ対象は、改訂後の共通契約との一致を別途確認してください。

文書ID：OES-IMPL-ALGORITHMS-0.2.0-draft.1  
作成日：2026-10-05  
状態：実装指示。以下の変更は文書作成時点では未実装。  
入口：[新システム仕様](SYSTEM-SPEC.md)／[受入試験](ACCEPTANCE.md)

## 1. 適用範囲と版

[PH1-SPEC](../milestones/PH1-SPEC.md) 2.2〜2.12、5章を具体化する。対象は実装済みソースから復元する単一アプリケーションの機能規模であり、RFP充足度ではない。COSMIC規格自体とOES独自の計数・換算規約を区別する。

`mapping_version=oes-cosmic-ph1-v1`、新しい入出力契約 `contract_version=0.2.0`、engine/schema/skillの版とhash、profile_set_idを保存する。意味・式・丸め・hash対象を変えるときは版を更新し、過去のBundleを上書きしない。

## 2. スナップショットと実読取範囲

### 2.1 取得

1. ホスト設定の `OES_WORKSPACE_ROOT` から相対パスを解決する。絶対パス、drive/UNC、NUL、`..`、root外、symlink/junction/reparse point経由の脱出を拒否する。
2. 検査後の読取でも実体を照合し、検査と読取の間の差替えを検出する。対象ソースのプログラム、install script、Git hookは実行しない。
3. 許可ファイルの元バイト列を対象repo外の専用cacheにコピーし、以後はコピーだけを読む。
4. 最大10,000ファイル、全体100 MiB、1ファイル2 MiB。上限で取得できないファイルにも未読・除外理由を記録する。列挙上限超過を「一覧取得済み」と扱わない。
5. SHA-256は元バイト列から計算する。不正UTF-8は置換文字で解析せず、エラーまたは明示除外にする。改行を変換してからhashしない。
6. 空ファイルは0行。それ以外はLF数に、末尾がLFでなければ1を加える。CRLFのCRは原本hashに残す。行番号は1始まり、両端を含む。

秘密情報、`.env`実値、鍵、実データdump、依存package本体、ビルド生成物等の除外はPH1 2.2を継承する。生成された業務コードは名前だけで除外しない。除外ファイルの内容はAIへ返さない。

### 2.2 カバレッジ

`read_repository_file` が実際に返した行区間をfileごとに保存し、開始行順に並べ、重なり・隣接を結合する。

```text
coverage(file) = 結合した実読取区間の行数 / line_count(file)
fully_read(file) = 全行が実読取区間に含まれる
```

空ファイルは読取操作で空と確認したときに完了にする。割合は診断値でありCFP・工数の乗数にしない。1回最大400行・64 KiB。長過ぎる1行は短縮せず `LINE_TOO_LARGE`。`next_start_line` が返ったときだけページ送りする。

AIのinputをcollectorの確定情報に照合する。path/hash/bytes/line_count/snapshot identityの相違はエラー。dispositionとanalysis_completeは実読取台帳で補正できるが、補正pointerと理由を返す。未読を既読へ昇格させない。

取得直後の `snapshot_manifest_hash` と解析後のdispositionを含む `Assessment.input.manifest_hash` は区別する。後者を作る際にも各fileの実体識別情報を変更しない。

### 2.3 Manifest hash

```text
manifest_hash = SHA256(UTF8(JCS({
  domain: "oes/source-manifest/v1",
  files: [{path, sha256, bytes, disposition, exclusion_reason}, ...]
})))
```

pathは相対・`/`区切り、filesはUnicode code point順。case衝突・Unicode正規化後に同一になる別pathは拒否する。JavaScriptの通常の文字列比較はUTF-16 code unit順なので、補助平面文字を含むcode point comparatorを試験する。JCSのobject key規則はRFC 8785のままにし、配列整列と混同しない。

## 3. AIによる機能モデル作成

AIは入口、利用者要求、データの意味を読み、functional user／object of interest／data group／store／process／movementを列挙する。AIは係数やCFP総数を決めない。

| 種別 | OESモデルで記録する移動 | 必須参照 |
|---|---|---|
| Entry | 機能利用者から境界内へのデータ | peer_id、data_group_id |
| Exit | 境界内から機能利用者へのデータ | peer_id、data_group_id |
| Read | 永続ストアから機能処理への読取 | store_id、data_group_id |
| Write | 機能処理から永続ストアへの書込 | store_id、data_group_id |

ループ回数、SQL回数、ファイル数、endpoint数、コード行数で増やさない。同じ意味の移動の繰返しを回数分数えない。異なる機能プロセス・関心対象かどうかは意味から判断する。判断可能な推論は `inferred=true`、判断不能ならprocessをunresolvedとする。confidenceによる小数CFP・割引は導入しない。

例：注文情報を受け、ストアへ保存し、受付結果を返すモデルで、重複のないEntry・Write・Exitが各1つ認定された場合は3 CFP。この例を全CRUDへ機械的に適用する規則にはしない。

## 4. 決定論的検証

1. raw JSONのUTF-8、構文、重複object key、不正surrogateを検査する。object化後だけでは重複keyを検出できない。
2. JSON Schema 2020-12を検証する。型変換、unknown field除去、default自動挿入は禁止。
3. 集合内IDの一意性、全参照、日時順、根拠の行範囲を検証する。
4. Manifestを再計算する。ローカルではsnapshot実体と実読取区間にも照合する。Issuerは申告の整合検査にとどまり、ソースを独立観測したとは表示しない。
5. accepted processはmeasured componentに属し、source/schema/configurationの実装根拠を持つ。READMEの将来計画・test単独を実装事実にしない。
6. triggerは同processのEntryでpeerがtrigger_userと一致。accepted processは2 movement以上、EntryとExitまたはWriteを含む。
7. E/Xは有効peerとstore=null、R/Wは有効storeとpeer=nullを要求する。
8. 同processで `(type,data_group_id,peer_id,store_id,semantic_variant_key)` が重複したら `DUPLICATE_MOVEMENT`。黙って削除しない。
9. 同process・type・object_of_interestの複数計上は、全該当movementに非defaultのdistinctness_basis、理由、根拠を要求する。
10. 配布SkillのID/hashを許可リストと照合する。成功は実行証明ではない。

上限はprocess 5,000、movement合計50,000、evidence 50,000、Assessment 8 MiB。超過は413相当。不正入力は計数しない。同じ検証段階のerrorsは `(pointer,code)` 順。エラーに秘密値を埋め込まない。

## 5. 計数・状態・特徴量

```text
A = acceptedなprocessの集合
N_t = A内のtype=tのmovement総数
CFP = N_Entry + N_Exit + N_Read + N_Write
```

各movementは1 CFP。weight、complexity_factor、希望額からの逆算は禁止。

| 条件 | measurement.status | cfp |
|---|---|---|
| acceptedあり、対象範囲に未解決・未読・除外なし、analysis_complete=true、blocking findingなし | COMPLETE | 正整数 |
| acceptedあり、上記の完全条件を満たさない | PARTIAL | 採用部分の正整数 |
| acceptedなし、scope_impact=trueの適用困難除外に構造化findingが対応 | UNSUPPORTED | null |
| acceptedなし、その他 | INCOMPLETE | null |

適用困難はcategory=applicability_limitと対象範囲の根拠で示す。契約0.2.0でfindingに `affected_component_ids`（重複なし、参照検証対象）を追加し、適用困難findingには対象componentを1件以上要求する。`reason.includes("applicability")` に依存しない。依存library/test等、scope_impact=falseの除外は単独でPARTIALにしない。未解析の業務機能はscope_impact=trueとして扱う。

acceptedなしはE/X/R/W=0、cfp=null。「測定結果0 CFP」ではない。total_processesは全候補、accepted_processesは採用候補。現行process statusはaccepted/unresolvedの2種類。

```text
unresolved_process_count = 全候補数 - accepted_processes
inferred_movement_count = inferred=trueのaccepted process内のmovement数
excluded_component_count = excluded AND scope_impact=trueのcomponent数
unread_file_count = disposition=unreadのfile数
data_group_count = accepted movementが参照する異なるdata_group数
measured_component_count = accepted processが属する異なるcomponent数
```

推論件数はprocess単位の推論フラグから導く。movementごとの確率と説明しない。粒度変更時はschema/feature版を更新する。表示側で別の集計式を持たない。

## 6. ベンチマークと分位点

### 6.1 採用データ

作業scopeは[表示時の為替換算と見積対象作業](DISPLAY-VALUATION.md)の `oes-design-implementation-test-v1` を次期正本とする。設計・実装・テストを含み、企画・運用を含めない。営業、要件交渉、組織管理、待ち時間、契約バッファ等の除外は継続する。旧 `oes-functional-build-v1` とモックの `oes-standard-dev-v1` は自動aliasにしない。

各案件iにCOSMIC測定 `s_i > 0` CFPと同scopeの実績 `h_i > 0` 人時を持つ。経過日、他FP方式、Story Point、AI試算値は混ぜない。出典、原票hash、観測期間、適用領域、利用条件、重複排除、人によるレビューを保存する。

```text
r_i = h_i / s_i
x = r_iを昇順に並べた配列（n件）
h = (n - 1) * p
j = floor(h)
Q(p) = x[j] + (h-j) * (x[min(j+1,n-1)] - x[j])
```

Hyndman–Fan type 7、p=0.25/0.5/0.75。各案件1観測。CFP加重平均へ置換しない。n=1では3値が同じ、n=0ではprofileを作れない。n=1を統計的に十分としない。格納率は小数12桁ROUND_HALF_UP。原観測・集計方式を保存し、格納した率を換算の正本にする。

`0 < p25 <= median <= p75`、`0 < min_cfp <= max_cfp`、sample_size・distinct study数・sourcesの整合を検査する。APPROVEDは登録済み内容hashとレビュー記録があるものだけ。TESTを本番current catalogへ昇格させない。

3分位は参照集団の比率のばらつきであり、対象案件の予測区間・信頼区間・短期/長期シナリオではない。AI未使用と確認できない実績をhuman-onlyと呼ばない。

### 6.2 規模範囲

CFPが `[min_cfp,max_cfp]` 外ならOUTSIDE_REFERENCE_RANGE。工数以降を算出しない。端値を含む。PARTIALも測定部分のscopeとprofileのscopeが一致する必要がある。対象外分を割合で補完・外挿しない。

## 7. 工数・参考労務額・為替・人日

q=p25/median/p75として、次の順番で計算する。

```text
H_q = CFP * R_q                       # 未丸め人時
U_q = H_q * W                         # 未丸めUSD
F = 公表値がcurrency_per_usdなら公表値
F = round_half_up(1 / 公表値, 12)      # usd_per_currencyの場合
L_q = U_q * F                         # 未丸め現地通貨
D_q = H_q / 8                         # OES表示規約による人日
```

WはPH1指定のBLS OEWS、US national/all industries、SOC 15-1252、H_MEDIAN。これは系列選択仕様であり、現実の時給値を本書では掲載しない。運営者が原票と列を確認し、値・出典URL・原票hash・reference_period・承認記録をimmutable profileにする。年収の独自割戻しや検索結果の額をAIへ入力させない。

FはプラグインとWebサーバーの共通Federal Reserve H.10 adapterがFRBから直接取得する。固定許可host/URL、redirectは同じ許可先のみ、timeout5秒、最大5 MiB、表示要求ごとに最新公表確認、同時refresh集約。公表済みの最新有効観測を使い、ND、0、負、未来日を拒否する。通貨別quote方向を固定して試験する。Lは表示のたびに計算し、H/Uは元評価の根拠を維持する。

FX snapshotは観測日、公表日、取得時刻、最新確認時刻、原値、quote方向、正規化値、source hashを保持し、DisplayQuoteに使用する。表示計算のUTC日と観測日の暦日差が14日以内なら利用可能、15日以上ならFX_STALE。refresh失敗時のcache利用にはFX_CACHE_AFTER_FAILUREと「最新確認に失敗／前回取得レート」を表示する。通常の最新表示に6時間未確認cacheを使わない。

localeの地域→通貨表はPH1 2.10を実装する。`ja`や文字列部分一致でJPYにしない。USD指定はF=1で外部FX不要。表示通貨とsnapshot.currencyの不一致は拒否する。

### 7.1 丸めと表現

| 値 | 最終小数桁 |
|---|---:|
| profile率／正規化FX逆数 | 12 |
| 人時 | 6 |
| 表示人日 | 1 |
| USD・JPY/KRW以外の対応通貨 | 2 |
| JPY・KRW | 0 |

decimal.js precision=50、ROUND_HALF_UP。下流式には未丸めH/Uを使う。人日も未丸めHから作り、表示人時÷8で二重丸めしない。Public projectorは保存ContextからHを再現してDを算出する。

JSONの率・金額は10進文字列。入力は `^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$` と意味制約を併用する。指数、負、NaN、Infinity、空文字は禁止。率・賃金・FXは厳密に正。結果も整数部18桁上限を検査し、超過はNUMERIC_OVERFLOW。不要な末尾0を除き、負のゼロは0へ正規化。桁区切りはHTML表示だけで行う。

### 7.2 未算出の連鎖

契約0.2.0ではUSD/現地通貨statusにUPSTREAM_UNAVAILABLEを追加する。原因が上流にあるのに賃金不足・FX不足と誤表示しない。

| 条件 | effort | reference_usd | localized_reference |
|---|---|---|---|
| cfp=null | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED |
| benchmarkなし | BENCHMARK_UNAVAILABLE | UPSTREAM_UNAVAILABLE | UPSTREAM_UNAVAILABLE |
| 規模範囲外 | OUTSIDE_REFERENCE_RANGE | UPSTREAM_UNAVAILABLE | UPSTREAM_UNAVAILABLE |
| 工数あり、wageなし | AVAILABLE | WAGE_UNAVAILABLE | UPSTREAM_UNAVAILABLE |
| USDあり、現地FXなし | AVAILABLE | AVAILABLE | FX_UNAVAILABLE |
| USDあり、現地FXが古い | AVAILABLE | AVAILABLE | FX_STALE |
| USDあり、表示USD | AVAILABLE | AVAILABLE | AVAILABLE、rate=1 |
| 全条件成立 | AVAILABLE | AVAILABLE | AVAILABLE |

AVAILABLEなら3分位全て非nullで順序を満たす。非AVAILABLEならその段の結果は全体null。0や直前表示値で埋めない。下流が未算出でも上流のCFP/工数/USDを保持する。UIはこの表とlimitation_codesから未算出理由を表示する。

## 8. 正規化と再現可能なReport

### 8.1 Assessment

ID集合・参照集合はcode point順、集合の重複は正規化前に拒否する。path_prefixes、data_group.attributes等はPH1 5.4に従う。本文、説明、Unicode、改行、空白を勝手に直さない。

```text
assessment_hash = SHA256(UTF8(JCS(normalized_assessment)))
```

同じ意味でもAIがID・文章を変えればhashは変わる。再現性の保証は同じ正規化入力と計算根拠の範囲である。

### 8.2 固定ReportとDisplayQuote（2026-10-14改訂）

現行コードの `generated_at = new Date()` をReport内に入れる方式を改める。旧Report v2設計からもFXを分離するため、次期domainをv3とする。以下は実装前の契約であり、機械可読Schemaは未更新。

```text
calculation_basis = {
  domain, engine_version, mapping_version,
  effort_scope_id, profile_set_id,
  benchmark_snapshot, wage_snapshot, availability_decisions
}
calculation_basis_hash = SHA256(UTF8(JCS(calculation_basis)))
report = {
  domain: "open-estimate/report/ph1/v3",
  assessment_id, assessment_hash, calculation_basis_hash, profile_set_id,
  measurement, assurance, effort, reference_usd,
  features, limitation_codes
}
report_hash = SHA256(UTF8(JCS(report)))
evaluation_envelope = {evaluation_id, evaluated_at, report, report_hash, calculation_basis}
display_quote = {
  source_report_hash: report_hash, conversion_policy_version,
  locale, display_currency, displayed_at, fx_snapshot,
  localized_reference, limitation_codes
}
```

availability_decisionsは固定評価のbenchmark/wageの利用可否を保持する。FXの利用可否、期限超過、cache失敗利用、表示時刻はDisplayQuoteへ分離する。FXだけが変わってもReport hashは一致する。同じ表示要求内の各表示箇所は同一DisplayQuoteを使う。

上記DisplayQuoteは非公開評価用の概念形。公開表示のquoteはprivate report hashを持たず、share_idと固定公開payloadのhashを参照する。公開可能な計算根拠だけをprojectorから渡す。

Issuerは現行の承認profileからbasisを作り、同じcoreで固定Reportを生成する。固定評価のprofile/利用可否が変わりhashが不一致ならESTIMATE_CHANGED等の既定経路へ戻す。FXだけの変更では発行同意を無効化しない。clientが係数やbasisを送っても信頼して採用しない。後日の原本検証は保存basisを使い、現在の表示換算は別DisplayQuoteとして計算する。

## 9. 署名と公開要約

原本CertificateはPH1 3.3〜3.5を継承する。

```text
document_commitment = SHA256(UTF8(JCS({
  domain: "open-estimate/document/ph1/v1", nonce, document
})))
signature = base64url(Ed25519.sign(UTF8(JCS(public_manifest))))
```

nonceは暗号学的乱数32 bytes、署名64 bytes、base64urlはpaddingなし、SHA-256は小文字hex64桁。署名は署名対象objectの外。次期DocumentにはAssessment、固定Report、basis、評価日時、契約版を保存する。公開ManifestのallowlistはPH1どおり。CFP、額、repo、model、private report hash、nonceを追加しない。

PublicDraftは原本からサーバーが作る公開許可項目と利用者編集metadataで構成し、share_id/published_at/署名はまだ持たない。

```text
preview_hash = SHA256(UTF8(JCS({
  domain: "open-estimate/share-preview/v1",
  certificate_id, projection_version, public_draft
})))
payload = finalize(public_draft, server_share_id, server_published_at)
signed_object = {domain: "open-estimate/public-share/v1", key_id, payload}
public_signature = base64url(Ed25519.sign(UTF8(JCS(signed_object))))
envelope = {signed_object, signature: public_signature}
```

公開確定は保存済みPublicDraftとpreview_hashを照合し、metadata/固定評価の数値/換算方針の差替えを許さない。share_idはsh_＋16 random bytesのhex。固定公開記録は不変。修正は新preview・新share_id。表示時FXと換算額は明示したDisplayQuoteとして分離し、原本の署名済み金額と説明しない。公開契約・domainも新版へ更新する。上記v1擬似コードは既存方式の参考であり、同じ版の意味を変更しない。

公開要約の署名はIssuerの発行を示す。公開Manifestのcommitmentだけから、第三者が非公開Reportと公開要約の数値一致を独立再計算できるわけではない。Issuerは原本投影を検証し、Bundleを持つ検証者が完全照合できるようにする。

## 10. Golden計算値

全てTEST用の架空入力。実績ベンチマーク・実際のBLS/FXではない。

| 入力 | p25 | median | p75 |
|---|---:|---:|---:|
| 6 CFP、率2/3/5、人時 | 12 | 18 | 30 |
| 上記の人日（8時間） | 1.5 | 2.3 | 3.8 |
| 上記×50 USD/h、USD | 600 | 900 | 1500 |
| 上記×150 JPY/USD、JPY | 90000 | 135000 | 225000 |
| 120 CFP、同率、人時 | 240 | 360 | 600 |
| 上記の人日 | 30 | 45 | 75 |
| 上記のJPY | 1800000 | 2700000 | 4500000 |
| 48 CFP、同率、人時 | 96 | 144 | 240 |
| 上記の人日 | 12 | 18 | 30 |
| 上記のJPY | 720000 | 1080000 | 1800000 |

補間：率 `[1,2,4,8]` のtype 7結果は `[1.75,3,5]`。逆数：公表0.8 USD/通貨ならF=1.25。

丸め：2 CFP×0.00000025 h/CFP＝未丸め0.0000005 h、表示0.000001 h。賃金10000ならUSDは0.005→0.01、FX150ならJPYは0.75→1。表示USD 0.01×150＝1.5→2を使う実装は不合格。

120 CFPの画面定数をGolden扱いせず、movementの和が120になる独立fixtureを作る。既存6 CFP fixtureを基礎に、表示・署名・HTTP・プラグインが同じ正本値を扱うことを試験する。
