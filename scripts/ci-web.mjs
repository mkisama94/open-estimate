import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { run } from './release-common.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(repo, '.cache/web-release');
export function checkTarget(env = process.env) {
  if (env.WRANGLER_CI_OVERRIDE_NAME && env.WRANGLER_CI_OVERRIDE_NAME !== 'open-estimate') throw new Error('WRONG_WORKER');
}
export function checkPrerequisites(secrets, tables) {
  for (const name of ['AUTH0_WEB_CLIENT_SECRET', 'BROWSER_SESSION_SECRET', 'PREVIEW_TRANSFER_CODE_SECRET']) {
    if (!secrets.some(s => s.name === name)) throw new Error('MISSING_SECRET:' + name);
  }
  for (const name of ['preview_transfers', 'preview_transfer_consents', 'saved_estimates', 'operation_guards', 'certificate_previews']) {
    if (!tables.some(t => t.name === name)) throw new Error('MISSING_TABLE:' + name);
  }
  if (!tables.find(t => t.name === 'preview_transfer_consents')?.sql?.includes('prepare_estimate_preview')) throw new Error('MISSING_MIGRATION:0006_estimate_preview_consents.sql');
}
export function checkPublicationPrerequisites(vars,tables){
  if(vars.ESTIMATE_PUBLICATION_ENABLED!=='true')throw new Error('ESTIMATE_PUBLICATION_DISABLED');
  for(const name of ['AUTH0_ISSUER','AUTH0_API_AUDIENCE','AUTH0_MCP_CLIENT_IDS'])if(!vars[name])throw new Error('MISSING_PUBLICATION_CONFIGURATION:'+name);
  for(const name of ['saved_estimates','estimate_publications','operation_guards','browser_sessions','browser_login_transactions'])if(!tables.some(t=>t.name===name))throw new Error('MISSING_TABLE:'+name);
}
function prerequisites(vars) {
  const query = args => JSON.parse(execFileSync(process.execPath, [path.join(repo, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
    cwd: repo, encoding: 'utf8', windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  }));
  const secrets = query(['secret', 'list', '--config', 'wrangler.jsonc']);
  const result = query(['d1', 'execute', 'open-estimate-certificates', '--remote', '--config', 'wrangler.jsonc', '--command', "SELECT name,sql FROM sqlite_master WHERE type='table'", '--json']);
  if (!Array.isArray(result) || result.some(r => r.success === false)) throw new Error('DB_CHECK_FAILED');
  checkPrerequisites(secrets, result.flatMap(r => r.results ?? []));
  checkPublicationPrerequisites(vars,result.flatMap(r=>r.results??[]));
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function deploymentConfig(config, root, bundle, hash, version) {
  if (config.name !== 'open-estimate' || !/^sg_[a-f0-9]{32}$/.test(config.vars?.OWNER_PREVIEW_GENERATION)) throw new Error('INVALID_WEB_RELEASE_CONFIG');
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('INVALID_ENGINE_HASH');
  return { ...config, main: bundle, no_bundle: true,
    assets: { ...config.assets, directory: path.resolve(root, config.assets.directory) },
    d1_databases: config.d1_databases.map(db => ({ ...db, migrations_dir: path.resolve(root, db.migrations_dir) })),
    vars: { ...config.vars, OWNER_PREVIEW_ENABLED: 'true', OWNER_PREVIEW_ENGINE_VERSION: version, OWNER_PREVIEW_ENGINE_SHA256: hash,
      ISSUANCE_ENABLED: 'false', PUBLICATION_READ_ENABLED: 'false' } };
}
export async function verifyBundle(config) {
  if (sha256(await fs.readFile(config.main)) !== config.vars.OWNER_PREVIEW_ENGINE_SHA256) throw new Error('WEB_BUNDLE_CHANGED');
}
async function prepare() {
  checkTarget();
  // Legacy saved-result release checks do not require issuer registration.
  const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', await fs.readFile(path.join(repo, 'wrangler.jsonc'), 'utf8'));
  if (parsed.error) throw new Error('INVALID_WEB_CONFIG');
  await fs.mkdir(output, { recursive: true });
  // Remove only the expected generated entry so a failed build cannot reuse it.
  const bundle = path.join(output, 'worker.js');
  await fs.rm(bundle, { force: true });
  run(repo, 'node_modules/wrangler/bin/wrangler.js', ['deploy', '--config', 'wrangler.jsonc', '--dry-run', '--outdir', output]);
  const hash = sha256(await fs.readFile(bundle));
  const version = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8')).version + '+web.' + hash.slice(0, 12);
  const config = deploymentConfig(parsed.config, repo, bundle, hash, version);
  await fs.writeFile(path.join(output, 'wrangler.json'), JSON.stringify(config, null, 2));
  await verifyBundle(config);
  console.log(JSON.stringify({ status: 'PREPARED', engine_version: version, artifact_sha256: hash, generation: config.vars.OWNER_PREVIEW_GENERATION, deployed: false }));
}
async function main() {
  const mode = process.argv[2];
  if (!['prepare', 'deploy', 'check'].includes(mode)) throw new Error('INVALID_WEB_RELEASE_COMMAND');
  // Always prepare from this checkout; never deploy an old cache after edits.
  await prepare();
  if (mode === 'prepare') return;
  const configFile = path.join(output, 'wrangler.json');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  await verifyBundle(config);
  if (mode === 'deploy') prerequisites(config.vars);
  run(repo, 'node_modules/wrangler/bin/wrangler.js', ['deploy', '--config', configFile, ...(mode === 'check' ? ['--dry-run'] : [])]);
  if (mode === 'deploy') {
    // GET is deliberately unsupported here: this verifies controller readiness
    // without creating a transfer or uploading a user's estimate.
    const response = await fetch('https://open-estimate.ai-orchestration.jp/api/v1/preview-transfers', { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    if (response.status !== 404 || body.error?.code !== 'NOT_FOUND') throw new Error('PRODUCTION_PREVIEW_NOT_READY');
    // Invalid input must be rejected before persistence. GET alone does not exercise validation.
    const invalid = await fetch('https://open-estimate.ai-orchestration.jp/api/v1/preview-transfers',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':'00000000-0000-4000-8000-000000000000'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});
    if(invalid.status!==400 || (await invalid.json()).error?.code!=='INVALID_INPUT')throw new Error('PRODUCTION_PREVIEW_VALIDATION_FAILED');
    const capabilities = await fetch('https://open-estimate.ai-orchestration.jp/api/v1/estimate-capabilities', {redirect:'error',signal:AbortSignal.timeout(10000)}).then(r=>r.json());
    if(capabilities.schema_version!=='oes/estimate-experience/v2' || capabilities.web?.available!==true || capabilities.standard_completion!=='WEB_SAVED')throw new Error('PRODUCTION_ESTIMATE_NOT_READY');
  }
  console.log(JSON.stringify({ status: 'PASS', mode, engine_version: config.vars.OWNER_PREVIEW_ENGINE_VERSION }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
