import {randomUUID} from 'node:crypto';
import {readWorkflowData,writeWorkflowData} from './workflow-data.js';
import {withWorkflowLock,readWorkflowFile} from './workflow-store.js';
import {approvedWorkflow} from './estimate-workflow.js';
import {saveRun,readRun} from './runs.js';
import {validateSnapshotAssessment} from '../mcp/tools/evaluate-assessment.js';
import {snapshotEntry,collectorInput,pageRows,bounded} from '../mcp/response-pages.js';
import {jcsSha256} from '../core/canonical.js';
import {parseStrictJson} from '../core/json-parser.js';
import {validateRuleReferences,type BoundRules} from './measurement-context.js';
import {createEvaluation} from '../core/evaluation.js';
import {getLocalProfile} from '../profiles/local-profile.js';
import {createDisplayQuote} from '../core/display-quote.js';
import {presentEvaluation} from '../mcp/presentation.js';
import {frbProvider,type FxProvider} from '../profiles/frb.js';
import {resultCoverage} from './result-coverage.js';
import {saveEvaluation,loadEvaluation} from '../mcp/storage.js';

interface Draft {draft_id:string;workflow_id:string;snapshot_id:string;assessment_id:string;version:number;input_hash:string;submission:string;input_mode:'collector'|'legacy';read_revision:string;display_currency:string;created_at:string}
interface Journal {status:string;validation_passed:boolean;errors:any[];run_id?:string;evaluation_id?:string;attempts:string[];input_reconciled?:boolean;last_error?:string}
interface Index {latest_draft_id:string;drafts:Array<{draft_id:string;snapshot_id:string;version:number}>}
const draftName=(id:string)=>{if(!/^draft_[a-f0-9]{64}$/.test(id))throw Error('INVALID_DRAFT_ID');return id+'.json';};
const journalName=(id:string)=>draftName(id).replace('.json','-progress.json');
const safeCode=(e:any)=>e?.code==='ENOENT'?'RUN_ARTIFACT_MISSING':['EPERM','EACCES'].includes(e?.code)?'LOCAL_STORAGE_DENIED':/^[A-Z][A-Z0-9_]+$/.test(e?.message)?e.message:'EVALUATION_STAGE_FAILED';
export function evaluationStageLabel(status:string){return ({ACQUISITION_OR_ANALYSIS:'取得・解析中',DRAFT_SAVED:'評価入力の下書き保存済み',VALIDATION_FAILED:'評価入力の修正が必要',RUN_SAVE_PENDING:'検査済みの評価を保存中',SAVE_RETRY_PENDING:'評価保存の再試行待ち',SAVE_INTERRUPTED:'評価保存の中断を検出',RUN_SAVED:'検査済みrun保存済み',RUN_SAVED_COMPLETION_BLOCKED:'run保存済み・取得整合性の確認が必要',RUN_SAVED_DISPLAY_PENDING:'run保存済み・表示の再試行待ち',RUN_INTEGRITY_FAILED:'保存済みrunの整合性確認が必要',RUN_REFERENCE_UNAVAILABLE:'保存済みrunの確認が必要'} as Record<string,string>)[status]??status;}
async function index(id:string):Promise<Index>{try{return await readWorkflowData(id,'evaluation-index.json');}catch(e:any){if(e.code==='ENOENT')return {latest_draft_id:'',drafts:[]};throw e;}}
async function draftFor(workflow:string,id:string){const draft=await readWorkflowData<Draft>(workflow,draftName(id));if(draft.workflow_id!==workflow||draft.draft_id!==id)throw Error('DRAFT_BINDING_MISMATCH');return draft;}
async function journalFor(d:Draft):Promise<Journal>{try{return await readWorkflowData(d.workflow_id,journalName(d.draft_id));}catch(e:any){if(e.code==='ENOENT')return {status:'DRAFT_SAVED',validation_passed:false,errors:[],attempts:[]};throw e;}}
const saveJournal=(d:Draft,j:Journal)=>writeWorkflowData(d.workflow_id,journalName(d.draft_id),j);
async function recovered(workflow_id:string){try{const ref=await readWorkflowData<any>(workflow_id,'recovered-evaluation.json'),run=await readRun(ref.run_id);if(run.checksums_hash!==ref.checksums_hash)throw Error('RUN_CHECKSUM_MISMATCH');const blocked=ref.completion_blockers?.length>0;return {response_format:'oes/recovered-evaluation/v1',status:blocked?'RUN_SAVED_COMPLETION_BLOCKED':'RUN_SAVED',workflow_id,run_id:ref.run_id,assessment_id:run.assessment.assessment_id,snapshot_id:ref.snapshot_id,validation_passed:true,last_error:blocked?ref.completion_blockers[0]:null,next_action:blocked?'CHECK_ACQUISITION_BEFORE_COMPLETE':'COMPLETE_ESTIMATE_WORKFLOW',signed:false,published:false};}catch(e:any){if(e.code==='ENOENT')return {status:'ACQUISITION_OR_ANALYSIS',workflow_id,run_id:null};return {status:'RUN_REFERENCE_UNAVAILABLE',workflow_id,run_id:null,last_error:safeCode(e)};}}
export async function peekWorkflowEvaluation(workflow_id:string){const history=await index(workflow_id);if(!history.latest_draft_id)return recovered(workflow_id);const d=await draftFor(workflow_id,history.latest_draft_id);return summary(d,await journalFor(d));}
export async function recoverSavedWorkflowRun(args:{workflow_id:string;run_id:string}){return withWorkflowLock(args.workflow_id,async()=>{
 const run=await readRun(args.run_id),a:any=run.metadata.acquisition_record,state=await readWorkflowFile<any>(args.workflow_id,'state.json'),head=await readWorkflowFile<any>(args.workflow_id,'mcp-snapshot.json');
 const snapshot_id=head.snapshot_id??head.snapshot?.snapshot_id;
 if(!snapshot_id||a?.snapshot_id!==snapshot_id||jcsSha256(run.metadata.rules_context?.ruleset_ref)!==jcsSha256(state.terms.ruleset_ref))throw Error('RUN_WORKFLOW_BINDING_MISMATCH');
 await approvedWorkflow(args.workflow_id,{target_hash:jcsSha256(run.metadata.target.root),plan_hash:a.preflight.fingerprint});
 const context=await readWorkflowData<any>(args.workflow_id,'mcp-context.json');if(jcsSha256(context.binding.plan.scope)!==jcsSha256(a.scope))throw Error('RUN_WORKFLOW_BINDING_MISMATCH');
 const completion_blockers=a.observed?.fingerprint!==a.preflight?.fingerprint||a.postflight_fingerprint!==a.preflight?.fingerprint?['WORKFLOW_ACQUISITION_CHANGED']:[];
 await writeWorkflowData(args.workflow_id,'recovered-evaluation.json',{run_id:args.run_id,snapshot_id,assessment_id:run.assessment.assessment_id,checksums_hash:run.checksums_hash,completion_blockers,source:'EXPLICIT_VERIFIED_EXISTING_RUN'});return recovered(args.workflow_id);
});}
const binding=(d:Draft)=>({workflow_id:d.workflow_id,snapshot_id:d.snapshot_id,draft_id:d.draft_id,input_hash:d.input_hash});
async function matchingRun(d:Draft,j:Journal){if(!j.run_id)return null;const run=await readRun(j.run_id);if(jcsSha256(run.metadata.workflow_binding)!==jcsSha256(binding(d)))throw Error('RUN_DRAFT_BINDING_MISMATCH');return run;}
function summary(d:Draft,j:Journal){return bounded({response_format:'oes/workflow-evaluation/v2',workflow_id:d.workflow_id,snapshot_id:d.snapshot_id,assessment_id:d.assessment_id,draft_id:d.draft_id,input_version:d.version,input_hash:d.input_hash,status:j.status,validation_passed:j.validation_passed,run_id:j.status.startsWith('RUN_SAVED')?j.run_id??null:null,last_error:j.last_error??null,validation:{total_errors:j.errors.length,errors:j.errors.slice(0,5).map(e=>({code:e.code,pointer:e.pointer,message:String(e.message??'').slice(0,300)})),details_tool:'get_assessment_draft_page',section:'validation'},signed:false,published:false,next_action:j.status.startsWith('RUN_SAVED')?'COMPLETE_ESTIMATE_WORKFLOW':j.status==='SAVE_INTERRUPTED'?'RETRY_SAME_DRAFT_TO_SAVE':'CORRECT_OR_EVALUATE_SAVED_DRAFT',byte_limit:65536});}
export async function saveWorkflowDraft(args:{workflow_id:string;snapshot_id:string;assessment:string;input_mode?:'collector'|'legacy';display_currency?:string}){return withWorkflowLock(args.workflow_id,async()=>{
 const e=snapshotEntry(args.snapshot_id),record:any=e.snapshot.acquisition_record;if(!e.workspace_root||!record?.preflight?.fingerprint)throw Error('ACQUISITION_BINDING_REQUIRED');await approvedWorkflow(args.workflow_id,{target_hash:jcsSha256(e.workspace_root),plan_hash:record.preflight.fingerprint});
 if(Buffer.byteLength(args.assessment)>8*1024*1024)throw Error('ASSESSMENT_TOO_LARGE');
 const terms=await readWorkflowFile<any>(args.workflow_id,'state.json');const read_revision=jcsSha256(e.tracker.exportReads()),input_mode=args.input_mode??'collector',display_currency=args.display_currency??terms.terms.display_currency,input_hash=jcsSha256({snapshot_id:args.snapshot_id,manifest_hash:e.snapshot.manifest_hash,read_revision,input_mode,submission:args.assessment,display_currency}),draft_id='draft_'+input_hash,history=await index(args.workflow_id);
 let assessment_id=e.preparation!.assessment_id;try{const candidate=(parseStrictJson(args.assessment) as any)?.assessment_id;if(typeof candidate==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(candidate))assessment_id=candidate;}catch{/* Invalid JSON is still a recoverable unvalidated draft. */}
 let d:Draft;try{d=await draftFor(args.workflow_id,draft_id);}catch(err:any){if(err.code!=='ENOENT')throw err;d={...args,input_mode,display_currency,submission:args.assessment,draft_id,assessment_id,version:history.drafts.length+1,input_hash,read_revision,created_at:new Date().toISOString()};delete (d as any).assessment;await writeWorkflowData(args.workflow_id,draftName(draft_id),d);}
 if(!history.drafts.some(x=>x.draft_id===draft_id))history.drafts.push({draft_id,snapshot_id:args.snapshot_id,version:d.version});history.latest_draft_id=draft_id;await writeWorkflowData(args.workflow_id,'evaluation-index.json',history);return summary(d,await journalFor(d));
});}
export async function getWorkflowEvaluation(workflow_id:string,draft_id?:string){return withWorkflowLock(workflow_id,async()=>{
 const history=await index(workflow_id),id=draft_id??history.latest_draft_id;if(!id)return recovered(workflow_id);const d=await draftFor(workflow_id,id),j=await journalFor(d);
 if(j.status==='RUN_SAVE_PENDING'&&j.run_id){try{await matchingRun(d,j);j.status='RUN_SAVED';j.validation_passed=true;delete j.last_error;await saveJournal(d,j);}catch(e:any){j.last_error=safeCode(e);}}
 return summary(d,j);
});}
export async function workflowDraftPage(args:{workflow_id:string;draft_id?:string;section:string;cursor?:string;limit?:number}){
 const history=await index(args.workflow_id);if(args.section==='history')return pageRows(history.drafts,args.section,args.cursor,args.limit,args.workflow_id);
 const d=await draftFor(args.workflow_id,args.draft_id??history.latest_draft_id),j=await journalFor(d);let rows:any[];
 if(args.section==='validation')rows=j.errors;else if(args.section==='attempts')rows=j.attempts;else if(args.section==='submission')rows=[d.submission];else{const raw=parseStrictJson(d.submission) as any;const value=raw[args.section];if(value===undefined)throw Error('UNKNOWN_DRAFT_SECTION');rows=Array.isArray(value)?value:[value];}
 return pageRows(rows,args.section,args.cursor,args.limit,{draft_id:d.draft_id,input_hash:d.input_hash,status:args.section==='validation'?j.status:null});
}
export async function evaluateWorkflowDraft(args:{workflow_id:string;draft_id:string;legacy_view?:boolean},rules:BoundRules,options:{provider?:FxProvider;save?:typeof saveRun;afterSave?:()=>Promise<void>}={}){return withWorkflowLock(args.workflow_id,async()=>{
 const d=await draftFor(args.workflow_id,args.draft_id),j=await journalFor(d),e=snapshotEntry(d.snapshot_id),record:any=e.snapshot.acquisition_record;
 await approvedWorkflow(d.workflow_id,{target_hash:jcsSha256(e.workspace_root),plan_hash:record.preflight.fingerprint});
 let run:Awaited<ReturnType<typeof readRun>>|null=null;
 if(j.run_id){try{run=await matchingRun(d,j);}catch(err:any){if(j.status==='RUN_SAVE_PENDING'||j.status==='SAVE_RETRY_PENDING'){j.status='SAVE_INTERRUPTED';j.last_error=safeCode(err);await saveJournal(d,j);return summary(d,j);}if(j.status.startsWith('RUN_SAVED')){j.status='RUN_INTEGRITY_FAILED';j.last_error=safeCode(err);await saveJournal(d,j);return summary(d,j);}}}
 if(!run){
  try{
   if(jcsSha256(e.tracker.exportReads())!==d.read_revision)throw Error('DRAFT_READ_REVISION_CHANGED_SAVE_NEW_VERSION');
   const raw=parseStrictJson(d.submission) as any;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('ASSESSMENT_INPUT_REQUIRED');
   if(d.input_mode==='collector'){if(Object.hasOwn(raw,'input'))throw Error('COLLECTOR_INPUT_OWNED_OMIT_INPUT');if(raw.assessment_id&&raw.assessment_id!==e.preparation!.assessment_id)throw Error('COLLECTOR_ASSESSMENT_ID_OWNED');raw.input=collectorInput(d.snapshot_id);raw.assessment_id??=e.preparation!.assessment_id;raw.assessor={...e.preparation!.assessor_defaults,...raw.assessor};}
   const {validated,wasReconciled}=await validateSnapshotAssessment({snapshot_id:d.snapshot_id,assessment:JSON.stringify(raw)});validateRuleReferences(validated,rules);j.validation_passed=true;j.errors=[];j.input_reconciled=wasReconciled;
   const run_id=randomUUID();j.run_id=run_id;j.attempts.push(run_id);j.status='RUN_SAVE_PENDING';delete j.last_error;await saveJournal(d,j);
   try{await (options.save??saveRun)(validated,raw,{ruleset_ref:rules.ruleset_ref,bundle:rules.bundle},e.workspace_root!,record,{run_id,workflow_binding:binding(d)});await options.afterSave?.();run=await matchingRun(d,j);j.status='RUN_SAVED';await saveJournal(d,j);}
   catch(error){j.status='SAVE_RETRY_PENDING';j.last_error=safeCode(error);await saveJournal(d,j);return summary(d,j);}
  }catch(error:any){j.status='VALIDATION_FAILED';j.validation_passed=false;j.errors=Array.isArray(error.errors)?error.errors:[{code:safeCode(error),pointer:'/',message:safeCode(error)}];j.last_error=Array.isArray(error.errors)?'ASSESSMENT_VALIDATION_FAILED':safeCode(error);await saveJournal(d,j);return summary(d,j);}
 }
 j.status='RUN_SAVED';j.validation_passed=true;delete j.last_error;await saveJournal(d,j);
 const fixed=createEvaluation(run!.assessment,run!.summary.calculation.basis);
 try{
  const quote=await createDisplayQuote(fixed,options.provider??frbProvider,'ja-JP',d.display_currency);
  if(args.legacy_view){const cached=j.evaluation_id?await loadEvaluation(j.evaluation_id):await saveEvaluation(fixed);j.evaluation_id=cached.evaluation_id;await saveJournal(d,j);const view=await presentEvaluation(cached,options.provider??frbProvider,'ja-JP',d.display_currency);return bounded({...view,run_id:j.run_id!,run_directory:run!.dir,assessment_path:run!.dir+'/assessment.json',assessment_hash:run!.metadata.assessment_hash,summary:run!.summary,workflow_id:d.workflow_id,input_reconciled:j.input_reconciled??false});}
  return bounded({...summary(d,j),coverage:resultCoverage(run!.assessment,fixed.report.effort.person_hours),measurement:fixed.report.measurement,display_quote:quote});
 }catch(error){j.status='RUN_SAVED_DISPLAY_PENDING';j.last_error=safeCode(error);await saveJournal(d,j);return summary(d,j);}
});}
