// One-time registration of the already distributed 0.8.1 package. Not a CI step.
import { atomicJson, readJson, registerCandidate, inspectPlugin, packagedProtocol } from './build-skill-registry.mjs';
import { buildRulesHistory, generateRules } from './build-measurement-rules.mjs';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const skills = await readJson(new URL('../profiles/skill-releases.json', import.meta.url));
const rules = await readJson(new URL('../profiles/measurement-rules.json', import.meta.url));
if (skills.releases.length || rules.revisions.length) throw new Error('BOOTSTRAP_ALREADY_REGISTERED');
const marketplace = repo + 'release/desktop-marketplace';
const integrity = await inspectPlugin(marketplace);
if (integrity.skill_version !== '0.8.1') throw new Error('UNEXPECTED_DISTRIBUTED_VERSION');
const next = registerCandidate(skills, integrity, packagedProtocol(marketplace));
next.releases[0].publication = 'published'; // Distributed locally; not a claim of server deployment.
next.enforcement_at = '2026-11-07T00:00:00.000Z';
const nextRules = await buildRulesHistory(rules, await generateRules(repo));
nextRules.rules_enforcement_at = next.enforcement_at;
await atomicJson(repo + 'profiles/skill-releases.json', next);
await atomicJson(repo + 'profiles/measurement-rules.json', nextRules);
