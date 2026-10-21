import fs from 'node:fs';
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
  report: { $ref: '#/$defs/Report' }, report_hash: hash, basis: { type: 'object' }, display_quote: { $ref: '#/$defs/DisplayQuote' },
  review: { type: 'object' }, storage: { const: 'LOCAL_ONLY' }, signed: { const: false }, published: { const: false },
  notices: { type: 'array', items: string }, input_reconciled: { type: 'boolean' } });
view.required = view.required.filter(k => k !== 'input_reconciled');
const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Open Estimate local preview 0.3.0',
  $defs: { Assessment: old.definitions.Assessment, Report: report, DisplayQuote: quote, EvaluationView: view } };
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
