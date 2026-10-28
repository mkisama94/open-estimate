import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, validateRegistry, contentHash } from './build-skill-registry.mjs';
import { generateRules } from './build-measurement-rules.mjs';
import { run, confirmDeployment } from './release-common.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
// CI consumes reviewed, Git-tracked registries. Never manufacture history or
// move migration deadlines during an ephemeral build.
export async function validateCiInputs(skills, rules, integrity, generated, version) {
  validateRegistry(skills);
  const { resolveMeasurementRules } = await import('../dist/remote/measurement-rules.js');
  const release = skills.releases.find(r => r.skill_version === version);
  if (integrity.skill_version !== version || release?.publication !== 'published') throw new Error('CI_RELEASE_NOT_REGISTERED');
  if (!skills.enforcement_at || !rules.rules_enforcement_at) throw new Error('CI_MIGRATION_DATES_REQUIRED');
  const result = resolveMeasurementRules({ skill_integrity: integrity, client_protocol: 'oes/measurement-client/v1' }, rules, skills);
  if (contentHash(result.bundle) !== contentHash(generated.bundle) || result.ruleset_ref.revision !== generated.ruleset_ref.revision) throw new Error('CI_RULES_NOT_REGISTERED');
}
async function inputs() {
  run(repo, 'scripts/build-contract-validators.mjs', ['--check']);
  const { inspectSkillPackage } = await import('../dist/profiles/skill-package.js');
  const skills = await readJson(path.join(repo, 'profiles/skill-releases.json'));
  const rules = await readJson(path.join(repo, 'profiles/measurement-rules.json'));
  const integrity = inspectSkillPackage(path.join(repo, 'skills/open-estimate-assessor'));
  await validateCiInputs(skills, rules, integrity, await generateRules(repo), (await readJson(path.join(repo, 'package.json'))).version);
  return { skills, rules, integrity };
}
async function main() {
  const mode = process.argv[2];
  if (!['check', 'deploy', 'verify'].includes(mode)) throw new Error('INVALID_CI_MODE');
  const { skills, rules, integrity } = await inputs();
  if (mode === 'deploy') {
    run(repo, 'node_modules/wrangler/bin/wrangler.js', ['deploy', '--config', 'wrangler.mcp.jsonc']);
  }
  if (mode !== 'check') {
    await confirmDeployment(skills, rules, integrity);
    const response = await fetch('https://open-estimate.ai-orchestration.jp/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }), signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    for (const name of ['get_skill_policy', 'get_measurement_rules', 'issue_estimate_proof', 'issue_document_proof']) {
      if (!response.ok || !result.result?.tools?.some(t => t.name === name)) throw new Error('PRODUCTION_TOOLS_MISSING');
    }
  }
  console.log(JSON.stringify({ status: 'PASS', mode, version: integrity.skill_version }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
