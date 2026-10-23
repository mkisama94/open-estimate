import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomBytes,randomUUID } from "node:crypto";
import { withQuality } from "./quality.js";
import { generatedRules,measurementRegistry,skillRegistry } from "./measurement.js";
import { legacyIntegrity } from "./skill-policy.js";
import { projectModel } from "../../src/core/numeric-model.js";
import { createEvaluation } from "../../src/core/evaluation.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { projectPublicResult } from "../../src/core/public-result.js";
import { jcsSha256,sha256Hex } from "../../src/core/canonical.js";
import { POLICY_VERSION,type FrozenInput } from "../../src/core/certificate-contract.js";
import { inputCommitment } from "../../src/core/certificate.js";
import { transferSecretHash,type TransferCreate } from "../../src/core/preview-transfer-contract.js";
import { PreviewTransferRepository } from "../../src/web/preview-transfer-repository.js";
import { PreviewTransferService } from "../../src/web/preview-transfer.js";
import { createOwnerPreviewController } from "../../src/web/owner-preview.js";
import type { D1Statement } from "../../src/web/certificate-repository.js";
import type { BrowserApprovalSessions } from "../../src/web/web-publication-approval.js";
export class PreviewSqlite {
  sqlite:DatabaseSync;failAt=-1;
  constructor(file=":memory:"){this.sqlite=new DatabaseSync(file);for(const m of ["0001_certificates","0002_web_approval_grants","0003_browser_sessions","0004_preview_transfers","0005_saved_estimates"])this.sqlite.exec(fs.readFileSync("migrations/"+m+".sql","utf8"));}
  prepare(sql:string):D1Statement {let args:unknown[]=[];const db=this.sqlite;return {bind(...a){args=a;return this;},async first<T>(){return (db.prepare(sql).get(...args as any[])??null) as T|null;},sql,get args(){return args;}} as D1Statement;}
  async batch(statements:D1Statement[]){this.sqlite.exec("BEGIN IMMEDIATE");try{(statements as any[]).forEach((s,i)=>{if(i===this.failAt)throw new Error("INJECTED_DB_FAILURE");this.sqlite.prepare(s.sql).run(...s.args);});this.sqlite.exec("COMMIT");}catch(e){this.sqlite.exec("ROLLBACK");throw e;}}
  count(table:string){return (this.sqlite.prepare("SELECT COUNT(*) AS n FROM "+table).get() as {n:number}).n;}
}
export function previewFixture(origin="https://preview-test.example.org",variant:"normal"|"v2"|"partial"|"incomplete"="normal"){
  const db=new PreviewSqlite(),now={value:Date.now()},a=withQuality();
  if(variant==="v2"){const p=a.functional_processes[0];p.status="unresolved";p.movements=[];a.function_candidates![0].disposition="unresolved";a.judgments![0].status="unresolved";a.judgments![0].unresolved_points=["Unknown trigger"];a.judgments![0].targets=a.judgments![0].targets.filter(t=>t.kind!=="movement");}
  if(variant==="partial"){a.quality!.boundaries[0].rerun="unknown";a.judgments![0].status="provisional";a.judgments![0].unresolved_points=["Retry relationship unconfirmed"];}
  if(variant==="incomplete"){a.functional_processes=[];a.function_candidates=[];a.judgments=[];a.quality!.boundaries=[];}
  const e=createEvaluation(a,getLocalProfile()),frozen:FrozenInput={schema_version:"oes/certificate-input/v1",model:projectModel(a),candidate:projectPublicResult(a,{measurement:e.report.measurement,calculation:{environment:"TEST",basis:e.basis,effort:e.report.effort,reference_usd:e.report.reference_usd,limitation_codes:e.report.limitation_codes}}),skill_integrity:legacyIntegrity as FrozenInput["skill_integrity"],ruleset_ref:generatedRules.ruleset_ref};
  const metadata={title:"合成プレビュー <script>CANARY</script>",description:"本人限定の合成試験です",publisher_label:null,scope_note:null,project_url:null,model_label:null},nonce=randomBytes(32).toString("base64url"),secret=randomBytes(32).toString("base64url");
  const body={frozen_input:frozen,nonce,metadata,policy_version:POLICY_VERSION};
  const creation:TransferCreate={input_commitment:inputCommitment(frozen,nonce),metadata_hash:jcsSha256(metadata),policy_version:POLICY_VERSION,client_secret_hash:transferSecretHash(secret)};
  const config={origin,environment:"test" as const,enabled:true,code_secret:randomBytes(32).toString("base64url"),generation:"sg_"+"1".repeat(32),engine:{engine_version:"isolated-source-fixture",artifact_sha256:sha256Hex(fs.readFileSync("src/core/certificate.ts"))},catalog:{skills:skillRegistry(legacyIntegrity),rules:measurementRegistry(),now:now.value}};
  const repo=new PreviewTransferRepository(db),service=new PreviewTransferService(repo,config);
  const sessions:BrowserApprovalSessions={mode:"test",async read(request){const match=request.headers.get("Cookie")?.match(/owner=([ab])/);return match?{session_id:"session-"+match[1],expires_at:now.value+3600000,principal:{subject:"owner-"+match[1],scopes:[],expires_at:now.value+3600000,authentication_strength:"synthetic-fixture"}}:null;},
    async csrfToken(s,t){return jcsSha256([s.session_id,t]);},async verifyCsrf(s,t,token){return token===jcsSha256([s.session_id,t]);}};
  let limited=false;const controller=createOwnerPreviewController(service,sessions,{async limit(){return {success:!limited};}});
  const create=async()=>service.create(creation,randomUUID(),null,now.value) as Promise<any>;
  async function approve(start:any,owner="a",code=start.user_code,consent="yes",originHeader:string|null=origin){
    const get=await controller.fetch(new Request(origin+"/manage/preview-transfers/"+start.transfer_id,{headers:{Cookie:"owner="+owner}}),now.value);
    const csrf=(await get.text()).match(/name="csrf" value="([^"]+)"/)?.[1]??"bad";
    return controller.fetch(new Request(origin+"/manage/preview-transfers/"+start.transfer_id+"/approve",{method:"POST",headers:{Cookie:"owner="+owner,"Content-Type":"application/x-www-form-urlencoded",...(originHeader===null?{}:{Origin:originHeader})},body:new URLSearchParams({csrf,code,consent})}),now.value);
  }
  return {db,now,a,frozen,body,creation,config,repo,service,sessions,controller,secret,create,approve,limit:()=>{limited=true;}};
}
