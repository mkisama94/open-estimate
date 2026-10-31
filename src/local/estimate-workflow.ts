import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {checkEstimate,PUBLICATION_MS,type EstimateResult,type EstimateValidationInput,type EstimateProofRequest,type EstimateProof,type PublishEstimate,type PublishedEstimate,type TrustedEstimateKey} from '../contracts/estimate-result.js';
import {estimateHash,estimateResultHash,verifyEstimateProof} from '../proof/estimate-proof.js';
import {jcsSha256} from '../core/canonical.js';
import {estimateView,renderEstimateMarkdown} from '../document/estimate-view.js';
import {renderStructuredEstimatePdf} from '../document/estimate-pdf.js';
import {estimateServices,type EstimateServices} from './estimate-services.js';
import {consentWorkflow,authorizeRequest,assertWorkflowContext,assertResultTerms,type WorkflowConsent,type WorkflowTerms,type WorkflowSelection} from './workflow-consent.js';
import {createWorkflowDirectory,workflowDirectory,readWorkflowFile,writeWorkflowFile,withWorkflowLock,isWorkflowCancelled} from './workflow-store.js';
import {workflowAdapters,WorkflowTransportError,type WorkflowAdapters} from './publication-client.js';
import keys from '../../profiles/document-signing-keys.json' with {type:'json'};
import type {AcquisitionPlan} from '../collector/acquisition-plan.js';
import {peekWorkflowEvaluation,evaluationStageLabel} from './workflow-evaluation.js';
export interface WorkflowState {workflow_id:string;terms:WorkflowTerms;target_ref:string;plan_ref:string;consent:WorkflowConsent|null;result?:EstimateResult;completed_run_id?:string;validation_input?:EstimateValidationInput;proof_request?:EstimateProofRequest;proof?:EstimateProof;publish_request?:PublishEstimate;publication?:PublishedEstimate;proof_status:string;publication_status:string;pdf_status:string;last_error?:string;last_error_stage?:string;recovery_action?:string;applications:unknown[];publish_inflight:boolean}
export async function prepareEstimateStart(context:{target_ref:string;target_hash:string;plan_ref:string;plan_hash:string;ruleset_ref:EstimateResult['ruleset_ref'];display_currency:string},services:EstimateServices=estimateServices){
 const id=randomUUID(),dir=await createWorkflowDirectory(id),rel=path.relative(path.resolve(context.target_ref),dir);if(!rel||!rel.startsWith('..')&&!path.isAbsolute(rel))throw Error('WORKFLOW_STATE_INSIDE_TARGET');
 const terms:WorkflowTerms={contract_version:'oes/workflow-consent/v1',workflow_id:id,target_hash:context.target_hash,plan_hash:context.plan_hash,ruleset_ref:context.ruleset_ref,services,display_currency:context.display_currency,calculation_policy:'oes-fixed-test-calculation/v1',publication_days:365,quality_policy:'DECLARED_PARTIAL_ALLOWED_PROJECT_TOTAL_UNCALCULATED',transmission_policy:'oes/estimate-transmission/v1'};
 await writeWorkflowFile(id,'state.json',{workflow_id:id,terms,target_ref:context.target_ref,plan_ref:context.plan_ref,consent:null,proof_status:'NOT_SELECTED',publication_status:'NOT_SELECTED',pdf_status:'NOT_CREATED',applications:[],publish_inflight:false} satisfies WorkflowState);
 return showEstimateStart(id);
}
export async function showEstimateStart(id:string){const s=await readWorkflowFile<WorkflowState>(id,'state.json');return {status:'AWAITING_START_SELECTION',workflow_id:id,terms:s.terms,terms_hash:jcsSha256(s.terms),target:s.target_ref,plan_ref:s.plan_ref,initial_selection:{read:false,verify:false,publish:false},source_content_read:false,notice:'読取・解析は必須、検証と公開は任意です。公開には検証が必要です。数値は算定後に確定し、宣言済み品質・部分試算・同一要求の再試行では追加同意しません。ソースはOpen Estimateへ送らず、AI解析ではモデル提供元（OpenAI、Anthropicなど、利用中のAIサービスのモデル提供元のこと）で処理される場合があります。',transmission:{mcp_only:['匿名数値モデル','配布整合性情報','ルール・計算条件','構造化結果'],web:['集計結果','計算・為替条件','品質集計・規定コード','証明'],never:['ソース','パス','企業名','案件名','機能名','根拠','判断台帳','自由記述']},publication_notice:'ログインなしでURLを知る人が閲覧できます。最初の公開から365日で終了し、閲覧・再送では延長しません。ダウンロード済みPDFはその後も利用できます。検索除外はアクセス制御ではありません。'};}
export async function startEstimateWorkflow(args:{workflow_id:string;terms_hash:string;selection:WorkflowSelection;explicit_answer:string}){return withWorkflowLock(args.workflow_id,async()=>{
 const s=await readWorkflowFile<WorkflowState>(args.workflow_id,'state.json');if(await isWorkflowCancelled(s.workflow_id))throw Error('WORKFLOW_CANCELLED');const consent=consentWorkflow(s.terms,args.selection,args.explicit_answer,args.terms_hash);
 if(s.consent){if(jcsSha256(s.consent.selection)!==jcsSha256(args.selection)||s.consent.terms_hash!==args.terms_hash)throw Error('WORKFLOW_ALREADY_STARTED_NEW_APPROVAL_REQUIRED');return showEstimateWorkflow(s.workflow_id);}
 s.consent=consent;s.proof_status=args.selection.verify?'PENDING':'NOT_SELECTED';s.publication_status=args.selection.publish?'PENDING':'NOT_SELECTED';await writeWorkflowFile(s.workflow_id,'state.json',s);return showEstimateWorkflow(s.workflow_id);
});}
export async function extendEstimateWorkflow(args:{workflow_id:string;terms_hash:string;selection:WorkflowSelection;explicit_answer:string}){return withWorkflowLock(args.workflow_id,async()=>{
 const s=await readWorkflowFile<WorkflowState>(args.workflow_id,'state.json');if(!s.consent||await isWorkflowCancelled(s.workflow_id))throw Error('WORKFLOW_START_REQUIRED');
 for(const key of ['read','verify','publish'] as const)if(s.consent.selection[key]&&!args.selection[key])throw Error('WORKFLOW_EXTENSION_ONLY');
 const next=consentWorkflow(s.terms,args.selection,args.explicit_answer,args.terms_hash);
 const history=await readWorkflowFile<WorkflowConsent[]>(s.workflow_id,'consent-history.json').catch((e:any):WorkflowConsent[]=>{if(e.code==='ENOENT')return [];throw e;});
 await writeWorkflowFile(s.workflow_id,'consent-history.json',[...history,s.consent]);s.consent=next;
 if(next.selection.verify&&s.proof_status==='NOT_SELECTED')s.proof_status='PENDING';if(next.selection.publish&&s.publication_status==='NOT_SELECTED')s.publication_status='PENDING';
 await writeWorkflowFile(s.workflow_id,'state.json',s);return showEstimateWorkflow(s.workflow_id);
});}
export async function approvedWorkflow(id:string,context:{target_hash:string;plan_hash:string}){const s=await readWorkflowFile<WorkflowState>(id,'state.json');if(!s.consent)throw Error('WORKFLOW_START_REQUIRED');if(await isWorkflowCancelled(id))throw Error('WORKFLOW_CANCELLED');const adjusted:string[]=await readWorkflowFile<string[]>(id,'acquisition-adjustments.json').catch((e:any):string[]=>{if(e.code==='ENOENT')return [];throw e;});if(context.plan_hash!==s.terms.plan_hash&&!adjusted.includes(context.plan_hash))throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');assertWorkflowContext(s.consent,context.target_hash,s.terms.plan_hash);return s.consent;}
export async function approveWorkflowAcquisition(id:string,target_hash:string,before:AcquisitionPlan,after:AcquisitionPlan){return withWorkflowLock(id,async()=>{
 await approvedWorkflow(id,{target_hash,plan_hash:before.fingerprint});if(jcsSha256(before.scope)!==jcsSha256(after.scope))throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
 const prior=await readWorkflowFile<string[]>(id,'acquisition-adjustments.json').catch((e:any)=>{if(e.code==='ENOENT')return [];throw e;});await writeWorkflowFile(id,'acquisition-adjustments.json',Array.from(new Set([...prior,after.fingerprint])));return {additional_consent:false,plan_hash:after.fingerprint};
});}
/** Internal adapter supplies origin from the approved acquisition, never from a public-result field. */
export async function freezeEstimateWorkflow(id:string,result:EstimateResult,input:EstimateValidationInput,origin:{target_hash:string;plan_hash:string},run_id?:string){return withWorkflowLock(id,()=>freezeEstimateWorkflowState(id,result,input,origin,run_id));}
/** Internal completion path holds the workflow lock while loading and freezing. */
export async function freezeEstimateWorkflowState(id:string,result:EstimateResult,input:EstimateValidationInput,origin:{target_hash:string;plan_hash:string},run_id?:string){
 const s=await readWorkflowFile<WorkflowState>(id,'state.json'),c=await approvedWorkflow(id,origin);assertResultTerms(c,result,input);
 const request:EstimateProofRequest={schema_version:'oes/estimate-proof-request/v1',operation_id:s.proof_request?.operation_id??randomUUID(),result,validation_input:input};checkEstimate('request',request);if(Buffer.byteLength(JSON.stringify(request))>1024*1024)throw Error('ESTIMATE_REQUEST_TOO_LARGE');
 if(s.result){if(jcsSha256(s.result)!==jcsSha256(result)||jcsSha256(s.validation_input)!==jcsSha256(input)||run_id&&s.completed_run_id&&run_id!==s.completed_run_id)throw Error('WORKFLOW_RESULT_FROZEN');if(run_id){s.completed_run_id=run_id;await writeWorkflowFile(id,'state.json',s);}return showEstimateWorkflow(id);}
 const token=randomBytes(32).toString('base64url');await writeWorkflowFile(id,'management-secret.json',{token,publish_operation_id:randomUUID()});
 s.result=structuredClone(result);s.validation_input=structuredClone(input);s.proof_request=request;if(run_id)s.completed_run_id=run_id;await writeWorkflowFile(id,'state.json',s);
 try{const dir=await workflowDirectory(id);await fs.writeFile(path.join(dir,'estimate.pdf'),await renderStructuredEstimatePdf(s.result),{flag:'wx',mode:0o600});s.pdf_status='READY';}catch{s.pdf_status='RETRY_PENDING';}await writeWorkflowFile(id,'state.json',s);return showEstimateWorkflow(id);
}
export function validatePublishedResponse(value:unknown,request:PublishEstimate,services:EstimateServices,now=Date.now()):PublishedEstimate {
 const p=checkEstimate<PublishedEstimate>('response',value),u=new URL(p.canonical_url);
 if(u.origin!==services.result_origin||u.pathname!=='/results/'+p.public_result_id||u.search||u.hash||u.username||u.password||u.href!==p.canonical_url||p.result_hash!==request.proof.statement.result_hash||Date.parse(p.expires_at)-Date.parse(p.published_at)!==PUBLICATION_MS||Date.parse(p.published_at)>now+30000)throw Error('PUBLICATION_RESPONSE_MISMATCH');return p;
}
export async function resumeEstimateWorkflow(id:string,options:{adapters?:WorkflowAdapters;keys?:readonly TrustedEstimateKey[];services?:EstimateServices}={}){return withWorkflowLock(id,async()=>{
 const s=await readWorkflowFile<WorkflowState>(id,'state.json');if(!s.consent||!s.result||!s.proof_request)throw Error('WORKFLOW_RESULT_REQUIRED');
 const services=options.services??estimateServices;if(jcsSha256(services)!==jcsSha256(s.terms.services))throw Error('WORKFLOW_DESTINATION_CHANGED');
 const adapters=options.adapters??workflowAdapters(services),trusted=options.keys??keys as TrustedEstimateKey[],c=s.consent,origin={target_hash:s.terms.target_hash,plan_hash:s.terms.plan_hash};
 const save=()=>writeWorkflowFile(id,'state.json',s),cancelled=()=>isWorkflowCancelled(id);
 const secret=()=>readWorkflowFile<{token:string;publish_operation_id:string}>(id,'management-secret.json');
 const wasInflight=s.publish_inflight;let reconciling=false;
 const send=async<T>(stage:'proof'|'publish',request:EstimateProofRequest|PublishEstimate,fn:()=>Promise<T>)=>{
  for(let attempt=0;attempt<2;attempt++){
   if(await cancelled())throw Error('WORKFLOW_CANCELLED');const application=authorizeRequest(c,request,stage,origin);s.applications.push(application);await save();if(await cancelled())throw Error('WORKFLOW_CANCELLED');
   try{return await fn();}catch(e){if(!(e instanceof WorkflowTransportError)||!e.retryable||stage==='publish'&&e.uncertain||attempt===1)throw e;}
  }throw Error('WORKFLOW_RETRY_EXHAUSTED');
 };
 try{
  if(await cancelled()){
   if(s.publish_inflight&&!s.publication){
    const m=await secret();reconciling=true;const v=await adapters.lookup(m.publish_operation_id,m.token);reconciling=false;
    if('status'in v&&v.status==='NOT_FOUND'){
     // A still-running POST may commit after this lookup. Keep its operation and
     // secret so later resumes can reconcile it without issuing another POST.
     s.publication_status='CANCELLED_PUBLICATION_UNCONFIRMED';
    }else if('status'in v&&['WITHDRAWN','EXPIRED'].includes(v.status)){
     s.publication_status=v.status;s.publish_inflight=false;
    }else{
     s.publication=validatePublishedResponse(v,s.publish_request!,services);
     s.publication_status='PUBLISHED';s.publish_inflight=false;
    }
    delete s.last_error;delete s.last_error_stage;delete s.recovery_action;await save();
   }
   return showEstimateWorkflow(id);
  }
  assertWorkflowContext(c,origin.target_hash,origin.plan_hash);assertResultTerms(c,s.result,s.validation_input!);
  if(c.selection.verify&&!s.proof&&s.proof_status!=='FAILED'){s.proof_status='IN_PROGRESS';await save();const proof=await send('proof',s.proof_request,()=>adapters.issue(s.proof_request!));await verifyEstimateProof(s.result,proof,trusted,services.environment);
   if(proof.statement.issuer!==new URL(services.proof_destination).origin||proof.statement.proof_id!=='estp_'+(await estimateHash({issuer:proof.statement.issuer,operation:s.proof_request.operation_id})).slice(0,32))throw Error('WORKFLOW_PROOF_RESPONSE_MISMATCH');s.proof=proof;s.proof_status='VERIFIED';await save();
  }
  if(c.selection.publish&&s.proof&&!s.publication&&(!['WITHDRAWN','EXPIRED','FAILED'].includes(s.publication_status)||s.publication_status==='FAILED'&&s.publish_inflight)){
   await verifyEstimateProof(s.result,s.proof,trusted,services.environment);const m=await secret();
   // Reconcile an uncertain POST (including legacy FAILED + inflight records)
   // before any retry. A cancelled workflow uses the read-only branch above.
   if(s.publish_inflight&&s.publish_request){
    reconciling=true;const found=await adapters.lookup(m.publish_operation_id,m.token);reconciling=false;
    if(found.status!=='NOT_FOUND'){
     if(['WITHDRAWN','EXPIRED'].includes(found.status))s.publication_status=found.status;
     else{s.publication=validatePublishedResponse(found,s.publish_request,services);s.publication_status='PUBLISHED';}
     s.publish_inflight=false;await save();
    }
   }
   if(!s.publication&&!['WITHDRAWN','EXPIRED'].includes(s.publication_status)){
   const request:PublishEstimate={schema_version:'oes/publish-estimate/v1',operation_id:m.publish_operation_id,result:s.result,proof:s.proof,withdrawal_token_hash:await estimateHash({domain:'oes/withdrawal-token/v1',token:m.token})};
   if(s.publish_request&&jcsSha256(s.publish_request)!==jcsSha256(request))throw Error('WORKFLOW_PUBLICATION_REQUEST_CHANGED');s.publish_request=request;s.publish_inflight=true;s.publication_status='IN_PROGRESS';await save();
   const v=await send('publish',request,()=>adapters.publish(request));
   if(['WITHDRAWN','EXPIRED'].includes((v as any).status))s.publication_status=(v as any).status;else{s.publication=validatePublishedResponse(v,request,services);s.publication_status='PUBLISHED';}s.publish_inflight=false;await save();
   }
  }
  if(s.proof_status!=='FAILED'&&s.publication_status!=='FAILED'){delete s.last_error;delete s.last_error_stage;delete s.recovery_action;}
 }catch(e){s.last_error=e instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'WORKFLOW_STAGE_FAILED';const retry=e instanceof WorkflowTransportError&&e.retryable,uncertain=s.publish_inflight&&(wasInflight||reconciling||!(e instanceof WorkflowTransportError)||e.uncertain);s.last_error_stage=s.proof?'PUBLICATION':'PROOF';s.recovery_action=uncertain?'RESUME_TO_LOOK_UP_PUBLICATION':retry?'RESUME_WORKFLOW':'CHECK_ERROR_BEFORE_RETRY';if(!s.proof&&c.selection.verify)s.proof_status=retry?'RETRY_PENDING':'FAILED';if(!s.publication&&c.selection.publish){s.publication_status=await cancelled()?'CANCELLED_PUBLICATION_UNCONFIRMED':uncertain?'PUBLICATION_UNCONFIRMED':retry?'RETRY_PENDING':'FAILED';if(!uncertain&&!await cancelled())s.publish_inflight=false;}await save();}
 // Local outputs are independent of remote success and can be regenerated alone.
 try{const dir=await workflowDirectory(id);await fs.writeFile(path.join(dir,'estimate.md'),renderEstimateMarkdown(s.result,s.proof,s.publication),{mode:0o600});const pdf=await renderStructuredEstimatePdf(s.result,s.proof,s.publication);const tmp=path.join(dir,randomUUID()+'.pdf');await fs.writeFile(tmp,pdf,{flag:'wx',mode:0o600});await fs.rename(tmp,path.join(dir,'estimate.pdf'));s.pdf_status='READY';}catch{s.pdf_status='RETRY_PENDING';}await save();return showEstimateWorkflow(id);
});}
export async function showEstimateWorkflow(id:string){const s=await readWorkflowFile<WorkflowState>(id,'state.json'),analysis=await peekWorkflowEvaluation(id);return {workflow_id:id,analysis,analysis_stage_label:s.result?'結果確定済み':evaluationStageLabel(analysis.status),selected_stages_complete:!!s.result&&s.pdf_status==='READY'&&(!s.consent?.selection.verify||s.proof_status==='VERIFIED')&&(!s.consent?.selection.publish||s.publication_status==='PUBLISHED'),status:await isWorkflowCancelled(id)?'CANCELLED':['WITHDRAWN','EXPIRED'].includes(s.publication_status)?s.publication_status:s.publication?'PUBLISHED':s.result?'RESULT_READY':s.consent?'STARTED':'AWAITING_START_SELECTION',selection:s.consent?.selection??{read:false,verify:false,publish:false},result:s.result??null,presentation:s.result?estimateView(s.result,s.proof,s.publication):null,proof:s.proof??null,proof_status:s.proof_status,publication:s.publication??null,publication_status:s.publication_status,pdf_status:s.pdf_status,last_error:s.last_error??null,last_error_stage:s.last_error_stage??null,recovery_action:s.recovery_action??null,recovery_notice:s.recovery_action?({CHECK_RUN_ID_AND_RETRY_COMPLETE:'評価で返された実行IDを確認し、同じ見積の完了処理を再実行してください。',USE_ORIGINAL_RUN_ID:'固定済みの結果に対応する元の実行IDを使ってください。',CHECK_LOCAL_RUN_AND_RETRY_COMPLETE:'ローカルの実行記録と読取権限を確認してから完了処理を再実行してください。',RESUME_TO_LOOK_UP_PUBLICATION:'公開の成否は未確認です。再開すると保存済みの操作IDで公開結果を照会します。',RESUME_WORKFLOW:'同じ見積の未完了工程を再開してください。'} as Record<string,string>)[s.recovery_action]??'原因を確認してから再実行してください。':null,browser_display:'NOT_CONFIRMED',product_additional_consent_count:0};}
export async function cancelEstimateWorkflow(id:string){await readWorkflowFile(id,'state.json');await writeWorkflowFile(id,'cancel.json',{cancelled_at:new Date().toISOString()});return showEstimateWorkflow(id);}
export async function withdrawEstimateWorkflow(id:string,adapters?:WorkflowAdapters){return withWorkflowLock(id,async()=>{const s=await readWorkflowFile<WorkflowState>(id,'state.json');if(!s.publication)throw Error('PUBLICATION_NOT_CONFIRMED');const m=await readWorkflowFile<{token:string}>(id,'management-secret.json');await (adapters??workflowAdapters(s.terms.services)).withdraw(s.publication.public_result_id,m.token);s.publication_status='WITHDRAWN';await writeWorkflowFile(id,'state.json',s);return showEstimateWorkflow(id);});}
