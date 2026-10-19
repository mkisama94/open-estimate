import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, readJson, contentHash, inventory, validateRegistry } from './build-skill-registry.mjs';
import { generateRules, buildRulesHistory, preserveRulesHistory } from './build-measurement-rules.mjs';
import { assertBaseline, assertNoOtherPending, claimPending, clearPending, buildFrozenWorker, confirmDeployment, deploymentVars, npmRun, run, runFrozenWorker, safeReleaseDirectory, withReleaseLock, ensureCandidateValidation, requireCandidateValidation } from './release-common.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function verifyRulesCandidate(dir, skills, rules) {
  validateRegistry(skills);
  const record = await readJson(path.join(dir, 'candidate.json'));
  const skillRegistry = await readJson(path.join(dir, 'registry.json'));
  const rulesRegistry = await readJson(path.join(dir, 'measurement-rules.json'));
  const { validateRulesRegistry } = await import('../dist/rules/measurement-contract.js');
  validateRulesRegistry(rulesRegistry, true);
  const baselineRules = await readJson(path.join(dir, 'rules-history.json'));
  if (contentHash(skillRegistry) !== record.baseline_skill_sha256 || contentHash(baselineRules) !== record.baseline_rules_sha256
    || contentHash(rulesRegistry) !== record.measurement_rules_sha256
    || contentHash(await inventory(path.join(dir, 'artifacts'))) !== record.artifacts_sha256) throw new Error('CANDIDATE_CHANGED');
  assertBaseline(skills, record.baseline_skill_sha256);
  let state = {};
  try { state = await readJson(path.join(dir, 'publication.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  assertBaseline(rules, record.baseline_rules_sha256, state.confirmed ? [rulesRegistry] : []);
  await preserveRulesHistory(baselineRules, rulesRegistry);
  return { record, skillRegistry, rulesRegistry };
}
export async function prepareRulesCandidate(repo, adapters = {}, action = {}) {
  const skills = validateRegistry(await readJson(path.join(repo, 'profiles/skill-releases.json')));
  const history = await readJson(path.join(repo, 'profiles/measurement-rules.json'));
  if (!skills.enforcement_at || !history.rules_enforcement_at) throw new Error('INITIAL_PLUGIN_RELEASE_REQUIRED');
  const release = skills.releases.filter(r => r.acceptance === 'accepted' && r.publication === 'published' && r.measurement_client_protocol === 'oes/measurement-client/v1').at(-1);
  if (!release) throw new Error('INITIAL_PLUGIN_RELEASE_REQUIRED');
  const generated = await generateRules(repo);
  const rules = await buildRulesHistory(history, generated, action);
  const { assertCompatible } = await import('../dist/rules/measurement-contract.js');
  assertCompatible(rules.revisions.find(r => r.revision === rules.current_revision).bundle, release.measurement_client_protocol);
  await preserveRulesHistory(history, rules);
  const key = contentHash({ skills, history, rules });
  const dir = path.join(repo, 'release/rules-staging', rules.current_revision, key);
  await safeReleaseDirectory(repo, dir);
  await assertNoOtherPending(repo, dir);
  const integrity = { format: 'oes/skill-integrity/v1', skill_id: release.skill_id, skill_version: release.skill_version, hash_rule: release.hash_rule, package_sha256: release.package_sha256 };
  const validate = () => ensureCandidateValidation(dir, () => verifyRulesCandidate(dir, skills, history),
    () => adapters.smoke ? adapters.smoke(repo, dir) : run(repo, 'scripts/smoke-worker.mjs', [dir]));
  let existing = false;
  try { await fs.access(path.join(dir, 'candidate.json')); existing = true; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing) { await validate(); return dir; }
  await atomicJson(path.join(dir, 'registry.json'), skills);
  await atomicJson(path.join(dir, 'rules-history.json'), history);
  await atomicJson(path.join(dir, 'measurement-rules.json'), rules);
  await (adapters.build ?? buildFrozenWorker)(repo, dir, skills, rules);
  await atomicJson(path.join(dir, 'candidate.json'), { kind: 'measurement-rules', revision: rules.current_revision, integrity,
    baseline_skill_sha256: contentHash(skills), baseline_rules_sha256: contentHash(history), measurement_rules_sha256: contentHash(rules),
    registry_sha256: contentHash(skills), artifacts_sha256: contentHash(await inventory(path.join(dir, 'artifacts'))) });
  await validate();
  return dir;
}
export async function publishRulesCandidate(dir, adapters) {
  const skills = await readJson(adapters.skillHistoryPath), rules = await readJson(adapters.rulesHistoryPath);
  const { record, skillRegistry, rulesRegistry } = await verifyRulesCandidate(dir, skills, rules);
  await requireCandidateValidation(dir);
  const file = path.join(dir, 'publication.json');
  let state = {};
  try { state = await readJson(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try {
    if (!state.deployed) {
      await adapters.deploy(dir, skillRegistry, rulesRegistry);
      state.deployed = true; await atomicJson(file, state);
    }
    await adapters.confirm(skillRegistry, rulesRegistry, record.integrity);
    state.confirmed = true; state.status = 'CONFIRMED'; await atomicJson(file, state);
  } catch (e) {
    state.status = 'PUBLICATION_UNCONFIRMED'; state.notice = 'サーバーは切替済みの可能性があります。同じ固定候補の反映確認を再実行してください。';
    await atomicJson(file, state); throw e;
  }
  // Re-read after remote I/O, even while using the shared operational lock.
  await verifyRulesCandidate(dir, await readJson(adapters.skillHistoryPath), await readJson(adapters.rulesHistoryPath));
  await requireCandidateValidation(dir);
  await atomicJson(adapters.rulesHistoryPath, rulesRegistry);
  state.status = 'PUBLISHED'; state.revision = record.revision; await atomicJson(file, state);
  return state;
}
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!['prepare', 'publish', 'release'].includes(mode)) throw new Error('INVALID_RELEASE_COMMAND');
  const action = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--withdraw', '--current'].includes(args[i]) || !/^[a-f0-9]{64}$/.test(args[i + 1] ?? '')) throw new Error('INVALID_RULESET_REF');
    action[args[i].slice(2)] = args[i + 1];
  }
  if (mode === 'publish' && args.length) throw new Error('PUBLISH_USES_FROZEN_CANDIDATE');
  const pointer = path.join(root, 'release/rules-staging/PREPARED.json');
  await withReleaseLock(root, async () => {
    let dir;
    if (mode !== 'publish') {
      // This path never runs the manifest/plugin-mutating normal build.
      npmRun(root, 'build:worker'); npmRun(root, 'test');
      dir = await prepareRulesCandidate(root, {}, action);
      await atomicJson(pointer, { candidate: path.relative(root, dir) });
      console.log('Rules prepared (not published):', dir);
    }
    if (mode !== 'prepare') {
      dir ??= path.resolve(root, (await readJson(pointer)).candidate);
      if (!/^release\/rules-staging\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(path.relative(root, dir).split(path.sep).join('/'))) throw new Error('UNSAFE_RELEASE_PATH');
      await safeReleaseDirectory(root, dir);
      await publishRulesCandidate(dir, { skillHistoryPath: path.join(root, 'profiles/skill-releases.json'), rulesHistoryPath: path.join(root, 'profiles/measurement-rules.json'),
        deploy: async (d, skills, rules) => { await claimPending(root, d); return runFrozenWorker(root, d, deploymentVars(skills, rules)); },
        confirm: async (skills, rules, integrity) => { await claimPending(root, dir); return confirmDeployment(skills, rules, integrity); } });
      await clearPending(root, dir);
      console.log('Rules published and verified:', dir);
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
