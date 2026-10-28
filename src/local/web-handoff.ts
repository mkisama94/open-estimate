import path from 'node:path';
import {consentedDocumentInput} from './document-consent.js';
/** Prepare the consented HTTPS file-selection flow. No navigation or hidden send. */
export async function openWebPreview(dir:string){
 const input=await consentedDocumentInput(dir,'web');
 const proof='proof' in input.request?input.request.proof:null;
 const steps=['HTTPSの表示ページを開く','estimate.md を選択',...(proof?['proof.json を選択']:[]),'Webで表示を押す'];
 return {status:'WEB_PREVIEW_FILES_READY',url:input.destination,destination:input.destination,
  files:{markdown:path.join(path.resolve(dir),'estimate.md'),proof:proof?path.join(path.resolve(dir),'proof.json'):null},
  request_hash:input.request_hash,transmitted:false,browser_display:'NOT_CONFIRMED',steps,operation_count:steps.length,
  notice:'ファイル選択方式です。URLを開くだけでは文書は送信されません。選択して送信した後の実表示を確認してください。'};
}
