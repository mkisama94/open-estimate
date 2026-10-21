import { it,expect } from "vitest";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { CertificateRepository,type D1Statement } from "../../src/web/certificate-repository.js";
import { WebPublicationApproval,d1ApprovalGrantWriter,type BrowserSession } from "../../src/web/web-publication-approval.js";
import { d1ApprovalGrantReader,createStoredApprovalAdapter } from "../../src/web/stored-approval.js";
import { draftHash } from "../../src/core/certificate.js";
import type { ApprovedDraft } from "../../src/core/certificate-contract.js";
function setup() {
  const db=new DatabaseSync(":memory:");db.exec(fs.readFileSync("migrations/0001_certificates.sql","utf8"));db.exec(fs.readFileSync("migrations/0002_web_approval_grants.sql","utf8"));
  const adapter={prepare(sql:string):D1Statement {const args:any[]=[];return {bind(...v:unknown[]){args.splice(0,args.length,...v);return this;},first:async<T>()=>(db.prepare(sql).get(...args)??null) as T|null,sql,args} as D1Statement;},async batch(rows:D1Statement[]) {db.exec("BEGIN IMMEDIATE");try {for(const row of rows as any[])db.prepare(row.sql).run(...row.args);db.exec("COMMIT");}catch(e){db.exec("ROLLBACK");throw e;}}};
  const now=Date.now(),s=JSON.parse(fs.readFileSync("tests/fixtures/certificates/complete.json","utf8")).signed_object;
  const draft:ApprovedDraft={schema_version:"oes/certificate-approved-draft/v1",operation:"issue_and_publish",issuer:s.issuer,deployment_environment:s.deployment_environment,certificate_id:s.certificate_id,share_id:"sh_"+"1".repeat(32),input_commitment:s.input_commitment,result:s.result,metadata:s.metadata,calculation_basis_hash:s.calculation_basis_hash,ruleset_ref:s.ruleset_ref,server_engine_ref:s.server_engine_ref,policy_version:s.approval.policy_version,status_generation:s.status_generation,expires_at:new Date(now+900000).toISOString()};
  const hash=draftHash(draft),preview="pv_"+"2".repeat(32),origin="https://certificate-test.example.org";
  db.prepare("INSERT INTO certificate_previews VALUES(?,?,?,?,?,?,NULL)").run(preview,"owner-1",JSON.stringify(draft),hash,now+900000,now);
  const session:BrowserSession={session_id:"synthetic-browser-session",principal:{subject:"owner-1",scopes:["certificates:manage"],expires_at:now+600000,authentication_strength:"SYNTHETIC_TEST"},expires_at:now+600000};
  const sessions={mode:"test" as const,read:async(req:Request)=>req.headers.get("Cookie")==="browser=valid"?session:null,csrfToken:async()=>"synthetic-csrf",verifyCsrf:async(_s:BrowserSession,target:{preview_id:string;draft_hash:string},token:string)=>target.preview_id===preview && target.draft_hash===hash && token==="synthetic-csrf"};
  const controller=new WebPublicationApproval(origin,sessions,new CertificateRepository(adapter),d1ApprovalGrantWriter(adapter));
  const form={csrf:"synthetic-csrf",draft_hash:hash,approve_issuance:"yes",approve_publication:"yes"};
  const request=(values:Record<string,string>=form,headers:Record<string,string>={})=>new Request(origin+`/manage/certificate-previews/${preview}/approve`,{method:"POST",headers:{Origin:origin,Cookie:"browser=valid","Content-Type":"application/x-www-form-urlencoded",...headers},body:new URLSearchParams(values)});
  return {db,adapter,controller,now,hash,preview,origin,form,request,session};
}
it("renders the exact unsigned preview and records both explicit consents against its server hash",async()=>{
  const f=setup();try {
    const page=await f.controller.render(new Request(f.origin+"/",{headers:{Cookie:"browser=valid"}}),f.preview,f.now);
    const html=await page.text();expect(html).toContain("発行前のプレビュー");expect(html).toContain(f.hash);expect(html).toContain("approve_issuance");expect(html).toContain("approve_publication");expect(page.headers.get("Cache-Control")).toBe("no-store");
    const approval=await f.controller.confirm(f.request(),f.preview,f.now);
    const stored=JSON.stringify(f.db.prepare("SELECT * FROM web_approval_grants").all());expect(stored).not.toContain(approval.approval_receipt_id);
    const verified=await createStoredApprovalAdapter(d1ApprovalGrantReader(f.adapter)).verifyPublication(approval.approval_receipt_id,{principal_id:"owner-1",operation:"issue_and_publish",approved_draft_hash:f.hash,policy_version:"oes/certificate-publication-policy/v1",now:f.now});
    expect(verified?.trusted_channel).toBe("WEB_USER_CONFIRMATION_V1");expect(verified?.expires_at).toBe(f.now+300000);
    expect((f.db.prepare("SELECT COUNT(*) AS n FROM certificates").get() as any).n).toBe(0);
  }finally{f.db.close();}
});
it.each(["approve_issuance","approve_publication"])("does not issue a receipt without %s",async field=>{
  const f=setup();try {const form={...f.form};delete form[field as keyof typeof form];await expect(f.controller.confirm(f.request(form),f.preview,f.now)).rejects.toThrow("APPROVAL_REQUIRED");expect((f.db.prepare("SELECT COUNT(*) AS n FROM web_approval_grants").get() as any).n).toBe(0);}finally{f.db.close();}
});
it.each(["origin","bearer","csrf","hash","owner","expiry"])("rejects invalid %s before recording approval",async reason=>{
  const f=setup();try {
    const form={...f.form},headers:Record<string,string>={};
    if(reason==="origin")headers.Origin="https://evil.example.org";
    if(reason==="bearer")headers.Authorization="Bearer ordinary-api-token";
    if(reason==="csrf")form.csrf="forged";
    if(reason==="hash")form.draft_hash="a".repeat(64);
    if(reason==="owner")f.session.principal.subject="other";
    if(reason==="expiry")f.session.expires_at=f.now;
    await expect(f.controller.confirm(f.request(form,headers),f.preview,f.now)).rejects.toThrow();
    expect((f.db.prepare("SELECT COUNT(*) AS n FROM web_approval_grants").get() as any).n).toBe(0);
  }finally{f.db.close();}
});
it("rejects a duplicate consent field and cannot use login alone to issue a receipt",async()=>{
  const f=setup();try {
    const request=f.request();const raw=await request.text();
    const duplicate=new Request(request.url,{method:"POST",headers:request.headers,body:raw+"&approve_publication=yes"});
    await expect(f.controller.confirm(duplicate,f.preview,f.now)).rejects.toThrow("APPROVAL_REQUIRED");
    await expect(f.controller.render(new Request(f.origin+"/",{headers:{Authorization:"Bearer api-token"}}),f.preview,f.now)).rejects.toThrow("AUTH_REQUIRED");
  }finally{f.db.close();}
});
