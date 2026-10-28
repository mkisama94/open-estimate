import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.resolve(process.argv[2]??'');if(!root.includes(path.join('release','publication-staging')))throw Error('STAGING_DIRECTORY_REQUIRED');
const stage=JSON.parse(await fs.readFile(path.join(root,'STAGING.json'),'utf8'));if(stage.services.environment!=='test')throw Error('STAGING_ONLY');
const server=path.join(root,'marketplace/plugins/open-estimate/server'),load=p=>import(pathToFileURL(path.join(server,'dist',p)).href);
const workflow=await load('local/estimate-workflow.js'),{resultFromDocument}=await load('contracts/estimate-result.js'),{inspectSkillPackage}=await load('profiles/skill-package.js'),{readWorkflowFile}=await load('local/workflow-store.js'),{workflowAdapters}=await load('local/publication-client.js');
const run=path.join(root,'acceptance',randomUUID());await fs.mkdir(run,{recursive:true});process.env.OES_WORKFLOWS_ROOT=path.join(run,'private-workflows');
const vector=JSON.parse(await fs.readFile('tests/fixtures/document-vector.json','utf8')),result=resultFromDocument(vector.request.document),integrity=inspectSkillPackage(path.join(root,'marketplace/plugins/open-estimate/skills/open-estimate-assessor'));
const input={...vector.request.validation_input,schema_version:'oes/estimate-validation-input/v1',skill_integrity:integrity},origin={target_hash:'a'.repeat(64),plan_hash:'b'.repeat(64)},reports=[];
for(const coverage of ['COMPLETE','MISSING']){
 const value={...result,scope_coverage:coverage};
 const start=await workflow.prepareEstimateStart({target_ref:path.join(run,'synthetic-target'),...origin,plan_ref:'SYNTHETIC_METADATA_ONLY',ruleset_ref:value.ruleset_ref,display_currency:'USD'},stage.services);
 const args={workflow_id:start.workflow_id,terms_hash:start.terms_hash,selection:{read:true,verify:true,publish:true},explicit_answer:'[合成試験・実利用者の同意ではない] 開始時に全工程を選択'};
 await workflow.startEstimateWorkflow(args);await workflow.freezeEstimateWorkflow(start.workflow_id,value,input,origin);
 const view=await workflow.resumeEstimateWorkflow(start.workflow_id);assert.equal(view.proof_status,'VERIFIED',view.last_error);assert.equal(view.publication_status,'PUBLISHED',view.last_error);assert.equal(view.pdf_status,'READY');
 const repeated=await workflow.resumeEstimateWorkflow(start.workflow_id);assert.deepEqual(repeated.publication,view.publication);assert.deepEqual(repeated.proof,view.proof);
 // Exercise the real network idempotency as well as a no-op local resume.
 const recorded=await readWorkflowFile(start.workflow_id,'state.json'),adapters=workflowAdapters(stage.services);
 assert.deepEqual(await adapters.issue(recorded.proof_request),view.proof);
 assert.deepEqual(await adapters.publish(recorded.publish_request),view.publication);
 await assert.rejects(adapters.publish({...recorded.publish_request,withdrawal_token_hash:'f'.repeat(64)}),e=>e.code==='PUBLICATION_OPERATION_CONFLICT');
 const page=await fetch(view.publication.canonical_url);assert.equal(page.status,200);assert.match(await page.text(),coverage==='MISSING'?/全体工数：未算出/:/18 時間/);
 const pdf=await fetch(view.publication.canonical_url+'/pdf');assert.equal(pdf.status,200);const pdfBytes=Buffer.from(await pdf.arrayBuffer());assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');
 const name=coverage==='COMPLETE'?'complete':'partial';await fs.writeFile(path.join(run,name+'.pdf'),pdfBytes);await fs.writeFile(path.join(run,name+'.json'),JSON.stringify(view,null,2));
 const client=new Client({name:'staging-workflow-card-smoke',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(server,'dist/index.js')],cwd:root,env:{...process.env,OES_WORKFLOWS_ROOT:process.env.OES_WORKFLOWS_ROOT}}));
 try{const card=await client.callTool({name:'show_estimate_workflow',arguments:{workflow_id:start.workflow_id}});assert.notEqual(card.isError,true);const resource=await client.readResource({uri:card._meta.ui.resourceUri});assert.match(resource.contents[0].text,/ui\/open-link/);const file=await client.callTool({name:'get_estimate_workflow_pdf',arguments:{workflow_id:start.workflow_id}});assert.equal(Buffer.from(file._meta.file_base64,'base64').subarray(0,5).toString(),'%PDF-');}finally{await client.close();}
 reports.push({sample:name,workflow_id:start.workflow_id,proof_id:view.proof.statement.proof_id,publication:view.publication,remote_issue:true,remote_register:true,identical_retry:true,pdf:true,local_mcp_card_protocol:true,actual_chatgpt_card:false,browser_display:false});
}
const testStop=reports[1];await workflow.withdrawEstimateWorkflow(testStop.workflow_id);assert.equal((await fetch(testStop.publication.canonical_url)).status,410);assert.equal((await fetch(testStop.publication.canonical_url+'/pdf')).status,410);
const report={status:'PASS_STAGING_API_AND_LOCAL_PROTOCOL',version:stage.version,run,created_at:new Date().toISOString(),input:'SYNTHETIC_ONLY',actual_user_consent:false,actual_chatgpt_full_journey:false,production_modified:false,reports,withdrawal_html_pdf_410:true};
await fs.writeFile(path.join(run,'REPORT.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'ACCEPTANCE-LATEST.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
