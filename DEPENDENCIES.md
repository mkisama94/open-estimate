# Open Estimate — 依存関係記録 (T00)

- 実行環境: Node.js v24.18.1 LTS
- パッケージマネージャー: npm 11.14.1
- OS: Windows / Linux

## 採用パッケージと確定バージョン

| パッケージ名 | バージョン | 役割 |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 | MCPプロトコル・サーバー・ツール実装 (stdio transport) |
| `ajv` | 8.20.0 | JSON Schema 2020-12 厳格バリデーション (Ajv 2020) |
| `ajv-formats` | 3.0.1 | date-time, uri, uuid 等のフォーマット検証 |
| `canonicalize` | 2.1.0 | RFC 8785 (JCS) 正規化 JSON 生成 |
| `decimal.js` | 10.6.0 | 浮動小数を排除した決定論的工数・金額計算 |
| `typescript` | 5.9.3 | 静的型検査 (ESM, strict) |
| `@types/node` | 22.20.3 | Node.js API 型定義 |
| `vitest` | 3.2.7 | 単体テスト・結合テスト実行フレームワーク |
