import fs from 'node:fs/promises';
import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import {build} from 'esbuild';
const old=JSON.parse(await fs.readFile('src/contracts/document.schema.json','utf8'));
const obj=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const hash={type:'string',pattern:'^[a-f0-9]{64}$'},uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const props=structuredClone(old.document.properties);delete props.template_version;props.schema_version={const:'oes/estimate-result/v1'};
props.display_quote.properties.locale={enum:['ja-JP','en-US']};
// Every public string is a number, timestamp, fixed source, catalog identifier or code.
const fxCodes=['FX_UNAVAILABLE','FX_STALE','FX_CACHE_AFTER_FAILURE','FRB_REDIRECT_REJECTED','FRB_HTTP_ERROR','FRB_CONTENT_TYPE_INVALID','FRB_BODY_MISSING','FRB_RESPONSE_TOO_LARGE','FRB_UTF8_INVALID','FRB_RESPONSE_INVALID','FRB_TIMEOUT','FRB_FETCH_FAILED','FRB_CURRENCY_UNAVAILABLE'];
props.display_quote.properties.limitation_codes.items={enum:[...props.result.properties.limitation_codes.items.enum,...fxCodes]};
const result=obj(props);
function bound(s){
 if(!s||typeof s!=='object')return;
 if(s.format==='date-time'){s.pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';s.maxLength=24;}
 if(s.type==='array'&&!s.maxItems)s.maxItems=64;
 if(s.type==='string'&&!s.maxLength)s.maxLength=256;
 if(s.type==='string'&&s.pattern==='^(0|[1-9][0-9]*)(\\.[0-9]+)?$')s.pattern='^(0|[1-9][0-9]*)(\\.[0-9]*[1-9])?$';
 for(const v of Object.values(s))if(v&&typeof v==='object')Array.isArray(v)?v.forEach(bound):bound(v);
}
bound(result);
const validation=structuredClone(old.request.properties.validation_input);validation.properties.schema_version={const:'oes/estimate-validation-input/v1'};
const request=obj({schema_version:{const:'oes/estimate-proof-request/v1'},operation_id:uuid,result,validation_input:validation});
const st=structuredClone(old.proof.properties.statement.properties);
st.schema_version={const:'oes/estimate-proof/v1'};st.domain={const:'oes/calculation-verified-estimate/v1'};st.proof_id={type:'string',pattern:'^estp_[a-f0-9]{32}$'};delete st.document_sha256;st.result_hash=hash;
st.verification_method={const:'oes/numeric-estimate-verification/v1'};st.scope={const:['NUMERIC_CONSISTENCY','RULESET_REFERENCE','STRUCTURED_RESULT_BINDING']};st.limitations={const:['SOURCE_COVERAGE_CLIENT_REPORTED','AI_SEMANTICS_NOT_AUDITED','FX_AUTHENTICITY_NOT_AUDITED','ACTUAL_EFFORT_NOT_GUARANTEED','DELIVERY_AND_MARKET_PRICE_NOT_GUARANTEED','SUBMITTER_IDENTITY_NOT_VERIFIED']};
const proof=obj({statement:obj(st),signature:old.proof.properties.signature});
const publish=obj({schema_version:{const:'oes/publish-estimate/v1'},operation_id:uuid,result,proof,withdrawal_token_hash:hash});
const response=obj({schema_version:{const:'oes/published-estimate/v1'},status:{const:'PUBLISHED'},public_result_id:{type:'string',pattern:'^res_[a-f0-9]{32}$'},canonical_url:{type:'string',format:'uri',maxLength:256},result_hash:hash,published_at:props.measured_at,expires_at:props.measured_at});
const schemas={result,proof,request,publish,response};
await fs.writeFile('src/contracts/estimate.schema.json',JSON.stringify(schemas,null,2)+'\n');
for(const [k,schema] of Object.entries(schemas)){
 const ajv=new Ajv2020({strict:false,ownProperties:true,code:{source:true}});addFormats(ajv);ajv.addSchema(schema,k);
 const r=await build({stdin:{contents:standalone(ajv,{validate:k}),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',minify:true});
 const out=r.outputFiles[0].text.replace(/export default ([^;]+);?\s*$/,'const generated=$1; export const validate=generated.validate;');
 await fs.writeFile('src/contracts/estimate-'+k+'-validator.ts','// @ts-nocheck\n// Generated standalone contract; no runtime compilation.\n'+out);
 await fs.writeFile('contracts/estimate-'+k+'.schema.json',JSON.stringify(schema,null,2)+'\n');
}
