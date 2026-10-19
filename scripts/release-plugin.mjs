import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, readJson, inspectPlugin, inventory, contentHash, registerCandidate, preserveHistory, validateRegistry, packagedProtocol } from './build-skill-registry.mjs';

import { run as commonRun, npmRun as commonNpmRun, safeReleaseDirectory, withReleaseLock, buildFrozenWorker, runFrozenWorker as commonFrozenWorker, confirmDeployment, deploymentVars, assertBaseline, assertNoOtherPending, claimPending, clearPending, ensureCandidateValidation, requireCandidateValidation } from './release-common.mjs';
import { generateRules, buildRulesHistory, preserveRulesHistory } from './build-measurement-rules.mjs';
const repo = fileURLToPath(new URL('../', import.meta.url));
const historyPath = path.join(repo, 'profiles/skill-releases.json');
const fourteenDays = 14 * 86400000;
const run = (script, args = []) => commonRun(repo, script, args);
const npmRun = (name, args = []) => commonNpmRun(repo, name, args);
const safeDirectory = target => safeReleaseDirectory(repo, target);
const runFrozenWorker = (dir, args) => commonFrozenWorker(repo, dir, args);
const rulesHistoryPath = path.join(repo, 'profiles/measurement-rules.json');
export async function verifyCandidate(dir, history, rulesHistory) {
  const record = await readJson(path.join(dir, 'candidate.json'));
  const registry = validateRegistry(await readJson(path.join(dir, 'registry.json')));
  if (record.registry_sha256 !== contentHash(registry)) throw new Error('CANDIDATE_CHANGED');
  // A history file lost after prepare must never silently become a new first release.
  const baseline = await readJson(path.join(dir, 'history.json'));
  preserveHistory(baseline, history);
  const resumed = structuredClone(registry);
  // The initial enforcement date is assigned once by publish, outside the frozen code bundle.
  if (resumed.enforcement_at === null) resumed.enforcement_at = history.enforcement_at;
  for (const r of resumed.releases) {
    if (history.releases.some(old => old.skill_version === r.skill_version && old.publication === 'published')) r.publication = 'published';
  }
  preserveHistory(history, resumed);
  const integrity = await inspectPlugin(path.join(dir, 'marketplace'));
  if (JSON.stringify(record.integrity) !== JSON.stringify(integrity)
    || record.artifacts_sha256 !== contentHash(await inventory(path.join(dir, 'artifacts')))
    || record.package_sha256 !== contentHash(await inventory(path.join(dir, 'marketplace')))) throw new Error('CANDIDATE_CHANGED');
  const r = registry.releases.find(r => r.skill_version === integrity.skill_version);
  if (!r || r.acceptance !== 'accepted' || r.package_sha256 !== integrity.package_sha256) throw new Error('INVALID_SKILL_REGISTRY');
  let rulesRegistry;
  if (record.measurement_rules_sha256) {
    rulesRegistry = await readJson(path.join(dir, 'measurement-rules.json'));
    const { validateRulesRegistry } = await import('../dist/rules/measurement-contract.js');
    validateRulesRegistry(rulesRegistry, true);
    const rulesBaseline = await readJson(path.join(dir, 'rules-history.json'));
    if (contentHash(rulesRegistry) !== record.measurement_rules_sha256 || contentHash(rulesBaseline) !== record.baseline_rules_sha256
      || contentHash(baseline) !== record.baseline_skill_sha256) throw new Error('CANDIDATE_CHANGED');
    rulesHistory ??= await readJson(rulesHistoryPath);
    let state = {};
    try { state = await readJson(path.join(dir, 'publication.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const ownSkill = structuredClone(registry), ownRules = structuredClone(rulesRegistry);
    ownSkill.enforcement_at ??= state.enforcement_at ?? null;
    ownRules.rules_enforcement_at ??= state.rules_enforcement_at ?? null;
    const published = structuredClone(ownSkill);
    published.releases.find(r => r.skill_version === integrity.skill_version).publication = 'published';
    assertBaseline(history, record.baseline_skill_sha256, state.enforcement_at ? [ownSkill, published, ...(state.previous_skill_history ? [state.previous_skill_history] : [])] : []);
    assertBaseline(rulesHistory, record.baseline_rules_sha256, state.rules_enforcement_at ? [ownRules, ...(state.previous_rules_history ? [state.previous_rules_history] : [])] : []);
    await preserveRulesHistory(rulesBaseline, ownRules);
  }
  return { record, registry, integrity, rulesRegistry };
}

export async function publishCandidate(dir, adapters, now = Date.now()) {
  const history = validateRegistry(await readJson(adapters.historyPath));
  const rulesHistory = adapters.rulesHistoryPath ? await readJson(adapters.rulesHistoryPath) : undefined;
  const { record, registry: preparedRegistry, integrity, rulesRegistry: preparedRules } = await verifyCandidate(dir, history, rulesHistory);
  await requireCandidateValidation(dir);
  const statePath = path.join(dir, 'publication.json');
  let state;
  try { state = await readJson(statePath); } catch (e) { if (e.code !== 'ENOENT') throw e; state = {}; }
  if (state.history_saved) {
    if (!history.releases.some(r => r.skill_version === integrity.skill_version && r.package_sha256 === integrity.package_sha256)) throw new Error('SKILL_HISTORY_LOST');
  }
  const registry = structuredClone(preparedRegistry);
  const rulesRegistry = preparedRules ? structuredClone(preparedRules) : undefined;
  const firstPublication = !history.releases.some(r => r.publication === 'published') && !state.promoted;
  const firstRulesPublication = preparedRules?.rules_enforcement_at === null && !state.promoted
    && !history.releases.some(r => r.publication === 'published' && r.measurement_client_protocol === 'oes/measurement-client/v1');
  registry.enforcement_at ??= history.enforcement_at ?? state.enforcement_at ?? new Date(now + fourteenDays + 3600000).toISOString();
  if (firstPublication && preparedRegistry.enforcement_at === null && Date.parse(registry.enforcement_at) - now < fourteenDays) {
    registry.enforcement_at = new Date(now + fourteenDays + 3600000).toISOString();
    state.previous_skill_history = history;
    state.deployed = false;
  }
  state.enforcement_at = registry.enforcement_at;
  if (rulesRegistry) {
    rulesRegistry.rules_enforcement_at ??= rulesHistory?.rules_enforcement_at ?? state.rules_enforcement_at ?? new Date(now + fourteenDays + 3600000).toISOString();
    if (firstRulesPublication && Date.parse(rulesRegistry.rules_enforcement_at) - now < fourteenDays) {
      rulesRegistry.rules_enforcement_at = new Date(now + fourteenDays + 3600000).toISOString(); state.deployed = false;
      state.previous_rules_history = rulesHistory;
    }
    state.rules_enforcement_at = rulesRegistry.rules_enforcement_at;
  }
  if (firstPublication && Date.parse(registry.enforcement_at) - now < fourteenDays) throw new Error('MIGRATION_WINDOW_TOO_SHORT_PREPARE_AGAIN');
  await atomicJson(statePath, state);
  if (!state.deployed) {
    await adapters.deploy(dir, registry, rulesRegistry);
    state.deployed = true; await atomicJson(statePath, state);
  }
  // Always re-check the live policy, even on resume or after an intervening deployment.
  try { await adapters.confirm(registry, integrity, rulesRegistry); }
  catch (e) { state.status = 'PUBLICATION_UNCONFIRMED'; await atomicJson(statePath, state); throw e; }
  if (firstPublication && Date.parse(registry.enforcement_at) - (adapters.now?.() ?? now) < fourteenDays) throw new Error('MIGRATION_WINDOW_TOO_SHORT_PREPARE_AGAIN');
  if (rulesRegistry && firstRulesPublication && Date.parse(rulesRegistry.rules_enforcement_at) - (adapters.now?.() ?? now) < fourteenDays) throw new Error('MIGRATION_WINDOW_TOO_SHORT_PREPARE_AGAIN');
  await verifyCandidate(dir, await readJson(adapters.historyPath), adapters.rulesHistoryPath ? await readJson(adapters.rulesHistoryPath) : undefined);
  await requireCandidateValidation(dir);
  // Persist history before promotion; a failed promotion resumes from this same artifact.
  const next = structuredClone(registry);
  if (history.releases.some(r => r.skill_version === integrity.skill_version && r.publication === 'published'))
    next.releases.find(r => r.skill_version === integrity.skill_version).publication = 'published';
  preserveHistory(history, next);
  if (rulesRegistry) {
    await preserveRulesHistory(firstRulesPublication ? { ...rulesHistory, rules_enforcement_at: null } : rulesHistory, rulesRegistry);
    await atomicJson(adapters.rulesHistoryPath, rulesRegistry);
  }
  await atomicJson(adapters.historyPath, next);
  state.history_saved = true; await atomicJson(statePath, state);
  await adapters.promote(path.join(dir, 'marketplace'));
  state.promoted = true; state.version = record.version; await atomicJson(statePath, state);
  next.releases.find(r => r.skill_version === integrity.skill_version).publication = 'published';
  await atomicJson(adapters.historyPath, next);
  state.status = 'PUBLISHED'; await atomicJson(statePath, state);
  return state;
}

export async function validatePluginCandidate(dir, history, rulesHistory, smoke = () => run('scripts/smoke-worker.mjs', [dir])) {
  await ensureCandidateValidation(dir, () => verifyCandidate(dir, history, rulesHistory), smoke);
}
async function prepare(version) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version) || version.length > 64) throw new Error('INVALID_RELEASE_VERSION');
  const dir = path.join(repo, 'release/staging', version);
  await safeDirectory(dir);
  await assertNoOtherPending(repo, dir);
  const history = validateRegistry(await readJson(historyPath));
  let existing = false;
  try { await fs.access(path.join(dir, 'candidate.json')); existing = true; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing) {
    await validatePluginCandidate(dir, history);
    console.log('Existing frozen candidate:', dir); return dir;
  }
  const pkg = await readJson(path.join(repo, 'package.json'));
  pkg.version = version; await atomicJson(path.join(repo, 'package.json'), pkg);
  const lock = await readJson(path.join(repo, 'package-lock.json'));
  lock.version = version; lock.packages[''].version = version;
  await atomicJson(path.join(repo, 'package-lock.json'), lock);
  npmRun('build'); npmRun('test');
  npmRun('plugin:pack', ['--output', path.relative(repo, path.join(dir, 'marketplace'))]);
  npmRun('plugin:smoke', [path.relative(repo, path.join(dir, 'marketplace'))]);
  const integrity = await inspectPlugin(path.join(dir, 'marketplace'));
  const registry = registerCandidate(history, integrity, packagedProtocol(path.join(dir, 'marketplace')));
  const rulesHistory = await readJson(rulesHistoryPath);
  const rulesRegistry = await buildRulesHistory(rulesHistory, await generateRules(repo));
  await atomicJson(path.join(dir, 'rules-history.json'), rulesHistory);
  await atomicJson(path.join(dir, 'measurement-rules.json'), rulesRegistry);
  // First enforcement date is assigned by publish; subsequent releases retain history's date.
  await atomicJson(path.join(dir, 'history.json'), history);
  await atomicJson(path.join(dir, 'registry.json'), registry);
  await buildFrozenWorker(repo, dir, registry, rulesRegistry);
  await atomicJson(path.join(dir, 'candidate.json'), { version, integrity, baseline_skill_sha256: contentHash(history), baseline_rules_sha256: contentHash(rulesHistory),
    measurement_rules_sha256: contentHash(rulesRegistry), registry_sha256: contentHash(registry),
    artifacts_sha256: contentHash(await inventory(path.join(dir, 'artifacts'))), package_sha256: contentHash(await inventory(path.join(dir, 'marketplace'))) });
  await validatePluginCandidate(dir, history, rulesHistory);
  console.log('Prepared (not published):', dir); return dir;
}

async function promote(source) {
  const target = path.join(repo, 'release/desktop-marketplace'), next = path.join(repo, 'release/promoting'), backup = path.join(repo, 'release/previous-marketplace');
  for (const dir of [target, next, backup]) await safeDirectory(dir);
  await fs.rm(next, { recursive: true, force: true });
  await fs.cp(source, next, { recursive: true });
  if (contentHash(await inventory(source)) !== contentHash(await inventory(next))) throw new Error('PROMOTION_COPY_CHANGED');
  // Recover a crash between renaming the old directory and promoting the new one.
  try { await fs.access(target); await fs.rm(backup, { recursive: true, force: true }); await fs.rename(target, backup); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { await fs.rename(next, target); }
  catch (e) { try { await fs.rename(backup, target); } catch {} throw e; }
}
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!['prepare', 'publish', 'release', 'deploy', 'check'].includes(mode)) throw new Error('INVALID_RELEASE_COMMAND');
  const pkg = await readJson(path.join(repo, 'package.json'));
  if (args.length && (args.length !== 2 || args[0] !== '--version')) throw new Error('USE_VERSION_ONLY');
  const version = args[1] ?? pkg.version;
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('INVALID_RELEASE_VERSION');
  const dir = path.join(repo, 'release/staging', version);
  await safeDirectory(dir);
  await withReleaseLock(repo, async () => {
    if (['prepare', 'release'].includes(mode)) await prepare(version);
    if (['publish', 'release', 'deploy'].includes(mode)) {
      if (!(await verifyCandidate(dir, await readJson(historyPath))).rulesRegistry) throw new Error('CENTRAL_RULES_CANDIDATE_REQUIRED');
      await publishCandidate(dir, { historyPath, rulesHistoryPath, confirm: async (skills, integrity, rules) => { await claimPending(repo, dir); return confirmDeployment(skills, rules, integrity); }, promote, now: () => Date.now(),
        deploy: async (d, skills, rules) => { await claimPending(repo, d); return runFrozenWorker(d, deploymentVars(skills, rules)); } });
      await clearPending(repo, dir);
    }
    if (mode === 'check') {
      await verifyCandidate(dir, await readJson(historyPath));
      await requireCandidateValidation(dir);
      await runFrozenWorker(dir, ['--dry-run']);
      await verifyCandidate(dir, await readJson(historyPath));
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
