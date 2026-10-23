# Cloudflare Workers Builds

Both Workers use this repository root and Node.js 24. Configure production branch main.

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
