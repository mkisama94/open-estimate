import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes,randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { checkContract,obj,POLICY_VERSION } from "../core/certificate-contract.js";
import { transferBinding,transferSecretHash,transferCreateResponseSchema,transferStatusSchema,previewErrorSchema,uuidSchema,type TransferStatus } from "../core/preview-transfer-contract.js";
import { PRODUCTION_ORIGIN,assertEnvironment } from "../core/certificate.js";
import { jcsSha256 } from "../core/canonical.js";
import { readCertificateJson } from "../core/certificate-json.js";
import { resolveSafePath } from "../collector/safe-paths.js";
import { certificateSubmissionsRoot,readCertificateSubmission } from "./certificate-submissions.js";
import { estimateSubmissionsRoot,readEstimateSubmission } from "./estimate-submissions.js";
import { ESTIMATE_POLICY,ESTIMATE_METADATA_HASH } from "../core/estimate-preview.js";
import { anyOwnerPreviewSchema,type OwnerPreview } from "../core/preview-transfer-contract.js";
export interface PreviewCliOptions {origin?:string;environment?:"test"|"production";send?:typeof fetch;now?:()=>number;sleep?:(milliseconds:number,signal?:AbortSignal)=>Promise<void>;signal?:AbortSignal;emit?:(value:PreviewCliOutput)=>void}
export interface PreviewCliOutput {status:string;submission_id:string;transfer_id?:string;verification_url?:string;user_code?:string;preview_url?:string;expires_at?:string;saved:boolean;issued:false;published:false;notice?:string;web_complete?:boolean;result?:OwnerPreview}
interface State {format:"oes/local-preview-transfer/v1";secret:string;idempotency_key:string;origin:string;binding_hash:string;submission_hash:string;created_at:number;attempted:boolean;transfer_id:string|null;user_code:string|null;verification_url:string|null;expires_at:string|null}
async function atomicWrite(dir:string,name:string,value:unknown){
  const destination=await resolveSafePath(name,dir),temp=await resolveSafePath(name+"."+randomUUID()+".tmp",dir);
  const handle=await fs.open(temp,"wx",0o600);
  try{await handle.writeFile(JSON.stringify(value)+"\n");await handle.sync();}finally{await handle.close();}
  await fs.rename(temp,destination);
}
/** Test transport injection is an in-process API only. CLI never accepts an origin, credential or owner. */
export async function previewEstimate(value:unknown,options:PreviewCliOptions={}){return previewCertificate(value,options,true);}
export async function previewCertificate(value:unknown,options:PreviewCliOptions={},numeric=false) {
  const args=checkContract<{submission_id:string}>(obj({submission_id:uuidSchema}),value);
  const readSubmission=numeric?readEstimateSubmission:readCertificateSubmission;
  const submission:any=await readSubmission(args.submission_id);
  const origin=options.origin??PRODUCTION_ORIGIN,environment=options.environment??"production";assertEnvironment(origin,environment);
  const send=options.send??fetch,now=options.now??Date.now,sleep=options.sleep??((ms,signal)=>pause(ms,undefined,{signal}));
  const base=await resolveSafePath(args.submission_id,numeric?estimateSubmissionsRoot():certificateSubmissionsRoot()),lockPath=await resolveSafePath("preview.lock",base),lock=await fs.open(lockPath,"wx",0o600);
  const output=(status:string,saved=true):PreviewCliOutput=>({status,submission_id:args.submission_id,saved,issued:false,published:false});
  const metadataHash=numeric?ESTIMATE_METADATA_HASH:jcsSha256(submission.metadata),policyVersion=numeric?ESTIMATE_POLICY:POLICY_VERSION;
  const binding=transferBinding(origin,{input_commitment:submission.input_commitment,metadata_hash:metadataHash,policy_version:policyVersion}),submissionHash=jcsSha256(submission);
  try {
    let state:State;
    const statePath=await resolveSafePath("preview-state.json",base);
    try {
      const stat=await fs.lstat(statePath);if(!stat.isFile() || stat.isSymbolicLink() || stat.size>16384)throw new Error("INVALID_PREVIEW_STATE");
      state=readCertificateJson(await fs.readFile(statePath)) as State;
      if(state.format!=="oes/local-preview-transfer/v1" || state.origin!==origin || state.binding_hash!==binding || state.submission_hash!==submissionHash
        || !(new RegExp(uuidSchema.pattern)).test(state.idempotency_key) || !Number.isSafeInteger(state.created_at) || typeof state.attempted!=="boolean"
        || (state.transfer_id!==null && !/^pt_[a-f0-9]{32}$/.test(state.transfer_id)))throw new Error("INVALID_PREVIEW_STATE");
      transferSecretHash(state.secret);
    }catch(e:any){if(e.code!=="ENOENT")throw new Error("INVALID_PREVIEW_STATE");state={format:"oes/local-preview-transfer/v1",secret:randomBytes(32).toString("base64url"),idempotency_key:randomUUID(),origin,binding_hash:binding,submission_hash:submissionHash,
      created_at:now(),attempted:false,transfer_id:null,user_code:null,verification_url:null,expires_at:null};}
    const persist=async()=>{try{await atomicWrite(base,"preview-state.json",state);}catch{throw new Error("PREVIEW_STATE_WRITE_FAILED");}};
    await persist(); // No HTTP before the secret, retry ID, input binding and original digest are durable.
    options.emit?.({...output("LOCAL_CONTENT_NOTICE"),notice:numeric?"数値モデル・数値の品質集計・表示通貨・スキルと測定規則の版を送信し、再計算して本人限定のWeb結果を15分間表示します。ソース・対象名・パス・根拠・公開用説明は送りません。ブラウザーの同意後にのみ入力を送信します。保存・署名・一般公開は別操作です。":"数値モデル・公開候補・公開用説明をサーバーで再計算し、本人限定で15分間表示します。ソース・元run情報は送信しません。発行・一般公開の承認ではありません。ブラウザーの同意後にのみ入力を送信します。"});
    let budget=125;
    const request=async(route:string,body:unknown,authenticate:boolean,key?:string):Promise<any>=>{
      for(;;){
        if(options.signal?.aborted)throw new Error("PREVIEW_INTERRUPTED");if(--budget<0)throw new Error("PREVIEW_EXPIRED");
        let response:Response;
        try{response=await send(origin+route,{method:"POST",redirect:"manual",signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),
          headers:{"Content-Type":"application/json",...(authenticate?{Authorization:"PreviewTransfer "+state.secret}:{}),...(key?{"Idempotency-Key":key}:{})},body:JSON.stringify(body)});}
        catch{throw new Error(options.signal?.aborted?"PREVIEW_INTERRUPTED":"PREVIEW_NETWORK_UNAVAILABLE");}
        if(response.status===429){
          const raw=response.headers.get("Retry-After")??"5";const delay=/^\d+$/.test(raw)?Number(raw)*1000:Math.max(0,Date.parse(raw)-now());
          const end=state.expires_at?Date.parse(state.expires_at):state.created_at+600000;
          if(!Number.isFinite(delay) || now()+Math.max(5000,delay)>=end)throw new Error("PREVIEW_EXPIRED");
          await sleep(Math.max(5000,delay),options.signal);continue;
        }
        const reader=response.body?.getReader();if(!reader)throw new Error("INVALID_PREVIEW_RESPONSE");let size=0;const chunks:Uint8Array[]=[];
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new Error("INVALID_PREVIEW_RESPONSE");}chunks.push(value);}}finally{reader.releaseLock();}
        const data=readCertificateJson(Buffer.concat(chunks));
        if(!response.ok && !(response.status===410 && (data as any)?.state==="EXPIRED")){
          try{checkContract(previewErrorSchema,data);}catch{throw new Error("INVALID_PREVIEW_RESPONSE");}
          throw new Error((data as {error:{code:string}}).error.code);
        }
        return data;
      }
    };
    const ready=async(status:TransferStatus)=>{
      if(!status.preview_id || !status.draft_hash || status.preview_url!==origin+(numeric?"/manage/estimate-previews/":"/manage/certificate-previews/")+status.preview_id)throw new Error("INVALID_PREVIEW_RESPONSE");
      const dto=numeric?checkContract<OwnerPreview>(anyOwnerPreviewSchema,await request("/api/v1/preview-transfers/"+status.transfer_id+"/result",{},true)):undefined;
      if(dto && (dto.preview_id!==status.preview_id || dto.draft_hash!==status.draft_hash || dto.report_hash!==submission.estimate_input.expected_report_hash))throw new Error("RESULT_MISMATCH");
      const result={...output("READY"),preview_url:status.preview_url,expires_at:status.expires_at,...(numeric?{web_complete:true,transfer_id:status.transfer_id,result:dto}:{})};
      try {await atomicWrite(base,"preview-response-"+randomUUID()+".json",numeric?{status,result:dto}:status);state.expires_at=status.expires_at;await persist();return result;}
      catch{return {...result,status:"READY_LOCAL_SAVE_INCOMPLETE",saved:false,notice:"プレビュー作成済み・ローカル保存未完了。"+(numeric?"resume-estimate":"resume-preview")+"で同じ受付から回復してください。"};}
    };
    if(!state.transfer_id){
      const previous=state.attempted;state.attempted=true;await persist();
      const created=checkContract<any>(transferCreateResponseSchema,await request("/api/v1/preview-transfers",{input_commitment:submission.input_commitment,metadata_hash:metadataHash,policy_version:policyVersion,client_secret_hash:transferSecretHash(state.secret)},previous,state.idempotency_key));
      state.transfer_id=created.transfer_id;state.expires_at=created.expires_at;
      if(created.state==="PENDING"){
        if(created.verification_url!==origin+"/manage/preview-transfers/"+state.transfer_id)throw new Error("INVALID_PREVIEW_RESPONSE");
        state.verification_url=created.verification_url;state.user_code=created.user_code;
      }
      try{await persist();}catch{throw new Error("PREVIEW_STATE_WRITE_FAILED");}
      if(created.state==="READY")return ready(created);
    }
    let shown=false;
    for(let i=0;i<121;i++){
      const status=checkContract<TransferStatus>(transferStatusSchema,await request("/api/v1/preview-transfers/"+state.transfer_id+"/status",{},true));
      if(status.transfer_id!==state.transfer_id || !Number.isFinite(Date.parse(status.expires_at)))throw new Error("INVALID_PREVIEW_RESPONSE");
      if(status.state==="READY")return ready(status);
      if(["EXPIRED","DENIED","LOCKED"].includes(status.state))return {...output(status.state),expires_at:status.expires_at};
      state.expires_at=status.expires_at;
      if(status.state==="APPROVED"){
        // Recheck immutable input and its original checksum immediately before sending it.
        if(jcsSha256(await readSubmission(args.submission_id))!==submissionHash)throw new Error("INVALID_SUBMISSION");
        await persist();
        const payload=numeric?{estimate_input:submission.estimate_input,nonce:submission.nonce,policy_version:ESTIMATE_POLICY}:{frozen_input:submission.frozen_input,nonce:submission.nonce,metadata:submission.metadata,policy_version:POLICY_VERSION};
        const response=checkContract<TransferStatus>(transferStatusSchema,await request("/api/v1/preview-transfers/"+state.transfer_id+"/preview",payload,true));
        if(response.state!=="READY" || response.transfer_id!==state.transfer_id)throw new Error("INVALID_PREVIEW_RESPONSE");return ready(response);
      }
      if(!shown){
        if(!state.user_code || !/^[0-9]{8}$/.test(state.user_code) || state.verification_url!==origin+"/manage/preview-transfers/"+state.transfer_id)throw new Error("INVALID_PREVIEW_STATE");
        options.emit?.({...output("PENDING"),transfer_id:state.transfer_id,verification_url:state.verification_url,user_code:state.user_code,expires_at:status.expires_at});shown=true;
      }
      if(now()+5000>=Date.parse(status.expires_at))return {...output("EXPIRED"),expires_at:status.expires_at};
      await sleep(5000,options.signal);
    }
    throw new Error("PREVIEW_EXPIRED");
  }catch(e){if(options.signal?.aborted || (e instanceof Error && e.message==="PREVIEW_INTERRUPTED"))return output("INTERRUPTED");throw e;}
  finally{await lock.close();await fs.unlink(lockPath);}
}
