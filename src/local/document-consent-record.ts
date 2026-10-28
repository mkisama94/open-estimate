import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolveSafePath} from '../collector/safe-paths.js';
import {jcsSha256} from '../core/canonical.js';

export interface DocumentConsentBinding {action:'proof'|'web';document_sha256:string;destination:string;purpose:string;request_hash:string}
export interface DocumentConsentRecord extends DocumentConsentBinding {confirmed_at:string;explicit_answer:string;evidence:'HOST_REPORTED_EXPLICIT_USER_ANSWER_NOT_IDENTITY_PROOF'}
export function documentConsentFile(binding:DocumentConsentBinding){
 if(!['proof','web'].includes(binding.action)||!/^[a-f0-9]{64}$/.test(binding.request_hash))throw new Error('INVALID_DOCUMENT_ACTION');
 return `consent-${binding.action}-${jcsSha256({action:binding.action,document_sha256:binding.document_sha256,destination:binding.destination,purpose:binding.purpose,request_hash:binding.request_hash})}.json`;
}
function assertBinding(value:DocumentConsentRecord,binding:DocumentConsentBinding){
 if(!value||(['action','document_sha256','destination','purpose','request_hash'] as const).some(k=>value[k]!==binding[k])||typeof value.explicit_answer!=='string'||!value.explicit_answer.trim()||value.explicit_answer.length>2000||!Number.isFinite(Date.parse(value.confirmed_at))||value.evidence!=='HOST_REPORTED_EXPLICIT_USER_ANSWER_NOT_IDENTITY_PROOF')throw new Error('DOCUMENT_CONSENT_CHANGED');
 return value;
}
async function read(dir:string,file:string){const full=await resolveSafePath(file,dir);if((await fs.stat(full)).size>16384)throw new Error('DOCUMENT_CONSENT_RECORD_INVALID');return JSON.parse(await fs.readFile(full,'utf8')) as DocumentConsentRecord;}
/** Exact request first. Legacy action-only records are read, never replaced. */
export async function readDocumentConsentRecord(dir:string,binding:DocumentConsentBinding){
 let value:DocumentConsentRecord;
 try{value=await read(dir,documentConsentFile(binding));}
 catch(e:any){if(e.code!=='ENOENT')throw e;try{value=await read(dir,`consent-${binding.action}-${binding.request_hash}.json`);}catch(e:any){if(e.code!=='ENOENT')throw e;try{value=await read(dir,`consent-${binding.action}.json`);}catch(e:any){if(e.code==='ENOENT')throw new Error('DOCUMENT_CONSENT_REQUIRED');throw e;}}}
 return assertBinding(value,binding);
}
/** Publish a fully written record without replacing a prior consent, even concurrently. */
export async function saveDocumentConsentRecord(dir:string,record:DocumentConsentRecord){
 const target=path.join(dir,documentConsentFile(record)),temporary=path.join(dir,`consent-${randomUUID()}.tmp`);
 try{await fs.writeFile(temporary,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  try{await fs.link(temporary,target);}catch(e:any){if(e.code!=='EEXIST')throw e;}
 }finally{await fs.unlink(temporary).catch((e:any)=>{if(e.code!=='ENOENT')throw e;});}
 return readDocumentConsentRecord(dir,record);
}
