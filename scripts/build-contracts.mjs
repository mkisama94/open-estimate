import fs from 'node:fs';
import {publicationRequestSchema,resultSnapshotSchema} from '../dist/core/estimate-publication.js';
fs.writeFileSync(new URL('../contracts/estimate-publication-request.schema.json',import.meta.url),JSON.stringify(publicationRequestSchema,null,2)+'\n');
fs.writeFileSync(new URL('../contracts/estimate-result-snapshot.schema.json',import.meta.url),JSON.stringify(resultSnapshotSchema,null,2)+'\n');
const old = JSON.parse(fs.readFileSync(new URL('../contracts/oes-ph1.schema.json', import.meta.url), 'utf8'));
const report = structuredClone(old.definitions.Report);
for (const key of ['generated_at', 'localized_reference']) {
  delete report.properties[key]; report.required = report.required.filter(k => k !== key);
}
report.properties.domain.const = 'open-estimate/report/ph1/v3';
report.properties.calculation_basis_hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
report.required.push('calculation_basis_hash');
const string = { type: 'string' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const nullable = value => ({ anyOf: [value, { type: 'null' }] });
const q = nullable(obj({ p25: string, median: string, p75: string }));
const fx = nullable(obj({ currency: string, source_url: { const: 'https://www.federalreserve.gov/releases/h10/current/' }, source_sha256: hash,
  observed_on: string, published_on: string, fetched_at: string, checked_at: string, raw_value: string,
  quote_direction: { enum: ['currency_per_usd', 'usd_per_currency'] }, currency_per_usd: string }));
const quote = obj({ domain: { const: 'open-estimate/display-quote/v1' }, source_report_hash: hash,
  conversion_policy_version: { const: 'frb-display-time-v1' }, displayed_at: string, locale: string, display_currency: string,
  fx_snapshot: fx, localized_reference: obj({ status: { enum: ['AVAILABLE','UPSTREAM_UNAVAILABLE','FX_UNAVAILABLE','FX_STALE'] },
    currency: string, currency_per_usd: nullable(string), amount: q }), person_days: q, limitation_codes: { type: 'array', items: string } });
const view = obj({ evaluation_id: string, assessment_id: string, evaluated_at: string,
  coverage: obj({scope_coverage:{enum:['COMPLETE','MISSING','UNKNOWN']},interpretation_status:{enum:['RECORDED','PROVISIONAL','UNKNOWN']},
    project_effort:q,acquired_portion_effort:q,headline:string,effort_label:string,notice:string}),
  report: { $ref: '#/$defs/Report' }, report_hash: hash, basis: { type: 'object' }, display_quote: { $ref: '#/$defs/DisplayQuote' },
  review: { type: 'object' }, storage: { const: 'LOCAL_ONLY' }, signed: { const: false }, published: { const: false },
  notices: { type: 'array', items: string }, input_reconciled: { type: 'boolean' } });
view.required = view.required.filter(k => k !== 'input_reconciled');
const uuid={type:'string',format:'uuid'};
const workflowView=obj({...view.properties,run_id:uuid,run_directory:string,assessment_path:string,assessment_hash:hash,summary:{type:'object'},workflow_id:uuid});
workflowView.required=workflowView.required.filter(k=>k!=='input_reconciled');
const workflowSummary=obj({response_format:{const:'oes/workflow-evaluation/v2'},workflow_id:uuid,snapshot_id:uuid,assessment_id:uuid,draft_id:{type:'string',pattern:'^draft_[a-f0-9]{64}$'},input_version:{type:'integer',minimum:1},input_hash:hash,status:string,validation_passed:{type:'boolean'},run_id:nullable(uuid),last_error:nullable(string),validation:{type:'object'},signed:{const:false},published:{const:false},next_action:string,byte_limit:{const:65536},coverage:view.properties.coverage,measurement:{type:'object'},display_quote:{$ref:'#/$defs/DisplayQuote'}});
workflowSummary.required=workflowSummary.required.filter(k=>!['coverage','measurement','display_quote'].includes(k));
const snapshotSummary=obj({response_format:{const:'oes/snapshot-summary/v2'},snapshot_id:uuid,assessment_id:uuid,status:string,assessor_defaults:{type:'object'},manifest_hash:hash,analysis_ready:{type:'boolean'},scope_coverage:{enum:['COMPLETE','MISSING','UNKNOWN']},summary:{type:'object'},issues:{type:'object'},snapshot_reused:{type:'boolean'},acquisition_performed:{type:'boolean'},previous_snapshot_id:nullable(uuid),byte_limit:{const:65536},json_payload_limit:{type:'integer'},details:{type:'object'},next_action:string,notice:string});
const detailPage=obj({section:string,revision:hash,total_records:{type:'integer'},total_items:{type:'integer'},offset:{type:'integer'},items:{type:'array',items:{type:'object'}},returned_items:{type:'integer'},has_more:{type:'boolean'},next_cursor:nullable(string),byte_limit:{const:65536},json_payload_limit:{type:'integer'}});
const startChoice=obj({method:{enum:['NEW','RECALCULATE','RESUME']},request_id:uuid,source_workflow_id:uuid,source_run_id:uuid},['method','request_id']);
startChoice.oneOf=[{properties:{method:{const:'NEW'}},not:{anyOf:[{required:['source_workflow_id']},{required:['source_run_id']}]}},{properties:{method:{const:'RECALCULATE'}},required:['source_workflow_id','source_run_id']},{properties:{method:{const:'RESUME'}},required:['source_workflow_id'],not:{required:['source_run_id']}}];
const frozenEvaluation=obj({status:{const:'RESULT_FROZEN'},workflow_id:uuid,run_id:nullable(uuid),validation_passed:{const:true},next_action:{const:'RESUME_SELECTED_STAGES'},result:{type:'object'}});
const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Open Estimate local preview 0.3.0',
  $defs: { StartChoice:startChoice, FrozenWorkflowEvaluation:frozenEvaluation, Assessment: old.definitions.Assessment, Report: report, DisplayQuote: quote, EvaluationView: view, WorkflowEvaluationView:workflowView, WorkflowEvaluationSummary:workflowSummary,RepositorySnapshotSummary:snapshotSummary,RepositoryDetailPage:detailPage, AnyEvaluationView:{type:'object',anyOf:[{$ref:'#/$defs/EvaluationView'},{$ref:'#/$defs/WorkflowEvaluationView'},{$ref:'#/$defs/WorkflowEvaluationSummary'}]} } };
fs.writeFileSync(new URL('../contracts/local-preview.schema.json', import.meta.url), JSON.stringify(schema, null, 2)+'\n');
const { remoteArgsSchema } = await import('../dist/remote/model.js');
fs.writeFileSync(new URL('../contracts/remote-model.schema.json', import.meta.url), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Open Estimate remote model v1/v2', ...remoteArgsSchema
}, null, 2)+'\n');
const { measurementRulesArgsSchema } = await import('../dist/remote/measurement-rules.js');
const { publicResultCandidateSchema } = await import('../dist/core/public-result.js');
fs.writeFileSync(new URL('../contracts/public-result-candidate.schema.json', import.meta.url), JSON.stringify(publicResultCandidateSchema, null, 2)+'\n');
const { rulesBundleSchema, rulesetRefSchema } = await import('../dist/rules/measurement-contract.js');
fs.writeFileSync(new URL('../contracts/measurement-rules.schema.json', import.meta.url), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Open Estimate central measurement rules v1',
  $defs: { GetMeasurementRulesRequest: measurementRulesArgsSchema, RulesBundle: rulesBundleSchema, RulesetRef: rulesetRefSchema }
}, null, 2)+'\n');

const certificate = await import('../dist/core/certificate-contract.js');
const { publicDisplayQuoteSchema } = await import('../dist/core/public-display-quote.js');
for (const [file, schema] of Object.entries({
  'certificate-input': certificate.frozenInputSchema,
  'certificate-approved-draft': certificate.approvedDraftSchema,
  'signed-calculation-certificate': certificate.envelopeSchema,
  'certificate-status': certificate.statusSchema,
  'certificate-calculation-basis': certificate.calculationBasisSchema,
  'public-display-quote': publicDisplayQuoteSchema
})) fs.writeFileSync(new URL(`../contracts/${file}.schema.json`, import.meta.url), JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',...schema},null,2)+'\n');
const error=certificate.obj({error:certificate.obj({code:{type:'string'},request_id:{type:'string'},retryable:{type:'boolean'}})});
const paths={};
for(const [path,method,request,response] of [
  ['/certificate-previews','post',certificate.previewRequestSchema,certificate.previewResponseSchema],
  ['/certificate-previews/{preview_id}','get',null,certificate.previewResponseSchema],
  ['/publications','post',certificate.publishRequestSchema,certificate.publishResponseSchema],
  ['/publications/{share_id}/withdraw','post',certificate.withdrawRequestSchema,certificate.withdrawResponseSchema],
  ['/issuance-requests/{idempotency_key}','get',null,certificate.receiptResponseSchema],
  ['/shared-estimates/{share_id}','get',null,certificate.sharedResponseSchema],
  ['/shared-estimates/{share_id}/display-quote','get',null,publicDisplayQuoteSchema],
  ['/certificates/{certificate_id}/status','get',null,certificate.statusSchema],
  ['/shared-estimates/{share_id}/certificate.json','get',null,certificate.envelopeSchema],
  ['/calculation-bases/{sha256}','get',null,certificate.calculationBasisSchema]
]) {
  const parameters=[...path.matchAll(/\{([^}]+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string'}}));
  if(path==='/publications')parameters.push({name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',format:'uuid'}});
  paths[path]={[method]:{parameters,...(request?{requestBody:{required:true,content:{'application/json':{schema:request}}}}:{}),responses:{
    ...(response?Object.fromEntries((path==='/publications'?['200','201']:['200']).map(status=>[status,{description:'Strict successful response; Cache-Control: no-store',content:{'application/json':{schema:response}}}])):{}),
    default:{description:'Fixed code only; input bodies and diagnostics are never echoed. Unconfigured deployment refuses publication.',content:{'application/json':{schema:error}}}
  }}};
}
fs.writeFileSync(new URL('../contracts/certificate-api.openapi.json',import.meta.url),JSON.stringify({openapi:'3.1.0',info:{title:'Open Estimate certificate API (development; production adapter disabled)',version:'1.0.0'},servers:[{url:'/api/v1'}],paths},null,2)+'\n');

const estimate=await import('../dist/core/estimate-preview.js');
fs.writeFileSync(new URL('../contracts/owner-estimate-input.schema.json',import.meta.url),JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',...estimate.estimateInputSchema},null,2)+'\n');
const transfer=await import('../dist/core/preview-transfer-contract.js');
for(const [name,schema] of Object.entries({'preview-transfer-error':transfer.previewErrorSchema,'preview-transfer-create':transfer.transferCreateSchema,'preview-transfer-created':transfer.transferCreateResponseSchema,'preview-transfer-status':transfer.transferStatusSchema,'preview-transfer-submit':transfer.transferSubmissionSchema,'owner-certificate-preview':transfer.ownerPreviewSchema,'owner-estimate-preview':transfer.anyOwnerPreviewSchema}))fs.writeFileSync(new URL('../contracts/'+name+'.schema.json',import.meta.url),JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',...schema},null,2)+'\n');
