import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

// This smoke creates synthetic public records on the approved normal service.
if(process.argv[2]!=='--production')throw Error('EXPLICIT_PRODUCTION_SMOKE_REQUIRED');
const root=path.resolve('release/local-marketplace'),plugin=path.join(root,'plugins/open-estimate'),server=path.join(plugin,'server');
const services=JSON.parse(await fs.readFile(path.join(server,'profiles/estimate-services.json'),'utf8'));
assert.equal(services.environment,'production');assert.equal(services.result_origin,'https://open-estimate.ai-orchestration.jp');
const load=p=>import(pathToFileURL(path.join(server,'dist',p)).href),workflow=await load('local/estimate-workflow.js');
const {resultFromDocument}=await load('contracts/estimate-result.js'),{inspectSkillPackage}=await load('profiles/skill-package.js');
const {readWorkflowFile}=await load('local/workflow-store.js'),{workflowAdapters}=await load('local/publication-client.js');
const version=JSON.parse(await fs.readFile(path.join(plugin,'.codex-plugin/plugin.json'),'utf8')).version;
const run=path.resolve('release/normal-acceptance',version,randomUUID());await fs.mkdir(run,{recursive:true});process.env.OES_WORKFLOWS_ROOT=path.join(run,'private-workflows');
const vector=JSON.parse(await fs.readFile('tests/fixtures/document-vector.json','utf8')),result=resultFromDocument(vector.request.document);
const input={...vector.request.validation_input,schema_version:'oes/estimate-validation-input/v1',skill_integrity:inspectSkillPackage(path.join(plugin,'skills/open-estimate-assessor'))};
const origin={target_hash:'a'.repeat(64),plan_hash:'b'.repeat(64)},reports=[];
for(const coverage of ['COMPLETE','MISSING']){
 const value={...result,scope_coverage:coverage};
 const start=await workflow.prepareEstimateStart({target_ref:path.join(run,'synthetic-target'),...origin,plan_ref:'SYNTHETIC_METADATA_ONLY',ruleset_ref:value.ruleset_ref,display_currency:'USD'},services);
 await workflow.startEstimateWorkflow({workflow_id:start.workflow_id,terms_hash:start.terms_hash,selection:{read:true,verify:true,publish:true},explicit_answer:'[合成動作試験] 読取・検証・公開を選択。実案件の利用者同意ではない。'});
 await workflow.freezeEstimateWorkflow(start.workflow_id,value,input,origin);
 const view=await workflow.resumeEstimateWorkflow(start.workflow_id);assert.equal(view.proof_status,'VERIFIED',view.last_error);assert.equal(view.publication_status,'PUBLISHED',view.last_error);assert.equal(view.pdf_status,'READY');
 assert.equal(view.proof.statement.environment,'production');
 const repeated=await workflow.resumeEstimateWorkflow(start.workflow_id);assert.deepEqual(repeated.publication,view.publication);assert.deepEqual(repeated.proof,view.proof);
 const recorded=await readWorkflowFile(start.workflow_id,'state.json'),adapters=workflowAdapters(services);
 assert.deepEqual(await adapters.issue(recorded.proof_request),view.proof);assert.deepEqual(await adapters.publish(recorded.publish_request),view.publication);
 await assert.rejects(adapters.publish({...recorded.publish_request,withdrawal_token_hash:'f'.repeat(64)}),e=>e.code==='PUBLICATION_OPERATION_CONFLICT');
 const page=await fetch(view.publication.canonical_url);assert.equal(page.status,200);assert.match(await page.text(),coverage==='MISSING'?/全体工数：未算出/:/18 時間/);
 const pdf=await fetch(view.publication.canonical_url+'/pdf');assert.equal(pdf.status,200);const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 const name=coverage==='COMPLETE'?'complete':'partial';await fs.writeFile(path.join(run,name+'.pdf'),bytes);await fs.writeFile(path.join(run,name+'.json'),JSON.stringify(view,null,2));
 const config=JSON.parse(await fs.readFile(path.join(plugin,'.mcp.json'),'utf8')).mcpServers['open-estimate-local'];
 const client=new Client({name:'normal-workflow-smoke',version:'1'});await client.connect(new StdioClientTransport({command:config.command,args:config.args,cwd:path.resolve(plugin,config.cwd),env:{...process.env}}));
 try{
  const card=await client.callTool({name:'show_estimate_workflow',arguments:{workflow_id:start.workflow_id}});assert.notEqual(card.isError,true);
  const resource=await client.readResource({uri:card._meta.ui.resourceUri});assert.match(resource.contents[0].text,/ui\/open-link/);
  const file=await client.callTool({name:'get_estimate_workflow_pdf',arguments:{workflow_id:start.workflow_id}});assert.equal(Buffer.from(file._meta.file_base64,'base64').subarray(0,5).toString(),'%PDF-');
 }finally{await client.close();}
 reports.push({sample:name,workflow_id:start.workflow_id,proof_id:view.proof.statement.proof_id,publication:view.publication,remote_issue:true,remote_register:true,identical_retry:true,pdf:true,local_mcp_card_protocol:true,actual_chatgpt_card:false,browser_display:false});
}
await workflow.withdrawEstimateWorkflow(reports[1].workflow_id);assert.equal((await fetch(reports[1].publication.canonical_url)).status,410);assert.equal((await fetch(reports[1].publication.canonical_url+'/pdf')).status,410);
const report={status:'PASS_NORMAL_API_AND_LOCAL_PROTOCOL',version,run,created_at:new Date().toISOString(),input:'SYNTHETIC_ONLY',actual_user_consent:false,actual_chatgpt_full_journey:false,production_modified:true,reports,withdrawal_html_pdf_410:true};
await fs.writeFile(path.join(run,'REPORT.json'),JSON.stringify(report,null,2));await fs.mkdir('release/normal-acceptance',{recursive:true});await fs.writeFile('release/normal-acceptance/LATEST.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
