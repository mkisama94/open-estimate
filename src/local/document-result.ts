import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolveSafePath} from '../collector/safe-paths.js';
import {jcsSha256,sha256Hex} from '../core/canonical.js';
import {checkDocumentContract,type EstimateDocument,type DocumentProof,type TrustedDocumentKey} from '../contracts/document.js';
import {assertDocumentMarkdown} from '../document/markdown.js';
import {documentPresentation} from '../document/presentation.js';
import {documentHash} from '../proof/crypto.js';
import {verifyDocumentProof} from '../proof/verify.js';
import {renderDocumentPdf} from './estimate-pdf.js';
import keys from '../../profiles/document-signing-keys.json' with {type:'json'};
import {readDocumentConsentRecord} from './document-consent-record.js';
import {PROOF_DESTINATION} from './document-services.js';

export async function writeDocumentFile(dir:string,name:string,data:string|Buffer){await fs.writeFile(path.join(dir,name),data,{flag:'wx',mode:0o600});}
export const jsonFile=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
export async function readDocumentFile(dir:string,name:string,max=1048576){const file=await resolveSafePath(name,path.resolve(dir));if((await fs.stat(file)).size>max)throw new Error('DOCUMENT_FILE_TOO_LARGE');return fs.readFile(file);}
export async function readDocument(dir:string){
 if(!path.isAbsolute(dir))throw new Error('ABSOLUTE_DOCUMENT_DIRECTORY_REQUIRED');
 const jsonBytes=await readDocumentFile(dir,'document.json'),data=checkDocumentContract<EstimateDocument>('document',JSON.parse(jsonBytes.toString()));
 const bytes=await readDocumentFile(dir,'estimate.md',262144),markdown=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);assertDocumentMarkdown(data,markdown);
 const hash=await documentHash(markdown);try{const integrity=JSON.parse((await readDocumentFile(dir,'document-ready.json',2048)).toString());if(integrity.document_sha256!==hash||integrity.json_sha256!==sha256Hex(jsonBytes))throw new Error('DOCUMENT_CONTENT_CHANGED');}catch(e:any){if(e.code!=='ENOENT')throw e;}
 return {dir:path.resolve(dir),document:data,markdown,document_sha256:hash};
}
export async function showDocument(dir:string){
 const d=await readDocument(dir);let proof:unknown=null,verification:unknown=null,proofVerified=false;
 try{proof=JSON.parse((await readDocumentFile(dir,'proof.json',32768)).toString());const v=await verifyDocumentProof(d.markdown,proof,keys as TrustedDocumentKey[]);verification=v;proofVerified=v.signature==='VALID'&&v.document==='MATCH'&&v.issuer==='TRUSTED';}catch(e:any){if(e.code!=='ENOENT')verification={error:'PROOF_UNREADABLE'};}
 let pdf:string|null=null;try{const marker=JSON.parse((await readDocumentFile(dir,'pdf-ready.json',2048)).toString()),bytes=await readDocumentFile(dir,'estimate.pdf',8*1024*1024);if(marker.document_sha256!==d.document_sha256||marker.pdf_sha256!==sha256Hex(bytes)||marker.proof_sha256!==(proofVerified?jcsSha256(proof):null))throw Error('PDF_CONTENT_CHANGED');pdf=path.join(d.dir,'estimate.pdf');}catch{}
 let local_details:unknown=null;try{local_details=JSON.parse((await readDocumentFile(dir,'local-reference.json')).toString());}catch{}
 return {...d,presentation:documentPresentation(d.document),local_details,pdf,proof,verification,status:pdf?'DOCUMENT_READY':'PDF_INCOMPLETE',transmitted:false,completion:{document:true,proof:proofVerified,web_display:'NOT_CONFIRMED',saved:false}};
}
export async function renderDocumentPdfFile(dir:string,trustedKeys:readonly TrustedDocumentKey[]=keys as TrustedDocumentKey[]){
 const d=await readDocument(dir);let proof:DocumentProof|undefined;
 try{const value=JSON.parse((await readDocumentFile(dir,'proof.json',32768)).toString()),v=await verifyDocumentProof(d.markdown,value,trustedKeys);if(v.signature==='VALID'&&v.document==='MATCH'&&v.issuer==='TRUSTED')proof=value;}catch(e:any){if(e.code!=='ENOENT')throw e;}
 const bytes=await renderDocumentPdf(d.document,proof),tmp=path.join(d.dir,`pdf-${randomUUID()}.tmp`);
 await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});await fs.rename(tmp,path.join(d.dir,'estimate.pdf'));
 const marker=path.join(d.dir,`pdf-marker-${randomUUID()}.tmp`);await fs.writeFile(marker,jsonFile({document_sha256:d.document_sha256,pdf_sha256:sha256Hex(bytes),proof_sha256:proof?jcsSha256(proof):null}),{flag:'wx',mode:0o600});await fs.rename(marker,path.join(d.dir,'pdf-ready.json'));
 return {path:path.join(d.dir,'estimate.pdf'),document_sha256:d.document_sha256,pdf_signed:false,proof_attached:!!proof};
}
export async function attachDocumentProof(dir:string,value:unknown,trustedKeys:readonly TrustedDocumentKey[]=keys as TrustedDocumentKey[]){
 const d=await readDocument(dir),proof=checkDocumentContract<DocumentProof>('proof',value),v=await verifyDocumentProof(d.markdown,proof,trustedKeys);
 if(v.schema!=='VALID'||v.signature!=='VALID'||v.document!=='MATCH'||v.issuer!=='TRUSTED'||jcsSha256(proof.statement.ruleset_ref)!==jcsSha256(d.document.ruleset_ref))throw new Error('DOCUMENT_PROOF_REJECTED');
 // Receiving a valid proof is only allowed for the locally consented exact request.
 const request=JSON.parse((await readDocumentFile(dir,'proof-request.json')).toString()),consent=await readDocumentConsentRecord(dir,{action:'proof',document_sha256:d.document_sha256,destination:PROOF_DESTINATION,purpose:'CALCULATION_VERIFICATION_AND_DOCUMENT_PROOF',request_hash:jcsSha256(request)});
 if(consent.action!=='proof'||consent.purpose!=='CALCULATION_VERIFICATION_AND_DOCUMENT_PROOF'||consent.destination!==PROOF_DESTINATION||!consent.explicit_answer?.trim()||consent.document_sha256!==d.document_sha256||consent.request_hash!==jcsSha256(request)||request.markdown!==d.markdown||jcsSha256(request.document)!==jcsSha256(d.document)||proof.statement.issuer!==new URL(consent.destination).origin||proof.statement.proof_id!=='docp_'+jcsSha256({issuer:proof.statement.issuer,operation:request.operation_id}).slice(0,32))throw new Error('DOCUMENT_PROOF_REQUEST_MISMATCH');
 try{await writeDocumentFile(d.dir,'proof.json',jsonFile(proof));}catch(e:any){if(e.code!=='EEXIST')throw e;const old=JSON.parse((await readDocumentFile(dir,'proof.json')).toString());if(jcsSha256(old)!==jcsSha256(proof))throw new Error('DOCUMENT_PROOF_ALREADY_ATTACHED');}
 await renderDocumentPdfFile(dir,trustedKeys);return {proof_id:proof.statement.proof_id,verification:v,document_sha256:d.document_sha256,pdf_signed:false};
}
