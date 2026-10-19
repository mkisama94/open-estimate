import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateRules, buildRulesHistory } from './build-measurement-rules.mjs';
import { resolveMeasurementRules } from '../dist/remote/measurement-rules.js';
const repo = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
const output = process.argv[2] ?? 'release/local-marketplace';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'oes-desktop-smoke-'));
const plugin = path.join(temp, 'relocated plugin');
try {
  await fs.cp(path.join(repo, output, 'plugins/open-estimate'), plugin, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(plugin, '.codex-plugin/plugin.json')));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.requires_local_executor, true);
  const mcp = JSON.parse(await fs.readFile(path.join(plugin, '.mcp.json'))).mcpServers['open-estimate'];
  assert.deepEqual(mcp, { type: 'http', url: 'https://open-estimate.ai-orchestration.jp/mcp' });
  const run = (command, input) => {
    const child = spawnSync(process.execPath, [path.join(plugin, 'skills/open-estimate-assessor/scripts/oes.mjs'), command], {
      cwd: temp, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, OES_HELPER_STATE: path.join(temp, 'state') }, windowsHide: true
    });
    assert.equal(child.status, 0, child.stdout + child.stderr); return JSON.parse(child.stdout);
  };
  const contract = run('contract', {});
  assert.equal(run('skill-integrity', {}).skill_version, pkg.version);
  assert.equal(contract.workspace_root, null);
  assert.equal(contract.skill.skill_version, pkg.version);
  const root = path.join(temp, 'sample-project'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'main.js'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, '.env'), 'CANARY=do-not-read\n');
  const scan = run('scan', { root }), common = { root, session_id: scan.session_id };
  assert.equal(scan.summary.source_content_read, false);
  const actual = run('skill-integrity', {});
  const { format, ...release } = actual;
  const rules = await buildRulesHistory({ format: 'oes/measurement-rules-registry/v1', rules_enforcement_at: null, current_revision: null, revisions: [] }, await generateRules(repo));
  const response = resolveMeasurementRules({ skill_integrity: actual, client_protocol: contract.measurement_client_protocol }, rules,
    { policy_version: 'oes/skill-integrity-policy/v1', enforcement_at: null, releases: [{ ...release, publication: 'candidate', acceptance: 'accepted', measurement_client_protocol: contract.measurement_client_protocol }] });
  run('bind-rules', { ...common, rules_response: response });
  run('confirm', { ...common, user_confirmed: true });
  const prepared = run('prepare', common);
  assert.equal(prepared.manifest.files.find(f => f.path === '.env').disposition, 'excluded');
  const read = run('read', { ...common, snapshot_id: prepared.snapshot_id, file_id: 'main.js' });
  assert.equal(read.content, '1: export const value = 1;');
  run('purge', common);
  console.log(JSON.stringify({ status: 'PASS', relocated_package: true, local_mcp_required: false, version: manifest.version }));
} finally { await fs.rm(temp, { recursive: true, force: true }); }
