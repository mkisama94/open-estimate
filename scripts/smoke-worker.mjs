import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { contentHash } from './build-skill-registry.mjs';
const dir = path.resolve(process.argv[2]);
const registry = JSON.parse(await fs.readFile(path.join(dir, 'registry.json'), 'utf8'));
const rules = JSON.parse(await fs.readFile(path.join(dir, 'measurement-rules.json'), 'utf8'));
const { integrity } = JSON.parse(await fs.readFile(path.join(dir, 'candidate.json'), 'utf8'));
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const enforcement = registry.enforcement_at ?? new Date(Date.now() + 14 * 86400000).toISOString();
const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'oes-worker-smoke-'));
await fs.cp(path.join(dir, 'artifacts'), runtime, { recursive: true });
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--config', path.join(runtime, 'wrangler.json'), '--local', '--ip', '127.0.0.1', '--port', String(port), '--var', `OES_ENFORCEMENT_AT:${enforcement}`, '--var', `OES_RULES_ENFORCEMENT_AT:${rules.rules_enforcement_at ?? enforcement}`], {
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', BROWSER: 'none' }
});
let logs = '', stopped = false;
child.stdout.on('data', value => { logs = (logs + value).slice(-5000); });
child.stderr.on('data', value => { logs = (logs + value).slice(-5000); });
child.on('exit', () => { stopped = true; });
child.on('error', error => { logs += error.message; stopped = true; });
async function call(name, args) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  assert.equal(res.status, 200);
  const body = await res.json(); assert.ok(body.result); return body.result;
}
try {
  let policy;
  const deadline = Date.now() + 30000;
  while (!policy && Date.now() < deadline && !stopped) {
    try { policy = await call('get_skill_policy', {}); }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(policy, logs);
  assert.equal(policy.isError, undefined);
  assert.equal(policy.structuredContent.registry_sha256, contentHash({ ...registry, enforcement_at: enforcement }));
  // Exercise a request-time schema check, not only validators compiled at module scope.
  const card = await call('show_estimate_step', {stage:'scope'});
  assert.notEqual(card.isError, true, JSON.stringify(card));
  assert.equal(card.structuredContent.stage, 'scope');
  assert.ok(card._meta?.ui?.resourceUri);
  const fetched = await call('get_measurement_rules', { skill_integrity: integrity, client_protocol: 'oes/measurement-client/v1' });
  assert.notEqual(fetched.isError, true, JSON.stringify(fetched));
  assert.equal(fetched.structuredContent.ruleset_ref.revision, rules.current_revision);
  assert.equal(contentHash(fetched.structuredContent.bundle), rules.current_revision);
  assert.deepEqual(fetched.structuredContent.bundle, rules.revisions.find(r => r.revision === rules.current_revision).bundle);
  const model = { version: 'oes/remote-model/v1', analysis_complete: true, partial: false, applicability_limit: false, users: 1, stores: 0, groups: [0],
    processes: [{ status: 'accepted', trigger_user: 0, trigger_group: 0, movements: [
      { type: 'Entry', group: 0, peer: 0, store: null, distinct: false, variant: null },
      { type: 'Exit', group: 0, peer: 0, store: null, distinct: false, variant: null }] }] };
  const args = { model, display_currency: 'USD', skill_integrity: integrity, ruleset_ref: fetched.structuredContent.ruleset_ref };
  const legacy = await call('evaluate_model', { model, display_currency: 'USD' });
  const skillGrace = Date.now() < Date.parse(enforcement);
  const rulesGrace = Date.now() < Date.parse(rules.rules_enforcement_at ?? enforcement);
  if (skillGrace && rulesGrace) {
    assert.notEqual(legacy.isError, true, JSON.stringify(legacy));
    assert.equal(legacy.structuredContent.assurance.skill_integrity.status, 'LEGACY_UNCHECKED');
    assert.equal(legacy.structuredContent.assurance.measurement_rules.status, 'LEGACY_LOCAL_RULES');
    assert.equal(legacy.structuredContent.evaluation_context_hash, null);
  } else {
    assert.equal(legacy.isError, true);
    assert.equal(legacy.structuredContent.error.code, skillGrace ? 'RULESET_REQUIRED' : 'SKILL_INTEGRITY_REQUIRED');
  }
  const omittedRules = await call('evaluate_model', { model, display_currency: 'USD', skill_integrity: integrity });
  assert.equal(omittedRules.isError, true); assert.equal(omittedRules.structuredContent.error.code, 'RULESET_REQUIRED');
  const good = await call('evaluate_model', args);
  assert.notEqual(good.isError, true, JSON.stringify(good));
  assert.equal(good.structuredContent.assurance.skill_integrity.status, 'MATCHED_CLIENT_REPORTED');
  assert.equal(good.structuredContent.report.measurement.cfp, 2);
  assert.equal(good.structuredContent.assurance.measurement_rules.status, 'ACCEPTED_CLIENT_REPORTED');
  const bad = await call('evaluate_model', { ...args, skill_integrity: { ...integrity, package_sha256: (integrity.package_sha256[0] === '0' ? '1' : '0') + integrity.package_sha256.slice(1) } });
  assert.equal(bad.isError, true); assert.equal(bad.structuredContent.error.code, 'SKILL_INTEGRITY_MISMATCH');
  assert.equal(bad.structuredContent.report, undefined);
  const unknown = await call('evaluate_model', { ...args, ruleset_ref: { ruleset_id: 'oes-measurement', revision: '0'.repeat(64) } });
  assert.equal(unknown.isError, true); assert.equal(unknown.structuredContent.error.code, 'RULESET_UNKNOWN');
  console.log(JSON.stringify({ status: 'PASS', execution: 'LOCAL_WORKER_BUNDLE', cfp: 2, mismatch_rejected: true }));
} finally {
  child.kill();
  await new Promise(resolve => { if (stopped) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 3000).unref(); } });
  await fs.rm(runtime, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
