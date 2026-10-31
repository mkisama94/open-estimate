import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../../src/mcp/server.js';
import {responseFor,setRuleReferences} from '../fixtures/measurement.js';
import {recorded} from '../fixtures/recorded.js';
import {withQuality} from '../fixtures/quality.js';
import {inspectSkillPackage} from '../../src/profiles/skill-package.js';
import {readWorkflowFile} from '../../src/local/workflow-store.js';
import {mcpState} from '../../src/mcp/state.js';
import {Ajv2020} from 'ajv/dist/2020.js';

async function connect(){const [ct,st]=InMemoryTransport.createLinkedPair(),server=createMcpServer(),client=new Client({name:'reuse-regression',version:'1'});await server.connect(st);await client.connect(ct);return {client,close:async()=>{await client.close();await server.close();}};}
async function fixture(){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'oes-reuse-')),root=path.join(base,'project');await fs.mkdir(root);await fs.copyFile('examples/quality-check/notes.js',path.join(root,'notes.js'));
 const keys=['OES_WORKFLOWS_ROOT','OES_CACHE_ROOT','OES_STATE_DIR','OES_RUNS_ROOT'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const [k,dir]of keys.map((k,i)=>[k,path.join(base,['workflows','cache','state','runs'][i])]))process.env[k]=dir;
 const connection=await connect();let current=connection;
 const call=async(name:string,args:any={})=>current.client.callTool({name,arguments:args});
 const ok=async(name:string,args:any={})=>{const r=await call(name,args);expect(r.isError,JSON.stringify(r.content)).not.toBe(true);return r.structuredContent as any;};
 await ok('discover_workspace',{context_path:root});
 const rules=responseFor(inspectSkillPackage('skills/open-estimate-assessor'));
 const start=await ok('show_estimate_start',{rules_response:rules,display_currency:'USD'});
 const args={workflow_id:start.workflow_id,terms_hash:start.terms_hash,selection:{read:true,verify:false,publish:false},explicit_answer:'[合成試験] カードで開始を選択'};
 return {base,root,start,args,call,ok,rules,listTools:()=>current.client.listTools(),restart:async()=>{await current.close();mcpState.clearSnapshots();current=await connect();},cleanup:async()=>{await current.close();for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}await fs.rm(base,{recursive:true,force:true});}};
}
it('replays the card and chat start on one workflow without candidate lookup or rewriting consent',async()=>{
 const f=await fixture();try{
  expect(f.start).toMatchObject({confirmation_mode:'card',chat_confirmation_required:false,next_action:'WAIT_FOR_START_CARD_SELECTION'});
  const again=await f.ok('show_estimate_start',{rules_response:f.rules,display_currency:'USD'});expect(again.workflow_id).toBe(f.start.workflow_id);
  const results=await Promise.all([f.ok('start_estimate_workflow',f.args),f.ok('start_estimate_workflow',{...f.args,explicit_answer:'[合成試験] 別フォームからの同じ選択'})]);
  expect(results.map(r=>r.start_reused)).toEqual([false,true]);
  const before=await readWorkflowFile<any>(f.start.workflow_id,'state.json');
  expect((await f.ok('start_estimate_workflow',f.args)).start_reused).toBe(true);
  expect((await readWorkflowFile<any>(f.start.workflow_id,'state.json')).consent).toEqual(before.consent);
  expect((await f.ok('show_estimate_start',{rules_response:f.rules,display_currency:'USD'})).status).toBe('STARTED');
  expect(await fs.readdir(path.join(f.base,'workflows'))).toEqual([f.start.workflow_id]);
  const changed=await f.call('start_estimate_workflow',{...f.args,selection:{read:true,verify:true,publish:false}});expect(changed.isError).toBe(true);expect(JSON.stringify(changed.content)).toContain('WORKFLOW_ALREADY_STARTED_NEW_APPROVAL_REQUIRED');
 }finally{await f.cleanup();}
},30000);

it('creates one snapshot for fourteen overlapping prepares and keeps inputs/read coverage during repairs',async()=>{
 const f=await fixture();try{
  await f.ok('start_estimate_workflow',f.args);
  const replies=await Promise.all(Array.from({length:14},()=>f.ok('prepare_repository'))),first=replies[0];
  expect(new Set(replies.map(r=>r.snapshot_id)).size).toBe(1);expect(replies.filter(r=>r.acquisition_performed)).toHaveLength(1);
  expect(await fs.readdir(path.join(f.base,'cache'))).toHaveLength(1);
  const read=await f.ok('read_repository_file',{snapshot_id:first.snapshot_id,file_id:'notes.js',start_line:5,max_lines:10});
  const invalid=await f.call('evaluate_assessment',{snapshot_id:first.snapshot_id,assessment:JSON.stringify({input:{...first.assessment_input,repository_label:'incorrect-source'}}),display_currency:'USD'});expect(invalid.isError).toBe(true);expect(JSON.stringify(invalid.content)).toContain('SNAPSHOT_SOURCE_IDENTITY_MISMATCH');
  const metadata=await f.ok('get_repository_snapshot',{snapshot_id:first.snapshot_id}),reused=await f.ok('prepare_repository');
  for(const r of [metadata,reused]){expect(r.acquisition_performed).toBe(false);expect(r.assessment_id).toBe(first.assessment_id);expect(r.assessment_input).toEqual(first.assessment_input);expect(r.assessor_defaults).toEqual(first.assessor_defaults);expect(r.read_coverage[0].readRanges).toEqual([{start:read.start_line,end:read.end_line}]);}
  const fresh=await f.ok('prepare_repository',{refresh_snapshot:true});expect(fresh.snapshot_id).not.toBe(first.snapshot_id);expect(fresh.acquisition_record.previous_snapshot_id).toBe(first.snapshot_id);expect(fresh.read_coverage[0].readRanges).toEqual([]);
  expect((await f.ok('get_repository_snapshot',{snapshot_id:first.snapshot_id})).read_coverage[0].readRanges).toEqual(metadata.read_coverage[0].readRanges);
 }finally{await f.cleanup();}
},30000);

it('restores consent, snapshot and read ranges after reconnect without discovery or source acquisition',async()=>{
 const f=await fixture();try{
  await f.ok('start_estimate_workflow',f.args);const first=await f.ok('prepare_repository');await f.ok('read_repository_file',{snapshot_id:first.snapshot_id,file_id:'notes.js'});
  const consent=(await readWorkflowFile<any>(f.start.workflow_id,'state.json')).consent;
  await f.restart();expect((await f.ok('start_estimate_workflow',f.args)).start_reused).toBe(true);
  const view=await f.ok('prepare_repository');expect(view.snapshot_id).toBe(first.snapshot_id);expect(view.assessment_input).toEqual(first.assessment_input);expect(view.read_coverage[0].readRanges.length).toBe(1);expect(view.acquisition_performed).toBe(false);
  expect((await readWorkflowFile<any>(f.start.workflow_id,'state.json')).consent).toEqual(consent);expect(await fs.readdir(path.join(f.base,'cache'))).toHaveLength(1);
 }finally{await f.cleanup();}
},30000);

it('does not silently reacquire an expired snapshot or bind an old consent to a different target',async()=>{
 const f=await fixture();try{
  await f.ok('start_estimate_workflow',f.args);const first=await f.ok('prepare_repository');
  const cache=mcpState.getSnapshot(first.snapshot_id)!.snapshot.cache_dir;await fs.rm(cache,{recursive:true,force:true});await f.restart();await f.ok('start_estimate_workflow',f.args);
  expect((await f.call('prepare_repository')).isError).toBe(true);expect(await fs.readdir(path.join(f.base,'cache'))).toEqual([]);
  const refreshed=await f.ok('prepare_repository',{refresh_snapshot:true});expect(refreshed.acquisition_record.previous_snapshot_id).toBe(first.snapshot_id);
  const other=path.join(f.base,'other');await fs.mkdir(other);await fs.writeFile(path.join(other,'other.js'),'export const value=1;');await f.ok('discover_workspace',{context_path:other});
  const rejected=await f.call('start_estimate_workflow',f.args);expect(rejected.isError).toBe(true);expect(JSON.stringify(rejected.content)).toContain('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
  expect((await f.call('prepare_repository')).isError).toBe(true);
 }finally{await f.cleanup();}
},30000);

it('uses one chat choice only when the explicit fallback mode is selected',async()=>{
 const f=await fixture();try{const view=await f.ok('show_estimate_start',{rules_response:f.rules,display_currency:'USD',confirmation_mode:'chat'});expect(view).toMatchObject({workflow_id:f.start.workflow_id,chat_confirmation_required:true,next_action:'ASK_ONE_CHAT_SELECTION'});}finally{await f.cleanup();}
});

it('publishes a valid workflow evaluation schema and completes the same frozen run twice without re-reading it',async()=>{
 const f=await fixture();try{
  const tools=await f.listTools(),published=tools.tools.find(t=>t.name==='evaluate_assessment')!.outputSchema!;
  await f.ok('start_estimate_workflow',f.args);
  const missing=await f.call('complete_estimate_workflow',{workflow_id:f.start.workflow_id,run_id:'11111111-1111-4111-8111-111111111111'});
  expect(JSON.stringify(missing.content)).toContain('RUN_NOT_FOUND');expect(JSON.stringify(missing.content)).not.toContain(f.base);
  expect(await f.ok('show_estimate_workflow',{workflow_id:f.start.workflow_id})).toMatchObject({last_error:'RUN_NOT_FOUND',last_error_stage:'PREPARE_RESULT',recovery_action:'CHECK_RUN_ID_AND_RETRY_COMPLETE'});
  const prep=await f.ok('prepare_repository');await f.ok('read_repository_file',{snapshot_id:prep.snapshot_id,file_id:'notes.js'});
  const a=recorded();a.assessment_id=prep.assessment_id;a.input=structuredClone(prep.assessment_input);a.assessor={...prep.assessor_defaults,finished_at:new Date().toISOString()};
  a.components[0].path_prefixes=['notes.js'];a.data_groups[0].attributes=['id','title','content'];a.functional_processes[1].movements.find((m:any)=>m.type==='Exit').data_group_id='dg-note';
  a.evidence[0]={...a.evidence[0],file_path:'notes.js',line_start:5,line_end:14};a.evidence[1]={...a.evidence[1],file_path:'notes.js',line_start:16,line_end:21};
  a.scope_record!.files=a.input.manifest.files.map(x=>({path:x.path,membership:'included',reason:'Synthetic notes implementation',confirmation_ref:'scope-confirmed',evidence_refs:[]}));setRuleReferences(a);withQuality(a);a.input.acquisition=prep.assessment_input.acquisition;
  const evaluated=await f.ok('evaluate_assessment',{snapshot_id:prep.snapshot_id,assessment:JSON.stringify(a),display_currency:'USD'});
  const schema=JSON.parse(await fs.readFile('contracts/local-preview.schema.json','utf8'));const validate=new Ajv2020({strict:false,validateFormats:false}).compile({...schema.$defs.WorkflowEvaluationView,$defs:schema.$defs});
  expect(validate(evaluated),JSON.stringify(validate.errors)).toBe(true);const publicValidate=new Ajv2020({strict:false,validateFormats:false}).compile(published);expect(publicValidate(evaluated),JSON.stringify(publicValidate.errors)).toBe(true);const noId={...evaluated};delete noId.run_id;expect(validate(noId)).toBe(false);expect(publicValidate(noId)).toBe(false);
  const args={workflow_id:f.start.workflow_id,run_id:evaluated.run_id},modelPath=path.join(evaluated.run_directory,'model.json'),modelBytes=await fs.readFile(modelPath);await fs.unlink(modelPath);
  const missingArtifact=await f.call('complete_estimate_workflow',args);expect(JSON.stringify(missingArtifact.content)).toContain('RUN_ARTIFACT_MISSING');expect(JSON.stringify(missingArtifact.content)).not.toContain(evaluated.run_directory);await fs.writeFile(modelPath,modelBytes);
  const first=await f.ok('complete_estimate_workflow',args);expect(first.last_error).toBeNull();expect(first.pdf_status).toBe('READY');
  const before=await readWorkflowFile<any>(args.workflow_id,'state.json');await fs.rm(evaluated.run_directory,{recursive:true,force:true});
  const repeated=await f.ok('complete_estimate_workflow',args);expect(repeated.result).toEqual(first.result);
  const after=await readWorkflowFile<any>(args.workflow_id,'state.json');expect(after.proof_request).toEqual(before.proof_request);expect(after.completed_run_id).toBe(evaluated.run_id);
  const changed=await f.call('complete_estimate_workflow',{...args,run_id:'22222222-2222-4222-8222-222222222222'});expect(JSON.stringify(changed.content)).toContain('WORKFLOW_RESULT_FROZEN');
  expect((await f.ok('complete_estimate_workflow',args)).last_error).toBeNull();
 }finally{await f.cleanup();}
},30000);
