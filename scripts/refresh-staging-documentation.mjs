import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventory,readJson} from './build-skill-registry.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),root=path.resolve(process.argv[2]??'');
if(!root.startsWith(path.join(repo,'release/document-staging')+path.sep))throw Error('STAGING_DIRECTORY_REQUIRED');
const staging=await readJson(path.join(root,'STAGING.json'));if(staging.services.environment!=='test'||staging.root!==root)throw Error('STAGING_DIRECTORY_MISMATCH');
const plugin=path.join(staging.marketplace,'plugins/open-estimate');
for(const file of ['SYSTEM-SPEC.md','SYSTEM-IMPLEMENTATION-PLAN.md','SYSTEM-IMPLEMENTATION-ACCEPTANCE.md','DOCUMENT-OPERATIONS.md','DOCUMENT-STAGING-ACCEPTANCE.md'])for(const target of [plugin,staging.marketplace]){await fs.mkdir(path.join(target,'implementation'),{recursive:true});await fs.copyFile(path.join(repo,'docs/implementation',file),path.join(target,'implementation',file));}
const readme=`> ステージング専用 ${staging.version}。本番配布ではありません。送信先・信頼鍵はこの配布内のtest設定へ固定しています。実ホストの全工程受入は未完です。\n\n`+await fs.readFile(path.join(repo,'docs/DESKTOP-PLUGIN.md'),'utf8');
await fs.writeFile(path.join(plugin,'README.md'),readme);await fs.writeFile(path.join(staging.marketplace,'INSTALL.md'),readme);
const build=await readJson(path.join(staging.marketplace,'BUILD.json'));await fs.writeFile(path.join(staging.marketplace,'BUILD.json'),JSON.stringify({...build,documentation_updated_at:new Date().toISOString(),files:await inventory(plugin)},null,2)+'\n');
console.log(JSON.stringify({status:'DOCUMENTATION_UPDATED',version:staging.version,runtime_changed:false,marketplace:staging.marketplace}));
