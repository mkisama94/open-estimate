import type {EstimateResult,EstimateValidationInput,PublishEstimate,EstimateProofRequest} from '../contracts/estimate-result.js';
import {checkEstimate,PUBLICATION_DAYS} from '../contracts/estimate-result.js';
import {jcsSha256} from '../core/canonical.js';
import type {EstimateServices} from './estimate-services.js';
export interface WorkflowTerms {
 contract_version:'oes/workflow-consent/v1';workflow_id:string;target_hash:string;plan_hash:string;ruleset_ref:EstimateResult['ruleset_ref'];
 services:EstimateServices;display_currency:string;calculation_policy:'oes-fixed-test-calculation/v1';publication_days:365;
 quality_policy:'DECLARED_PARTIAL_ALLOWED_PROJECT_TOTAL_UNCALCULATED';
 transmission_policy:'oes/estimate-transmission/v1';
}
export interface WorkflowSelection {read:boolean;verify:boolean;publish:boolean}
export interface WorkflowConsent {terms:WorkflowTerms;terms_hash:string;selection:WorkflowSelection;explicit_answer:string;confirmed_at:string;evidence:'HOST_REPORTED_EXPLICIT_CHOICE_NOT_IDENTITY_PROOF';cancelled_at:string|null}
export function consentWorkflow(terms:WorkflowTerms,selection:WorkflowSelection,explicit_answer:string,expected_hash:string,now=Date.now()):WorkflowConsent {
 if(expected_hash!==jcsSha256(terms))throw Error('WORKFLOW_TERMS_CHANGED');
 if(Object.keys(selection).sort().join(',')!=='publish,read,verify'||Object.values(selection).some(v=>typeof v!=='boolean')||!selection.read||selection.publish&&!selection.verify)throw Error('WORKFLOW_SELECTION_INVALID');
 if(typeof explicit_answer!=='string'||!explicit_answer.trim()||explicit_answer.length>2000)throw Error('WORKFLOW_EXPLICIT_CHOICE_REQUIRED');
 return {terms:structuredClone(terms),terms_hash:expected_hash,selection:{...selection},explicit_answer,confirmed_at:new Date(now).toISOString(),evidence:'HOST_REPORTED_EXPLICIT_CHOICE_NOT_IDENTITY_PROOF',cancelled_at:null};
}
export function assertWorkflowContext(c:WorkflowConsent,target_hash:string,plan_hash:string){
 if(c.cancelled_at)throw Error('WORKFLOW_CANCELLED');if(jcsSha256(c.terms)!==c.terms_hash||c.terms.target_hash!==target_hash||c.terms.plan_hash!==plan_hash||!c.selection.read)throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
}
export function assertResultTerms(c:WorkflowConsent,result:EstimateResult,input:EstimateValidationInput){
 checkEstimate('result',result);const t=c.terms;
 if(jcsSha256(result.ruleset_ref)!==jcsSha256(t.ruleset_ref)||jcsSha256(input.ruleset_ref)!==jcsSha256(t.ruleset_ref)||result.display_quote.display_currency!==t.display_currency||input.display_currency!==t.display_currency||t.publication_days!==PUBLICATION_DAYS||t.calculation_policy!=='oes-fixed-test-calculation/v1'||t.quality_policy!=='DECLARED_PARTIAL_ALLOWED_PROJECT_TOTAL_UNCALCULATED'||t.transmission_policy!=='oes/estimate-transmission/v1')throw Error('WORKFLOW_CONDITIONS_CHANGED');
}
/** Applies existing approval to newly fixed numbers, without requesting another answer. */
export function authorizeRequest(c:WorkflowConsent,request:EstimateProofRequest|PublishEstimate,stage:'proof'|'publish',context:{target_hash:string;plan_hash:string},now=Date.now()){
 assertWorkflowContext(c,context.target_hash,context.plan_hash);
 if(stage==='proof'){if(!c.selection.verify)throw Error('WORKFLOW_OPERATION_NOT_SELECTED');const r=checkEstimate<EstimateProofRequest>('request',request);assertResultTerms(c,r.result,r.validation_input);}
 else {if(!c.selection.publish||!c.selection.verify)throw Error('WORKFLOW_OPERATION_NOT_SELECTED');const r=checkEstimate<PublishEstimate>('publish',request);if(jcsSha256(r.result.ruleset_ref)!==jcsSha256(c.terms.ruleset_ref)||r.result.display_quote.display_currency!==c.terms.display_currency||r.proof.statement.environment!==c.terms.services.environment)throw Error('WORKFLOW_CONDITIONS_CHANGED');}
 return {workflow_id:c.terms.workflow_id,consent_hash:c.terms_hash,stage,operation_id:request.operation_id,request_hash:jcsSha256(request),destination:stage==='proof'?c.terms.services.proof_destination:c.terms.services.publication_destination,applied_at:new Date(now).toISOString(),additional_consent:false};
}
