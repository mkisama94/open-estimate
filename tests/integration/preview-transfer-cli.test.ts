import { it,expect,vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { previewFixture } from "../fixtures/owner-preview.js";
import { generatedRules } from "../fixtures/measurement.js";
import { withQuality } from "../fixtures/quality.js";
import { saveRun } from "../../src/local/runs.js";
import { prepareCertificate,certificateSubmissionsRoot,readCertificateSubmission } from "../../src/local/certificate-submissions.js";
import { previewCertificate } from "../../src/local/preview-transfer.js";
import { jcsSha256 } from "../../src/core/canonical.js";
async function fixture(){const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-preview-cli-"));vi.stubEnv("OES_RUNS_ROOT",path.join(temp,"runs"));const a=withQuality(),run=await saveRun(a,a,{ruleset_ref:generatedRules.ruleset_ref,bundle:generatedRules.bundle},path.join(temp,"project")),f=previewFixture();
  const prepared=await prepareCertificate({run_id:run.run_id,metadata:f.body.metadata});
  const submission=await readCertificateSubmission(prepared.submission_id);f.config.catalog.skills.releases[0]={...f.config.catalog.skills.releases[0],skill_version:submission.frozen_input.skill_integrity.skill_version,package_sha256:submission.frozen_input.skill_integrity.package_sha256};
  const dir=path.join(certificateSubmissionsRoot(),prepared.submission_id),before=await fs.readFile(path.join(dir,"submission.json")),marker=await fs.readFile(path.join(dir,"COMPLETE.json"));
  const events:any[]=[],requests:any[]=[];let pending:any;
  const send:typeof fetch=async(url,init)=>{const req=new Request(String(url),init);requests.push({url:String(url),body:JSON.parse(String(init!.body)),headers:new Headers(init?.headers)});const response=await f.controller.fetch(req,f.now.value);if(String(url).endsWith("/preview-transfers") && response.ok){const copy=await response.clone().json() as any;if(copy.state==="PENDING")pending=copy;}return response;};
  const options={origin:f.config.origin,environment:"test" as const,send,now:()=>f.now.value,sleep:async(ms:number)=>{f.now.value+=ms;if(pending){await f.approve(pending);pending=null;}},emit:(v:any)=>events.push(v)};
  return {temp,f,prepared,dir,before,marker,requests,events,options,async close(){f.db.sqlite.close();vi.restoreAllMocks();vi.unstubAllEnvs();await fs.rm(temp,{recursive:true,force:true});}};
}
it("OP01/13/20 CLI saves before HTTP, waits for Web consent, sends exact input and prints no secret/nonce/hash/owner",async()=>{const t=await fixture();try{
  const out=await previewCertificate({submission_id:t.prepared.submission_id},t.options);expect(out).toMatchObject({status:"READY",saved:true,issued:false,published:false});
  expect(t.requests[0].body).not.toHaveProperty("frozen_input");expect(t.requests[0].body).not.toHaveProperty("nonce");expect(t.events.some(v=>v.status==="PENDING")).toBe(true);
  const state=JSON.parse(await fs.readFile(path.join(t.dir,"preview-state.json"),"utf8")),submission=await readCertificateSubmission(t.prepared.submission_id);
  const printed=JSON.stringify(t.events.concat(out));for(const secret of [state.secret,submission.nonce,state.binding_hash,"owner-a"])expect(printed).not.toContain(secret);
  expect(await fs.readFile(path.join(t.dir,"submission.json"))).toEqual(t.before);expect(await fs.readFile(path.join(t.dir,"COMPLETE.json"))).toEqual(t.marker);
  t.f.now.value+=610000;expect(await previewCertificate({submission_id:t.prepared.submission_id},t.options)).toEqual(out);expect(t.f.db.count("certificate_previews")).toBe(1);
}finally{await t.close();}},30000);
it.each(["creation","preview"])("OP13/14 recovers a lost %s response using the original secret/input and same receipt",async lost=>{const t=await fixture();try{
  let failed=false;const send:typeof fetch=async(url,init)=>{const response=await t.options.send(url,init);if(!failed && (lost==="creation"?String(url).endsWith("/preview-transfers"):String(url).endsWith("/preview"))){failed=true;throw new Error("PRIVATE_NETWORK_DETAIL");}return response;};
  await expect(previewCertificate({submission_id:t.prepared.submission_id},{...t.options,send})).rejects.toThrow("PREVIEW_NETWORK_UNAVAILABLE");
  const stateBefore=JSON.parse(await fs.readFile(path.join(t.dir,"preview-state.json"),"utf8"));
  const result=await previewCertificate({submission_id:t.prepared.submission_id},t.options);expect(result.status).toBe("READY");expect(t.f.db.count("preview_transfers")).toBe(1);expect(t.f.db.count("certificate_previews")).toBe(1);
  expect(JSON.parse(await fs.readFile(path.join(t.dir,"preview-state.json"),"utf8"))).toMatchObject({secret:stateBefore.secret,idempotency_key:stateBefore.idempotency_key,submission_hash:stateBefore.submission_hash});
}finally{await t.close();}},30000);
it("OP13/21 interruption is resumable, Retry-After is observed and response-save failure is explicit",async()=>{const t=await fixture();try{
  const abort=new AbortController();await previewCertificate({submission_id:t.prepared.submission_id},{...t.options,signal:abort.signal,sleep:async()=>{abort.abort();}}).then(r=>expect(r.status).toBe("INTERRUPTED"));
  t.f.now.value+=5000;let rate=true,slept=0;const send:typeof fetch=async(url,init)=>{if(rate){rate=false;return new Response("",{status:429,headers:{"Retry-After":"7"}});}return t.options.send(url,init);};
  const realOpen=fs.open.bind(fs),spy=vi.spyOn(fs,"open").mockImplementation(async(...args:Parameters<typeof fs.open>)=>{if(String(args[0]).includes("preview-response-"))throw new Error("PRIVATE_DISK_DETAIL");return realOpen(...args);});
  const result=await previewCertificate({submission_id:t.prepared.submission_id},{...t.options,send,sleep:async(ms)=>{slept+=ms;await t.options.sleep(ms);}});spy.mockRestore();expect(slept).toBeGreaterThanOrEqual(7000);expect(result).toMatchObject({status:"READY_LOCAL_SAVE_INCOMPLETE",saved:false});
  expect((await previewCertificate({submission_id:t.prepared.submission_id},t.options)).status).toBe("READY");expect(t.f.db.count("certificate_previews")).toBe(1);
}finally{await t.close();}},30000);
it("OP13 local state failure prevents any network request",async()=>{const t=await fixture();try{
  const realOpen=fs.open.bind(fs),spy=vi.spyOn(fs,"open").mockImplementation(async(...args:Parameters<typeof fs.open>)=>{if(String(args[0]).includes("preview-state.json"))throw new Error("DISK_PRIVATE");return realOpen(...args);});
  await expect(previewCertificate({submission_id:t.prepared.submission_id},t.options)).rejects.toThrow("PREVIEW_STATE_WRITE_FAILED");spy.mockRestore();expect(t.requests).toHaveLength(0);
}finally{await t.close();}},30000);
