import fs from 'node:fs/promises';
import path from 'node:path';
import {inventory} from './build-skill-registry.mjs';
const base=path.resolve('release/publication-staging'),root=path.resolve(process.argv[2]??''),relative=path.relative(base,root);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('STAGING_ROOT_REQUIRED');
const stage=JSON.parse(await fs.readFile(path.join(root,'STAGING.json'),'utf8'));if(stage.services.environment!=='test')throw Error('STAGING_ONLY');
const marketplace=path.join(root,'marketplace'),plugin=path.join(marketplace,'plugins/open-estimate');
for(const filename of ['SYSTEM-SPEC.md','SYSTEM-IMPLEMENTATION-PLAN.md','SYSTEM-IMPLEMENTATION-ACCEPTANCE.md','PUBLICATION-OPERATIONS.md','PUBLICATION-IMPLEMENTATION-MAP.md','PUBLICATION-STAGING-ACCEPTANCE.md','WEB-PUBLICATION-SIMPLIFICATION-PROPOSAL.md']){
 for(const target of [marketplace,plugin])await fs.copyFile(path.join('docs/implementation',filename),path.join(target,'implementation',filename));
}
await fs.copyFile('docs/DESKTOP-PLUGIN.md',path.join(plugin,'README.md'));
const file=path.join(marketplace,'BUILD.json'),old=JSON.parse(await fs.readFile(file,'utf8'));await fs.writeFile(file,JSON.stringify({...old,documentation_updated_at:new Date().toISOString(),files:await inventory(plugin)},null,2)+'\n');
console.log(JSON.stringify({status:'STAGING_DOCUMENTATION_REFRESHED',version:stage.version,runtime_changed:false,production_modified:false}));
