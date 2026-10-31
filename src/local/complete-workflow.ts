import {fixedDocumentFromRun} from './create-document.js';
import {resultFromDocument} from '../contracts/estimate-result.js';
import {approvedWorkflow,freezeEstimateWorkflowState,resumeEstimateWorkflow,type WorkflowState} from './estimate-workflow.js';
import {readWorkflowFile,writeWorkflowFile,withWorkflowLock} from './workflow-store.js';
import {jcsSha256} from '../core/canonical.js';
export class WorkflowCompletionError extends Error {
 constructor(public code:string,public stage:string,public recovery_action:string){super(code);}
}
export async function completeEstimateWorkflow(args:{workflow_id:string;run_id:string}){
 await withWorkflowLock(args.workflow_id,async()=>{
 const state=await readWorkflowFile<WorkflowState>(args.workflow_id,'state.json');let stage='PREPARE_RESULT';
 try{
 if(state.completed_run_id&&state.completed_run_id!==args.run_id)throw Error('WORKFLOW_RESULT_FROZEN');
 if(!(state.result&&state.completed_run_id===args.run_id)){
 const {document,input,run}=await fixedDocumentFromRun({run_id:args.run_id,display_currency:state.terms.display_currency,fixed_display_quote:state.result?.display_quote});
 stage='CHECK_ACQUISITION';
 const acquisition=run.metadata.acquisition_record as any;
 if(!acquisition?.preflight?.fingerprint||acquisition.observed?.fingerprint!==acquisition.preflight.fingerprint||acquisition.postflight_fingerprint!==acquisition.preflight.fingerprint)throw Error('WORKFLOW_ACQUISITION_CHANGED');
 const context={target_hash:jcsSha256(run.metadata.target.root),plan_hash:acquisition.preflight.fingerprint};await approvedWorkflow(args.workflow_id,context);
 stage='FREEZE_RESULT';
 await freezeEstimateWorkflowState(args.workflow_id,resultFromDocument(document),{...input,schema_version:'oes/estimate-validation-input/v1'},context,args.run_id);
 }
 const saved=await readWorkflowFile<WorkflowState>(args.workflow_id,'state.json');
 if(['PREPARE_RESULT','CHECK_ACQUISITION','FREEZE_RESULT'].includes(saved.last_error_stage??'')){delete saved.last_error;delete saved.last_error_stage;delete saved.recovery_action;await writeWorkflowFile(args.workflow_id,'state.json',saved);}
 }catch(e:any){
 const code=e.code==='ENOENT'?'RUN_ARTIFACT_MISSING':['EACCES','EPERM'].includes(e.code)?'RUN_READ_DENIED':e instanceof SyntaxError?'RUN_DATA_INVALID':/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'WORKFLOW_COMPLETION_FAILED';
 const recovery=['RUN_NOT_FOUND','INVALID_RUN_ID'].includes(code)?'CHECK_RUN_ID_AND_RETRY_COMPLETE':code==='WORKFLOW_RESULT_FROZEN'?'USE_ORIGINAL_RUN_ID':'CHECK_LOCAL_RUN_AND_RETRY_COMPLETE';
 const saved=await readWorkflowFile<WorkflowState>(args.workflow_id,'state.json');saved.last_error=code;saved.last_error_stage=stage;saved.recovery_action=recovery;await writeWorkflowFile(args.workflow_id,'state.json',saved);
 throw new WorkflowCompletionError(code,stage,recovery);
 }
 });
 return resumeEstimateWorkflow(args.workflow_id);
}
