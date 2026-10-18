# Open Estimate — Web／HTTP API／DB側 実装仕様

> **改訂基準（2026-10-11）**：[製品構成とデータの扱い](PRODUCT-ARCHITECTURE.md)を優先します。Webは公開表示に加えて所有者の継続管理を担います。本文の「Web UIは読取専用」、管理画面・セッション等の禁止、ローカル管理キーだけを前提とする認可は再設計の対象です。初回発行・公開の会話による確定は維持し、具体的な認証・復旧方式は未決定です。
> **認証方針の確定（2026-10-11）**：WebにGoogle認証・メール認証による登録とログインを設けます。ChatGPT認証は将来構想です。上記の認証方式未決定という記述はこの決定で更新し、本文のログインUI除外・登録なし前提は旧仕様として扱います。メール認証の具体方式と復旧・プラグイン連携は詳細設計で定めます。

仕様ID：**OES-ACCOUNTLESS-WEB-0.1.0**  
共通契約：[SHARED-SPEC.md](SHARED-SPEC.md)／Schema：[contracts/accountless.schema.json](contracts/accountless.schema.json)

## 0. この担当の実装範囲

実装する：登録なしの発行API、オブジェクト別認可、公開preview/publish/status/withdraw、DB、署名済み公開要約、SSR/OGP配信、削除・復旧・濫用対策。
実装しない：LLM推論、利用者のローカル管理キー保管、MCPの会話制御、ログインUI、作者の本人確認、SNS自動投稿。

**Web UIは読取専用。書込みAPIまで読取専用という意味ではない。**
既存の結果カード・人日/参考金額・公開要約署名・表示許可リストはDETAIL-PAGE-SPECを再利用する。
元の計数器／換算器／署名器は再利用し、Web側に別の見積係数や独自金額計算を追加しない。

**表示仕様更新（2026-10-14）**：[表示時の為替換算と見積対象作業](DISPLAY-VALUATION.md)に従い、WebサーバーがFRB公表データを直接取得し、表示要求ごとに現地通貨額を計算する。プラグインと同じadapter・計算式を用いる。固定公開記録とDisplayQuoteのAPI/cacheを分離し、ページ再表示・更新・通貨切替・印刷等へ反映する。対象作業は設計・実装・テスト、企画・運用を除外。現行コード・Schemaには未反映。

## 1. 既存認可からの変更

旧仕様の`owner_client_id == authenticated_client_id`という所有確認を廃止し、
**対象オブジェクトに結び付いたcapability digestとの一致**へ置き換える。

証明書発行に旧client tokenが必要なままでは、登録不要は成立しない。
`/api/v1/certificates`のaccountless経路も実装する。
ただし運営者専用の失効、鍵管理、データ承認、緊急停止の認証を公開しない。

既存clientsを全利用者で共有したり、単一の匿名client tokenをプラグインへ埋め込んだりしない。
「匿名の共通client_id」を作って認可問題を回避しない。
DB移行は[MIGRATION.md](MIGRATION.md)に従い、既存署名のバイト列を維持する。

## 2. モジュールと依存方向

| モジュール | 責任 | 他担当との境界 |
|---|---|---|
| AccountlessIssuerAdapter | 新oecの結び付け、再送、既存Issuer呼出し | Assessmentは従来の検証器へ |
| CapabilityVerifier | 形式・digest・種別・対象IDの照合 | 原secretを後続へ長期間保持しない |
| CertificateAuthorityStore | certificateとoec digestの対応 | PublicManifestへ出さない |
| PublicationService | preview/publishの状態遷移 | 公開候補はサーバー生成 |
| PublicationRepository | 原子的保存、期限、contentと権限の分離 | Webへcredentialテーブルを渡さない |
| WithdrawalService | 認可された削除・tombstone・journal | 元Certificateは失効させない |
| PublicReadService | HTML/JSON/OGの共通公開ゲート | ブラウザへprivate値を渡さない |
| AbuseLimiter | IP/全体/オブジェクトの制限 | 利用者IDの代用にしない |
| WithdrawalJournal | DB復旧に独立した最小撤回記録 | 公開ストレージに置かない |

既存Node/Fastify/SQLiteバックエンドがあればそこへ追加する。
既に別のHTTP runtimeが存在する場合は、同じ契約・原子性を満たす既存経路へ統合する。
ローカルstdio MCPの実行ファイルを、公開HTTPサーバーとして配信しない。
KVや静的HTMLだけで最新の公開状態を判断しない。状態の強整合性を持つauthoritative storeが必要。
本書はCloudflareやDB基盤の無断移行指示ではない。

## 3. HTTP入口

### 3.1 必須検査
1. HTTPS／信頼するproxy境界。
2. method allowlistとContent-Type。管理GETを除く書込みはapplication/json。
3. body/header上限、raw JSON重複キー、schema、追加キー拒否。
4. protocol header、secret形式・種別、必要なIdempotency-Key。
5. 経路別の濫用制限。
6. オブジェクト認可、再送、業務状態検査。

secretをURLやbodyの別フィールドから拾う互換fallbackを作らない。
プレビューに新publicationキーを渡す専用ヘッダー以外はAuthorizationだけを用いる。

### 3.2 公開作成と認証の違い
初回`POST /certificates`は未登録のoecで呼べる**匿名の作成操作**。
形式が正しい新キーを持つことだけで「信頼済みclient」としない。
その新キーは、生成された一件の証明書を管理するdigestとして結び付ける。
既存証明書の操作では、必ず既存bindingを確認する。

`POST /share-previews`では、certificate_idを知っているだけでは足りない。
対応oecを持たない要求はRESOURCE_NOT_ACCESSIBLE。
同時に渡る新oepを、予約した一つのshareへ登録する。

### 3.3 エラー・ログ・CORS
- エラー構造は既存ErrorResponse。秘密・app名・本文・ヘッダーを返さない。
- missing authは401、対象不存在／誤ったキーは同じ404。
- ログにbody、Authorization、X-OES-Publication-Key、private preview、Bundleを出さない。
- request_id、route名、汎用code、処理時間、件数を使う。個別secretやapp名をmetricsラベルにしない。
- ブラウザの書込みは提供しないため、書込みAPIにCORS許可を追加しない。
- ただしCORSは非ブラウザクライアントへの認可機構ではない。capability検査を省かない。
- Cookie/sessionを使わない。HTMLに管理キーを埋めない。
- 原本コード・リンクから誘導された任意URLをサーバーfetchしない。

## 4. 匿名証明書発行

既存Issuerが行うSchema/意味検査、current profile解決、CFP・工数・金額の再計算、
expected_report_hash照合、private暗号化、署名、Registry追記は維持する。

### 処理順
1. oecの形式からcertificate digestを算出する。
2. Issueの再送receiptを検索。同一要求なら保存済みBundleと同じIDを返す。
3. digestが別要求へ既に結び付いていれば409。
4. 新規作成の濫用制限、既存IssueRequest検査を実施。
5. 既存Issuer coreで再計算・hash照合。不一致は409、まだ権限bindingを確定しない。
6. トランザクション開始。digestとreceiptの一意性を再確認。
7. 証明書／private payload／公開発行履歴／oec binding／receipt／許可されたanalyticsを保存。
8. COMMIT後にIssueResponseを返す。secretは返さない。
9. 同時要求の一方が先に確定したら、もう一方は再送として同じIDを取得する。

Receiptの正規化bodyに管理secretを混ぜない。digestを認可namespaceとして利用する。
証明書IDだけで再送Bundleを取り出すAPIは設けない。
private payload期限切れ後は、正しいoecでも再取得に410を返す。

## 5. プレビュー処理

### 5.1 入力
既存metadataのキーと上限を維持する：
app_name 1〜80、description 0〜240、publisher_label nullまたは1〜60 Unicodeコードポイント。
app_urlはnullまたは2048文字以内のHTTPS URL。include_model_labelはboolean、既定false。
Schema検査のほか、空白だけの名前、制御文字、危険URL等を意味検査する。

### 5.2 サーバー生成
1. 元oecを照合し、元Certificate/鍵/保存Bundleの状態を確認。
2. 再送receiptがあれば共通仕様§6に従って返す。旧preview全文の固定レスポンスcacheは作らない。
3. 元Bundleの署名・commitment・計算整合を検証する。
4. 既存PublicProjectionで公開候補を生成する。
5. share_id、preview_id、expires_atを生成し、oep digestをbindingする。
6. 公開候補にshare_idを入れ、published_atはまだ入れない。
7. 共通式でpreview_hashを生成し、候補・表示条件を暗号化保存する。
8. preview rootとreceiptを同一トランザクションで保存する。
9. PreviewReadyを返す。公開readには見せない。

private previewは既存AES-GCMの保存方式を再利用する。暗号鍵ID・IV・tag・AADを記録する。
AADは`share_id + ":" + preview_hash`に固定する。
claimの真偽を審査したとは扱わず、文字列はescapeして表示する。
原本の自由文をそのまま注意文・OGPへ流さず、既存の安全なコード→文言変換を使う。

### 5.3 再プレビュー
紹介文を変更したら新share_idと新oepを発行する。
旧previewは15分で期限切れ。不要な候補から公開できないよう利用者には新しいpreviewだけを提示する。
旧previewを自動公開しない。期限切れcontentは遅くとも1時間以内のpurge対象とする。

## 6. 公開確定

### 6.1 処理
1. preview_idから対象を引き、対応oepをconstant-time照合。
2. 認可後にIdempotency-Keyとrequest HMACを照合。
3. WITHDRAWNは410。EXPIREDまたは期限切れは410。別キーで消費済みは409。
4. 共通仕様の同意4項目とpolicy_versionを検査。
5. 元Certificate、鍵、運営停止状態を再確認。
6. preview_hashと保存候補の固定評価・metadata・表示時換算方針を確認。新係数・新時給で元評価を変えない。表示時FXはDisplayQuoteで別計算し、FXだけの変化でpreview_hashを不一致にしない。
7. published_atを加えた公開payloadを作り、既存public-estimate domainで署名。
8. 生成時のDisplayQuoteを持つ同じViewModelからOG画像を生成し、観測日・換算日時を付ける。以後のWeb閲覧は別途表示時換算する。配布済み画像・外部SNS cacheが自動更新されるとは扱わない。
9. 最終トランザクションで、PREVIEW/期限/tombstone/元証明状態を再確認。
10. content＋署名＋OG＋同意版＋receiptを保存し、stateをPUBLISHEDへ更新。
11. 不要なprivate preview blobを削除し、監査イベントを追記。
12. COMMIT後にManagementStatusを返す。

OG生成・署名中に削除された場合は、最終状態チェックで公開を中止する。
write前に取得した状態だけを信用しない。
大きなOG生成を長時間のDBロック内で行わず、最終CASで正当性を確認する。
失敗した一時画像はcleanupする。公開storageへの仮アップロードは禁止。

### 6.2 原子的公開
参照DDLはOGをDB BLOBとして保存する方式を示す。
別ストレージを使う場合も、原子性の代わりとなる可視化ゲート・一時物cleanupを必須にする。
PUBLISHEDなのに署名や画像が存在しない状態を成功応答しない。

## 7. 削除の実装

### 7.1 認可は削除対象のキー
oep＋share_idだけで認可する。元oec、旧client token、ログイン、メールを追加要求しない。
元private payload消去済み、元証明書失効、元署名鍵失効でも削除できる。
削除済みの最小tombstoneにもdigestを保持し、再送に同じ完了時刻を返す。

### 7.2 原子的な配信停止
1. 対象とキーを照合する。不明/誤りは404。
2. BEGIN。tombstoneがあれば既存結果の耐久化を確認して再返却する。
3. PREVIEW/PUBLISHED/EXPIREDからWITHDRAWNへ変更する。
4. 公開content、OG BLOB、private preview、派生配信cacheを削除する。
5. 最小撤回tombstoneとWITHDRAWNイベント、ジャーナルoutboxを保存する。
6. COMMIT。以後の新しいreadは410。旧内容を返さない。
7. WithdrawalJournalへ最小tombstoneを耐久化し、outboxを完了にする。
8. 200 WithdrawResultを返す。

7に失敗したら503 `WITHDRAWAL_DURABILITY_PENDING`。
配信停止は済んでいても復旧耐久化を完了扱いしない。再送で7を再実行する。
WITHDRAWN→PUBLISHEDはDB制約でも禁止する。

### 7.3 ジャーナルとバックアップ
ジャーナルレコードはshare_id、publication digest、withdrawn_at、固定理由、記録版だけ。
app名、金額、CFP、旧preview、原本、secretは含めない。

初期Node単一writerでは、DBバックアップとは別の永続ディレクトリに、
share_id単位のimmutable JSONをatomic write＋fsyncして保存する構成を採用可能。
運用基盤が異なる場合は、同じ耐久性と復旧順序を満たす非公開storageへ置き換える。
ハッシュチェーンを追加しても、運営者や全バックアップの同時喪失まで防ぐと主張しない。

復旧時：公開配信停止→DB復元→最新journal適用→public content cleanup→整合試験→公開再開。
最新journalが取得できなければ、旧バックアップの内容を勝手に公開しない。
消去済みデータを含むバックアップの保持は初期30日以内を運用既定とし、データ取扱ページへ明示する。
共有tombstoneはより長く保持して、旧URLの再利用・復活を防ぐ。

### 7.4 全配信面
HTML本文、title、description、埋込JSON、JSON API、OG、print/download経路から旧値を返さない。
CDN／Service Worker／origin cacheに個別ページを残さない。
旧OGの直接storage URLを公開しない。
外部SNSのcacheや既に開始済みの送信までは回収できないと明示する。

public requestの終了表示は「この公開見積は削除されました。」とする。
旧app名、作者名、削除キー、元数値を終了ページに再表示しない。
元Certificateは失効させず、Registryへ共有ページの削除理由やshare_idを追加しない。

## 8. 公開Webへの変更

- 既存の`/e/:id`、`/og/e/:id.png`、公開JSONは維持。
- 一般閲覧者向けの管理／ログイン／削除／公開フォームを削除する。
- 作者は「公開者の申告」と表示する。本人確認済み、リポジトリ所有確認済みと表示しない。
- 利用方法に「登録不要。公開・削除は接続したAIから操作」を追記する。
- FAQに「削除権限は利用した端末に保存」「キー紛失時は自動復旧不可」「公開削除の範囲」を追記する。
- キーを入力する管理URLは作らない。削除案内リンクは一般的な使い方の説明へ遷移させる。
- `/verify/:certificate_id`は従来の発行履歴だけ。`/e`と混ぜない。
- 要約の人日・参考金額・CFP・partial・Community表示、未提供状態、参照profileは既存仕様どおり。
- 署名成功は本人性・見積妥当性の保証にしない。
- 個別shareをsitemap・公開一覧・Registryリンクから列挙しない。

## 9. キャッシュ・失効

すべてのshare系HTML/JSON/OG、preview、managementに`Cache-Control: no-store`。
reverse proxy／CDNにも同じパスのcache bypassを設定する。no-storeだけを万能の消去として説明しない。
公開readは各requestで公開stateと証明書／鍵状態を確認する。
状態不明時は503＋Retry-After。最終成功データを返さない。

静的なCSSや共通の終了画像は長期cacheできるが、個別値を含めない。
撤回済みshareにIf-None-Matchが来ても304で旧representationを再利用させない。
初版の個別shareへETag／Last-Modified条件付き再利用は実装しない。
バックエンドのstate参照とproxyのcache双方を受入試験で確認する。

## 10. 濫用対策

以下はENGINEERING_DEFAULT。公開状況を見て運営者が調整し、測定係数には影響させない。

| 経路 | 初期上限の案 |
|---|---|
| 新規証明書発行 | IPあたり10回/10分、100回/日 |
| 新規preview | IPあたり20回/10分、200回/日＋certificateあたり20回/日 |
| 新規publish | IPあたり10回/10分、100回/日 |
| 新規書込み全体 | サービス全体1,000件/日を初期上限とし、運営設定化 |
| PreviewRequest | 16KiB以内 |
| Publish/WithdrawRequest | 4KiB以内 |
| 無効キーの連続試行 | IPあたり30回/分を初期目安に制限 |
| 正しいキーのstatus/withdraw | 別枠の短時間制限。新規発行の日次枠と共有しない |

issue bodyの上限は既存Ph1の制限を維持する。
再送は重い新規作成と区別し、正しいキーの撤回を「今日100件作ったから」と拒否しない。
IPは作者本人を表さない。企業NAT・代理サービス・分散送信で限界がある。
clientが送るX-Forwarded-Forを無条件で信用しない。信頼するproxyからの情報だけを使う。
IP制限の識別値は短期HMAC等で保持し、公開レポートへ出さない。初期保持は7日以内。
上限を超えたら429、サービス容量停止は503。新規受付停止時も削除経路は可能な限り維持する。

APIキーを登録不要にしたからといって、匿名作成の攻撃面は消えない。
投稿停止スイッチ、保存量監視、通報導線、運営者の停止権限を用意する。
初版にCAPTCHA必須のブラウザ操作は導入しない。将来必要なら登録不要UXへの変更として明示検討する。

## 11. DB／Schema

参照DDL：[db/003_accountless.reference.sql](db/003_accountless.reference.sql)。
これは旧client NOT NULL制約を自動解決する本番migrationではない。

| テーブル | 内容 |
|---|---|
| anon_certificate_authorities | 元証明書とoec digest。原secretなし |
| anon_request_receipts | ISSUE/PREVIEW/PUBLISHのHMACと結果ID。raw bodyなし |
| anon_publications | share/preview/certificate IDs、oep digest、state、期限、時刻、同意版 |
| anon_preview_blobs | 公開前だけの暗号化preview |
| anon_publication_contents | 公開中の署名要約とOG画像 |
| anon_publication_events | 固定コードの私的イベント。一般公開しない |
| anon_withdrawal_tombstones | ID、digest、撤回時刻。contentなし |
| anon_withdrawal_outbox | 独立journalへの耐久化待ち |

公開readでSELECT *を使わず、公開専用DTOへ写像する。
匿名管理digestとイベントを、元の公開Registry・PublicManifestへ混ぜない。
証明書署名のbytesはそのまま。権限のbindingは別表で扱う。
旧analyticsのclient_id依存はnullableまたはlegacy fieldにし、新規データのユーザー識別に使わない。

## 12. 実装順序

| ID | 作業 | 完了条件 |
|---|---|---|
| W00 | 現行runtime/DB/認可棚卸し | migration計画と既存test結果を記録 |
| W01 | capability検査、Schema、共通error | 種別・対象・秘密非露出・不存在秘匿を検査 |
| W02 | 匿名Issue adapter | 初回発行・競合・応答断・再取得・private expiryを検査 |
| W03 | preview | 元記録照合、予約ID、暗号化、期限、再送 |
| W04 | publish | 署名/OG/原子的公開、同意、競合、fake値拒否 |
| W05 | public read/management | 全配信面が共通stateゲートで動く |
| W06 | withdraw/journal | 配信削除、再送、競合、復旧後の非復活 |
| W07 | Webの登録不要案内 | 管理UIなし、使い方・削除限界を明示 |
| W08 | 濫用対策・監視・移行 | 枠分離、容量停止、秘密ログ検査、backup復旧 |
| W09 | pluginとの結合と公開判定 | 受入条件、試験結果、未完条件を記録 |

署名や本番profileが未提供なら、TEST環境で構成を先行検証する。
productionに未署名・TEST係数・偽のVALIDを流す迂回経路を作らない。
実サービスへのデプロイは別の明示指示まで行わない。
