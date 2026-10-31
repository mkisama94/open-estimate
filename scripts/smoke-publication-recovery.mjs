import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
if(process.argv[2]!=='--production')throw Error('PRODUCTION_FLAG_REQUIRED');
const base=path.resolve('release/local-marketplace/plugins/open-estimate'),load=p=>import(pathToFileURL(path.join(base,'server/dist',p)).href);
const w=await load('local/estimate-workflow.js'),{resultFromDocument}=await load('contracts/estimate-result.js'),{inspectSkillPackage}=await load('profiles/skill-package.js');
const {readWorkflowFile}=await load('local/workflow-store.js'),services=JSON.parse(await fs.readFile(path.join(base,'server/profiles/estimate-services.json'),'utf8'));
assert.equal(services.environment,'production');const version=JSON.parse(await fs.readFile(path.join(base,'.codex-plugin/plugin.json'),'utf8')).version;
const dir=path.resolve('release/normal-acceptance',version,'recovery-'+randomUUID());await fs.mkdir(dir,{recursive:true});process.env.OES_WORKFLOWS_ROOT=path.join(dir,'private-workflows');
const vector=JSON.parse(await fs.readFile('tests/fixtures/document-vector.json','utf8')),result=resultFromDocument(vector.request.document),input={...vector.request.validation_input,schema_version:'oes/estimate-validation-input/v1',skill_integrity:inspectSkillPackage(path.join(base,'skills/open-estimate-assessor'))};
const origin={target_hash:'a'.repeat(64),plan_hash:'b'.repeat(64)},start=await w.prepareEstimateStart({target_ref:path.join(dir,'synthetic-target'),...origin,plan_ref:'SYNTHETIC_METADATA_ONLY',ruleset_ref:result.ruleset_ref,display_currency:'USD'},services);
await w.startEstimateWorkflow({workflow_id:start.workflow_id,terms_hash:start.terms_hash,selection:{read:true,verify:true,publish:true},explicit_answer:'[合成試験] 応答損失と照会復旧を確認。実案件の同意ではない。'});await w.freezeEstimateWorkflow(start.workflow_id,result,input,origin);
const original=globalThis.fetch;let posts=0,lookups=0,unknown,done;
try{
 globalThis.fetch=async(url,options)=>{
  const u=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url);
  if(u.origin===services.result_origin&&u.pathname==='/api/results'&&options?.method==='POST'){
   posts++;const response=await original(url,options);assert.ok(response.ok);await response.arrayBuffer();return new Response('<html>synthetic response lost after commit</html>',{status:502});
  }
  if(u.origin===services.result_origin&&u.pathname.startsWith('/api/result-operations/'))lookups++;
  return original(url,options);
 };
 unknown=await w.resumeEstimateWorkflow(start.workflow_id);assert.equal(unknown.publication_status,'PUBLICATION_UNCONFIRMED');assert.equal(unknown.last_error,'WEB_RESPONSE_INVALID');
 const before=await readWorkflowFile(start.workflow_id,'state.json');done=await w.resumeEstimateWorkflow(start.workflow_id);assert.equal(done.publication_status,'PUBLISHED');assert.equal(posts,1);assert.equal(lookups,1);assert.deepEqual(done.result,unknown.result);assert.deepEqual((await readWorkflowFile(start.workflow_id,'state.json')).publish_request,before.publish_request);
}finally{globalThis.fetch=original;}
const page=await fetch(done.publication.canonical_url);assert.equal(page.status,200);await page.arrayBuffer();const pdf=await fetch(done.publication.canonical_url+'/pdf');assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
await w.withdrawEstimateWorkflow(start.workflow_id);assert.equal((await fetch(done.publication.canonical_url)).status,410);
const report={status:'PASS_PRODUCTION_UNKNOWN_RESPONSE_RECOVERY',version,created_at:new Date().toISOString(),input:'SYNTHETIC_ONLY',actual_chatgpt_full_journey:false,posts,lookups,first_status:unknown.publication_status,recovered_status:done.publication_status,same_fixed_result:true,same_operation_and_request:true,pdf:true,withdrawn:true,publication:done.publication};await fs.writeFile(path.join(dir,'REPORT.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({dir,...report}));
