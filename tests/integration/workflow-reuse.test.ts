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
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {workspaceContext} from '../../src/collector/workspace-context.js';
import {evaluateWorkflowDraft} from '../../src/local/workflow-evaluation.js';
import {pageRows} from '../../src/mcp/response-pages.js';
import {saveRun,readRun} from '../../src/local/runs.js';
import {validateSnapshotAssessment} from '../../src/mcp/tools/evaluate-assessment.js';

async function connect(){const [ct,st]=InMemoryTransport.createLinkedPair(),server=createMcpServer(),client=new Client({name:'reuse-regression',version:'1'});await server.connect(st);await client.connect(ct);return {client,close:async()=>{await client.close();await server.close();}};}
async function fixture(legacyConfirm=false,extraFiles=0,currency='USD'){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'oes-reuse-')),root=path.join(base,'project');await fs.mkdir(root);await fs.copyFile('examples/quality-check/notes.js',path.join(root,'notes.js'));
 const keys=['OES_WORKFLOWS_ROOT','OES_CACHE_ROOT','OES_STATE_DIR','OES_RUNS_ROOT'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 for(const [k,dir]of keys.map((k,i)=>[k,path.join(base,['workflows','cache','state','runs'][i])]))process.env[k]=dir;
 const connection=await connect();let current=connection;
 const call=async(name:string,args:any={})=>current.client.callTool({name,arguments:args});
 const ok=async(name:string,args:any={})=>{const r=await call(name,['prepare_repository','get_repository_snapshot','evaluate_assessment'].includes(name)?{response_format:'legacy',...args}:args);expect(r.isError,JSON.stringify(r.content)).not.toBe(true);return r.structuredContent as any;};
 if(extraFiles){await fs.mkdir(path.join(root,'src'));for(let offset=0;offset<extraFiles;offset+=100)await Promise.all(Array.from({length:Math.min(100,extraFiles-offset)},(_,i)=>fs.writeFile(path.join(root,'src',`file-${offset+i}.ts`),'export const x=1;\n')));}
 const discovery=await ok('discover_workspace',{context_path:root});if(legacyConfirm)await ok('confirm_workspace',{candidate_id:discovery.candidate_id,user_confirmed:true});
 const rules=responseFor(inspectSkillPackage('skills/open-estimate-assessor'));
 const start=await ok('show_estimate_start',{rules_response:rules,display_currency:currency});
 const args={workflow_id:start.workflow_id,terms_hash:start.terms_hash,selection:{read:true,verify:false,publish:false},explicit_answer:'[合成試験] カードで開始を選択'};
 return {base,root,start,args,call,ok,rules,listTools:()=>current.client.listTools(),restart:async()=>{await current.close();mcpState.clearSnapshots();current=await connect();},cleanup:async()=>{await current.close();for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}await fs.rm(base,{recursive:true,force:true});}};
}
it('replays the card and chat start on one workflow without candidate lookup or rewriting consent',async()=>{
 const f=await fixture();try{
  expect(f.start).toMatchObject({confirmation_mode:'card',chat_confirmation_required:false,next_action:'BEGIN_LOCAL_WORK_FROM_ESTIMATE_REQUEST'});
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

async function savedOriginal(f:Awaited<ReturnType<typeof fixture>>,freeze=true){
 const {prep,body}=await editableDraft(f),d=await f.ok('save_assessment_draft',{workflow_id:f.start.workflow_id,snapshot_id:prep.snapshot_id,assessment:JSON.stringify(body)}),run=await f.ok('evaluate_assessment_draft',{workflow_id:f.start.workflow_id,draft_id:d.draft_id});
 if(freeze)await f.ok('complete_estimate_workflow',{workflow_id:f.start.workflow_id,run_id:run.run_id});return {prep,body,d,run};
}
async function choose(f:Awaited<ReturnType<typeof fixture>>,method:string,source?:any,request=randomUUID()){
 return f.ok('select_estimate_start',{workflow_id:f.start.workflow_id,start_method:method,start_request_id:request,...(source?{source_workflow_id:f.start.workflow_id,...(method==='RECALCULATE'?{source_run_id:source.run.run_id}:{})}:{})});
}
async function startChosen(f:Awaited<ReturnType<typeof fixture>>,view:any){return f.ok('start_estimate_workflow',{workflow_id:view.workflow_id,terms_hash:view.terms_hash,selection:{read:true,verify:false,publish:false},explicit_answer:'[合成] 新しい開始方法を選択'});}
it('returns progress without requiring a start card after selecting a method',async()=>{
 const f=await fixture();try{const selected=await f.call('select_estimate_start',{workflow_id:f.start.workflow_id,start_method:'NEW',start_request_id:randomUUID()});expect((selected._meta as any)?.ui.resourceUri).toBe('ui://open-estimate/workflow-result.html');const view=selected.structuredContent as any;const started=await f.call('start_estimate_workflow',{workflow_id:view.workflow_id,terms_hash:view.terms_hash,selection:{read:true,verify:false,publish:false},explicit_answer:'[合成] 開始カードから開始'});expect(started.isError).not.toBe(true);expect((started._meta as any)?.ui.resourceUri).toBe('ui://open-estimate/workflow-result.html');
 }finally{await f.cleanup();}
});

it('rejects post-freeze edits before creating a draft/run and displays only the confirmed run',async()=>{
 const f=await fixture();try{const old=await savedOriginal(f),before=await readWorkflowFile<any>(f.start.workflow_id,'state.json');
  const rejected=await f.call('save_assessment_draft',{workflow_id:f.start.workflow_id,snapshot_id:old.prep.snapshot_id,assessment:'{}'});expect(JSON.stringify(rejected.content)).toContain('SELECT_RECALCULATE_TO_CREATE_NEW_WORKFLOW');
  expect((await f.ok('evaluate_assessment_draft',{workflow_id:f.start.workflow_id,draft_id:old.d.draft_id})).run_id).toBe(old.run.run_id);
  const view=await f.ok('show_estimate_workflow',{workflow_id:f.start.workflow_id});expect(view.analysis.status).toBe('RESULT_FROZEN');expect(view.confirmed_run_id).toBe(old.run.run_id);expect(await fs.readdir(path.join(f.base,'runs'))).toEqual([old.run.run_id]);expect(await readWorkflowFile(f.start.workflow_id,'state.json')).toEqual(before);
 }finally{await f.cleanup();}
},30000);

it('starts recalculation on a new workflow, reuses verified unchanged bytes, and revalidates inherited evidence',async()=>{
 const f=await fixture();try{const old=await savedOriginal(f),before=await readWorkflowFile<any>(f.start.workflow_id,'state.json');
  const history=await f.ok('get_project_estimates');expect(history.items[0].value).toMatchObject({workflow_id:f.start.workflow_id,run_id:old.run.run_id,cfp:6,can_resume:false});
  const request=randomUUID(),next=await choose(f,'RECALCULATE',old,request);expect(next.workflow_id).not.toBe(f.start.workflow_id);expect((await choose(f,'RECALCULATE',old,request)).workflow_id).toBe(next.workflow_id);expect(next.initial_selection).toEqual({read:false,verify:false,publish:false});expect(next.lineage.source_run_id).toBe(old.run.run_id);
  expect((await f.call('get_recalculation_input_page',{workflow_id:next.workflow_id,section:'evidence'})).isError).toBe(true);await startChosen(f,next);
  const prepares=Array.from({length:14},()=>f.ok('prepare_repository')),snapshot=await prepares[0];const all=await Promise.all(prepares);expect(new Set(all.map(r=>r.assessment_id)).size).toBe(1);expect(all.every(r=>!r.acquisition_performed)).toBe(true);expect(snapshot.snapshot_id,JSON.stringify(await readWorkflowFile(next.workflow_id,"source-comparison.json"))).toBe(old.prep.snapshot_id);expect(snapshot.acquisition_performed).toBe(false);expect(snapshot.read_coverage[0].readRanges).toEqual([]);expect(await fs.readdir(path.join(f.base,'cache'))).toHaveLength(1);
  const inherited=await f.ok('get_recalculation_input_page',{workflow_id:next.workflow_id,section:'judgments'});expect(inherited.evidence_revalidation_required).toBe(true);expect(inherited.total_records).toBeGreaterThan(0);old.body.assessor.finished_at=new Date().toISOString();
  const d=await f.ok('save_assessment_draft',{workflow_id:next.workflow_id,snapshot_id:snapshot.snapshot_id,assessment:JSON.stringify(old.body)}),invalid=await f.ok('evaluate_assessment_draft',{workflow_id:next.workflow_id,draft_id:d.draft_id});expect(invalid.status).toBe('VALIDATION_FAILED');expect(JSON.stringify(invalid.validation)).toContain('UNREAD_EVIDENCE_SOURCE');expect(invalid.run_id).toBeNull();
  await f.ok('read_repository_file',{snapshot_id:snapshot.snapshot_id,file_id:'notes.js'});const corrected=await f.ok('save_assessment_draft',{workflow_id:next.workflow_id,snapshot_id:snapshot.snapshot_id,assessment:JSON.stringify(old.body)});const evaluated=await f.ok('evaluate_assessment_draft',{workflow_id:next.workflow_id,draft_id:corrected.draft_id});expect(evaluated.status,JSON.stringify(evaluated.validation)).toBe('RUN_SAVED');expect(evaluated.run_id).not.toBe(old.run.run_id);
  const finished=await f.ok('complete_estimate_workflow',{workflow_id:next.workflow_id,run_id:evaluated.run_id});expect(finished.confirmed_run_id).toBe(evaluated.run_id);expect(finished.proof).toBeNull();expect(finished.publication).toBeNull();expect(await readWorkflowFile(f.start.workflow_id,'state.json')).toEqual(before);
 }finally{await f.cleanup();}
},30000);

it('reacquires changed sources and does not accept the old evidence as read',async()=>{
 const f=await fixture();try{const old=await savedOriginal(f);await fs.appendFile(path.join(f.root,'notes.js'),'\n// changed\n');const next=await choose(f,'RECALCULATE',old);await startChosen(f,next);const snapshot=await f.ok('prepare_repository');expect(snapshot.snapshot_id).not.toBe(old.prep.snapshot_id);expect(snapshot.acquisition_performed).toBe(true);expect(snapshot.read_coverage[0].readRanges).toEqual([]);expect(snapshot.assessment_input.manifest.files[0].sha256).not.toBe(old.prep.assessment_input.manifest.files[0].sha256);
 }finally{await f.cleanup();}
},30000);

it('creates an independent NEW estimate without inherited inputs or approval, retaining the old result',async()=>{
 const f=await fixture();try{const old=await savedOriginal(f),before=await readWorkflowFile(f.start.workflow_id,'state.json'),next=await choose(f,'NEW');expect(next.lineage.source_run_id).toBeUndefined();await startChosen(f,next);const snapshot=await f.ok('prepare_repository');expect(snapshot.snapshot_id).not.toBe(old.prep.snapshot_id);expect((await f.call('get_recalculation_input_page',{workflow_id:next.workflow_id,section:'sections'})).isError).toBe(true);expect(await readWorkflowFile(f.start.workflow_id,'state.json')).toEqual(before);
 }finally{await f.cleanup();}
},30000);

it('resumes the same unfinished workflow after reconnect without source acquisition or new consent',async()=>{
 const f=await fixture();try{const old=await savedOriginal(f,false),before=await readWorkflowFile<any>(f.start.workflow_id,'state.json');await f.restart();await f.ok('discover_workspace',{context_path:f.root});const resumed=await choose(f,'RESUME',old);expect(resumed.workflow_id).toBe(f.start.workflow_id);expect((await f.ok('prepare_repository')).snapshot_id).toBe(old.prep.snapshot_id);expect((await readWorkflowFile<any>(f.start.workflow_id,'state.json')).consent).toEqual(before.consent);expect((await f.ok('get_workflow_evaluation',{workflow_id:f.start.workflow_id})).run_id).toBe(old.run.run_id);expect(await fs.readdir(path.join(f.base,'runs'))).toHaveLength(1);
 }finally{await f.cleanup();}
},30000);

it('rejects invalid source combinations and does not silently transfer another project',async()=>{
 const f=await fixture();try{const old=await savedOriginal(f);const invalid=await f.call('select_estimate_start',{workflow_id:f.start.workflow_id,start_method:'NEW',start_request_id:randomUUID(),source_workflow_id:f.start.workflow_id});expect(JSON.stringify(invalid.content)).toContain('START_SOURCE_COMBINATION_INVALID');
  const other=path.join(f.base,'other');await fs.mkdir(other);await fs.writeFile(path.join(other,'a.js'),'x');await f.ok('discover_workspace',{context_path:other});const wrong=await f.call('show_estimate_start',{rules_response:f.rules,start_method:'RECALCULATE',start_request_id:randomUUID(),source_workflow_id:f.start.workflow_id,source_run_id:old.run.run_id});expect(JSON.stringify(wrong.content)).toContain('START_SOURCE_TARGET_MISMATCH');
 }finally{await f.cleanup();}
},30000);
it('reacquires when the reusable cache fails integrity even though current source metadata is unchanged',async()=>{
 const f=await fixture();try{const old=await savedOriginal(f),cache=mcpState.getSnapshot(old.prep.snapshot_id)!.snapshot.cache_dir;await fs.writeFile(path.join(cache,'files','notes.js'),'corrupt');const next=await choose(f,'RECALCULATE',old);await startChosen(f,next);const snapshot=await f.ok('prepare_repository');expect(snapshot.snapshot_id).not.toBe(old.prep.snapshot_id);expect(snapshot.acquisition_performed).toBe(true);expect(await readWorkflowFile(next.workflow_id,'source-comparison.json')).toMatchObject({status:'REACQUIRE_REQUIRED',reason:'SOURCE_CONTENT_CHANGED'});
 }finally{await f.cleanup();}
},30000);
it('does not mix an old frozen result with a newer draft left by a previous version',async()=>{
 const f=await fixture();try{const old=await savedOriginal(f,false),newer=await f.ok('save_assessment_draft',{workflow_id:f.start.workflow_id,snapshot_id:old.prep.snapshot_id,assessment:'{}'});expect(newer.draft_id).not.toBe(old.d.draft_id);await f.ok('complete_estimate_workflow',{workflow_id:f.start.workflow_id,run_id:old.run.run_id});const view=await f.ok('show_estimate_workflow',{workflow_id:f.start.workflow_id});expect(view.analysis.run_id).toBe(old.run.run_id);expect(view.analysis.status).toBe('RESULT_FROZEN');expect(JSON.stringify((await f.call('evaluate_assessment_draft',{workflow_id:f.start.workflow_id,draft_id:newer.draft_id})).content)).toContain('WORKFLOW_RECALCULATION_REQUIRED');expect((await f.ok('get_workflow_evaluation',{workflow_id:f.start.workflow_id})).run_id).toBe(old.run.run_id);
 }finally{await f.cleanup();}
},30000);
it('keeps a recalculated partial estimate uncalculated for the whole project while another measured file remains unread',async()=>{
 const f=await fixture(false,1);try{const old=await savedOriginal(f);const original=await f.ok('show_estimate_workflow',{workflow_id:f.start.workflow_id});expect(original.presentation.median).toBeNull();const next=await choose(f,'RECALCULATE',old);await startChosen(f,next);const snapshot=await f.ok('prepare_repository');await f.ok('read_repository_file',{snapshot_id:snapshot.snapshot_id,file_id:'notes.js'});old.body.assessor.finished_at=new Date().toISOString();const d=await f.ok('save_assessment_draft',{workflow_id:next.workflow_id,snapshot_id:snapshot.snapshot_id,assessment:JSON.stringify(old.body)}),evaluated=await f.ok('evaluate_assessment_draft',{workflow_id:next.workflow_id,draft_id:d.draft_id});expect(evaluated.status,JSON.stringify(evaluated.validation)).toBe('RUN_SAVED');expect(evaluated.coverage.project_effort).toBeNull();const done=await f.ok('complete_estimate_workflow',{workflow_id:next.workflow_id,run_id:evaluated.run_id});expect(done.presentation.median).toBeNull();expect(done.selected_stages_complete).toBe(true);expect(done.source_summary.ruleset_ref).toBeDefined();expect(done.source_summary.basis).toBeDefined();
 }finally{await f.cleanup();}
},30000);

it('creates one snapshot for fourteen overlapping prepares and keeps inputs/read coverage during repairs',async()=>{
 const f=await fixture();try{
  await f.ok('start_estimate_workflow',f.args);
  const replies=await Promise.all(Array.from({length:14},()=>f.ok('prepare_repository'))),first=replies[0];
  expect(new Set(replies.map(r=>r.snapshot_id)).size).toBe(1);expect(replies.filter(r=>r.acquisition_performed)).toHaveLength(1);
  expect(await fs.readdir(path.join(f.base,'cache'))).toHaveLength(1);
  const read=await f.ok('read_repository_file',{snapshot_id:first.snapshot_id,file_id:'notes.js',start_line:5,max_lines:10});
  const invalid=await f.call('evaluate_assessment',{snapshot_id:first.snapshot_id,assessment:JSON.stringify({input:{...first.assessment_input,repository_label:'incorrect-source'}}),display_currency:'USD'});expect(invalid.structuredContent?.status).toBe('VALIDATION_FAILED');expect(JSON.stringify(invalid.content)).toContain('SNAPSHOT_SOURCE_IDENTITY_MISMATCH');
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

it('does not require a chat confirmation when cards are unavailable',async()=>{
 const f=await fixture();try{const view=await f.ok('show_estimate_start',{rules_response:f.rules,display_currency:'USD',confirmation_mode:'chat'});expect(view).toMatchObject({workflow_id:f.start.workflow_id,chat_confirmation_required:false,next_action:'BEGIN_LOCAL_WORK_FROM_ESTIMATE_REQUEST'});}finally{await f.cleanup();}
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

async function editableDraft(f:Awaited<ReturnType<typeof fixture>>){
 if(!(await readWorkflowFile<any>(f.start.workflow_id,'state.json')).local_work)await f.ok('start_estimate_workflow',f.args);const prep=await f.ok('prepare_repository');await f.ok('read_repository_file',{snapshot_id:prep.snapshot_id,file_id:'notes.js'});
 const a=recorded();a.input=structuredClone(prep.assessment_input);a.assessment_id=prep.assessment_id;a.assessor={...prep.assessor_defaults,finished_at:new Date().toISOString()};a.components[0].path_prefixes=['notes.js'];a.data_groups[0].attributes=['id','title','content'];a.functional_processes[1].movements.find(m=>m.type==='Exit')!.data_group_id='dg-note';
 a.evidence[0]={...a.evidence[0],file_path:'notes.js',line_start:5,line_end:14};a.evidence[1]={...a.evidence[1],file_path:'notes.js',line_start:16,line_end:21};a.scope_record!.files=a.input.manifest.files.map(x=>({path:x.path,membership:'included',reason:'Synthetic notes',confirmation_ref:'scope-confirmed',evidence_refs:[]}));setRuleReferences(a);withQuality(a);
 const body:any=structuredClone(a);delete body.input;delete body.assessment_id;body.assessor={finished_at:a.assessor.finished_at};return {prep,body};
}
it('declares request-based local work and preserves a prior legacy confirmation',async()=>{
 const f=await fixture(true);try{const c=await f.ok('get_assessor_contract');expect(c).toMatchObject({workspace_selection:'estimate_request_then_local_work',requires_workspace_confirmation:false});const repeated=await f.ok('show_estimate_start',{rules_response:f.rules,display_currency:'USD'});expect(repeated.workflow_id).toBe(f.start.workflow_id);expect((await f.ok('start_estimate_workflow',f.args)).start_reused).toBe(false);expect((await f.ok('start_estimate_workflow',f.args)).start_reused).toBe(true);}finally{await f.cleanup();}
});
it('keeps large snapshot responses and every detail page within 64 KiB without missing files',async()=>{
 const f=await fixture(false,1200);try{
  await f.ok('start_estimate_workflow',f.args);const result=await f.call('prepare_repository');expect(result.isError).not.toBe(true);expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(65536);const s:any=result.structuredContent;expect(s.response_format).toBe('oes/snapshot-summary/v2');expect(s.manifest).toBeUndefined();expect(s.assessment_input).toBeUndefined();expect(s.summary.total_files).toBe(1201);
  const paths:string[]=[];let cursor:string|undefined;do{const response=await f.call('get_repository_snapshot_page',{snapshot_id:s.snapshot_id,section:'manifest',cursor,limit:100});expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(65536);const page:any=response.structuredContent;paths.push(...page.items.map((x:any)=>x.value.path));cursor=page.next_cursor??undefined;}while(cursor);
  expect(paths.length).toBe(1201);expect(new Set(paths).size).toBe(1201);expect(paths).toContain('notes.js');const again=await f.call('prepare_repository');expect(again.structuredContent?.snapshot_id).toBe(s.snapshot_id);expect(again.structuredContent?.acquisition_performed).toBe(false);expect(await fs.readdir(path.join(f.base,'cache'))).toHaveLength(1);
  const fragments:Buffer[]=[];const row={long:'日本語'.repeat(15000)};cursor=undefined;do{const page=pageRows([row],'record',cursor,10,'same');expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(65536);for(const item of page.items)fragments.push(Buffer.from(item.data,'base64'));cursor=page.next_cursor??undefined;}while(cursor);expect(JSON.parse(Buffer.concat(fragments).toString())).toEqual(row);
 }finally{await f.cleanup();}
},60000);
it('persists failed validation and corrected input revisions, and returns one saved run after reconnect or response loss',async()=>{
 const f=await fixture();try{
  const {prep,body}=await editableDraft(f),base={workflow_id:f.start.workflow_id,snapshot_id:prep.snapshot_id};const bad=await f.ok('save_assessment_draft',{...base,assessment:'{}'});const failed=await f.ok('evaluate_assessment_draft',{workflow_id:f.start.workflow_id,draft_id:bad.draft_id});expect(failed.status).toBe('VALIDATION_FAILED');expect(failed.run_id).toBeNull();expect(failed.validation.total_errors).toBeGreaterThan(0);
  const errors=await f.ok('get_assessment_draft_page',{workflow_id:f.start.workflow_id,draft_id:bad.draft_id,section:'validation'});expect(errors.total_records).toBe(failed.validation.total_errors);
  const saved=await f.ok('save_assessment_draft',{...base,assessment:JSON.stringify(body)});expect(saved.input_version).toBe(2);expect((await f.ok('save_assessment_draft',{...base,assessment:JSON.stringify(body)})).draft_id).toBe(saved.draft_id);
  const run=await f.ok('evaluate_assessment_draft',{workflow_id:f.start.workflow_id,draft_id:saved.draft_id});expect(run.status).toBe('RUN_SAVED');expect(run.run_id).toBeTruthy();expect(run.signed).toBe(false);expect(run.published).toBe(false);
  await f.restart();const state=await f.ok('show_estimate_workflow',{workflow_id:f.start.workflow_id});expect(state.analysis.run_id).toBe(run.run_id);expect(state.analysis_context_restored).toBe(true);const recovered=await f.ok('get_workflow_evaluation',{workflow_id:f.start.workflow_id});expect(recovered.run_id).toBe(run.run_id);expect((await f.ok('evaluate_assessment_draft',{workflow_id:f.start.workflow_id,draft_id:saved.draft_id})).run_id).toBe(run.run_id);expect(await fs.readdir(path.join(f.base,'runs'))).toEqual([run.run_id]);
  expect((await f.ok('complete_estimate_workflow',{workflow_id:f.start.workflow_id,run_id:run.run_id})).selected_stages_complete).toBe(true);
 }finally{await f.cleanup();}
},30000);
for(const mode of ['complete','incomplete'])it('recovers a process killed after '+mode+' run save without treating incomplete artifacts as success',async()=>{
 const f=await fixture();let child:ReturnType<typeof fork>|undefined;try{
  const {prep,body}=await editableDraft(f);const saved=await f.ok('save_assessment_draft',{workflow_id:f.start.workflow_id,snapshot_id:prep.snapshot_id,assessment:JSON.stringify(body)});
  child=fork(fileURLToPath(new URL('../fixtures/evaluation-crash-child.mjs',import.meta.url)),[],{env:{...process.env},stdio:['ignore','ignore','pipe','ipc']});const message=once(child,'message');child.send({workflow_id:f.start.workflow_id,draft_id:saved.draft_id,root:f.root,rules:f.rules,mode});const first:any=(await message)[0];expect(first.error).toBeUndefined();expect(first.phase).toBe(mode==='complete'?'RUN_COMPLETE':'RUN_INCOMPLETE');const exit=once(child,'exit');child.kill('SIGKILL');await exit;
  if(mode==='complete'){const found=await f.ok('get_workflow_evaluation',{workflow_id:f.start.workflow_id});expect(found.status).toBe('RUN_SAVED');expect(found.run_id).toBe(first.run_id);expect(await fs.readdir(path.join(f.base,'runs'))).toEqual([first.run_id]);}
  else{const interrupted=await f.ok('evaluate_assessment_draft',{workflow_id:f.start.workflow_id,draft_id:saved.draft_id});expect(interrupted.status).toBe('SAVE_INTERRUPTED');expect(interrupted.run_id).toBeNull();const repaired=await f.ok('evaluate_assessment_draft',{workflow_id:f.start.workflow_id,draft_id:saved.draft_id});expect(repaired.status).toBe('RUN_SAVED');expect(repaired.run_id).not.toBe(first.run_id);await expect(fs.stat(path.join(f.base,'runs',first.run_id,'COMPLETE.json'))).rejects.toMatchObject({code:'ENOENT'});expect((await f.ok('get_assessment_draft_page',{workflow_id:f.start.workflow_id,draft_id:saved.draft_id,section:'attempts'})).total_records).toBe(2);}
 }finally{if(child&&!child.killed)child.kill('SIGKILL');await f.cleanup();}
},30000);
it('returns saved run identifiers even when FX display fails, then retries only the display stage',async()=>{
 const f=await fixture(false,0,'JPY');try{const {prep,body}=await editableDraft(f);const saved=await f.ok('save_assessment_draft',{workflow_id:f.start.workflow_id,snapshot_id:prep.snapshot_id,assessment:JSON.stringify(body)});
  const args={workflow_id:f.start.workflow_id,draft_id:saved.draft_id};const failed:any=await workspaceContext.run(f.root,()=>evaluateWorkflowDraft(args,f.rules,{provider:{get:async()=>{throw Error('SYNTHETIC_FX_FAILURE');}}}));expect(failed.status).toBe('RUN_SAVED_DISPLAY_PENDING');expect(failed.run_id).toBeTruthy();expect((await f.ok('get_workflow_evaluation',{workflow_id:f.start.workflow_id})).run_id).toBe(failed.run_id);
  const done:any=await workspaceContext.run(f.root,()=>evaluateWorkflowDraft(args,f.rules,{provider:{get:async()=>({status:'FX_UNAVAILABLE',snapshot:null,limitation_codes:['FX_UNAVAILABLE']})}}));expect(done.run_id).toBe(failed.run_id);expect(done.status).toBe('RUN_SAVED');expect(await fs.readdir(path.join(f.base,'runs'))).toEqual([failed.run_id]);
 }finally{await f.cleanup();}
},30000);

it('recovers only an explicitly verified legacy run and preserves changed-acquisition blockers',async()=>{
 const f=await fixture();try{
  const {prep,body}=await editableDraft(f);const e=mcpState.getSnapshot(prep.snapshot_id)!;
  const raw={...body,assessment_id:prep.assessment_id,input:prep.assessment_input,assessor:{...prep.assessor_defaults,...body.assessor}};
  const {validated}=await workspaceContext.run(f.root,()=>validateSnapshotAssessment({snapshot_id:prep.snapshot_id,assessment:JSON.stringify(raw)}));
  const acquisition=structuredClone(e.snapshot.acquisition_record) as any;acquisition.postflight_fingerprint='f'.repeat(64);
  const saved=await saveRun(validated,raw,{ruleset_ref:f.rules.ruleset_ref,bundle:f.rules.bundle},f.root,acquisition);
  const run=await readRun(saved.run_id);expect((await f.ok('get_workflow_evaluation',{workflow_id:f.start.workflow_id})).run_id).toBeNull();
  const recovered=await f.ok('recover_saved_workflow_run',{workflow_id:f.start.workflow_id,run_id:saved.run_id});expect(recovered).toMatchObject({status:'RUN_SAVED_COMPLETION_BLOCKED',run_id:saved.run_id,last_error:'WORKFLOW_ACQUISITION_CHANGED'});
  expect((await f.ok('show_estimate_workflow',{workflow_id:f.start.workflow_id})).analysis_stage_label).toContain('取得整合性');
  expect(JSON.stringify((await f.call('complete_estimate_workflow',{workflow_id:f.start.workflow_id,run_id:saved.run_id})).content)).toContain('WORKFLOW_ACQUISITION_CHANGED');
  expect((await readWorkflowFile<any>(f.start.workflow_id,'state.json')).result).toBeUndefined();expect((await readRun(saved.run_id)).checksums_hash).toBe(run.checksums_hash);
  const other=structuredClone(acquisition);other.snapshot_id='11111111-1111-4111-8111-111111111111';const foreign=await saveRun(validated,raw,{ruleset_ref:f.rules.ruleset_ref,bundle:f.rules.bundle},f.root,other);expect(JSON.stringify((await f.call('recover_saved_workflow_run',{workflow_id:f.start.workflow_id,run_id:foreign.run_id})).content)).toContain('RUN_WORKFLOW_BINDING_MISMATCH');
 }finally{await f.cleanup();}
},30000);

it('LUX01/02/07/08/11 starts from the actual request without read consent, saves a real run and PDF, and restores local-only work',async()=>{
 const f=await fixture();try{
 const missing=await f.call('begin_estimate_workflow',{workflow_id:f.start.workflow_id,local_request:''});expect(missing.isError).toBe(true);
 await f.ok('begin_estimate_workflow',{workflow_id:f.start.workflow_id,local_request:'このプロジェクトを新規に見積もりPDFを作って'});
 const state=await readWorkflowFile<any>(f.start.workflow_id,'state.json');expect(state.consent).toBeNull();expect(state.local_work.request).toContain('新規に見積もり');expect(JSON.stringify(state.local_work)).not.toContain('explicit_answer');
 const old=await savedOriginal(f),view=await f.ok('show_estimate_workflow',{workflow_id:f.start.workflow_id});
 expect(view.pdf_status).toBe('READY');expect(view.selected_stages_complete).toBe(true);expect(view.proof).toBeNull();expect(view.publication).toBeNull();expect(view.confirmed_run_id).toBe(old.run.run_id);
 await f.restart();const restored=await f.ok('show_estimate_workflow',{workflow_id:f.start.workflow_id});expect(restored.local_work_started).toBe(true);expect(restored.confirmed_run_id).toBe(old.run.run_id);
 const pdf=await f.call('get_estimate_workflow_pdf',{workflow_id:f.start.workflow_id});expect(Buffer.from((pdf._meta as any).file_base64,'base64').subarray(0,5).toString()).toBe('%PDF-');
 }finally{await f.cleanup();}
},30000);
it('LUX03 external cancellation does not prevent source acquisition or local evaluation',async()=>{
 const f=await fixture();try{
 await f.ok('begin_estimate_workflow',{workflow_id:f.start.workflow_id,local_request:'この対象を見積もって'});
 await f.ok('cancel_estimate_transmission',{workflow_id:f.start.workflow_id});
 const old=await savedOriginal(f),view=await f.ok('show_estimate_workflow',{workflow_id:f.start.workflow_id});
 expect(view.status).toBe('RESULT_READY');expect(view.external_cancelled).toBe(true);expect(view.result).not.toBeNull();expect(view.pdf_status).toBe('READY');expect(view.confirmed_run_id).toBe(old.run.run_id);
 }finally{await f.cleanup();}
},30000);
