import type {DocumentProof,ProofStatement} from '../contracts/document.js';
import {proofBytes,base64url,decodeBase64url} from '../proof/crypto.js';
export async function createDocumentSigner(pkcs8:string){
 let key:Awaited<ReturnType<typeof crypto.subtle.importKey>>;try{key=await crypto.subtle.importKey('pkcs8',decodeBase64url(pkcs8),{name:'Ed25519'},false,['sign']);}catch{throw new Error('DOCUMENT_SIGNING_UNAVAILABLE');}
 return async(statement:ProofStatement):Promise<DocumentProof>=>({statement:structuredClone(statement),signature:base64url(new Uint8Array(await crypto.subtle.sign('Ed25519',key,proofBytes(statement))))});
}
