import fs from 'node:fs/promises';
import path from 'node:path';
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const emptyRegistry = () => ({ policy_version: 'oes/skill-integrity-policy/v1', enforcement_at: null, releases: [] });
export function validateRegistry(registry) {
  if (registry.policy_version !== 'oes/skill-integrity-policy/v1' || !Array.isArray(registry.releases)
    || (registry.enforcement_at !== null && (typeof registry.enforcement_at !== 'string' || !Number.isFinite(Date.parse(registry.enforcement_at))))) throw new Error('INVALID_SKILL_REGISTRY');
  const versions = new Set();
  for (const r of registry.releases) {
    if (r.skill_id !== 'open-estimate-assessor' || r.hash_rule !== 'oes/skill-package/v1' || typeof r.package_sha256 !== 'string' || typeof r.skill_version !== 'string'
      || !/^[a-f0-9]{64}$/.test(r.package_sha256) || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(r.skill_version)
      || r.skill_version.length > 64 || !['candidate', 'published'].includes(r.publication)
      || !['accepted', 'revoked'].includes(r.acceptance) || versions.has(r.skill_version)
      || (r.measurement_client_protocol != null && (typeof r.measurement_client_protocol !== 'string' || r.measurement_client_protocol.length > 128))) throw new Error('INVALID_SKILL_REGISTRY');
    versions.add(r.skill_version);
  }
  return registry;
}
export function registerCandidate(history, integrity, measurement_client_protocol = null) {
  const next = structuredClone(validateRegistry(history));
  const existing = next.releases.find(r => r.skill_version === integrity.skill_version);
  if (existing && existing.package_sha256 !== integrity.package_sha256) throw new Error('SKILL_VERSION_COLLISION');
  if (existing && (existing.measurement_client_protocol ?? null) !== measurement_client_protocol) throw new Error('SKILL_VERSION_COLLISION');
  if (!existing) next.releases.push({ skill_id: integrity.skill_id, skill_version: integrity.skill_version,
    hash_rule: integrity.hash_rule, package_sha256: integrity.package_sha256, measurement_client_protocol, publication: 'candidate', acceptance: 'accepted' });
  return next;
}
export function preserveHistory(history, candidate) {
  validateRegistry(history); validateRegistry(candidate);
  if (history.enforcement_at && history.releases.some(r => r.publication === 'published') && history.enforcement_at !== candidate.enforcement_at) throw new Error('ENFORCEMENT_DATE_CHANGED');
  for (const old of history.releases) {
    const r = candidate.releases.find(r => r.skill_version === old.skill_version);
    if (!r || r.package_sha256 !== old.package_sha256 || (old.measurement_client_protocol ?? null) !== (r.measurement_client_protocol ?? null) || (old.acceptance === 'revoked' && r.acceptance !== 'revoked')
      || (old.publication === 'published' && r.publication !== 'published')) throw new Error('SKILL_HISTORY_LOST');
  }
}
export async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
export async function inspectPlugin(marketplace) {
  const { inspectSkillPackage } = await import('../dist/profiles/skill-package.js');
  const plugin = path.join(marketplace, 'plugins/open-estimate');
  const first = inspectSkillPackage(path.join(plugin, 'skills/open-estimate-assessor'));
  const second = inspectSkillPackage(path.join(plugin, 'server/skills/open-estimate-assessor'));
  const manifest = await readJson(path.join(plugin, '.codex-plugin/plugin.json'));
  if (JSON.stringify(first) !== JSON.stringify(second) || first.skill_version !== manifest.version) throw new Error('SKILL_INTEGRITY_MISMATCH');
  return first;
}
export function packagedProtocol(marketplace) {
  const entry = path.join(marketplace, 'plugins/open-estimate/skills/open-estimate-assessor/scripts/oes.mjs');
  const result = spawnSync(process.execPath, [entry, 'contract'], { input: '{}', encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('PACKAGED_CONTRACT_FAILED');
  const protocol = JSON.parse(result.stdout).measurement_client_protocol ?? null;
  if (protocol !== null && protocol !== 'oes/measurement-client/v1') throw new Error('RULESET_INCOMPATIBLE');
  return protocol;
}
export async function inventory(root) {
  const files = [];
  async function walk(dir, prefix = '') {
    if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('UNSAFE_RELEASE_PATH');
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('UNSAFE_RELEASE_PATH');
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel + '/');
      else if (entry.isFile()) {
        const { createHash } = await import('node:crypto');
        files.push({ path: rel, sha256: createHash('sha256').update(await fs.readFile(path.join(dir, entry.name))).digest('hex') });
      } else throw new Error('UNSAFE_RELEASE_PATH');
    }
  }
  await walk(root);
  files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return files;
}
export const contentHash = value => createHash('sha256').update(canonicalize(value)).digest('hex');
