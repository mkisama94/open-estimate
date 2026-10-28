import fs from 'node:fs/promises';
import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import {build} from 'esbuild';
import {publicResultCandidateSchema} from '../dist/core/public-result.js';
import {displayQuoteSchema,estimateInputSchema} from '../dist/core/estimate-preview.js';
import {rulesetRefSchema} from '../dist/rules/measurement-contract.js';
const obj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const time={type:'string',format:'date-time',maxLength:24},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const document=obj({schema_version:{const:'oes/estimate-document/v1'},template_version:{const:'oes/estimate-markdown/v1'},measured_at:time,ruleset_ref:rulesetRefSchema,scope:{const:'AGREED_AS_BUILT_FUNCTIONAL_SCOPE'},scope_coverage:{enum:['COMPLETE','MISSING','UNKNOWN']},result:publicResultCandidateSchema,display_quote:displayQuoteSchema});
const evaluation=estimateInputSchema.properties.evaluation.properties;
const validationInput=obj({schema_version:{const:'oes/document-validation-input/v1'},model:evaluation.model,quality:estimateInputSchema.properties.quality,ruleset_ref:rulesetRefSchema,skill_integrity:evaluation.skill_integrity,display_currency:evaluation.display_currency,expected_report_hash:hash});
const request=obj({schema_version:{const:'oes/document-proof-request/v1'},operation_id:{type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'},document,markdown:{type:'string',minLength:1,maxLength:262144},validation_input:validationInput});
const proof=obj({statement:obj({schema_version:{const:'oes/document-proof/v1'},domain:{const:'oes/calculation-verified-document/v1'},algorithm:{const:'Ed25519'},issuer:{type:'string',format:'uri',maxLength:200},proof_id:{type:'string',pattern:'^docp_[a-f0-9]{32}$'},issued_at:time,document_sha256:hash,ruleset_ref:rulesetRefSchema,verification:{const:'CALCULATION_VERIFIED'},verification_method:{const:'oes/numeric-document-verification/v1'},scope:{const:['DOCUMENT_FORMAT','NUMERIC_CONSISTENCY','RULESET_REFERENCE','DOCUMENT_BINDING']},limitations:{const:['SOURCE_COVERAGE_CLIENT_REPORTED','AI_SEMANTICS_NOT_AUDITED','FX_AUTHENTICITY_NOT_AUDITED','ACTUAL_EFFORT_NOT_GUARANTEED','SUBMITTER_IDENTITY_NOT_VERIFIED','FREE_TEXT_NOT_VERIFIED']},key_id:{type:'string',pattern:'^doc_(test|prod)_[a-f0-9]{32}$'},environment:{enum:['test','production']}}),signature:{type:'string',pattern:'^[A-Za-z0-9_-]{85}[AQgw]$'}});
const schemas={document,request,proof};
await fs.mkdir('src/contracts',{recursive:true});await fs.writeFile('src/contracts/document.schema.json',JSON.stringify(schemas,null,2)+'\n');
const ajv=new Ajv2020({strict:false,ownProperties:true,code:{source:true}});addFormats(ajv);for(const [key,schema] of Object.entries(schemas))ajv.addSchema(schema,key);
const source=standalone(ajv,Object.fromEntries(Object.keys(schemas).map(k=>[k,k])))+'\nexports.validators={document:exports.document,request:exports.request,proof:exports.proof};';
const r=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',minify:true});
const output=r.outputFiles[0].text.replace(/export default ([^;]+);?\s*$/,'const generated=$1; export const validators=generated.validators;');
await fs.writeFile('src/contracts/document-validators.ts','// @ts-nocheck\n// Generated standalone validators; no dynamic compilation.\n'+output);
// Display contracts do not acquire the numeric verification-model contract.
for(const [key,name] of [['document','estimate-document'],['proof','document-proof']]){
 const code=standalone(ajv,{validate:key});const r=await build({stdin:{contents:code,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',minify:true});
 const out=r.outputFiles[0].text.replace(/export default ([^;]+);?\s*$/,'const generated=$1; export const validate=generated.validate;');
 await fs.writeFile('src/contracts/'+name+'-validator.ts','// @ts-nocheck\n// Generated standalone display validator.\n'+out);
 await fs.writeFile('contracts/'+name+'.schema.json',JSON.stringify(schemas[key],null,2)+'\n');
}
await fs.writeFile('contracts/document-proof-request.schema.json',JSON.stringify(request,null,2)+'\n');
