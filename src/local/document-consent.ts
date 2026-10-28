import {randomUUID} from 'node:crypto';
import {checkDocumentContract,type DocumentProofRequest} from '../contracts/document.js';
import {jcsSha256} from '../core/canonical.js';
import {readDocument,readDocumentFile,writeDocumentFile,jsonFile} from './document-result.js';
import {readDocumentConsentRecord,saveDocumentConsentRecord,type DocumentConsentRecord} from './document-consent-record.js';
import {PROOF_DESTINATION,WEB_DESTINATION} from './document-services.js';
export {PROOF_DESTINATION,WEB_DESTINATION} from './document-services.js';
export async function prepareProofRequest(dir:string){
 const d=await readDocument(dir);let request:DocumentProofRequest;
 try{request=checkDocumentContract<DocumentProofRequest>('request',JSON.parse((await readDocumentFile(dir,'proof-request.json')).toString()));}
 catch(e:any){if(e.code!=='ENOENT')throw e;const validation_input=JSON.parse((await readDocumentFile(dir,'validation-input.json')).toString());request={schema_version:'oes/document-proof-request/v1',operation_id:randomUUID(),document:d.document,markdown:d.markdown,validation_input};checkDocumentContract('request',request);try{await writeDocumentFile(d.dir,'proof-request.json',jsonFile(request));}catch(e:any){if(e.code!=='EEXIST')throw e;request=JSON.parse((await readDocumentFile(dir,'proof-request.json')).toString());}}
 if(request.markdown!==d.markdown||jcsSha256(request.document)!==jcsSha256(d.document))throw new Error('DOCUMENT_REQUEST_CHANGED');
 return {request,request_hash:jcsSha256(request),destination:PROOF_DESTINATION,purpose:'CALCULATION_VERIFICATION_AND_DOCUMENT_PROOF',transmitted:false,excluded:['ソース','対象パス','根拠本文','判断台帳'],disclosure:'実際に送信する要求全体です。文書と数値モデルを検証に送り、発行記録には操作ID・要求指紋・証明だけを残します。本人性は証明しません。'};
}
export async function webPreviewInput(dir:string){
 const d=await readDocument(dir);let proof:unknown=null;try{proof=JSON.parse((await readDocumentFile(dir,'proof.json',32768)).toString());}catch(e:any){if(e.code!=='ENOENT')throw e;}
 const request={markdown:d.markdown,proof};return {request,request_hash:jcsSha256(request),destination:WEB_DESTINATION,purpose:'STATELESS_WEB_DISPLAY',transmitted:false,disclosure:'Markdownと任意の証明だけを表示用Webへ送信。数値モデル・元ソースは送信せず、保存・ログインは行いません。'};
}
export async function consentDocumentAction(args:{document_dir:string;action:'proof'|'web';request_hash:string;destination:string;user_confirmed:boolean;explicit_answer:string}){
 if(!['proof','web'].includes(args.action)||args.user_confirmed!==true||typeof args.explicit_answer!=='string'||!args.explicit_answer.trim()||args.explicit_answer.length>2000)throw new Error('EXPLICIT_DOCUMENT_CONSENT_REQUIRED');
 const pending=args.action==='proof'?await prepareProofRequest(args.document_dir):await webPreviewInput(args.document_dir);
 if(args.request_hash!==pending.request_hash||args.destination!==pending.destination)throw new Error('DOCUMENT_CONSENT_CHANGED');
 let record:DocumentConsentRecord={action:args.action,document_sha256:(await readDocument(args.document_dir)).document_sha256,destination:pending.destination,purpose:pending.purpose,request_hash:pending.request_hash,confirmed_at:new Date().toISOString(),explicit_answer:args.explicit_answer,evidence:'HOST_REPORTED_EXPLICIT_USER_ANSWER_NOT_IDENTITY_PROOF'};
 try{record=await readDocumentConsentRecord(args.document_dir,record);}catch(e:any){if(!['DOCUMENT_CONSENT_REQUIRED','DOCUMENT_CONSENT_CHANGED'].includes(e.message))throw e;}
 await saveDocumentConsentRecord(args.document_dir,record);
 return consentedDocumentInput(args.document_dir,args.action);
}
export async function consentedDocumentInput(dir:string,action:'proof'|'web'){
 if(!['proof','web'].includes(action))throw new Error('INVALID_DOCUMENT_ACTION');
 const pending=action==='proof'?await prepareProofRequest(dir):await webPreviewInput(dir);
 const consent=await readDocumentConsentRecord(dir,{action,document_sha256:(await readDocument(dir)).document_sha256,destination:pending.destination,purpose:pending.purpose,request_hash:pending.request_hash});
 return {...pending,consent,next_action:action==='proof'?'issue_document_proof':'open-web-preview'};
}
