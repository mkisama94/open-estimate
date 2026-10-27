import { checkContract,obj,prepareContracts } from "../core/certificate-contract.js";
import { experienceUiUri } from "./experience-ui.js";
const capabilitySchema=obj({schema_version:{const:"oes/estimate-experience/v1"},web:obj({available:{type:"boolean"},reason:{enum:["AVAILABLE","OWNER_PREVIEW_DISABLED","CONFIGURATION_REQUIRED","MIGRATION_REQUIRED","STATUS_UNAVAILABLE"]},authentication:{const:"BROWSER_LOGIN_REQUIRED"},minutes:{const:15}}),save:obj({available:{type:"boolean"},days:{const:30}}),certificate:obj({available:{const:false},reason:{const:"NOT_PROVIDED"},issuer:{const:"AI Orchestration Inc."}}),standard_completion:{const:"WEB_READY"}});
export async function getExperienceCapabilities(send:typeof fetch=fetch){
  try{const response=await send("https://open-estimate.ai-orchestration.jp/api/v1/estimate-capabilities",{redirect:"error",signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error();
    const reader=response.body?.getReader();if(!reader)throw new Error();let text="",size=0;const decoder=new TextDecoder();
    try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>8192){await reader.cancel();throw new Error();}text+=decoder.decode(r.value,{stream:true});}}finally{reader.releaseLock();}
    return checkContract<any>(capabilitySchema,JSON.parse(text));
  }catch{return {schema_version:"oes/estimate-experience/v1",web:{available:false,reason:"STATUS_UNAVAILABLE",authentication:"BROWSER_LOGIN_REQUIRED",minutes:15},save:{available:false,days:30},certificate:{available:false,reason:"NOT_PROVIDED",issuer:"AI Orchestration Inc."},standard_completion:"WEB_READY"};}
}
export const experienceStepSchema={...obj({stage:{enum:["scope","analyzing","confirmation","result","error","local"]},transfer_id:{type:"string",pattern:"^pt_[a-f0-9]{32}$"},preview_url:{type:"string",pattern:"^https://open-estimate\\.ai-orchestration\\.jp/manage/estimate-previews/pv_[a-f0-9]{32}$"},expires_at:{type:"string",format:"date-time"},error_code:{type:"string",pattern:"^[A-Z][A-Z0-9_]{0,80}$"}}),required:["stage"]};
export function experienceStep(value:unknown){
  const a=checkContract<{stage:string;transfer_id?:string;preview_url?:string;expires_at?:string;error_code?:string}>(experienceStepSchema,value);
  const keys=Object.keys(a).sort().join();
  const allowed=a.stage==="result"?"expires_at,preview_url,stage":a.stage==="confirmation"?"stage,transfer_id":a.stage==="error"?"error_code,stage":"stage";
  if(keys!==allowed)throw new Error("INVALID_INPUT");
  if(a.stage==="result" && Date.parse(a.expires_at!)<=Date.now())throw new Error("PREVIEW_EXPIRED");
  return a;
}
prepareContracts([capabilitySchema,experienceStepSchema]);
export function experienceResponse(data:Record<string,unknown>){
  const stage=data.stage,notice=stage==="result"?"本人用Web結果: "+data.preview_url+" ／ 期限: "+data.expires_at
    :stage==="confirmation"?"送信内容を確認してWeb表示へ: https://open-estimate.ai-orchestration.jp/manage/preview-transfers/"+data.transfer_id
    :stage==="error"?"Web表示は未完了です。原因: "+data.error_code+"。保存済みの同じsubmissionからresume-estimateで再開してください。"
    :stage==="local"?"利用者の選択によりローカル結果で終了。後で同じrunからWeb表示を再開できます。"
    :"対象確認 → 解析 → 同意後に本人用Web結果（15分）。希望すれば30日保存。計算証明書は発行元の電子署名を確認する仕組みですが、この環境では未提供です。ソースをOpen Estimateへ送信しません。AI解析のモデル提供元（OpenAI、Anthropicなど）による処理とは別です。";
  return {structuredContent:data,content:[{type:"text" as const,text:notice}],_meta:{ui:{resourceUri:experienceUiUri}}};
}
