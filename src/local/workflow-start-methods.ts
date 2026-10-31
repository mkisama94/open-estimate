import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {jcsSha256,sha256Hex} from '../core/canonical.js';
import {privateDirectory} from '../local-files.js';
import {resolveSafePath} from '../collector/safe-paths.js';
import {planAcquisition,type ScopeRule} from '../collector/acquisition-plan.js';
import {workflowsRoot,readWorkflowFile,writeWorkflowFile,withWorkflowLock,isWorkflowCancelled} from './workflow-store.js';
import {withProcessLock} from './workflow-lock.js';
import {readWorkflowData,writeWorkflowData} from './workflow-data.js';
import {prepareEstimateStart,showEstimateStart,showEstimateWorkflow,approvedWorkflow,type WorkflowState} from './estimate-workflow.js';
import {peekWorkflowEvaluation} from './workflow-evaluation.js';
import {readRun} from './runs.js';
import {restoreWorkflowSnapshot,saveWorkflowSnapshot} from '../mcp/workflow-snapshot.js';
import {mcpState} from '../mcp/state.js';
import {pageRows} from '../mcp/response-pages.js';
import {estimateView} from '../document/estimate-view.js';
import type {BoundRules} from './measurement-context.js';
import type {WorkspaceBinding} from '../mcp/workspace-session.js';
import {handleGetAssessorContract} from '../mcp/tools/get-assessor-contract.js';

export interface StartChoice {method:'NEW'|'RECALCULATE'|'RESUME';request_id:string;source_workflow_id?:string;source_run_id?:string}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const startLabels={NEW:'過去の評価を使わず、新規に見積',RECALCULATE:'過去の見積を引き継いで再計算',RESUME:'中断した処理を再開'};
export function fixedEvaluation(s:WorkflowState){return {status:'RESULT_FROZEN',workflow_id:s.workflow_id,run_id:s.completed_run_id??null,validation_passed:true,next_action:'RESUME_SELECTED_STAGES',result:s.result};}
export async function assertEvaluationEditable(id:string){const s=await readWorkflowFile<WorkflowState>(id,'state.json');if(s.result)throw Error('WORKFLOW_RECALCULATION_REQUIRED');return s;}
export async function listProjectEstimates(root:string){
 await privateDirectory(workflowsRoot());const rows:any[]=[];
 for(const entry of await fs.readdir(workflowsRoot(),{withFileTypes:true})){
  if(!entry.isDirectory()||entry.isSymbolicLink()||!uuid.test(entry.name))continue;
  try{const s=await readWorkflowFile<WorkflowState>(entry.name,'state.json');if(s.target_ref!==root||!s.consent)continue;
   const context=await readWorkflowData<any>(entry.name,'mcp-context.json').catch(()=>null),analysis=s.result?fixedEvaluation(s):await peekWorkflowEvaluation(entry.name);
   const cancelled=await isWorkflowCancelled(entry.name),complete=!!s.result&&s.pdf_status==='READY'&&(!s.consent.selection.verify||s.proof_status==='VERIFIED')&&(!s.consent.selection.publish||s.publication_status==='PUBLISHED');
   const run_id=s.completed_run_id??analysis.run_id??null,run=run_id&&!s.result?await readRun(run_id).catch(()=>null):null;
   const presentation=s.result?estimateView(s.result):null,summary=run?.summary;
   rows.push({workflow_id:entry.name,run_id,estimated_at:s.created_at??s.consent.confirmed_at,target:root,ruleset_ref:s.terms.ruleset_ref,calculation_policy:s.terms.calculation_policy,basis:s.result?.result.calculation.basis??summary?.calculation?.basis??null,scope:context?.binding?.plan?.scope?.slice(0,10).map((r:any)=>({...r,path:r.path.length>128?r.path.slice(0,128)+'…':r.path}))??null,scope_display_truncated:!!context?.binding?.plan?.scope?.some((r:any)=>r.path.length>128)||context?.binding?.plan?.scope?.length>10,scope_rule_count:context?.binding?.plan?.scope?.length??null,scope_known:!!context,scope_coverage:s.result?.scope_coverage??summary?.coverage?.scope_coverage??'UNKNOWN',cfp:s.result?.result.measurement?.cfp??summary?.measurement?.cfp??null,project_effort:presentation?presentation.median===null?null:s.result!.result.calculation.effort.person_hours:summary?.coverage?.project_effort??null,acquired_portion_effort:s.result?.result.calculation.effort.person_hours??summary?.coverage?.acquired_portion_effort??null,evaluation_status:analysis.status,proof_status:s.proof_status,publication_status:s.publication_status,can_recalculate:!!run_id&&!!context,can_resume:!cancelled&&!complete&&!['WITHDRAWN','EXPIRED'].includes(s.publication_status),resume_disabled_reason:cancelled?'取消済み':complete?'選択した工程は完了済み':['WITHDRAWN','EXPIRED'].includes(s.publication_status)?'公開終了済み':null,start_method:s.terms.start?.method??null});
  }catch{/* A damaged record is never offered as a selectable source. */}
 }
 return rows.sort((a,b)=>b.estimated_at.localeCompare(a.estimated_at)||a.workflow_id.localeCompare(b.workflow_id));
}
export async function startHistoryPage(args:{root:string;workflow_id?:string;cursor?:string;limit?:number}){if(args.workflow_id){const state=await readWorkflowFile<WorkflowState>(args.workflow_id,'state.json');if(state.target_ref!==args.root)throw Error('START_SOURCE_TARGET_MISMATCH');const c=await readWorkflowData<any>(args.workflow_id,'mcp-context.json');return pageRows(c.binding.plan.scope,'past-scope',args.cursor,args.limit,args.workflow_id);}return pageRows(await listProjectEstimates(args.root),'past-estimates',args.cursor,args.limit,args.root);}
export async function decorateStart(view:any,root:string){const rows=await listProjectEstimates(root);return {...view,start_method:view.terms?.start?.method??null,lineage:view.terms?.start??null,start_method_label:view.terms?.start?startLabels[view.terms.start.method as 'NEW'|'RECALCULATE']:null,start_history:pageRows(rows,'past-estimates',undefined,5,root),start_methods:[{method:'NEW',label:startLabels.NEW,enabled:true},{method:'RECALCULATE',label:startLabels.RECALCULATE,enabled:rows.some(r=>r.can_recalculate),reason:'参照できる保存済み評価が必要です。'},{method:'RESUME',label:startLabels.RESUME,enabled:rows.some(r=>r.can_resume),reason:'未完了で有効な承認のある処理が必要です。'}]};}

/** Each intentional start has an explicit request UUID; retries reserve the same ID. */
export async function prepareStartChoice(binding:WorkspaceBinding,rules:BoundRules,currency:string,choice:StartChoice){
 if(!uuid.test(choice.request_id)||!['NEW','RECALCULATE','RESUME'].includes(choice.method))throw Error('START_METHOD_INVALID');
 if(choice.method==='NEW'&&(choice.source_workflow_id||choice.source_run_id)||choice.method==='RESUME'&&(!choice.source_workflow_id||choice.source_run_id)||choice.method==='RECALCULATE'&&(!choice.source_workflow_id||!choice.source_run_id))throw Error('START_SOURCE_COMBINATION_INVALID');
 let source:WorkflowState|undefined,sourceRun:Awaited<ReturnType<typeof readRun>>|undefined;
 let next=structuredClone(binding);
 if(choice.source_workflow_id){
  source=await readWorkflowFile<WorkflowState>(choice.source_workflow_id,'state.json');if(source.target_ref!==binding.root||source.terms.target_hash!==jcsSha256(binding.root))throw Error('START_SOURCE_TARGET_MISMATCH');
  if(choice.method==='RESUME'){
   const listed=(await listProjectEstimates(binding.root)).find(r=>r.workflow_id===choice.source_workflow_id);if(!listed?.can_resume)throw Error('WORKFLOW_NOT_RESUMABLE');
   const old=await readWorkflowData<any>(source.workflow_id,'mcp-context.json');await approvedWorkflow(source.workflow_id,{target_hash:jcsSha256(binding.root),plan_hash:old.binding.plan.fingerprint});
   return {view:await showEstimateWorkflow(source.workflow_id),binding:old.binding,rules:old.rules,resume:true};
  }
  const known=source.completed_run_id??(await peekWorkflowEvaluation(source.workflow_id)).run_id;
  if(known!==choice.source_run_id)throw Error('START_SOURCE_RUN_MISMATCH');
  sourceRun=await readRun(choice.source_run_id!);const a:any=sourceRun.metadata.acquisition_record;
  if(sourceRun.metadata.target.root!==binding.root||!a?.scope)throw Error('START_SOURCE_TARGET_MISMATCH');
  const adjustments:string[]=await readWorkflowFile<string[]>(source.workflow_id,'acquisition-adjustments.json').catch((e:any):string[]=>{if(e.code==='ENOENT')return [];throw e;});
  if(!source.consent||source.terms.plan_hash!==a.preflight.fingerprint&&!adjustments.includes(a.preflight.fingerprint))throw Error('START_SOURCE_RUN_MISMATCH');
  next.plan=await planAcquisition(binding.root,a.scope);
 }else next.plan=await planAcquisition(binding.root,binding.plan.scope);
 const claim={choice,target:next.root,scope:next.plan.scope,ruleset:rules.ruleset_ref,currency},digest=jcsSha256({domain:'oes/start-request/v1',root:next.root,request:choice.request_id});
 const id=digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+digest.slice(13,16)+'-a'+digest.slice(17,20)+'-'+digest.slice(20,32);
 const locks=path.join(path.dirname(workflowsRoot()),'.oes-start-requests-'+sha256Hex(path.resolve(workflowsRoot())).slice(0,12));await privateDirectory(locks);
 return withProcessLock(locks,async()=>{
  let saved:any;try{saved=await readWorkflowFile<any>(id,'start-claim.json');}catch(e:any){if(e.code!=='ENOENT')throw e;}
  if(saved){if(jcsSha256(saved)!==jcsSha256(claim))throw Error('START_REQUEST_CONFLICT');const context=await readWorkflowData<any>(id,'mcp-context.json'),state=await readWorkflowFile<WorkflowState>(id,'state.json');return {view:state.consent?await showEstimateWorkflow(id):await showEstimateStart(id),binding:context.binding,rules:context.rules,resume:false};}
  const start={method:choice.method as 'NEW'|'RECALCULATE',request_id:choice.request_id,...(sourceRun?{source_workflow_id:source!.workflow_id,source_run_id:choice.source_run_id,source_checksums_hash:sourceRun.checksums_hash}:{})};
  let view:any;try{const existing=await readWorkflowFile<WorkflowState>(id,'state.json');if(existing.terms.target_hash!==jcsSha256(next.root)||existing.terms.plan_hash!==next.plan.fingerprint||jcsSha256(existing.terms.start)!==jcsSha256(start)||existing.terms.display_currency!==currency||jcsSha256(existing.terms.ruleset_ref)!==jcsSha256(rules.ruleset_ref))throw Error('START_REQUEST_CONFLICT');view=await showEstimateStart(id);}catch(e:any){if(e.code!=='ENOENT')throw e;view=await prepareEstimateStart({workflow_id:id,target_ref:next.root,target_hash:jcsSha256(next.root),plan_ref:next.candidate_id,plan_hash:next.plan.fingerprint,ruleset_ref:rules.ruleset_ref,display_currency:currency,start});}
  await writeWorkflowData(id,'mcp-context.json',{binding:next,rules});await writeWorkflowFile(id,'start-claim.json',claim);
  return {view,binding:next,rules,resume:false};
 });
}
export async function recordWorkflowResume(id:string,request_id:string){return withWorkflowLock(id,async()=>{const s=await readWorkflowFile<WorkflowState>(id,'state.json');if(s.applications.some((a:any)=>a.action==='RESUME_SELECTED'&&a.request_id===request_id))return;s.applications.push({action:'RESUME_SELECTED',request_id,at:new Date().toISOString()});await writeWorkflowFile(id,'state.json',s);});}

/** Only after consent: unchanged metadata is insufficient, verify cache AND current bytes. */
export async function reuseRecalculationSnapshot(id:string,root:string){
 const s=await readWorkflowFile<WorkflowState>(id,'state.json'),lineage=s.terms.start;if(lineage?.method!=='RECALCULATE')return null;
 await approvedWorkflow(id,{target_hash:jcsSha256(root),plan_hash:s.terms.plan_hash});
 try{
  const run=await readRun(lineage.source_run_id!);if(run.checksums_hash!==lineage.source_checksums_hash)throw Error('SOURCE_RUN_CHANGED');
  const a:any=run.metadata.acquisition_record;if(!a?.scope_complete||a.preflight.fingerprint!==s.terms.plan_hash||a.postflight_fingerprint!==a.preflight.fingerprint)throw Error('SOURCE_SNAPSHOT_NOT_COMPLETE');
  const restored=await restoreWorkflowSnapshot(lineage.source_workflow_id!,root,a.snapshot_id);if(!restored?.available)throw Error('SOURCE_SNAPSHOT_UNAVAILABLE');
  const old=mcpState.getSnapshot(restored.snapshot_id)!;
  // The validated run has reconciled read dispositions; compare acquisition
  // identity separately from that old analysis ledger.
  const identity=(files:any[])=>files.map(({disposition,...f})=>f);
  if(old.snapshot.manifest_hash!==a.manifest_hash||jcsSha256(identity(old.snapshot.manifest.files))!==jcsSha256(identity(run.assessment.input.manifest.files)))throw Error('SOURCE_MANIFEST_CHANGED');
  const before=await planAcquisition(root,a.scope);if(!before.summary.discovery_complete||before.fingerprint!==s.terms.plan_hash)throw Error('SOURCE_METADATA_CHANGED');
  for(const f of old.snapshot.manifest.files.filter(f=>f.disposition!=='excluded')){
   const current=await fs.readFile(await resolveSafePath(f.path,root)),cached=await fs.readFile(await resolveSafePath(f.path,path.join(old.snapshot.cache_dir,'files')));
   if(current.length!==f.bytes||cached.length!==f.bytes||sha256Hex(current)!==f.sha256||sha256Hex(cached)!==f.sha256)throw Error('SOURCE_CONTENT_CHANGED');
  }
  if((await planAcquisition(root,a.scope)).fingerprint!==before.fingerprint)throw Error('SOURCE_CHANGED_DURING_CHECK');
  const contract=await handleGetAssessorContract(),snapshot=structuredClone(old.snapshot);mcpState.registerSnapshot(snapshot,root,{assessment_id:randomUUID(),assessor_defaults:contract.assessor_defaults??{...old.preparation!.assessor_defaults,skill_version:contract.skill.skill_version,skill_sha256:contract.skill.package_sha256,started_at:new Date().toISOString()}});
  await saveWorkflowSnapshot(id,snapshot.snapshot_id);await writeWorkflowFile(id,'source-comparison.json',{status:'VERIFIED_UNCHANGED',snapshot_id:snapshot.snapshot_id,evidence_revalidation_required:true});return snapshot.snapshot_id;
 }catch(e:any){await writeWorkflowFile(id,'source-comparison.json',{status:'REACQUIRE_REQUIRED',reason:/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'SOURCE_NOT_COMPARABLE',evidence_revalidation_required:true});return null;}
}
export async function recalculationInputPage(args:{workflow_id:string;section:string;cursor?:string;limit?:number}){
 const s=await readWorkflowFile<WorkflowState>(args.workflow_id,'state.json'),l=s.terms.start;if(l?.method!=='RECALCULATE')throw Error('RECALCULATION_SOURCE_REQUIRED');
 await approvedWorkflow(s.workflow_id,{target_hash:s.terms.target_hash,plan_hash:s.terms.plan_hash});const run=await readRun(l.source_run_id!);if(run.checksums_hash!==l.source_checksums_hash)throw Error('SOURCE_RUN_CHANGED');
 const {input,assessment_id,assessor,...body}=run.assessment;const section=args.section==='sections'?Object.keys(body):(body as any)[args.section];if(section===undefined)throw Error('UNKNOWN_DRAFT_SECTION');
 return {...pageRows(Array.isArray(section)?section:[section],args.section,args.cursor,args.limit,{workflow_id:s.workflow_id,source:l.source_run_id}),validation_status:'UNVALIDATED_INHERITED_INPUT',evidence_revalidation_required:true};
}
