# 計算証明書 認証・本人承認の採用方針

> 2026-10-20追記：以下は方式選定時の記録。以後、Auth0カスタムドメインreadyとWebアプリ作成を確認し、本人確認だけのPKCE/browser session/logoutをローカル実装した。最新の接続状況・未配備項目は[Auth0接続記録](SIGNED-CALCULATION-CERTIFICATE-AUTH0-CONNECTION.md)を参照。migration 0001/0002は本番適用済み、今回の0003は本番未適用。

決定日：2026-10-20 JST  
根拠：利用者の「未選定。適切なものがあれば推奨に従って対応する」との指示に基づく選定。  
状態：**方式選定・ローカルadapter実装まで。本番テナント、Google OAuth、メール送信、実ユーザーの承認は未接続。公開無効を維持。**

## 採用する方式

G1は **Auth0 Universal Login + Google + メールOTP** を採用する。ログイン開始・callbackはOIDC Authorization Code Flow with PKCEで構成する。アプリはパスワードやGoogleの認証情報を保持しない。

G2は **Open EstimateのWeb画面で1回、固定結果への発行と一般公開の両方を承認する** 方式へ進める。検証可能な会話ホストの本人承認イベントは現時点で未確認のため、自然言語や通常のAPI tokenを公開承認へ変換しない。同じ公開操作について会話とWebの二重承認を要求しない。ローカル入力の送信許可は、送信前に別の目的として確認する。

G1/G2は「方式選定済み・接続/実受入待ち」。本番受入済みではない。G3～G6も未解決であり、この決定をデプロイ許可・課金契約・本番公開と扱わない。

## 選定理由と比較

| 候補 | 公式に確認できた性質 | 今回の判断 |
|---|---|---|
| Auth0 | メールOTPとUniversal Loginを提供。異なるidentityを標準で別ユーザーとして扱う | 仕様の「メール一致だけで自動統合しない」に合わせ、account linkingを追加せず採用 |
| Supabase Auth | Google/メールOTPを提供。同じメールのidentityを自動linkする | D1を使う本構成で追加基盤とidentity統合方針を増やすため今回は選ばない |
| Clerk | Google/メールコードを提供。メールを共通識別子としてOAuth accountのlinkを試みる | 本仕様のidentity境界に合わせる追加検証が必要なため選ばない |

初版ではGoogleとメールで別アカウントになる場合があることを案内する。統合が必要になった場合は、両方の再認証と明示的な関連付けを別工程で設計する。Auth0のaccount linkingにもプラン条件があるため、初版の必須機能にしない。

## 費用と設定

2026-10-20の公式価格表ではFreeに月25,000 active users、Passwordless、Social Connectionsが記載されている。カスタムドメインにはカード確認の注記がある。無料運用を保証せず、実契約時に機能差・料金を再確認する。

Auth0内蔵SMTPは公式にテスト用途とされており、本番メールOTPには外部メールproviderと送信元ドメインの設定が必要。送信料が別途生じ得る。本作業ではprovider契約・DNS・送信元・予算上限を設定していない。Google OAuthも本番用アプリ・同意画面・redirect URIの登録が必要。

隔離したテストtenant、web/native application、API audienceを先に作り、Google/メールOTPを試験する。本番のtenant/DB/署名鍵/originと分ける。資格情報をチャットへ貼らずsecret管理へ渡す。

## 今回実装した境界

`src/web/oidc-auth.ts`は、設定済みissuerの固定JWKSと`jose 6.2.12`でRS256署名、issuer、API audience、exp/iat/nbf、許可client ID、scopeを検証する。jku/x5u/同梱JWK、未知鍵、client credentials、ID token用audience、通常cookieだけの認証を受け付けない。

owner内部IDはissuer/subのJCS hashから作る。同じemailでも異なるsubは別ownerで、email変更でownerは変わらない。認証成功をMFAや公開承認済みとは表示しない。運営scopeを一般管理scopeに混ぜない。ローカル鍵を注入したadapterはmode=testとなる。

`src/web/web-publication-approval.ts`はbrowser session adapterの所有者について、DBのpreviewを再読込し、期限・未消費・draft hashを確認して表示する。フォームは発行と一般公開のチェックを分け、一度の送信で両方を承認する。POSTでは同一Origin、browser session、preview/hashに結び付くCSRF、両チェック、現在のhashを検査する。Bearer Authorization付きPOSTや任意receipt生成用JSON APIを承認経路にしない。

承認IDは32 byte乱数。`web_approval_grants`にはそのhash、owner、operation、binding hash、期限、固定承認経路だけを保存する。生receipt、モデル、nonce、metadata全体を保存しない。有効期間は最大5分かつpreview/session期限以内。

`src/web/stored-approval.ts`は保存grantの検証だけを行い、receiptを発行しない。grant hashをone_time_idとして発行serviceの原子的消費・一意制約へ渡す。承認記録作成だけでは証明書発行・公開をしない。新migrationは`0002_web_approval_grants.sql`で、実D1には未適用。

## 残る接続と受入

1. Auth0 tenant、Google client、メールprovider、API audience/scope、web/native client IDの設定。
2. PKCE/state/nonceのログイン開始・callback、server-side browser session、cookie属性、logout、失効、CSRF adapterの実装。現在の`BrowserApprovalSessions`はinterfaceと合成テストだけで、実ブラウザ認証ではない。
3. Web controllerのrouting、CLIの所有者関連付け・receipt受渡し。receiptをURLに載せず、モデルへ任意発行権限を渡さない。
4. 送信許可と公開停止のgrant発行経路。現在は公開承認フォームと3操作のgrant verifierまで。
5. 実Auth0/JWKSローテーション、別identity、再ログイン/回復、承認期限・同時実行・再利用・停止を隔離環境と実ホストで受入する。
6. 保存期間、grant削除schedule、rate limit、認証/メール費用の通知・停止を配備する。

default Workerへの実adapter接続は行っていない。`ISSUANCE_ENABLED=false`、`PUBLICATION_READ_ENABLED=false`を維持する。

## 公式情報

- [Auth0 account linking](https://auth0.com/docs/manage-users/user-accounts/user-account-linking)
- [メールOTPと本番メールprovider](https://auth0.com/docs/authenticate/passwordless/authentication-methods/email-otp)
- [Universal Login](https://auth0.com/docs/authenticate/passwordless/passwordless-with-universal-login)
- [PKCE](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce)
- [Access token検証](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens)
- [Auth0価格表](https://auth0.com/pricing)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Clerk account linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking)
- [jose](https://github.com/panva/jose)

公式資料は選定根拠であり、本プロジェクトの接続完了・実動作の証拠ではない。
