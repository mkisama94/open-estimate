import type {EstimatePublicationEnvironment} from "../remote/estimate-publishing.js";
import type {ReadinessDatabase} from "./certificate-readiness.js";
export interface EstimateEnvironment extends Omit<EstimatePublicationEnvironment,"CERTIFICATES_DB"> {CERTIFICATES_DB?:ReadinessDatabase;WEB_LOGIN_ENABLED?:string;AUTH0_WEB_CLIENT_ID?:string;AUTH0_WEB_CLIENT_SECRET?:string;BROWSER_SESSION_SECRET?:string;BROWSER_LOGIN_LIMITER?:unknown}
export async function estimateCapabilities(env:EstimateEnvironment){
 let reason="AVAILABLE";
 if(env.ESTIMATE_PUBLICATION_ENABLED!=="true")reason="ESTIMATE_PUBLICATION_DISABLED";
 else if(!env.AUTH0_ISSUER||!env.AUTH0_API_AUDIENCE||!env.AUTH0_MCP_CLIENT_IDS||!env.ESTIMATE_PUBLICATION_LIMITER||env.WEB_LOGIN_ENABLED!=="true"||!env.AUTH0_WEB_CLIENT_ID||!env.AUTH0_WEB_CLIENT_SECRET||!env.BROWSER_SESSION_SECRET||!env.CERTIFICATES_DB)reason="CONFIGURATION_REQUIRED";
 else try{const db=env.CERTIFICATES_DB.withSession?.("first-primary")??env.CERTIFICATES_DB;
  const names=["saved_estimates","estimate_publications","operation_guards","browser_sessions","browser_login_transactions"];
  const row=await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN (${names.map(()=>"?").join(",")})`).bind(...names).first<{n:number}>();if(row?.n!==names.length)reason="MIGRATION_REQUIRED";
 }catch{reason="STATUS_UNAVAILABLE";}
 return {schema_version:"oes/estimate-experience/v2",web:{available:reason==="AVAILABLE",reason,authentication:"CONNECTED_OAUTH_REQUIRED",retention_days:30},local:{preview:true,pdf:true},certificate:{available:false,reason:"NOT_PROVIDED",issuer:"AI Orchestration Inc."},standard_completion:"WEB_SAVED"};
}
