import {it,expect,vi} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {previewFixture} from "../fixtures/owner-preview.js";
import {generatedRules} from "../fixtures/measurement.js";
import {prepareEstimate,readEstimateSubmission} from "../../src/local/estimate-submissions.js";
import {previewEstimate} from "../../src/local/preview-transfer.js";
import {saveRun} from "../../src/local/runs.js";
import {ESTIMATE_POLICY,ESTIMATE_METADATA_HASH,estimateCommitment,type EstimateInput} from "../../src/core/estimate-preview.js";
import {validateAndRecomputeNumericModel} from "../../src/core/numeric-model.js";
import {certificateCalculationProfile} from "../../src/profiles/certificate-basis.js";
import {jcsSha256} from "../../src/core/canonical.js";
import {transferSecretHash} from "../../src/core/preview-transfer-contract.js";
import {estimateCapabilities} from "../../src/web/estimate-capabilities.js";
import {experienceStep,getExperienceCapabilities} from "../../src/remote/experience.js";
function numeric(f:ReturnType<typeof previewFixture>){
  const profile=certificateCalculationProfile(),model=f.frozen.model,report=validateAndRecomputeNumericModel(model,profile);
  const input:EstimateInput={schema_version:"oes/owner-estimate-input/v1",evaluation:{model,display_currency:"USD",skill_integrity:f.frozen.skill_integrity,ruleset_ref:f.frozen.ruleset_ref},quality:f.frozen.candidate.quality,expected_report_hash:jcsSha256({model,profile,report})};
  const nonce=randomBytes(32).toString("base64url");
  return {input,body:{estimate_input:input,nonce,policy_version:ESTIMATE_POLICY},creation:{input_commitment:estimateCommitment(input,nonce),metadata_hash:ESTIMATE_METADATA_HASH,policy_version:ESTIMATE_POLICY,client_secret_hash:transferSecretHash(f.secret)}};
}
it("standard numeric-only consent produces private Web result, supports save, rejects other owner and expires",async()=>{
 const f=previewFixture(undefined,"partial"),n=numeric(f);try{
  const start=await f.service.create(n.creation,randomUUID(),null,f.now.value) as any;
  await expect(f.service.submit(start.transfer_id,f.secret,n.body,f.now.value)).rejects.toThrow("APPROVAL_REQUIRED");
  const consent=await f.controller.fetch(new Request(start.verification_url,{headers:{Cookie:"owner=a"}}),f.now.value);
  expect(await consent.text()).toContain("数値データを送信してWebで結果を見る");
  expect((await f.approve(start)).status).toBe(200);
  const ready=await f.service.submit(start.transfer_id,f.secret,n.body,f.now.value);
  expect(ready.preview_url).toContain("/manage/estimate-previews/");
  const view=await f.controller.fetch(new Request(ready.preview_url!,{headers:{Cookie:"owner=a"}}),f.now.value);
  const html=await view.text();expect(view.status).toBe(200);for(const text of ["本人用Web見積結果","PARTIAL","計算証明書","30日","未署名","TEST"])expect(html).toContain(text);
  expect(html).not.toContain("CANARY");
  expect((await f.controller.fetch(new Request(ready.preview_url!,{headers:{Cookie:"owner=b"}}),f.now.value)).status).toBe(404);
  const saveUrl=f.config.origin+"/manage/estimates/save/"+ready.preview_id;
  const confirm=await f.controller.fetch(new Request(saveUrl,{headers:{Cookie:"owner=a"}}),f.now.value),csrf=(await confirm.text()).match(/name="csrf" value="([^"]+)"/)![1];
  const saved=await f.controller.fetch(new Request(saveUrl,{method:"POST",headers:{Cookie:"owner=a",Origin:f.config.origin,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrf,consent:"yes"})}),f.now.value);
  expect(saved.status).toBe(303);
  expect((await f.controller.fetch(new Request(saved.headers.get("Location")!,{headers:{Cookie:"owner=a"}}),f.now.value)).status).toBe(200);
  expect(await f.service.submit(start.transfer_id,f.secret,n.body,f.now.value)).toEqual(ready);expect(f.db.count("certificate_previews")).toBe(1);
  expect(f.db.count("certificates")).toBe(0);expect(f.db.count("publications")).toBe(0);
  f.now.value+=900001;expect((await f.controller.fetch(new Request(ready.preview_url!,{headers:{Cookie:"owner=a"}}),f.now.value)).status).toBe(410);
  expect((await f.controller.fetch(new Request(saved.headers.get("Location")!,{headers:{Cookie:"owner=a"}}),f.now.value)).status).toBe(200);
 }finally{f.db.sqlite.close();}
});
it("numeric contract rejects private fields, changed input, wrong result, and certificate consent reuse",async()=>{
 const f=previewFixture(),n=numeric(f);try{
  const start=await f.service.create(n.creation,randomUUID(),null,f.now.value) as any;await f.approve(start);
  await expect(f.service.submit(start.transfer_id,f.secret,{...n.body,metadata:f.body.metadata},f.now.value)).rejects.toThrow("INVALID_INPUT");
  await expect(f.service.submit(start.transfer_id,f.secret,f.body,f.now.value)).rejects.toThrow("DRAFT_CHANGED");
  const changed=structuredClone(n.body);changed.estimate_input.evaluation.display_currency="JPY";
  await expect(f.service.submit(start.transfer_id,f.secret,changed,f.now.value)).rejects.toThrow("DRAFT_CHANGED");
  const wrong=numeric(f);wrong.input.expected_report_hash="0".repeat(64);wrong.creation.input_commitment=estimateCommitment(wrong.input,wrong.body.nonce);
  const s=await f.service.create(wrong.creation,randomUUID(),null,f.now.value) as any;await f.approve(s);
  await expect(f.service.submit(s.transfer_id,f.secret,wrong.body,f.now.value)).rejects.toThrow("RESULT_MISMATCH");expect(f.db.count("certificate_previews")).toBe(0);
 }finally{f.db.sqlite.close();}
});
it("CLI goes from an immutable saved run through browser consent to Web URL and survives response loss",async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-numeric-")),f=previewFixture(undefined,"partial");vi.stubEnv("OES_RUNS_ROOT",path.join(tmp,"runs"));try{
  const run=await saveRun(f.a,f.a,{ruleset_ref:generatedRules.ruleset_ref,bundle:generatedRules.bundle},path.join(tmp,"project"));
  const prepared=await prepareEstimate({run_id:run.run_id,display_currency:"USD"}),s=await readEstimateSubmission(prepared.submission_id);
  f.config.catalog.skills.releases[0]={...f.config.catalog.skills.releases[0],skill_version:s.estimate_input.evaluation.skill_integrity.skill_version,package_sha256:s.estimate_input.evaluation.skill_integrity.package_sha256};
  const requests:any[]=[],events:any[]=[];let pending:any,lost=false;
  const send:typeof fetch=async(url,init)=>{requests.push(JSON.parse(String(init?.body)));const response=await f.controller.fetch(new Request(String(url),init),f.now.value);
    if(String(url).endsWith("/preview-transfers")&&response.ok)pending=await response.clone().json();
    if(String(url).endsWith("/preview")&&response.ok&&!lost){lost=true;throw new Error("response lost");}return response;};
  const options={origin:f.config.origin,environment:"test" as const,send,now:()=>f.now.value,sleep:async(ms:number)=>{f.now.value+=ms;if(pending){await f.approve(pending);pending=null;}},emit:(e:any)=>events.push(e)};
  await expect(previewEstimate({submission_id:prepared.submission_id},options)).rejects.toThrow("PREVIEW_NETWORK_UNAVAILABLE");
  const result=await previewEstimate({submission_id:prepared.submission_id},options);expect(result).toMatchObject({status:"READY",web_complete:true,issued:false,published:false});
  expect(result.result!.result.measurement.cfp).toBe(6);expect(result.result!.display_quote!.display_currency).toBe("USD");expect(f.db.count("certificate_previews")).toBe(1);
  expect(requests[0]).not.toHaveProperty("estimate_input");const wire=JSON.stringify(requests);for(const canary of ["CANARY",tmp,"public-result-candidate","frozen_input",'"metadata":'])expect(wire).not.toContain(canary);
  expect(events.some(e=>e.status==="PENDING")).toBe(true);
 }finally{f.db.sqlite.close();vi.unstubAllEnvs();await fs.rm(tmp,{recursive:true,force:true});}
},30000);
it("capability discovery fails closed and UI refuses fabricated URLs and private data",async()=>{
 expect((await estimateCapabilities({})).web.reason).toBe("OWNER_PREVIEW_DISABLED");
 expect((await estimateCapabilities({OWNER_PREVIEW_ENABLED:"true"})).web.available).toBe(false);
 expect((await getExperienceCapabilities(async()=>{throw new Error("PRIVATE");})).web.reason).toBe("STATUS_UNAVAILABLE");
 expect(()=>experienceStep({stage:"scope",path:"PRIVATE"})).toThrow();
 expect(()=>experienceStep({stage:"result",preview_url:"https://evil.example/",expires_at:"2099-01-01T00:00:00.000Z"})).toThrow();
 expect(()=>experienceStep({stage:"result"})).toThrow();
 expect(experienceStep({stage:"confirmation",transfer_id:"pt_"+"1".repeat(32)}).stage).toBe("confirmation");
});
