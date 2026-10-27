import type { ReadinessDatabase } from "./certificate-readiness.js";
export interface EstimateEnvironment {OWNER_PREVIEW_ENABLED?:string;WEB_LOGIN_ENABLED?:string;PREVIEW_TRANSFER_CODE_SECRET?:string;OWNER_PREVIEW_ENGINE_SHA256?:string;OWNER_PREVIEW_ENGINE_VERSION?:string;OWNER_PREVIEW_GENERATION?:string;AUTH0_ISSUER?:string;AUTH0_WEB_CLIENT_ID?:string;AUTH0_WEB_CLIENT_SECRET?:string;BROWSER_SESSION_SECRET?:string;OWNER_PREVIEW_LIMITER?:unknown;BROWSER_LOGIN_LIMITER?:unknown;CERTIFICATES_DB?:ReadinessDatabase}
/** No user data, transfer or approval is created by capability discovery. */
export async function estimateCapabilities(env:EstimateEnvironment){
  let reason="AVAILABLE";
  if(env.OWNER_PREVIEW_ENABLED!=="true")reason="OWNER_PREVIEW_DISABLED";
  else if(env.WEB_LOGIN_ENABLED!=="true" || !env.PREVIEW_TRANSFER_CODE_SECRET || !/^[a-f0-9]{64}$/.test(env.OWNER_PREVIEW_ENGINE_SHA256??"") || !env.OWNER_PREVIEW_ENGINE_VERSION || !/^sg_[a-f0-9]{32}$/.test(env.OWNER_PREVIEW_GENERATION??"") || !env.AUTH0_ISSUER || !env.AUTH0_WEB_CLIENT_ID || !env.AUTH0_WEB_CLIENT_SECRET || !env.BROWSER_SESSION_SECRET || !env.OWNER_PREVIEW_LIMITER || !env.BROWSER_LOGIN_LIMITER || !env.CERTIFICATES_DB)reason="CONFIGURATION_REQUIRED";
  else try{
    const db=env.CERTIFICATES_DB.withSession?.("first-primary")??env.CERTIFICATES_DB;
    const names=["preview_transfers","preview_transfer_consents","saved_estimates","certificate_previews","operation_guards","browser_sessions","browser_login_transactions"];
    // Inspect actual schema, not migration filenames alone.
    const rows=await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN (${names.map(()=>"?").join(",")})`).bind(...names).first<{n:number}>();
    const consent=await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='preview_transfer_consents'").first<{sql:string}>();
    if(rows?.n!==names.length || !consent?.sql.includes("prepare_estimate_preview"))reason="MIGRATION_REQUIRED";
  }catch{reason="STATUS_UNAVAILABLE";}
  return {schema_version:"oes/estimate-experience/v1",web:{available:reason==="AVAILABLE",reason,authentication:"BROWSER_LOGIN_REQUIRED",minutes:15},save:{available:reason==="AVAILABLE",days:30},certificate:{available:false,reason:"NOT_PROVIDED",issuer:"AI Orchestration Inc."},standard_completion:"WEB_READY"};
}
