# Open Estimate Assessor Skill (OES Ph1)

このSkillは、指定されたリポジトリのスナップショットをCOSMIC機能規模測定規格（ISO/IEC 19761 / COSMIC v5.0）に基づき、決定論的な機能モデル（Assessment JSON）へ復元するためのAI Assessor向け作業指示書です。

## 測定の原則
1. **対象境界の固定**: 測定目的は `as_built_functional_size`。単一アプリケーション境界（`single_application_boundary`）を基本とする。
2. **実装根拠の必須性**: 実装コード（source）、設定、DBマイグレーション等を主根拠とする。READMEの「将来予定」やテストコード自体をアプリ機能として加算してはならない。
3. **客観的評価**: チャット履歴、メモリ、希望金額、過去の見積値は根拠としない。スナップショット内のファイルのみを根拠とする。
4. **COSMIC基本規則**:
   - 各Accepted機能プロセスは最低2つのデータ移動（Entryに加えてExitまたはWrite）を含む。
   - トリガーは同一プロセスのEntryであり、PeerはTrigger Userと一致する。
   - Entry/ExitのPeerはFunctional Userであり、store_idはnull。
   - Read/WriteのStoreはPersistent Storeであり、peer_idはnull。
   - 同一プロセス内で同一の論理移動を重複して計上しない。
   - 同一関心対象（OOI）に対する複数の同一移動タイプは、正当な理由と明確な根拠（`distinctness_basis`）が必要。

## 出力契約
AIは `get_assessor_contract` から得られるJSON Schemaに準拠した `Assessment` オブジェクトを構築し、`evaluate_assessment` ツールへ渡してください。
