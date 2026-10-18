import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashSkillPackage } from '../dist/profiles/skill-package.js';
const root = new URL('../skills/open-estimate-assessor/', import.meta.url);
const manifest = { domain: 'oes/skill-manifest/v1', skill_id: 'open-estimate-assessor', skill_version: '0.4.0',
  hash_rule: 'SHA256(JCS({domain:oes/skill-package/v1,files:[{path,sha256},...]}))', ...hashSkillPackage(fileURLToPath(root)) };
fs.writeFileSync(new URL('skill.manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
