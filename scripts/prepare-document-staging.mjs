import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hashSkillPackage,inspectSkillPackage} from '../dist/profiles/skill-package.js';
import {registerCandidate,readJson,inventory} from './build-skill-registry.mjs';

// Named isolated resources, verified separately before initial provisioning.
const repo=fileURLToPath(new URL('../',import.meta.url));
const issuer='https://open-estimate-proof-staging.mkisama.workers.dev',preview='https://open-estimate-preview-staging.mkisama.workers.dev';
const database={binding:'DOCUMENT_PROOF_DB',database_name:'open-estimate-document-proofs-staging',database_id:'9076c6c2-4047-47c4-b072-ecf0e5c3573c'};
if(process.argv[2]!=='--deploy')throw Error('EXPLICIT_STAGING_DEPLOY_REQUIRED');
const revision=process.argv[3]??'1';if(!/^[1-9][0-9]?$/.test(revision))throw Error('INVALID_STAGING_REVISION');
const pkg=await readJson(path.join(repo,'package.json')),version=pkg.version+'-staging.'+revision,root=path.join(repo,'release/document-staging',version);
const prior=Number(revision)>1?await readJson(path.join(repo,'release/document-staging',pkg.version+'-staging.'+(Number(revision)-1),'STAGING.json')):null;
await fs.mkdir(root,{recursive:false});
const json=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n');};
const source=path.join(root,'source'),marketplace=path.join(root,'marketplace'),plugin=path.join(marketplace,'plugins/open-estimate');
await fs.mkdir(source);for(const dir of ['src','profiles'])await fs.cp(path.join(repo,dir),path.join(source,dir),{recursive:true});await json(path.join(source,'package.json'),{...pkg,version});
await fs.cp(path.join(repo,'release/local-marketplace'),marketplace,{recursive:true});
const services={environment:'test',proof_destination:issuer+'/mcp',web_destination:preview+'/preview'};
const pair=prior?null:generateKeyPairSync('ed25519');
const key=prior?.key??{key_id:'doc_test_'+randomBytes(16).toString('hex'),algorithm:'Ed25519',public_key:pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url'),issuer,environment:'test'};
if(key.issuer!==issuer||key.environment!=='test'||!key.key_id.startsWith('doc_test_'))throw Error('INVALID_PRIOR_STAGING_KEY');
const trusted=[...await readJson(path.join(repo,'profiles/document-signing-keys.json')),key];
for(const base of [source,path.join(plugin,'server')]){await json(path.join(base,'profiles/document-services.json'),services);await json(path.join(base,'profiles/document-signing-keys.json'),trusted);}
for(const base of [plugin,path.join(plugin,'server')]){
 const skill=path.join(base,'skills/open-estimate-assessor'),file=path.join(skill,'SKILL.md');
 let text=await fs.readFile(file,'utf8');text=text.replaceAll('https://open-estimate.ai-orchestration.jp/mcp',services.proof_destination).replaceAll('https://open-estimate.ai-orchestration.jp/preview',services.web_destination);
 text+='\nステージング専用配布。合成対象だけを使い、本番受入済みとは説明しない。\n';await fs.writeFile(file,text);
 const old=await readJson(path.join(skill,'skill.manifest.json'));await json(path.join(skill,'skill.manifest.json'),{...old,skill_version:version,...hashSkillPackage(skill)});
}
const integrity=inspectSkillPackage(path.join(plugin,'skills/open-estimate-assessor'));
const registry=registerCandidate(await readJson(prior?path.join(prior.root,'source/profiles/skill-releases.json'):path.join(repo,'profiles/skill-releases.json')),integrity,'oes/measurement-client/v1');
for(const base of [source,path.join(plugin,'server')])await json(path.join(base,'profiles/skill-releases.json'),registry);
await json(path.join(plugin,'server/package.json'),{...pkg,version});
const manifest=await readJson(path.join(plugin,'.codex-plugin/plugin.json'));await json(path.join(plugin,'.codex-plugin/plugin.json'),{...manifest,version,interface:{...manifest.interface,displayName:'Open Estimate（ステージング）'}});
const connections=await readJson(path.join(plugin,'.mcp.json'));connections.mcpServers['open-estimate'].url=services.proof_destination;await json(path.join(plugin,'.mcp.json'),connections);
const listing=await readJson(path.join(marketplace,'.agents/plugins/marketplace.json'));listing.name='open-estimate-document-staging';listing.interface.displayName='Open Estimate 文書受入ステージング';await json(path.join(marketplace,'.agents/plugins/marketplace.json'),listing);
const common={account_id:'461a49a5bd16d90b629e8583ff7d7ec2',compatibility_date:'2026-09-25',workers_dev:true,observability:{enabled:false}};
const issuerConfig={...common,name:'open-estimate-proof-staging',main:'./source/src/remote/worker.ts',compatibility_flags:['nodejs_compat'],
 vars:{DOCUMENT_ISSUANCE_ENABLED:'false',DOCUMENT_ISSUER_ORIGIN:issuer,DOCUMENT_ENVIRONMENT:'test',DOCUMENT_SIGNING_KEY_ID:key.key_id,DOCUMENT_SIGNING_PUBLIC_KEY:key.public_key},
 d1_databases:[{...database,migrations_dir:path.join(repo,'migrations')}],ratelimits:[{name:'DOCUMENT_ISSUANCE_LIMITER',namespace_id:'2026102803',simple:{limit:20,period:60}}]};
const previewConfig={...common,name:'open-estimate-preview-staging',main:'./source/src/web/document-worker.ts'};
const issuerFile=path.join(root,'issuer.json'),previewFile=path.join(root,'preview.json');await json(issuerFile,issuerConfig);await json(previewFile,previewConfig);
const cli=path.join(repo,'node_modules/wrangler/bin/wrangler.js');
const run=(args,input,capture=false)=>execFileSync(process.execPath,[cli,...args],{cwd:repo,windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'},...(input||capture?{...(input?{input}:{}),encoding:'utf8',stdio:['pipe','pipe','pipe']}:{stdio:'inherit'})});
// The explicit UUID is the new staging DB. Never apply the production migration set.
run(['d1','execute',database.database_name,'--remote','--config',issuerFile,'--file',path.join(repo,'migrations/0008_document_proof_issuances.sql')]);
run(['deploy','--config',issuerFile]);
// Secret remains in memory and a stdin pipe; never persist it or echo CLI buffers.
if(pair){try{run(['secret','put','DOCUMENT_SIGNING_PRIVATE_KEY','--config',issuerFile],pair.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')+'\n');}catch{throw Error('STAGING_SECRET_PROVISION_FAILED_ISSUANCE_REMAINS_DISABLED');}}
else if(!JSON.parse(run(['secret','list','--config',issuerFile],null,true)).some(s=>s.name==='DOCUMENT_SIGNING_PRIVATE_KEY'))throw Error('STAGING_SECRET_MISSING_ISSUANCE_REMAINS_DISABLED');
issuerConfig.vars.DOCUMENT_ISSUANCE_ENABLED='true';await json(issuerFile,issuerConfig);run(['deploy','--config',issuerFile]);run(['deploy','--config',previewFile]);
await json(path.join(marketplace,'BUILD.json'),{release_status:'STAGING_ONLY_HOST_ACCEPTANCE_PENDING',plugin_version:version,built_at:new Date().toISOString(),files:await inventory(plugin)});
const result={status:'STAGING_DEPLOYED_HOST_ACCEPTANCE_PENDING',version,root,marketplace,services,key,database,production_modified:false,private_key_stored:'WORKER_SECRET_ONLY'};
await json(path.join(root,'STAGING.json'),result);console.log(JSON.stringify(result));
