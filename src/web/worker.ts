import { estimateCapabilities } from "./estimate-capabilities.js";
import { isOwnerPreviewPath,createOwnerPreviewController } from "./owner-preview.js";
import { PreviewTransferService } from "./preview-transfer.js";
import { PreviewTransferRepository } from "./preview-transfer-repository.js";
import { defaultRegistry } from "../remote/skill-integrity.js";
import { defaultRulesRegistry } from "../remote/measurement-rules.js";
import { randomUUID } from "node:crypto";
import { readCertificateJson, CERTIFICATE_BODY_LIMIT } from "../core/certificate-json.js";
import { checkContract, withdrawRequestSchema } from "../core/certificate-contract.js";
import { getCertificateBasis } from "../profiles/certificate-basis.js";
import { requirePrincipal, type AuthAdapter } from "./auth.js";
import type { CertificateService } from "./certificate-service.js";
import { certificateHtml, statusHtml, publicErrorHtml, publicHtmlHeaders } from "./public-views.js";
import { publicResultService, isPublicResultPath, type PublicResultEnvironment } from "./public-result-runtime.js";
import { publicDisplayQuote } from "../core/public-display-quote.js";
import { frbProvider } from "../profiles/frb.js";
import {publishAuthenticatedEstimate,publicationAuthChallenge,type EstimatePublicationEnvironment} from "../remote/estimate-publishing.js";
import {isSavedEstimatePath,savedEstimatePage} from "./saved-estimates.js";
import documentWorker from './document-worker.js';
import publicResultsWorker,{isPublicResultsPath,type PublicResultsEnvironment} from './public-results-worker.js';

interface Assets {fetch(request:Request):Promise<Response>}
interface Env extends PublicResultEnvironment, PublicResultsEnvironment {OWNER_PREVIEW_ENABLED?:string;PREVIEW_TRANSFER_CODE_SECRET?:string;OWNER_PREVIEW_ENGINE_SHA256?:string;OWNER_PREVIEW_ENGINE_VERSION?:string;OWNER_PREVIEW_GENERATION?:string;OWNER_PREVIEW_LIMITER?:{limit(options:{key:string}):Promise<{success:boolean}>};ASSETS:Assets;ISSUANCE_ENABLED?:string;PUBLICATION_READ_ENABLED?:string;CERTIFICATES_DB?:import("./certificate-readiness.js").ReadinessDatabase;WEB_LOGIN_ENABLED?:string;AUTH0_ISSUER?:string;AUTH0_WEB_CLIENT_ID?:string;AUTH0_WEB_CLIENT_SECRET?:string;BROWSER_SESSION_SECRET?:string;BROWSER_LOGIN_LIMITER?:{limit(options:{key:string}):Promise<{success:boolean}>}}
const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const codeStatus:Record<string,number>={INVALID_INPUT:400,INPUT_TOO_LARGE:413,AUTH_REQUIRED:401,APPROVAL_REQUIRED:403,AUTH_CONSENT_NOT_READY:403,NOT_FOUND:404,RESULT_MISMATCH:409,BASIS_MISMATCH:409,DRAFT_CHANGED:409,IDEMPOTENCY_CONFLICT:409,ALREADY_CONSUMED:409,PREVIEW_EXPIRED:410,PUBLICATION_WITHDRAWN:410,MODEL_UNSUPPORTED:422,BASIS_UNSUPPORTED:422,RULESET_NOT_ISSUABLE:422,SKILL_NOT_ISSUABLE:422,RATE_LIMITED:429,ISSUANCE_DISABLED:503,SIGNING_UNAVAILABLE:503,STATUS_UNAVAILABLE:503};
async function body(request:Request) {
  if(request.headers.has("Content-Encoding") || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("Content-Type")??""))throw new Error("INVALID_INPUT");
  if(Number(request.headers.get("Content-Length"))>CERTIFICATE_BODY_LIMIT)throw new Error("INPUT_TOO_LARGE");
  const reader=request.body?.getReader();if(!reader)throw new Error("INVALID_INPUT");
  const chunks:Uint8Array[]=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>CERTIFICATE_BODY_LIMIT){await reader.cancel();throw new Error("INPUT_TOO_LARGE");}chunks.push(value);}}
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return readCertificateJson(bytes);
}
function dynamic(path:string) {return /^\/(api\/v1(?:\/|$)|e(?:\/|$)|verify(?:\/|$)|manage(?:\/|$)|\.well-known\/oes-signing-keys\.json$)/.test(path);}
/** Dependencies are supplied by a reviewed deployment adapter. There is no body-token/test-adapter fallback. */
export function createCertificateWorker(service:CertificateService,auth:AuthAdapter) {
  if(service.config.environment==="production" && auth.mode!=="production")throw new Error("AUTH_CONSENT_NOT_READY");
  return {async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url),path=url.pathname,now=Date.now();
    if(!dynamic(path))return env.ASSETS.fetch(request);
    try {
      const api="/api/v1";
      if(request.method==="GET" && path==="/.well-known/oes-signing-keys.json")return json({schema_version:"oes/signing-keys/v1",issuer_origin:service.config.origin,keys:service.config.trusted_keys.map(k=>({key_id:k.key_id,algorithm:k.algorithm,public_key:k.public_key,created_at:k.created_at,deployment_environment:k.deployment_environment}))});
      const page=path.match(/^\/e\/(sh_[a-f0-9]{32})$/);
      if(request.method==="GET" && page){const result=await service.shared(page[1],now);return new Response(certificateHtml(result.certificate,page[1],result.current_status),{headers:publicHtmlHeaders});}
      const verify=path.match(/^\/verify\/(cert_[a-f0-9]{32})$/);
      if(request.method==="GET" && verify){const result=await service.repository.status(verify[1],service.config.generation,now);return new Response(statusHtml(result),{status:result.registration==="NOT_FOUND"?404:result.registration==="UNKNOWN"?503:200,headers:publicHtmlHeaders});}
      if(request.method==="GET" && path.startsWith(api+"/calculation-bases/"))return json(getCertificateBasis(path.slice((api+"/calculation-bases/").length)));
      const status=path.match(/^\/api\/v1\/certificates\/(cert_[a-f0-9]{32})\/status$/);
      if(request.method==="GET" && status) {
        try {const result=await service.repository.status(status[1],service.config.generation,now);return json(result,result.registration==="NOT_FOUND"?404:result.registration==="UNKNOWN"?503:200);}
        catch {return json({certificate_id:status[1],signed_object_hash:null,key_id:null,registration:"UNKNOWN",certificate_state:"UNKNOWN",publication_state:"UNKNOWN",key_state:"UNKNOWN",status_generation:null,status_checked_at:new Date(now).toISOString(),reason_code:"STATUS_UNAVAILABLE"},503);}
      }
      const shared=path.match(/^\/api\/v1\/shared-estimates\/(sh_[a-f0-9]{32})(\/certificate\.json)?$/);
      if(request.method==="GET" && shared) {const result=await service.shared(shared[1],now);return json(shared[2]?result.certificate:result);}
      const quote=path.match(/^\/api\/v1\/shared-estimates\/(sh_[a-f0-9]{32})\/display-quote$/);
      if(request.method==="GET" && quote){const before=await service.shared(quote[1],now);const value=await publicDisplayQuote(before.certificate,frbProvider,url.searchParams.get("locale")??"ja-JP",url.searchParams.get("currency")??"JPY",()=>new Date(now));await service.shared(quote[1],Date.now());return json(value);}
      if(isPublicResultPath(path))throw new Error("NOT_FOUND");
      if(isPublicResultPath(path))throw new Error("NOT_FOUND");
      // Cookie-bound writes require the same trusted origin, including when auth is otherwise valid.
      if(request.method!=="GET" && (request.headers.has("Cookie") || request.headers.has("Origin")) && request.headers.get("Origin")!==service.config.origin)throw new Error("AUTH_REQUIRED");
      const principal=requirePrincipal(await auth.authenticate(request),"certificates:manage",now);
      if(request.method==="POST" && path===api+"/certificate-previews")return json(await service.preview(principal,await body(request),now));
      const preview=path.match(/^\/api\/v1\/certificate-previews\/(pv_[a-f0-9]{32})$/);
      if(request.method==="GET" && preview)return json(await service.getPreview(principal,preview[1],now));
      if(request.method==="POST" && path===api+"/publications") {const result=await service.publish(principal,await body(request),request.headers.get("Idempotency-Key")??"",now);const {created,...response}=result;return json(response,created?201:200);}
      const receipt=path.match(/^\/api\/v1\/issuance-requests\/([a-f0-9-]{36})$/);
      if(request.method==="GET" && receipt)return json(await service.receipt(principal,receipt[1]));
      const withdraw=path.match(/^\/api\/v1\/publications\/(sh_[a-f0-9]{32})\/withdraw$/);
      if(request.method==="POST" && withdraw){const value=checkContract<{approval_receipt_id:string}>(withdrawRequestSchema,await body(request));return json(await service.withdraw(principal,withdraw[1],value.approval_receipt_id,now));}
      throw new Error("NOT_FOUND");
    } catch(e) {
      const code=e instanceof Error && Object.hasOwn(codeStatus,e.message)?e.message:"STATUS_UNAVAILABLE";
      if(request.method==="GET" && /^\/(e|verify)(\/|$)/.test(path))return new Response(publicErrorHtml(code),{status:codeStatus[code],headers:publicHtmlHeaders});
      const response=json({error:{code,request_id:randomUUID(),retryable:[429,503].includes(codeStatus[code])}},codeStatus[code]);
      if(code==="RATE_LIMITED")response.headers.set("Retry-After","60");return response;
    }
  },async scheduled(){await service.repository.purge(Date.now());}};
}
// G1/G2 are unresolved. Shipping this Worker cannot enable signing merely by setting a flag.
export default {async fetch(request:Request,env:Env):Promise<Response> {
  if(isPublicResultsPath(new URL(request.url).pathname))return publicResultsWorker.fetch(request,env);
  if(new URL(request.url).pathname==='/preview')return documentWorker.fetch(request);
  if(request.method==="GET" && new URL(request.url).pathname==="/api/v1/certificate-readiness")return (await import("./certificate-readiness.js")).certificateReadiness(env.CERTIFICATES_DB);
  const path=new URL(request.url).pathname;
  if(path==="/api/v1/estimates" && request.method==="POST"){
    try {
      if(request.headers.has("Cookie")||request.headers.has("Origin"))throw new Error("AUTH_REQUIRED");
      return json(await publishAuthenticatedEstimate(request,await body(request),env as unknown as EstimatePublicationEnvironment,defaultRegistry,defaultRulesRegistry));
    }catch(e){const code=e instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:"STATUS_UNAVAILABLE";
      const status=code==="AUTH_REQUIRED"?401:code==="RATE_LIMITED"?429:["IDEMPOTENCY_CONFLICT","CONSENT_CONTENT_CHANGED","RESULT_MISMATCH"].includes(code)?409:["INVALID_INPUT","INPUT_TOO_LARGE"].includes(code)?400:503;
      const response=json({error:{code,retryable:status===429||status===503}},status);if(status===401)response.headers.set("WWW-Authenticate",publicationAuthChallenge);if(status===429)response.headers.set("Retry-After","60");return response;}
  }
  if(isSavedEstimatePath(path) && !path.includes("/save/")){
    try {
      const db=env.CERTIFICATES_DB as import("./browser-login.js").BrowserLoginDatabase|undefined;
      if(env.WEB_LOGIN_ENABLED!=="true"||!db||!env.AUTH0_ISSUER||!env.AUTH0_WEB_CLIENT_ID||!env.AUTH0_WEB_CLIENT_SECRET||!env.BROWSER_SESSION_SECRET)throw new Error("AUTH_CONSENT_NOT_READY");
      const origin="https://open-estimate.ai-orchestration.jp",login=(await import("./browser-login.js")).createBrowserLogin({origin,issuer:env.AUTH0_ISSUER,client_id:env.AUTH0_WEB_CLIENT_ID,client_secret:env.AUTH0_WEB_CLIENT_SECRET,session_secret:env.BROWSER_SESSION_SECRET},db);
      return await savedEstimatePage(request,{repository:{db},config:{origin},ownerPreview:async()=>{throw new Error("NOT_FOUND");}},login.sessions,Date.now());
    }catch{return json({error:{code:"STATUS_UNAVAILABLE",retryable:true}},503);}
  }
  if(path==="/api/v1/estimate-capabilities" && request.method==="GET")return json(await estimateCapabilities(env));
  if(isPublicResultPath(path)){
    try {
      return await createCertificateWorker(publicResultService(env),{mode:"production",authenticate:async()=>null}).fetch(request,env);
    }catch{
      if(request.method==="GET" && /^\/(e|verify)(\/|$)/.test(path))return new Response(publicErrorHtml("STATUS_UNAVAILABLE"),{status:503,headers:publicHtmlHeaders});
      return json({error:{code:"STATUS_UNAVAILABLE",request_id:randomUUID(),retryable:true}},503);
    }
  }
  if(isOwnerPreviewPath(path)) {
    if(env.OWNER_PREVIEW_ENABLED!=="true")return json({error:{code:"OWNER_PREVIEW_DISABLED",request_id:randomUUID(),retryable:false}},503);
    try {
      const db=env.CERTIFICATES_DB as import("./browser-login.js").BrowserLoginDatabase|undefined;
      if(env.WEB_LOGIN_ENABLED!=="true" || !db || !env.PREVIEW_TRANSFER_CODE_SECRET || !env.OWNER_PREVIEW_ENGINE_SHA256 || !env.OWNER_PREVIEW_ENGINE_VERSION || !env.OWNER_PREVIEW_GENERATION || !env.OWNER_PREVIEW_LIMITER
        || !env.AUTH0_ISSUER || !env.AUTH0_WEB_CLIENT_ID || !env.AUTH0_WEB_CLIENT_SECRET || !env.BROWSER_SESSION_SECRET)throw new Error("AUTH_CONSENT_NOT_READY");
      const origin="https://open-estimate.ai-orchestration.jp";
      const login=(await import("./browser-login.js")).createBrowserLogin({origin,issuer:env.AUTH0_ISSUER,client_id:env.AUTH0_WEB_CLIENT_ID,client_secret:env.AUTH0_WEB_CLIENT_SECRET,session_secret:env.BROWSER_SESSION_SECRET},db);
      const service=new PreviewTransferService(new PreviewTransferRepository(db),{origin,environment:"production",enabled:true,code_secret:env.PREVIEW_TRANSFER_CODE_SECRET,generation:env.OWNER_PREVIEW_GENERATION,
        engine:{engine_version:env.OWNER_PREVIEW_ENGINE_VERSION,artifact_sha256:env.OWNER_PREVIEW_ENGINE_SHA256},catalog:{skills:defaultRegistry,rules:defaultRulesRegistry,now:Date.now()}});
      return await createOwnerPreviewController(service,login.sessions,env.OWNER_PREVIEW_LIMITER).fetch(request);
    }catch{return json({error:{code:"STATUS_UNAVAILABLE",request_id:randomUUID(),retryable:true}},503);}
  }

  if(env.WEB_LOGIN_ENABLED==="true" && (path==="/manage" || path.startsWith("/manage/auth/"))) {
    try {
      const db=env.CERTIFICATES_DB as import("./browser-login.js").BrowserLoginDatabase|undefined;
      if(!db || typeof db.batch!=="function" || !env.AUTH0_ISSUER || !env.AUTH0_WEB_CLIENT_ID || !env.AUTH0_WEB_CLIENT_SECRET || !env.BROWSER_SESSION_SECRET || !env.BROWSER_LOGIN_LIMITER)throw new Error("AUTH_CONSENT_NOT_READY");
      // Conservative shared throttle for the single-user login trial. No IP or identity in the key.
      if(!(await env.BROWSER_LOGIN_LIMITER.limit({key:"oes:web-login-trial:v1"})).success) {
        const response=json({error:{code:"RATE_LIMITED",request_id:randomUUID(),retryable:true}},429);response.headers.set("Retry-After","60");return response;
      }
      return await (await import("./browser-login.js")).createBrowserLogin({origin:"https://open-estimate.ai-orchestration.jp",issuer:env.AUTH0_ISSUER,client_id:env.AUTH0_WEB_CLIENT_ID,client_secret:env.AUTH0_WEB_CLIENT_SECRET,session_secret:env.BROWSER_SESSION_SECRET},db).handle(request);
    } catch {return json({error:{code:"AUTH_CONSENT_NOT_READY",request_id:randomUUID(),retryable:false}},503);}
  }
  if(dynamic(new URL(request.url).pathname))return json({error:{code:"AUTH_CONSENT_NOT_READY",request_id:randomUUID(),retryable:false}},403);
  return env.ASSETS.fetch(request);
},async scheduled(_event:unknown,env:Env) {
  if(env.PUBLIC_RESULTS_DB)await publicResultsWorker.scheduled(_event,env);
  const db=env.CERTIFICATES_DB as import("./browser-login.js").BrowserLoginDatabase|undefined;
  if(!db || typeof db.batch!=="function"){if(env.PUBLIC_RESULTS_DB)return;throw new Error("STATUS_UNAVAILABLE");}
  await (await import("./browser-login.js")).purgeBrowserSessions(db,Date.now());
  if(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_estimates'").first())await db.batch([db.prepare("DELETE FROM saved_estimates WHERE expires_at<=?").bind(Date.now())]);
  if(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='estimate_publications'").first())await db.batch([db.prepare("DELETE FROM estimate_publications WHERE expires_at<=?").bind(Date.now())]);
  if(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='preview_transfers'").first())await new PreviewTransferRepository(db).purge(Date.now());
}};
