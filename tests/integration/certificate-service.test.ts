import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { CertificateRepository, type D1Statement } from "../../src/web/certificate-repository.js";
import { CertificateService } from "../../src/web/certificate-service.js";
import { createCertificateWorker } from "../../src/web/worker.js";
import disabledWorker from "../../src/web/worker.js";
import { base64url, createCertificateSigner } from "../../src/web/signing.js";
import { withQuality } from "../fixtures/quality.js";
import { measurementRegistry, skillRegistry, generatedRules } from "../fixtures/measurement.js";
import { legacyIntegrity } from "../fixtures/skill-policy.js";
import { projectModel } from "../../src/core/numeric-model.js";
import { projectPublicResult } from "../../src/core/public-result.js";
import { createEvaluation } from "../../src/core/evaluation.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { POLICY_VERSION, type FrozenInput } from "../../src/core/certificate-contract.js";
import type { ApprovalAdapter } from "../../src/web/approval.js";

class SqliteD1 {
  readonly sqlite=new DatabaseSync(":memory:");failAt=-1;
  constructor(){this.sqlite.exec(fs.readFileSync("migrations/0001_certificates.sql","utf8"));}
  prepare(sql:string):D1Statement {const args:any[]=[];return {bind(...values:unknown[]){args.splice(0,args.length,...values);return this;},first:async<T>()=>(this.sqlite.prepare(sql).get(...args)??null) as T|null,
    sql,args} as D1Statement;}
  async batch(statements:D1Statement[]){
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {statements.forEach((s:any,index)=>{if(this.failAt===index)throw Error("injected");this.sqlite.prepare(s.sql).run(...s.args);});this.sqlite.exec("COMMIT");}
    catch(e){this.sqlite.exec("ROLLBACK");throw e;}
  }
  count(table:string){return (this.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n;}
}
async function setup() {
  const db=new SqliteD1(),repo=new CertificateRepository(db),now=Date.now();
  const principal={subject:"owner-1",scopes:["certificates:manage"],expires_at:now+86400000,authentication_strength:"test"};
  const a=withQuality();a.scope.description="PRIVATE_CANARY_CERTIFICATE";
  const e=createEvaluation(a,getLocalProfile());
  const input:FrozenInput={schema_version:"oes/certificate-input/v1",model:projectModel(a),candidate:projectPublicResult(a,{measurement:e.report.measurement,calculation:{environment:"TEST",basis:e.basis,effort:e.report.effort,reference_usd:e.report.reference_usd,limitation_codes:e.report.limitation_codes}}),skill_integrity:legacyIntegrity as FrozenInput["skill_integrity"],ruleset_ref:generatedRules.ruleset_ref};
  const key=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
  const signer=await createCertificateSigner(base64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8",key.privateKey))));
  const key_id="key_test_"+"1".repeat(32),generation="sg_"+"2".repeat(32);
  db.sqlite.prepare("INSERT INTO issuance_policy VALUES(1,1,?)").run(generation);
  db.sqlite.prepare("INSERT INTO signing_keys VALUES(?,'ACTIVE','{}')").run(key_id);
  const approvals:ApprovalAdapter={mode:"test",verifyTransfer:async id=>id==="transfer-test",verifyPublication:async(id,b)=>id==="approval-test"?{one_time_id:"one-time-test",expires_at:b.now+30000,trusted_channel:"synthetic-test"}:null,verifyWithdrawal:async id=>id==="withdraw-test"};
  const config={environment:"test" as const,origin:"https://test.example.org",generation,engine:{engine_version:"test-build",artifact_sha256:"3".repeat(64)},key_id,issuance_enabled:true,publication_read_enabled:true,auth_mode:"test" as const,catalog:{skills:skillRegistry(legacyIntegrity),rules:measurementRegistry(),now},trusted_keys:[{key_id,algorithm:"Ed25519" as const,public_key:base64url(new Uint8Array(await crypto.subtle.exportKey("raw",key.publicKey))),issuer_origin:"https://test.example.org",deployment_environment:"test" as const,created_at:new Date(now).toISOString()}]};
  const service=new CertificateService(repo,approvals,config,signer);
  const request={frozen_input:input,nonce:base64url(new Uint8Array(32).fill(9)),metadata:{title:"合成結果",description:null,publisher_label:null,scope_note:null,project_url:null,model_label:null},policy_version:POLICY_VERSION,transfer_authorization_id:"transfer-test"};
  const preview=await service.preview(principal,request,now);
  const publish={preview_id:preview.preview_id,approved_draft_hash:preview.approved_draft_hash,frozen_input:input,nonce:request.nonce,approval_receipt_id:"approval-test"};
  return {db,repo,service,config,principal,now,request,preview,publish,key:randomUUID()};
}
it("T01/T02 same concurrent idempotency key recovers one certificate; different body or key conflicts",async()=>{
  const f=await setup();try {
    const results=await Promise.all([f.service.publish(f.principal,f.publish,f.key,f.now),f.service.publish(f.principal,f.publish,f.key,f.now)]);
    expect(results[0].certificate).toEqual(results[1].certificate);expect(f.db.count("certificates")).toBe(1);
    await expect(f.service.publish(f.principal,{...f.publish,approval_receipt_id:"changed"},f.key,f.now)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(f.service.publish(f.principal,f.publish,randomUUID(),f.now)).rejects.toThrow("ALREADY_CONSUMED");
  } finally {f.db.sqlite.close();}
});
it.each([0,1,2,3,4,5,6,7,8])("T03 failure at batch statement %i rolls back everything",async index=>{
  const f=await setup();try {
    f.db.failAt=index;
    await expect(f.service.publish(f.principal,f.publish,f.key,f.now)).rejects.toThrow();
    for(const table of ["certificates","publications","publication_contents","approval_receipts","issuance_receipts","audit_events","operation_guards"])expect(f.db.count(table),table).toBe(0);
    expect((await f.repo.preview(f.preview.preview_id,f.principal.subject))?.consumed_receipt).toBeNull();
  } finally {f.db.sqlite.close();}
});
it.each(["preview","key","policy","generation"])("T04/T05 failed %s guard cannot partially commit",async kind=>{
  const f=await setup();try {
    if(kind==="preview")f.db.sqlite.prepare("UPDATE certificate_previews SET expires_at=0").run();
    if(kind==="key")f.db.sqlite.prepare("UPDATE signing_keys SET state='REVOKED'").run();
    if(kind==="policy")f.db.sqlite.prepare("UPDATE issuance_policy SET enabled=0").run();
    if(kind==="generation")f.db.sqlite.prepare("UPDATE issuance_policy SET status_generation='old'").run();
    await expect(f.service.publish(f.principal,f.publish,f.key,f.now)).rejects.toThrow();
    expect(f.db.count("certificates")).toBe(0);expect(f.db.count("approval_receipts")).toBe(0);
  } finally {f.db.sqlite.close();}
});
it("T06/P01 recovery after expiry uses original envelope; withdrawal removes all content and prevents replay",async()=>{
  const f=await setup();try {
    const issued=await f.service.publish(f.principal,f.publish,f.key,f.now);
    const again=await f.service.publish(f.principal,f.publish,f.key,f.now+3600000);expect(again.certificate).toEqual(issued.certificate);
    const share=issued.publication.share_id;
    expect((await f.service.shared(share,f.now)).certificate).toEqual(issued.certificate);
    await f.service.withdraw(f.principal,share,"withdraw-test",f.now);
    expect(f.db.count("publication_contents")).toBe(0);
    expect((await f.service.publish(f.principal,f.publish,f.key,f.now+3600000)).certificate).toBeNull();
    await expect(f.service.shared(share,f.now)).rejects.toThrow("PUBLICATION_WITHDRAWN");
    const status=await f.repo.status(issued.publication.certificate_id,f.config.generation,f.now);
    expect(status.publication_state).toBe("WITHDRAWN");expect(JSON.stringify(status)).not.toContain("合成結果");
  } finally {f.db.sqlite.close();}
});
it("P03/P05 retired keys verify past records; revoked keys and restored generations stop delivery",async()=>{
  const f=await setup();try {
    const issued=await f.service.publish(f.principal,f.publish,f.key,f.now),share=issued.publication.share_id;
    f.db.sqlite.prepare("UPDATE signing_keys SET state='RETIRED'").run();expect((await f.service.shared(share,f.now)).current_status.key_state).toBe("RETIRED");
    f.config.generation="sg_"+"9".repeat(32);await expect(f.service.shared(share,f.now)).rejects.toThrow("STATUS_UNAVAILABLE");
    expect((await f.repo.status(issued.publication.certificate_id,f.config.generation,f.now)).reason_code).toBe("STATUS_GENERATION_MISMATCH");
    f.config.generation="sg_"+"2".repeat(32);f.db.sqlite.prepare("UPDATE signing_keys SET state='REVOKED'").run();
    await expect(f.service.shared(share,f.now)).rejects.toThrow("PUBLICATION_WITHDRAWN");
    expect((await f.repo.status(issued.publication.certificate_id,f.config.generation,f.now)).certificate_state).toBe("REVOKED");
  } finally {f.db.sqlite.close();}
});
it("A01/A02/P06 body flags cannot approve and private canary/input/nonce never enter persisted rows",async()=>{
  const f=await setup();try {
    await expect(f.service.getPreview({...f.principal,subject:"other"},f.preview.preview_id,f.now)).rejects.toThrow("NOT_FOUND");
    await expect(f.service.publish(f.principal,{...f.publish,approval_receipt_id:"fake"},f.key,f.now)).rejects.toThrow("APPROVAL_REQUIRED");
    await expect(f.service.publish(f.principal,{...f.publish,confirmed:true},f.key,f.now)).rejects.toThrow("INVALID_INPUT");
    await f.service.publish(f.principal,f.publish,f.key,f.now);
    const dump=["certificate_previews","approval_receipts","certificates","publications","publication_contents","issuance_receipts","audit_events"].map(table=>f.db.sqlite.prepare(`SELECT * FROM ${table}`).all());
    const text=JSON.stringify(dump);for(const forbidden of ["PRIVATE_CANARY_CERTIFICATE",f.request.nonce,"frozen_input","oes/remote-model/","transfer-test","approval-test"])expect(text).not.toContain(forbidden);
  } finally {f.db.sqlite.close();}
});
it("HTTP strict body, auth, Origin, no-store and deployed default refuse unconfigured issuance",async()=>{
  const f=await setup();try {
    const worker=createCertificateWorker(f.service,{mode:"test",authenticate:async()=>f.principal});
    const env={ASSETS:{fetch:async()=>new Response("static")}};
    const post=(raw:string,extra:Record<string,string>={})=>worker.fetch(new Request(f.config.origin+"/api/v1/publications",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":f.key,...extra},body:raw}),env);
    expect((await post('{"x":1,"\\u0078":2}')).status).toBe(400);
    expect((await post(JSON.stringify(f.publish),{Cookie:"session=x"})).status).toBe(401);
    const success=await post(JSON.stringify(f.publish));expect(success.status).toBe(201);expect(success.headers.get("Cache-Control")).toBe("no-store");
    expect((await disabledWorker.fetch(new Request(f.config.origin+"/api/v1/publications",{method:"POST"}),env)).status).toBe(403);
    expect(await (await disabledWorker.fetch(new Request(f.config.origin+"/"),env)).text()).toBe("static");
  } finally {f.db.sqlite.close();}
});
