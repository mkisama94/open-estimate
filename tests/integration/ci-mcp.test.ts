import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
// @ts-ignore native build scripts
import { selectCiIntegrity, validateCiInputs } from '../../scripts/ci-mcp.mjs';
// @ts-ignore native build scripts
import { generateRules } from '../../scripts/build-measurement-rules.mjs';
import { inspectSkillPackage } from '../../src/profiles/skill-package.js';

it('server CI validates a published client while the source plugin is still unpublished', async () => {
  const skills = JSON.parse(await fs.readFile('profiles/skill-releases.json', 'utf8'));
  const rules = JSON.parse(await fs.readFile('profiles/measurement-rules.json', 'utf8'));
  const source = { ...inspectSkillPackage('skills/open-estimate-assessor'), skill_version: '999.0.0' };
  const before = JSON.stringify(skills);
  const selected = await selectCiIntegrity(skills, source, source.skill_version);
  expect(selected.skill_version).not.toBe(source.skill_version);
  expect(skills.releases.find((r:any) => r.skill_version === selected.skill_version).publication).toBe('published');
  await expect(validateCiInputs(skills, rules, selected, await generateRules(process.cwd()), selected.skill_version)).resolves.toBeUndefined();
  expect(JSON.stringify(skills)).toBe(before);
  await expect(selectCiIntegrity(skills, source, '999.0.1')).rejects.toThrow('CI_SOURCE_VERSION_MISMATCH');
  await expect(selectCiIntegrity({ ...skills, releases: [] }, source, source.skill_version)).rejects.toThrow('CI_RELEASE_NOT_REGISTERED');
  await expect(selectCiIntegrity({ ...skills, releases: skills.releases.map((r:any) => ({ ...r, acceptance: 'revoked' })) }, source, source.skill_version)).rejects.toThrow('CI_RELEASE_NOT_REGISTERED');

  const { format, ...release } = source;
  skills.releases.push({ ...release, measurement_client_protocol: 'oes/measurement-client/v1', publication: 'candidate', acceptance: 'accepted' });
  expect(await selectCiIntegrity(skills, source, source.skill_version)).toEqual(selected);
  await expect(selectCiIntegrity({ ...skills, releases: [skills.releases.at(-1)] }, source, source.skill_version)).rejects.toThrow('CI_RELEASE_NOT_REGISTERED');
  skills.releases.at(-1).publication = 'published';
  expect(await selectCiIntegrity(skills, source, source.skill_version)).toEqual(source);
  await expect(selectCiIntegrity(skills, { ...source, package_sha256: '0'.repeat(64) }, source.skill_version)).rejects.toThrow('SKILL_INTEGRITY_MISMATCH');
  skills.releases.at(-1).acceptance = 'revoked';
  await expect(selectCiIntegrity(skills, source, source.skill_version)).rejects.toThrow('SKILL_VERSION_REVOKED');
});

it('CI refuses empty, stale or revoked registries and changed distributed packages', async () => {
  const skills = JSON.parse(await fs.readFile('profiles/skill-releases.json', 'utf8'));
  const rules = JSON.parse(await fs.readFile('profiles/measurement-rules.json', 'utf8'));
  const integrity = inspectSkillPackage('skills/open-estimate-assessor');
  // Exercise validation with an isolated published fixture: release:prepare runs tests
  // before the real new version is registered/published. Do not require it to lie about publication.
  skills.releases = skills.releases.filter((r:any)=>r.skill_version!==integrity.skill_version);
  const {format,...release}=integrity;
  skills.releases.push({...release,measurement_client_protocol:'oes/measurement-client/v1',publication:'published',acceptance:'accepted'});
  const generated = await generateRules(process.cwd());
  const check = (s=skills, r=rules, i=integrity, g=generated) => validateCiInputs(s,r,i,g,integrity.skill_version);
  await expect(check()).resolves.toBeUndefined();
  await expect(check({...skills,releases:[]})).rejects.toThrow('CI_RELEASE_NOT_REGISTERED');
  await expect(check({...skills,releases:skills.releases.map((r:any)=>({...r,publication:'staged'}))})).rejects.toThrow();
  await expect(check({...skills,enforcement_at:null})).rejects.toThrow('CI_MIGRATION_DATES_REQUIRED');
  await expect(check({...skills,releases:skills.releases.map((r:any)=>({...r,acceptance:'revoked'}))})).rejects.toThrow('SKILL_VERSION_REVOKED');
  await expect(check(skills,rules,{...integrity,package_sha256:'0'.repeat(64)})).rejects.toThrow('SKILL_INTEGRITY_MISMATCH');
  await expect(check(skills,{...rules,current_revision:null})).rejects.toThrow('RULESET_UNAVAILABLE');
  await expect(check(skills,rules,integrity,{...generated,ruleset_ref:{...generated.ruleset_ref,revision:'0'.repeat(64)}})).rejects.toThrow('CI_RULES_NOT_REGISTERED');
});
