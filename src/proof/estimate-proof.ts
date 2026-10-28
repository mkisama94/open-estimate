import {checkEstimate,type EstimateResult,type EstimateProof,type TrustedEstimateKey} from '../contracts/estimate-result.js';
import {jcsBytes} from '../core/canonical-json.js';
import {proofBytes,base64url,decodeBase64url} from './crypto.js';
export async function estimateHash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',jcsBytes(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export const estimateResultHash=(result:EstimateResult)=>estimateHash({domain:'oes/estimate-result-hash/v1',result:checkEstimate('result',result)});
export async function verifyEstimateProof(result:EstimateResult,value:unknown,keys:readonly TrustedEstimateKey[],environment?:'test'|'production'){
 checkEstimate('result',result);const p=checkEstimate<EstimateProof>('proof',value),s=p.statement;
 const key=keys.find(k=>k.key_id===s.key_id&&k.issuer===s.issuer&&k.environment===s.environment&&k.algorithm==='Ed25519');
 if(!key||environment&&s.environment!==environment||new URL(s.issuer).origin!==s.issuer||!s.issuer.startsWith('https://'))throw Error('ESTIMATE_ISSUER_UNTRUSTED');
 if(s.result_hash!==await estimateResultHash(result)||await estimateHash(s.ruleset_ref)!==await estimateHash(result.ruleset_ref))throw Error('ESTIMATE_PROOF_MISMATCH');
 const publicKey=await crypto.subtle.importKey('raw',decodeBase64url(key.public_key),{name:'Ed25519'},false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',publicKey,decodeBase64url(p.signature),proofBytes(s)))throw Error('ESTIMATE_SIGNATURE_INVALID');
 return {schema:'VALID',signature:'VALID',result:'MATCH',issuer:'TRUSTED',current_status:'NOT_CHECKED'} as const;
}
export async function createEstimateSigner(pkcs8:string){const key=await crypto.subtle.importKey('pkcs8',decodeBase64url(pkcs8),{name:'Ed25519'},false,['sign']);return async(statement:EstimateProof['statement']):Promise<EstimateProof>=>({statement,signature:base64url(new Uint8Array(await crypto.subtle.sign('Ed25519',key,proofBytes(statement))))});}
