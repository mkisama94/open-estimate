import {checkContract,obj,prepareContracts} from "../core/certificate-contract.js";
import {experienceUiUri} from "./experience-ui.js";
const capabilitySchema=obj({schema_version:{const:"oes/estimate-experience/v2"},web:obj({available:{type:"boolean"},reason:{enum:["AVAILABLE","ESTIMATE_PUBLICATION_DISABLED","CONFIGURATION_REQUIRED","MIGRATION_REQUIRED","STATUS_UNAVAILABLE"]},authentication:{const:"CONNECTED_OAUTH_REQUIRED"},retention_days:{const:30}}),local:obj({preview:{const:true},pdf:{const:true}}),certificate:obj({available:{const:false},reason:{const:"NOT_PROVIDED"},issuer:{const:"AI Orchestration Inc."}}),standard_completion:{const:"WEB_SAVED"}});
let cached:{value:any;expires:number}|undefined;
export async function getExperienceCapabilities(send:typeof fetch=fetch){
 if(send===fetch&&cached&&cached.expires>Date.now())return cached.value;
 try{const response=await send("https://open-estimate.ai-orchestration.jp/api/v1/estimate-capabilities",{redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error();const reader=response.body?.getReader();if(!reader)throw new Error();const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>8192){await reader.cancel();throw new Error();}chunks.push(r.value);}}finally{reader.releaseLock();}
  const value=checkContract<any>(capabilitySchema,JSON.parse(Buffer.concat(chunks).toString("utf8")));if(send===fetch)cached={value,expires:Date.now()+60000};return value;
 }catch{return {schema_version:"oes/estimate-experience/v2",web:{available:false,reason:"STATUS_UNAVAILABLE",authentication:"CONNECTED_OAUTH_REQUIRED",retention_days:30},local:{preview:true,pdf:true},certificate:{available:false,reason:"NOT_PROVIDED",issuer:"AI Orchestration Inc."},standard_completion:"WEB_SAVED"};}
}
export const experienceStepSchema={...obj({stage:{enum:["scope","analyzing","review","confirmation","publishing","authentication","result","error","local"]},result_url:{type:"string",pattern:"^https://open-estimate\\.ai-orchestration\\.jp/manage/estimates/se_[a-f0-9]{32}$"},expires_at:{type:"string",format:"date-time"},error_code:{type:"string",pattern:"^[A-Z][A-Z0-9_]{0,80}$"}}),required:["stage"]};
export function experienceStep(value:unknown){const a=checkContract<{stage:string;result_url?:string;expires_at?:string;error_code?:string}>(experienceStepSchema,value);
 const allowed=a.stage==="result"?"expires_at,result_url,stage":a.stage==="error"?"error_code,stage":"stage";
 if(Object.keys(a).sort().join()!==allowed)throw new Error("INVALID_INPUT");return a;
}
prepareContracts([capabilitySchema,experienceStepSchema]);
export function experienceResponse(data:Record<string,unknown>){
 const notice=data.stage==="result"?"本人用Web結果（30日保存）："+data.result_url+" / 期限："+data.expires_at
 :data.stage==="error"?"掲載は未完了です。結果とPDFを保持し、同じ掲載操作で再試行できます。原因："+data.error_code
 :data.stage==="authentication"?"本人のログインが必要です。認証後は同じ掲載操作へ戻ります。掲載同意は繰り返しません。"
 :"対象範囲の確認 → 解析 → チャット内プレビュー・PDF → 掲載同意 → 本人用Web結果（30日保存）。送信せず終了することもできます。ソースコード・対象パス・根拠本文・判断台帳はOpen Estimateへ送信しません。";
 return {structuredContent:data,content:[{type:"text" as const,text:notice}],_meta:{ui:{resourceUri:experienceUiUri}}};
}
