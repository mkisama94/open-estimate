import {publicationInput,recordResultPublication} from "./estimate-result.js";
import {ESTIMATE_DESTINATION,type PublicationResult} from "../core/estimate-publication.js";
export async function publishResultPreview(id:string,options:{send?:typeof fetch;token?:string;sleep?:(ms:number)=>Promise<void>}={}){
 const prepared=await publicationInput(id),send=options.send??fetch,token=options.token??process.env.OES_ESTIMATE_ACCESS_TOKEN;
 if(!token)return {status:"AUTHENTICATION_REQUIRED",preview_id:id,next_action:"publish_estimate",request:prepared.request,notice:"接続済みホストの認証済み掲載ツールを使って、同じ操作を実行してください。"};
 const payload=JSON.stringify(prepared.request);
 for(let attempt=0;attempt<3;attempt++){
  try{const response=await send(ESTIMATE_DESTINATION+"/api/v1/estimates",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:payload,redirect:"error",signal:AbortSignal.timeout(10000)});
   if(response.status===401)return {status:"AUTHENTICATION_REQUIRED",preview_id:id,next_action:"publish_estimate"};
   if([429,502,503,504].includes(response.status)){const wait=Number(response.headers.get("Retry-After")??"1");if(attempt===2||!Number.isFinite(wait)||wait>30)break;await(options.sleep??(ms=>new Promise(r=>setTimeout(r,ms))))(Math.max(1000,wait*1000));continue;}
   const reader=response.body?.getReader();if(!reader)throw Error("INVALID_PUBLICATION_RESPONSE");let size=0;const chunks:Uint8Array[]=[];
   try{for(;;){const read=await reader.read();if(read.done)break;size+=read.value.length;if(size>65536){await reader.cancel();throw Error("INVALID_PUBLICATION_RESPONSE");}chunks.push(read.value);}}finally{reader.releaseLock();}
   const value=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!response.ok)return {status:"PUBLICATION_FAILED",preview_id:id,error_code:typeof value.error?.code==="string"&&/^[A-Z_]+$/.test(value.error.code)?value.error.code:"PUBLICATION_REJECTED",retryable:false};
   const result=value as PublicationResult;
   try{return await recordResultPublication(id,result);}catch(e){if(e instanceof Error&&e.message==="INVALID_PUBLICATION_RESPONSE")throw e;return {...result,status:"PUBLISHED_LOCAL_RECORD_INCOMPLETE",preview_id:id,retryable:true};}
  }catch(e){if(e instanceof Error&&e.message==="INVALID_PUBLICATION_RESPONSE")return {status:"PUBLICATION_FAILED",preview_id:id,error_code:"INVALID_PUBLICATION_RESPONSE",retryable:false};if(attempt<2)await(options.sleep??(ms=>new Promise(r=>setTimeout(r,ms))))(1000);}
 }
 return {status:"PUBLICATION_FAILED",preview_id:id,error_code:"SERVICE_UNAVAILABLE",retryable:true,next_action:"publish-result",notice:"結果とPDFは保持されています。同じ掲載操作から再試行できます。"};
}
