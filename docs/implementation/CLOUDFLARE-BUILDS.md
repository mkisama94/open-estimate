> **仕様整理（2026-10-28）**：構成・責務・利用フローは[新システム仕様](SYSTEM-SPEC.md)を基準とします。本書は従来の実装・検証・個別技術の参考資料です。Web保存必須、表示時の再計算、認証との結合等の旧前提は新規設計へ適用しません。本書の合格記録は新仕様の受入完了を意味しません。

# Cloudflare Workers Builds

Both Workers use this repository root and Node.js 24. Configure production branch main.

## Web owner preview deployment

Web deployment must use `npm run deploy`, not direct `npx wrangler deploy`. After `npm run build`, the deploy script builds a Web bundle once, hashes its bytes, and uploads that exact bundle with `no_bundle: true`. It sets `OWNER_PREVIEW_ENGINE_VERSION` to the package version plus the bundle hash prefix and `OWNER_PREVIEW_ENGINE_SHA256` to the full SHA-256. These values are generated, not manually copied from a local build to Cloudflare. The fixed generation in wrangler.jsonc is retained; the source configuration keeps preview disabled to fail closed on direct Wrangler deployment.

Prerequisites on **open-estimate**, not the MCP Worker: migrations 0004 and 0005 applied, existing Auth0/session secrets, and `PREVIEW_TRANSFER_CODE_SECRET` (32 random bytes encoded as base64url). The deploy script reads secret names and table names remotely and fails before upload when required entries are absent. The build API token therefore needs permission to list Worker secrets and read the bound D1 database as well as deploy the Worker. No secret values are printed and no migrations are applied automatically.

`npm run ci:web:check` performs bundle generation and a deployment dry run without checking remote prerequisites or publishing. Successful production deployment enables owner preview only; issuance and publication stay disabled. The post-deploy GET check verifies the preview controller responds with JSON NOT_FOUND for an unsupported method, rather than disabled/unavailable or the MCP plain-text 404. This does not replace logged-in browser acceptance of consent, preview, saving, extension and deletion. A failed post-deploy check does not roll back an uploaded version.

Do not change the generation or rotate the code secret during an active preview session. Cloudflare's standard config-name warning must not be fixed by renaming the Web configuration to the MCP Worker name. The Web script rejects the MCP CI override before any Wrangler deployment.

| Worker | Build command | Deploy command |
| --- | --- | --- |
| open-estimate | npm run build | npm run deploy |
| open-estimate-mcp | npm run ci:mcp:build | npm run ci:mcp:deploy |

Configure commands before pushing these changes: default Wrangler deployment targets the Web Worker.
These commands target production only; do not use the production deploy command for preview branches.

MCP CI validates Git-tracked skill and measurement registries, runs tests and a Wrangler dry run, then deploys only wrangler.mcp.jsonc. It verifies live policy, rule contents, numeric recalculation, rejection of invalid hashes/rules, and required tool names. Verification failure fails the deployment job; it does not automatically roll back a Worker already uploaded. Rerun ci:mcp:verify after investigating, or deploy a reviewed recovery commit.

Registries in profiles/ are durable release inputs, not transient CI outputs. The bootstrap records locally distributed 0.8.1 and fixes the legacy migration deadline at 2026-11-07T00:00:00Z. Builds never move that deadline. Future skill changes require a new version and reviewed registry entry; retain historical entries and revoked/withdrawn states. Update rules/source and the tracked rules registry together. CI rejects an unregistered version, hash mismatch or changed current rules.

The one-time register-ci-bootstrap.mjs script refuses a nonempty registry; never run it in CI. Package publication means the plugin was distributed, not that a server deployment succeeded.

Cloudflare artifacts do not update the user's local desktop-marketplace directory. Package and distribute future plugin versions separately after server compatibility verification. GitHub-connected MCP deployment does not enable Web owner preview, apply D1 migrations or enable issuance/publication. Those are separate Web release steps.
