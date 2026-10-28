import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { atomicJson, readJson, inventory, contentHash } from './build-skill-registry.mjs';
import ts from 'typescript';

export const run = (repo, script, args = []) => execFileSync(process.execPath, [path.resolve(repo, script), ...args], {
  cwd: repo, stdio: 'inherit', windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
});
export function npmRun(repo, name, args = []) {
  if (!process.env.npm_execpath) throw new Error('RUN_THROUGH_NPM');
  run(repo, process.env.npm_execpath, ['run', name, ...(args.length ? ['--', ...args] : [])]);
}
export async function safeReleaseDirectory(repo, target) {
  const release = path.resolve(repo, 'release'), relative = path.relative(release, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('UNSAFE_RELEASE_PATH');
  let current = release;
  for (const part of ['', ...relative.split(path.sep)].filter((p,i) => p || !i)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('UNSAFE_RELEASE_PATH'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
export async function withReleaseLock(repo, operation) {
  await safeReleaseDirectory(repo, path.join(repo, 'release'));
  await fs.mkdir(path.join(repo, 'release'), { recursive: true });
  const file = path.join(repo, 'release/operation.lock'), lock = await fs.open(file, 'wx');
  try { return await operation(); } finally { await lock.close(); await fs.unlink(file); }
}
export function assertBaseline(actual, baselineHash, ownExpected = []) {
  const hash = contentHash(actual);
  if (hash !== baselineHash && !ownExpected.some(v => contentHash(v) === hash)) throw new Error('STALE_RELEASE_CANDIDATE');
}
export async function assertNoOtherPending(repo, dir) {
  try {
    const pending = await readJson(path.join(repo, 'release/PENDING.json'));
    const expected = path.relative(repo, dir).split(path.sep).join('/');
    if (pending.candidate !== expected) throw new Error('PENDING_RELEASE_REQUIRES_RESUME');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
export async function requireCandidateValidation(dir) {
  let proof;
  try { proof = await readJson(path.join(dir, 'validation.json')); }
  catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) throw new Error('CANDIDATE_NOT_VALIDATED'); throw e; }
  const candidate_sha256 = contentHash(await readJson(path.join(dir, 'candidate.json')));
  if (proof?.format !== 'oes/candidate-validation/v1' || proof.status !== 'PASSED' || proof.candidate_sha256 !== candidate_sha256) throw new Error('CANDIDATE_NOT_VALIDATED');
}
export async function ensureCandidateValidation(dir, verify, smoke) {
  await verify();
  try { await requireCandidateValidation(dir); return; }
  catch (e) { if (e.message !== 'CANDIDATE_NOT_VALIDATED') throw e; }
  const proofPath = path.join(dir, 'validation.json');
  await fs.rm(proofPath, { force: true });
  const candidate_sha256 = contentHash(await readJson(path.join(dir, 'candidate.json')));
  await smoke();
  await verify();
  if (candidate_sha256 !== contentHash(await readJson(path.join(dir, 'candidate.json')))) throw new Error('CANDIDATE_CHANGED');
  await atomicJson(proofPath, { format: 'oes/candidate-validation/v1', status: 'PASSED', candidate_sha256 });
}
export async function claimPending(repo, dir) {
  await safeReleaseDirectory(repo, dir); await assertNoOtherPending(repo, dir);
  await atomicJson(path.join(repo, 'release/PENDING.json'), { candidate: path.relative(repo, dir).split(path.sep).join('/'), status: 'PUBLICATION_UNCONFIRMED',
    notice: 'サーバー切替済みの可能性があります。同じ候補で公開確認を再開してください。' });
}
export async function clearPending(repo, dir) {
  await assertNoOtherPending(repo, dir);
  await fs.rm(path.join(repo, 'release/PENDING.json'), { force: true });
}
export async function buildFrozenWorker(repo, dir, skills, rules) {
  const source = path.join(dir, 'source');
  await fs.mkdir(source, { recursive: true });
  await fs.cp(path.join(repo, 'src'), path.join(source, 'src'), { recursive: true });
  await fs.cp(path.join(repo, 'profiles'), path.join(source, 'profiles'), { recursive: true });
  await fs.copyFile(path.join(repo, 'package.json'), path.join(source, 'package.json'));
  await atomicJson(path.join(source, 'profiles/skill-releases.json'), skills);
  await atomicJson(path.join(source, 'profiles/measurement-rules.json'), rules);
  const parsed=ts.parseConfigFileTextToJson('wrangler.mcp.jsonc',await fs.readFile(path.join(repo,'wrangler.mcp.jsonc'),'utf8'));
  if(parsed.error||parsed.config.name!=='open-estimate-mcp')throw new Error('INVALID_ISSUER_RELEASE_CONFIG');
  const config = { ...parsed.config, main: './source/src/remote/worker.ts',
    d1_databases:(parsed.config.d1_databases??[]).map(db=>({...db,migrations_dir:path.resolve(repo,db.migrations_dir)})) };
  await atomicJson(path.join(dir, 'build.json'), config);
  run(repo, 'node_modules/wrangler/bin/wrangler.js', ['deploy', '--config', path.join(dir, 'build.json'), '--dry-run', '--outdir', path.join(dir, 'artifacts')]);
  await atomicJson(path.join(dir, 'artifacts/wrangler.json'), { ...config, main: './worker.js', no_bundle: true });
}
export async function runFrozenWorker(repo, dir, args) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'oes-frozen-worker-'));
  try {
    const source = path.join(dir, 'artifacts');
    await fs.cp(source, temp, { recursive: true });
    if (contentHash(await inventory(source)) !== contentHash(await inventory(temp))) throw new Error('CANDIDATE_COPY_CHANGED');
    run(repo, 'node_modules/wrangler/bin/wrangler.js', ['deploy', '--config', path.join(temp, 'wrangler.json'), '--no-bundle', ...args]);
  } finally { await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
export function deploymentVars(skills, rules) {
  if (!skills.enforcement_at || !rules.rules_enforcement_at) throw new Error('MIGRATION_DATE_REQUIRED');
  return ['--var', `OES_ENFORCEMENT_AT:${skills.enforcement_at}`, '--var', `OES_RULES_ENFORCEMENT_AT:${rules.rules_enforcement_at}`];
}
export const syntheticModel = () => ({ version: 'oes/remote-model/v1', analysis_complete: true, partial: false, applicability_limit: false,
  users: 1, stores: 0, groups: [0], processes: [{ status: 'accepted', trigger_user: 0, trigger_group: 0,
    movements: [{ type: 'Entry', group: 0, peer: 0, store: null, distinct: false, variant: null }, { type: 'Exit', group: 0, peer: 0, store: null, distinct: false, variant: null }] }] });
export async function remoteCall(name, args) {
  const response = await fetch('https://open-estimate.ai-orchestration.jp/mcp', { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  if (!response.ok) throw new Error('PRODUCTION_CHECK_FAILED');
  const body = await response.json();
  if (body.error || !body.result) throw new Error('PRODUCTION_CHECK_FAILED');
  return body.result;
}
export async function confirmDeployment(skills, rules, integrity, call = remoteCall) {
  const { resolveMeasurementRules } = await import('../dist/remote/measurement-rules.js');
  const request = { skill_integrity: integrity, client_protocol: 'oes/measurement-client/v1' };
  const expected = resolveMeasurementRules(request, rules, skills);
  const policy = await call('get_skill_policy', {});
  if (policy.isError || policy.structuredContent?.registry_sha256 !== contentHash(skills)) throw new Error('PRODUCTION_POLICY_MISMATCH');
  const got = await call('get_measurement_rules', request);
  if (got.isError || contentHash(got.structuredContent) !== contentHash(expected)) throw new Error('PRODUCTION_RULES_MISMATCH');
  const bad = await call('get_measurement_rules', { ...request, skill_integrity: { ...integrity, package_sha256: (integrity.package_sha256[0] === '0' ? '1' : '0') + integrity.package_sha256.slice(1) } });
  if (bad.isError !== true || bad.structuredContent?.error?.code !== 'SKILL_INTEGRITY_MISMATCH') throw new Error('PRODUCTION_REJECTION_FAILED');
  let unknown='0'.repeat(64);while(rules.revisions.some(r=>r.revision===unknown))unknown='f'+unknown.slice(0,-1);
  const rejected=await call('get_measurement_rules',{...request,ruleset_ref:{ruleset_id:'oes-measurement',revision:unknown}});
  if(rejected.isError!==true||rejected.structuredContent?.error?.code!=='RULESET_UNKNOWN')throw new Error('PRODUCTION_REJECTION_FAILED');
  // Rule acceptance does not issue a proof, save a document or depend on Web.
}
