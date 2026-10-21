import { it,expect,vi } from "vitest";
import { randomUUID,randomBytes } from "node:crypto";
import { previewFixture } from "../fixtures/owner-preview.js";
import { transferSecretHash } from "../../src/core/preview-transfer-contract.js";
import { jcsSha256 } from "../../src/core/canonical.js";
import worker from "../../src/web/worker.js";

it("OP03/05/06/07/15/19/20 completes scoped owner preview without scopes, signing keys or public rows",async()=>{
  const f=previewFixture();try{
    const s=await f.create();expect(s.user_code).toMatch(/^\d{8}$/);expect(s.verification_url).not.toContain(s.user_code);
    const pending=await f.repo.get(s.transfer_id);expect(pending!.owner_id).toBeNull();
    await expect(f.service.submit(s.transfer_id,f.secret,f.body,f.now.value)).rejects.toThrow("APPROVAL_REQUIRED");
    await expect(f.service.status(s.transfer_id,randomBytes(32).toString("base64url"),f.now.value)).rejects.toThrow("AUTH_REQUIRED");
    const urlOnly=await f.controller.fetch(new Request(s.verification_url),f.now.value);expect(urlOnly.status).toBe(303);expect((await f.repo.get(s.transfer_id))!.owner_id).toBeNull();
    expect((await f.approve(s)).status).toBe(200);expect((await f.repo.get(s.transfer_id))!.owner_id).toBe("owner-a");
    expect((await f.approve(s,"b")).status).toBe(404);
    const r=await f.service.submit(s.transfer_id,f.secret,f.body,f.now.value),view=await f.controller.fetch(new Request(r.preview_url!,{headers:{Cookie:"owner=a"}}),f.now.value);
    const html=await view.text();expect(html).toContain("公開前プレビュー");expect(html).toContain("本人限定・未発行・未公開・未署名");expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");expect(html).not.toContain("/e/sh_");expect(html).not.toContain("type=\"submit\"");
    expect(view.headers.get("Cache-Control")).toBe("no-store");expect(view.headers.get("X-Robots-Tag")).toBe("noindex");
    for(const route of [r.preview_url!,f.config.origin+"/api/v1/owner-certificate-previews/"+r.preview_id]){
      expect((await f.controller.fetch(new Request(route,{headers:{Cookie:"owner=b"}}),f.now.value)).status).toBe(404);
      expect((await f.controller.fetch(new Request(route),f.now.value)).status).toBe(401);
    }
    const dto=await f.service.ownerPreview(r.preview_id!,"owner-a",f.now.value);expect(dto.result.measurement.cfp).toBe(6);expect(dto).toMatchObject({issued:false,published:false,signed:false});expect(JSON.stringify(dto)).not.toContain("cert_");
    const database=JSON.stringify(f.db.sqlite.prepare("SELECT * FROM preview_transfers").all());for(const secret of [f.secret,f.body.nonce,s.user_code,"合成プレビュー"])expect(database).not.toContain(secret);
    const content=JSON.stringify(f.db.sqlite.prepare("SELECT * FROM certificate_previews").all());expect(content).not.toContain(f.body.nonce);expect(content).not.toContain('"model":');
    for(const table of ["certificates","publications","signing_keys","web_approval_grants"])expect(f.db.count(table)).toBe(0);
    const denied=await worker.fetch(new Request(f.config.origin+"/api/v1/publications",{method:"POST",headers:{Authorization:"PreviewTransfer "+f.secret}}),{ASSETS:{fetch:async()=>new Response()}});expect(denied.status).toBe(403);
  }finally{f.db.sqlite.close();}
});
it("OP04 five incorrect codes lock permanently; consent and Origin are mandatory",async()=>{
  const f=previewFixture();try{const s=await f.create();
    for(const origin of [null,"null","https://other.example.org"])expect((await f.approve(s,"a",s.user_code,"yes",origin)).status).toBe(401);
    expect((await f.approve(s,"a",s.user_code,"no")).status).toBe(403);expect((await f.repo.get(s.transfer_id))!.attempts).toBe(0);
    const wrong=s.user_code==="00000000"?"00000001":"00000000";
    for(let i=0;i<5;i++)expect((await f.approve(s,"a",wrong)).status).toBe(403);
    expect((await f.repo.get(s.transfer_id))!.state).toBe("LOCKED");expect((await f.repo.get(s.transfer_id))!.owner_id).toBeNull();expect((await f.approve(s)).status).toBe(403);
  }finally{f.db.sqlite.close();}
});
it("OP08/14 recovery proves the secret, rotates codes without resetting attempts or expiry, and rejects binding changes",async()=>{
  const f=previewFixture();try{const key=randomUUID(),s=await f.service.create(f.creation,key,null,f.now.value) as any;
    await expect(f.service.create(f.creation,key,null,f.now.value)).rejects.toThrow("AUTH_REQUIRED");
    const badSecret=randomBytes(32).toString("base64url");await expect(f.service.create({...f.creation,client_secret_hash:transferSecretHash(badSecret)},key,badSecret,f.now.value)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    const next=await f.service.create(f.creation,key,f.secret,f.now.value+1) as any;expect(next.transfer_id).toBe(s.transfer_id);expect(next.expires_at).toBe(s.expires_at);
    expect((await f.approve(s)).status).toBe(403);expect((await f.approve(next)).status).toBe(200);
    const approved=await f.service.create(f.creation,key,f.secret,f.now.value+2);expect(approved.state).toBe("APPROVED");expect(approved).not.toHaveProperty("user_code");
    for(const part of ["metadata","nonce","model"]){const changed=structuredClone(f.body);if(part==="metadata")changed.metadata.title="changed";if(part==="nonce")changed.nonce=randomBytes(32).toString("base64url");if(part==="model")changed.frozen_input.model.partial=true;
      await expect(f.service.submit(s.transfer_id,f.secret,changed,f.now.value)).rejects.toThrow("DRAFT_CHANGED");}
  }finally{f.db.sqlite.close();}
});
it.each(["normal","v2","partial","incomplete"] as const)("OP09 preserves %s counting and null state",async variant=>{
  const f=previewFixture(undefined,variant);try{const s=await f.create();await f.approve(s);const r=await f.service.submit(s.transfer_id,f.secret,f.body,f.now.value),dto=await f.service.ownerPreview(r.preview_id!,"owner-a",f.now.value);
    expect(dto.result.measurement).toEqual(f.frozen.candidate.measurement);expect(dto.result.quality).toEqual(f.frozen.candidate.quality);if(variant==="v2")expect(f.frozen.model.version).toBe("oes/remote-model/v2");
  }finally{f.db.sqlite.close();}
});
it.each(["basis","skill","rules"])("OP10 refuses unapproved %s without any preview",async kind=>{
  const f=previewFixture();try{
    if(kind==="basis")f.body.frozen_input.candidate.calculation.basis.wage.hourly_wage_usd="51";
    if(kind==="skill")f.config.catalog.skills.releases=[];if(kind==="rules")f.config.catalog.rules.revisions=[];
    f.creation.input_commitment=(await import("../../src/core/certificate.js")).inputCommitment(f.body.frozen_input,f.body.nonce);
    const s=await f.create();await f.approve(s);await expect(f.service.submit(s.transfer_id,f.secret,f.body,f.now.value)).rejects.toThrow(kind==="basis"?"BASIS_MISMATCH":kind==="skill"?"SKILL_NOT_ISSUABLE":"RULESET_NOT_ISSUABLE");expect(f.db.count("certificate_previews")).toBe(0);
  }finally{f.db.sqlite.close();}
});
it("OP11/13/16 concurrent replay returns the same preview after approval expiry without extension",async()=>{
  const f=previewFixture();try{const s=await f.create();await f.approve(s);
    const [a,b]=await Promise.all([f.service.submit(s.transfer_id,f.secret,f.body,f.now.value),f.service.submit(s.transfer_id,f.secret,f.body,f.now.value)]);expect(a).toEqual(b);expect(f.db.count("certificate_previews")).toBe(1);
    f.now.value+=610000;expect(await f.service.submit(s.transfer_id,f.secret,f.body,f.now.value)).toEqual(a);expect((await f.service.status(s.transfer_id,f.secret,f.now.value)).state).toBe("READY");
    f.now.value=Date.parse(a.expires_at);expect((await f.service.status(s.transfer_id,f.secret,f.now.value)).state).toBe("EXPIRED");await expect(f.service.ownerPreview(a.preview_id!,"owner-a",f.now.value)).rejects.toThrow("PREVIEW_EXPIRED");
    const page=await f.controller.fetch(new Request(a.preview_url!,{headers:{Cookie:"owner=a"}}),f.now.value);expect(page.status).toBe(410);expect(await page.text()).not.toContain("本人限定の合成試験です");
    f.db.sqlite.prepare("INSERT INTO browser_sessions VALUES ('retained','owner-a',?)").run(f.now.value+99999999);
    await f.repo.purge(f.now.value+3600000);expect(f.db.count("certificate_previews")).toBe(0);expect(f.db.count("preview_transfers")).toBe(0);expect(f.db.count("preview_transfer_consents")).toBe(0);expect(f.db.count("browser_sessions")).toBe(1);
  }finally{f.db.sqlite.close();}
});
it.each([0,1,2,3])("OP12 batch fault at %i leaves neither partial preview nor READY",async index=>{
  const f=previewFixture();try{const s=await f.create();await f.approve(s);f.db.failAt=index;await expect(f.service.submit(s.transfer_id,f.secret,f.body,f.now.value)).rejects.toThrow("STATUS_UNAVAILABLE");expect((await f.repo.get(s.transfer_id))!.state).toBe("APPROVED");expect(f.db.count("certificate_previews")).toBe(0);expect(f.db.count("operation_guards")).toBe(0);
  }finally{f.db.sqlite.close();}
});
it("OP21 strict bodies, request cap, polling interval, expiry and preview flag stay closed",async()=>{
  const f=previewFixture();try{
    const post=(body:string)=>f.controller.fetch(new Request(f.config.origin+"/api/v1/preview-transfers",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":randomUUID()},body}),f.now.value);
    expect((await post(JSON.stringify({...f.creation,owner_id:"untrusted"}))).status).toBe(400);expect((await post("x".repeat(4097))).status).toBe(413);
    const s=await f.create();await f.service.status(s.transfer_id,f.secret,f.now.value);await expect(f.service.status(s.transfer_id,f.secret,f.now.value)).rejects.toThrow("RATE_LIMITED");
    f.now.value+=600000;await expect(f.service.approve(s.transfer_id,"owner-a",s.user_code,f.now.value)).rejects.toThrow("PREVIEW_EXPIRED");
    f.config.enabled=false;await expect(f.service.status(s.transfer_id,f.secret,f.now.value)).rejects.toThrow("OWNER_PREVIEW_DISABLED");f.config.enabled=true;f.limit();expect((await post(JSON.stringify(f.creation))).status).toBe(429);
  }finally{f.db.sqlite.close();}
});
it("OP14 recovery retries a random-code collision and never reissues the old code",async()=>{
  const f=previewFixture();try{
    const key=randomUUID(),s=await f.service.create(f.creation,key,null,f.now.value) as any;
    const replacement=s.user_code==="00000000"?"00000001":"00000000";
    const spy=vi.spyOn(f.service as any,"code").mockReturnValueOnce(s.user_code).mockReturnValueOnce(replacement);
    const next=await f.service.create(f.creation,key,f.secret,f.now.value) as any;spy.mockRestore();
    expect(next.user_code).toBe(replacement);expect((await f.approve(s)).status).toBe(403);
    expect((await f.repo.get(s.transfer_id))!.attempts).toBe(1);expect((await f.approve(next)).status).toBe(200);
  }finally{vi.restoreAllMocks();f.db.sqlite.close();}
});
it("OP06/08/17/19 rejects missing proof, corrupted CSRF, changed policy and issuance escalation",async()=>{
  const f=previewFixture();try{
    const s=await f.create(),base=f.config.origin;
    for(const suffix of ["status","preview"]){
      const response=await f.controller.fetch(new Request(base+"/api/v1/preview-transfers/"+s.transfer_id+"/"+suffix,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),f.now.value);expect(response.status).toBe(401);
    }
    const badCsrf=await f.controller.fetch(new Request(s.verification_url+"/approve",{method:"POST",headers:{Cookie:"owner=a",Origin:base,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrf:"corrupted",code:s.user_code,consent:"yes"})}),f.now.value);expect(badCsrf.status).toBe(403);expect((await f.repo.get(s.transfer_id))!.owner_id).toBeNull();
    await f.approve(s);await expect(f.service.submit(s.transfer_id,f.secret,{...f.body,policy_version:"different-policy"},f.now.value)).rejects.toThrow("INVALID_INPUT");
    const env={ASSETS:{fetch:async()=>new Response()},OWNER_PREVIEW_ENABLED:"true",ISSUANCE_ENABLED:"false",PUBLICATION_READ_ENABLED:"false"};
    for(const route of ["/api/v1/certificate-previews","/api/v1/publications","/manage/publication-approvals/another","/api/v1/issuance-requests/another"]){
      expect((await worker.fetch(new Request(base+route,{method:"POST",headers:{Authorization:"PreviewTransfer "+f.secret}}),env)).status).toBe(403);
    }
    for(const table of ["certificates","publications","signing_keys","web_approval_grants"])expect(f.db.count(table)).toBe(0);
  }finally{f.db.sqlite.close();}
});
it("OP16 scheduled cleanup meets the one-hour bound and preserves unrelated issuance previews",async()=>{
  const f=previewFixture();try{
    const s=await f.create();await f.approve(s);const r=await f.service.submit(s.transfer_id,f.secret,f.body,f.now.value),expiry=Date.parse(r.expires_at);
    f.db.sqlite.prepare("INSERT INTO certificate_previews VALUES ('unrelated','other','{}','hash',?, ?,NULL)").run(expiry-1,0);
    f.db.sqlite.prepare("INSERT INTO browser_sessions VALUES ('valid-session','owner-a',?)").run(expiry+7200000);
    await f.repo.purge(expiry+2699999);expect(f.db.count("preview_transfers")).toBe(1);
    vi.spyOn(Date,"now").mockReturnValue(expiry+2700000);
    await worker.scheduled({}, {ASSETS:{fetch:async()=>new Response()},CERTIFICATES_DB:f.db,OWNER_PREVIEW_ENABLED:"false"});
    expect(f.db.count("preview_transfers")).toBe(0);expect(f.db.count("preview_transfer_consents")).toBe(0);
    expect(f.db.count("certificate_previews")).toBe(1);expect(f.db.count("browser_sessions")).toBe(1);
  }finally{vi.restoreAllMocks();f.db.sqlite.close();}
});
