import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashSkillPackage } from '../dist/profiles/skill-package.js';
const root = new URL('../skills/open-estimate-assessor/', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const pluginPath = new URL('../plugin/plugin.json', import.meta.url);
const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
plugin.version = pkg.version;
fs.writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + '\n');
const manifest = { domain: 'oes/skill-manifest/v1', skill_id: 'open-estimate-assessor', skill_version: pkg.version,
  hash_rule: 'SHA256(JCS({domain:oes/skill-package/v1,files:[{path,sha256},...]}))', ...hashSkillPackage(fileURLToPath(root)) };
fs.writeFileSync(new URL('skill.manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
