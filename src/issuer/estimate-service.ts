import {checkEstimate,documentFromResult,type EstimateProofRequest,type EstimateProof,type TrustedEstimateKey} from '../contracts/estimate-result.js';
import {estimateHash,estimateResultHash,verifyEstimateProof,createEstimateSigner} from '../proof/estimate-proof.js';
import {validateCalculationData} from './validation.js';
import type {IssuanceCatalog} from '../core/certificate.js';
import type {IssuerDatabase} from './repository.js';
import type {DocumentIssuerEnvironment} from './runtime.js';
export interface EstimateIssuance {operation_id:string;fingerprint:string;proof_json:string;issued_at:number}
export interface EstimateIssuanceRepository {get(id:string):Promise<EstimateIssuance|null>;commit(id:string,fingerprint:string,proof:EstimateProof,now:number):Promise<void>}
export class EstimateIssuerRepository implements EstimateIssuanceRepository {
 constructor(private db:IssuerDatabase){}
 get(id:string){return this.db.prepare('SELECT * FROM estimate_proof_issuances WHERE operation_id=?').bind(id).first<EstimateIssuance>();}
 async commit(id:string,fingerprint:string,p:EstimateProof,now:number){await this.db.batch([
  this.db.prepare('INSERT INTO estimate_proof_guards VALUES (?,CASE WHEN (SELECT COUNT(*) FROM estimate_proof_issuances)<1000000 AND (SELECT COUNT(*) FROM estimate_proof_issuances WHERE issued_at>?)<100 THEN 1 ELSE 0 END)').bind(id,now-60000),
  this.db.prepare('INSERT INTO estimate_proof_issuances VALUES (?,?,?,?,?)').bind(id,fingerprint,p.statement.proof_id,JSON.stringify(p),now),
  this.db.prepare('DELETE FROM estimate_proof_guards WHERE operation_id=?').bind(id)
 ]);}
}
export class EstimateIssuerService {
 constructor(private repository:EstimateIssuanceRepository,private config:{enabled:boolean;key:TrustedEstimateKey},private catalog:IssuanceCatalog,private sign:(s:EstimateProof['statement'])=>Promise<EstimateProof>){}
 async issue(value:unknown,now=Date.now()){
  const r=checkEstimate<EstimateProofRequest>('request',value),fingerprint=await estimateHash(r);
  const same=(row:EstimateIssuance)=>{if(row.fingerprint!==fingerprint)throw Error('ESTIMATE_OPERATION_CONFLICT');return checkEstimate<EstimateProof>('proof',JSON.parse(row.proof_json));};
  const old=await this.repository.get(r.operation_id);if(old)return same(old);
  if(!this.config.enabled)throw Error('ESTIMATE_ISSUANCE_DISABLED');
  const k=this.config.key;if(!k.key_id.startsWith(k.environment==='test'?'doc_test_':'doc_prod_')||new URL(k.issuer).origin!==k.issuer||!k.issuer.startsWith('https://'))throw Error('ESTIMATE_SIGNING_CONFIGURATION_INVALID');
  if([r.result.measured_at,r.result.display_quote.displayed_at].some(t=>Date.parse(t)>now+30000))throw Error('ESTIMATE_TIME_INVALID');
  await validateCalculationData(documentFromResult(r.result),{...r.validation_input,schema_version:'oes/document-validation-input/v1'},{...this.catalog,now});
  const statement:EstimateProof['statement']={schema_version:'oes/estimate-proof/v1',domain:'oes/calculation-verified-estimate/v1',algorithm:'Ed25519',issuer:k.issuer,environment:k.environment,key_id:k.key_id,proof_id:'estp_'+(await estimateHash({issuer:k.issuer,operation:r.operation_id})).slice(0,32),issued_at:new Date(now).toISOString(),result_hash:await estimateResultHash(r.result),ruleset_ref:r.result.ruleset_ref,verification:'CALCULATION_VERIFIED',verification_method:'oes/numeric-estimate-verification/v1',scope:['NUMERIC_CONSISTENCY','RULESET_REFERENCE','STRUCTURED_RESULT_BINDING'],limitations:['SOURCE_COVERAGE_CLIENT_REPORTED','AI_SEMANTICS_NOT_AUDITED','FX_AUTHENTICITY_NOT_AUDITED','ACTUAL_EFFORT_NOT_GUARANTEED','DELIVERY_AND_MARKET_PRICE_NOT_GUARANTEED','SUBMITTER_IDENTITY_NOT_VERIFIED']};
  const proof=await this.sign(statement);if(await estimateHash(proof.statement)!==await estimateHash(statement))throw Error('ESTIMATE_SIGNING_UNAVAILABLE');await verifyEstimateProof(r.result,proof,[k],k.environment);
  try{await this.repository.commit(r.operation_id,fingerprint,proof,now);}catch{const raced=await this.repository.get(r.operation_id);if(raced)return same(raced);throw Error('ESTIMATE_RECORD_UNAVAILABLE');}
  const row=await this.repository.get(r.operation_id);if(!row)throw Error('ESTIMATE_RECORD_UNAVAILABLE');return same(row);
 }
}
export interface EstimateIssuerEnvironment extends DocumentIssuerEnvironment {ESTIMATE_PROOF_DB?:IssuerDatabase;ESTIMATE_ISSUANCE_ENABLED?:string}
export async function issueEstimateProof(value:unknown,env:EstimateIssuerEnvironment,catalog:IssuanceCatalog){
 if(!env.ESTIMATE_PROOF_DB||!env.DOCUMENT_ISSUANCE_LIMITER)throw Error('ESTIMATE_SERVICE_UNAVAILABLE');
 if(!(await env.DOCUMENT_ISSUANCE_LIMITER.limit({key:'estimate-global'})).success)throw Error('ESTIMATE_RATE_LIMITED');
 if(!env.DOCUMENT_SIGNING_PRIVATE_KEY||!env.DOCUMENT_SIGNING_PUBLIC_KEY||!env.DOCUMENT_SIGNING_KEY_ID||!env.DOCUMENT_ISSUER_ORIGIN||!['test','production'].includes(env.DOCUMENT_ENVIRONMENT??''))throw Error('ESTIMATE_SIGNING_UNAVAILABLE');
 const key:TrustedEstimateKey={key_id:env.DOCUMENT_SIGNING_KEY_ID,algorithm:'Ed25519',public_key:env.DOCUMENT_SIGNING_PUBLIC_KEY,issuer:env.DOCUMENT_ISSUER_ORIGIN,environment:env.DOCUMENT_ENVIRONMENT as 'test'|'production'};
 return new EstimateIssuerService(new EstimateIssuerRepository(env.ESTIMATE_PROOF_DB),{enabled:env.ESTIMATE_ISSUANCE_ENABLED==='true',key},catalog,await createEstimateSigner(env.DOCUMENT_SIGNING_PRIVATE_KEY)).issue(value);
}
