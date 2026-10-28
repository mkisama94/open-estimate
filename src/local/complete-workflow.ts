import {fixedDocumentFromRun} from './create-document.js';
import {resultFromDocument} from '../contracts/estimate-result.js';
import {approvedWorkflow,freezeEstimateWorkflow,resumeEstimateWorkflow} from './estimate-workflow.js';
import {readWorkflowFile} from './workflow-store.js';
import {jcsSha256} from '../core/canonical.js';
import type {WorkflowTerms} from './workflow-consent.js';
export async function completeEstimateWorkflow(args:{workflow_id:string;run_id:string}){
 const state=await readWorkflowFile<{terms:WorkflowTerms}>(args.workflow_id,'state.json');
 const {document,input,run}=await fixedDocumentFromRun({run_id:args.run_id,display_currency:state.terms.display_currency});
 const acquisition=run.metadata.acquisition_record as any;
 if(!acquisition?.preflight?.fingerprint||acquisition.observed?.fingerprint!==acquisition.preflight.fingerprint||acquisition.postflight_fingerprint!==acquisition.preflight.fingerprint)throw Error('WORKFLOW_ACQUISITION_CHANGED');
 const context={target_hash:jcsSha256(run.metadata.target.root),plan_hash:acquisition.preflight.fingerprint};await approvedWorkflow(args.workflow_id,context);
 await freezeEstimateWorkflow(args.workflow_id,resultFromDocument(document),{...input,schema_version:'oes/estimate-validation-input/v1'},context);
 return resumeEstimateWorkflow(args.workflow_id);
}
