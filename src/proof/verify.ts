import type {DocumentProof,TrustedDocumentKey} from '../contracts/document.js';
import {checkDocumentProof} from '../contracts/document-reader.js';
import {proofBytes,base64url,decodeBase64url,documentHash} from './crypto.js';
export interface DocumentVerification {schema:'VALID'|'INVALID';signature:'VALID'|'INVALID'|'UNKNOWN_KEY';document:'MATCH'|'MISMATCH';issuer:'TRUSTED'|'UNTRUSTED';current_status:'NOT_CHECKED'}
/** Never fetch a key supplied by the document or claim a live revocation check. */
export async function verifyDocumentProof(markdown:string,value:unknown,keys:readonly TrustedDocumentKey[]):Promise<DocumentVerification>{
 const v:DocumentVerification={schema:'INVALID',signature:'INVALID',document:'MISMATCH',issuer:'UNTRUSTED',current_status:'NOT_CHECKED'};let proof:DocumentProof;
 try{proof=checkDocumentProof(value);const s=proof.statement;if(!s.issuer.startsWith('https://')||new URL(s.issuer).origin!==s.issuer||!s.key_id.startsWith(s.environment==='test'?'doc_test_':'doc_prod_'))return v;v.schema='VALID';}catch{return v;}
 const s=proof.statement;v.document=await documentHash(markdown)===s.document_sha256?'MATCH':'MISMATCH';
 const key=keys.find(k=>k.key_id===s.key_id&&k.environment===s.environment&&k.issuer===s.issuer&&k.algorithm==='Ed25519');if(!key){v.signature='UNKNOWN_KEY';return v;}v.issuer='TRUSTED';
 try{const bytes=decodeBase64url(key.public_key);if(bytes.length!==32||base64url(bytes)!==key.public_key)return v;const publicKey=await crypto.subtle.importKey('raw',bytes,{name:'Ed25519'},false,['verify']);v.signature=await crypto.subtle.verify('Ed25519',publicKey,decodeBase64url(proof.signature),proofBytes(s))?'VALID':'INVALID';}catch{v.signature='INVALID';}return v;
}
