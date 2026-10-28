import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hashSkillPackage, inspectSkillPackage } from '../dist/profiles/skill-package.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const output = outputIndex < 0 ? null : args.splice(outputIndex, 2)[1];
if (outputIndex >= 0 && !output) throw new Error('OUTPUT_REQUIRED');
if (args.length && (args.length !== 2 || args[0] !== '--workspace')) throw new Error('Usage: npm run plugin:pack -- --workspace ABSOLUTE_DIRECTORY');
if (args.length) throw new Error('Workspace is now selected in chat; run npm run plugin:pack without --workspace');
const workspace = null;
const release = path.resolve(repo, 'release');
const marketplace = output ? path.resolve(repo, output) : path.join(release, 'local-marketplace');
const plugin = path.join(marketplace, 'plugins', 'open-estimate');
// The only replacement target is this generated directory, contained in release/.
if (!path.relative(release, marketplace) || path.relative(release, marketplace).startsWith('..') || path.isAbsolute(path.relative(release, marketplace))) throw new Error('Unsafe output path');
const outputRelative = path.relative(release, marketplace).split(path.sep).join('/');
if (outputRelative !== 'local-marketplace' && !/^staging\/[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\/marketplace$/.test(outputRelative)) throw new Error('PACK_OUTPUT_MUST_BE_LOCAL_OR_STAGING');
let ancestor = release;
for (const part of outputRelative.split('/')) {
  ancestor = path.join(ancestor, part);
  try { if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('Unsafe output ancestor'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
if (outputRelative.startsWith('staging/')) {
  try { await fs.access(path.join(path.dirname(marketplace), 'candidate.json')); throw new Error('FROZEN_CANDIDATE_EXISTS'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
try { if ((await fs.lstat(release)).isSymbolicLink()) throw new Error('Unsafe release directory'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
try { if ((await fs.lstat(marketplace)).isSymbolicLink()) throw new Error('Unsafe marketplace directory'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
console.log('Generating package at', marketplace);
await fs.rm(marketplace, { recursive: true, force: true });
await fs.mkdir(path.join(plugin, '.codex-plugin'), { recursive: true });
const json = async (file, data) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n'); };
const manifest = JSON.parse(await fs.readFile(path.join(repo, 'plugin/plugin.json'), 'utf8'));
await json(path.join(plugin, '.codex-plugin/plugin.json'), manifest);
// Select the project through discovery and confirmation; plugin cwd is not the project.
await json(path.join(plugin, '.mcp.json'), { mcpServers: { 'open-estimate-local': {type:'stdio',command:'node',args:['./server/dist/index.js'],cwd:'.'}, 'open-estimate': {
  type: 'http', url: 'https://open-estimate.ai-orchestration.jp/mcp'
} } });
for (const dir of ['dist', 'contracts', 'profiles', 'skills'])
  await fs.cp(path.join(repo, dir), path.join(plugin, 'server', dir), { recursive: true, dereference: false });
await fs.cp(path.join(repo, 'skills'), path.join(plugin, 'skills'), { recursive: true });
try { await fs.copyFile(path.join(repo, 'LICENSE'), path.join(plugin, 'LICENSE')); } catch(e) { if(e.code !== 'ENOENT') throw e; }
await fs.copyFile(path.join(repo, 'docs/DESKTOP-PLUGIN.md'), path.join(plugin, 'README.md'));
for (const file of ['SYSTEM-SPEC.md','SYSTEM-IMPLEMENTATION-PLAN.md','SYSTEM-IMPLEMENTATION-ACCEPTANCE.md','DOCUMENT-OPERATIONS.md','DOCUMENT-STAGING-ACCEPTANCE.md','PUBLICATION-OPERATIONS.md','PUBLICATION-IMPLEMENTATION-MAP.md','PUBLICATION-STAGING-ACCEPTANCE.md','WEB-PUBLICATION-SIMPLIFICATION-PROPOSAL.md']) { for (const target of [plugin, marketplace]) { await fs.mkdir(path.join(target,'implementation'),{recursive:true}); await fs.copyFile(path.join(repo,'docs/implementation',file),path.join(target,'implementation',file)); } }
await fs.mkdir(path.join(plugin, 'implementation'), { recursive: true });
await fs.copyFile(path.join(repo, 'docs/implementation/PLUGIN-QUALITY-0.8.0.md'), path.join(plugin, 'implementation/PLUGIN-QUALITY-0.8.0.md'));
await fs.copyFile(path.join(repo, 'docs/implementation/PLUGIN-QUALITY-0.8.1.md'), path.join(plugin, 'implementation/PLUGIN-QUALITY-0.8.1.md'));
await fs.copyFile(path.join(repo, 'package.json'), path.join(plugin, 'server/package.json'));
await fs.copyFile(path.join(repo, 'package-lock.json'), path.join(plugin, 'server/package-lock.json'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run plugin:pack');
const dependencies = execFileSync(process.execPath, [npm, 'ls', '--omit=dev', '--parseable', '--all'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).filter(p => p !== path.resolve(repo));
const moduleRoot = path.join(repo, 'node_modules');
for (const dep of dependencies) {
  const rel = path.relative(moduleRoot, dep);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || (await fs.lstat(dep)).isSymbolicLink()) throw new Error('Unsafe dependency path');
  await fs.cp(dep, path.join(plugin, 'server/node_modules', rel), { recursive: true, filter: source => !path.relative(dep, source).split(path.sep).includes('node_modules') });
}
const skill = hashSkillPackage(path.join(plugin, 'skills/open-estimate-assessor'));
const skillManifest = JSON.parse(await fs.readFile(path.join(plugin, 'skills/open-estimate-assessor/skill.manifest.json'), 'utf8'));
if (skill.package_sha256 !== skillManifest.package_sha256) throw new Error('Packaged skill hash mismatch');
const first = inspectSkillPackage(path.join(plugin, 'skills/open-estimate-assessor'));
const second = inspectSkillPackage(path.join(plugin, 'server/skills/open-estimate-assessor'));
if (JSON.stringify(first) !== JSON.stringify(second) || manifest.version !== first.skill_version) throw new Error('SKILL_INTEGRITY_MISMATCH');
await json(path.join(marketplace, '.agents/plugins/marketplace.json'), {
  name: 'open-estimate-desktop', interface: { displayName: 'Open Estimate（Work／Codex・ローカル実行向け）' },
  plugins: [{ name: 'open-estimate', source: { source: 'local', path: './plugins/open-estimate' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }]
});
await fs.copyFile(path.join(repo, 'docs/DESKTOP-PLUGIN.md'), path.join(marketplace, 'INSTALL.md'));
await fs.mkdir(path.join(marketplace, 'implementation'), { recursive: true });
await fs.copyFile(path.join(repo, 'docs/implementation/PLUGIN-QUALITY-0.8.0.md'), path.join(marketplace, 'implementation/PLUGIN-QUALITY-0.8.0.md'));
await fs.copyFile(path.join(repo, 'docs/implementation/PLUGIN-QUALITY-0.8.1.md'), path.join(marketplace, 'implementation/PLUGIN-QUALITY-0.8.1.md'));
const files = [];
async function inventory(dir, prefix = '') {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Symlink found in output');
    if (entry.isDirectory()) await inventory(path.join(dir, entry.name), rel + '/');
    else files.push({ path: rel, sha256: createHash('sha256').update(await fs.readFile(path.join(dir, entry.name))).digest('hex') });
  }
}
await inventory(plugin);
files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
await json(path.join(marketplace, 'BUILD.json'), { release_status: 'LOCAL_VALIDATION_ONLY', plugin_version: manifest.version, built_at: new Date().toISOString(), workspace_root: workspace, node_version: process.version, production_dependencies: dependencies.length, files });
console.log(JSON.stringify({ marketplace, plugin, workspace, production_dependencies: dependencies.length, files: files.length }, null, 2));
