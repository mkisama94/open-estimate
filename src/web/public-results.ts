import {checkEstimate,PUBLICATION_MS,type PublishEstimate,type PublishedEstimate,type EstimateResult,type EstimateProof,type TrustedEstimateKey} from '../contracts/estimate-result.js';
import {estimateHash,estimateResultHash,verifyEstimateProof} from '../proof/estimate-proof.js';
import {PublicResultsRepository,type PublicRow} from './public-results-repository.js';
export class PublicResultsError extends Error {constructor(public code:string,public status:number,public state?:string){super(code);}}
const fail=(c:string,s:number,state?:string):never=>{throw new PublicResultsError(c,s,state);};
export class PublicResultsService {
 constructor(readonly repository:PublicResultsRepository,readonly config:{origin:string;environment:'production'|'test';keys:readonly TrustedEstimateKey[];enabled:boolean},readonly clock=()=>Date.now()){
  const u=new URL(config.origin);if(u.origin!==config.origin||u.protocol!=='https:')throw Error('PUBLIC_RESULT_CONFIGURATION_INVALID');
 }
 active(row:PublicRow|null){if(!row)return fail('RESULT_NOT_FOUND',404);if(row.state!=='PUBLISHED'||this.clock()>=row.expires_at)fail('RESULT_UNAVAILABLE',410,row.state==='WITHDRAWN'?'WITHDRAWN':'EXPIRED');return row;}
 response(r:PublicRow):PublishedEstimate {return {schema_version:'oes/published-estimate/v1',status:'PUBLISHED',public_result_id:r.public_result_id,canonical_url:this.config.origin+'/results/'+r.public_result_id,result_hash:r.result_hash,published_at:new Date(r.published_at).toISOString(),expires_at:new Date(r.expires_at).toISOString()};}
 async register(value:unknown){
  let input:PublishEstimate;try{input=checkEstimate('publish',value);}catch{ return fail('INVALID_PUBLICATION_INPUT',400); }
  const fingerprint=await estimateHash(input),same=(row:PublicRow)=>{if(row.fingerprint!==fingerprint)fail('PUBLICATION_OPERATION_CONFLICT',409);return {created:false,response:this.response(this.active(row))};};
  const old=await this.repository.operation(input.operation_id);if(old)return same(old);
  if(!this.config.enabled)fail('PUBLICATION_DISABLED',503);
  try{await verifyEstimateProof(input.result,input.proof,this.config.keys,this.config.environment);}catch{return fail('PUBLICATION_PROOF_INVALID',422);}
  const now=this.clock();if([input.result.measured_at,input.result.display_quote.displayed_at,input.proof.statement.issued_at].some(t=>Date.parse(t)>now+30000))fail('PUBLICATION_TIME_INVALID',422);
  const random=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const row:PublicRow={public_result_id:'res_'+random,operation_id:input.operation_id,fingerprint,result_hash:await estimateResultHash(input.result),result_json:JSON.stringify(input.result),proof_json:JSON.stringify(input.proof),withdrawal_token_hash:input.withdrawal_token_hash,published_at:now,expires_at:now+PUBLICATION_MS,state:'PUBLISHED',withdrawn_at:null};
  try{await this.repository.insert(row);}catch{const raced=await this.repository.operation(input.operation_id);if(raced)return same(raced);return fail('PUBLICATION_STORAGE_UNAVAILABLE',503);}
  const committed=await this.repository.operation(input.operation_id);if(!committed)return fail('PUBLICATION_STORAGE_UNAVAILABLE',503);
  return {created:true,response:this.response(this.active(committed))};
 }
 async read(id:string){const row=this.active(await this.repository.result(id));if(!row.result_json||!row.proof_json)return fail('RESULT_UNAVAILABLE',410,'EXPIRED');
  const result=checkEstimate<EstimateResult>('result',JSON.parse(row.result_json)),proof=checkEstimate<EstimateProof>('proof',JSON.parse(row.proof_json));
  await verifyEstimateProof(result,proof,this.config.keys,this.config.environment);this.active(row);return {row,result,proof,publication:this.response(row)};
 }
 async authorized(row:PublicRow|null,token:string){if(!row||!/^[A-Za-z0-9_-]{43}$/.test(token))return fail('RESULT_NOT_FOUND',404);const actual=await estimateHash({domain:'oes/withdrawal-token/v1',token});let mismatch=actual.length^row.withdrawal_token_hash.length;for(let i=0;i<actual.length;i++)mismatch|=actual.charCodeAt(i)^row.withdrawal_token_hash.charCodeAt(i);if(mismatch)return fail('RESULT_NOT_FOUND',404);return row;}
 async operation(id:string,token:string){const r=await this.authorized(await this.repository.operation(id),token);this.active(r);return this.response(r);}
 async withdraw(id:string,token:string){const row=await this.authorized(await this.repository.result(id),token);if(row.state==='WITHDRAWN')return {status:'WITHDRAWN'};this.active(row);await this.repository.withdraw(id,this.clock());return {status:'WITHDRAWN'};}
}
