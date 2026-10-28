import {it,expect,vi} from "vitest";
import {directFixture} from "../fixtures/direct-estimate.js";
import {EstimatePublicationService} from "../../src/web/estimate-publication.js";
import {savedEstimatePage} from "../../src/web/saved-estimates.js";
import {validateResultSnapshot,estimatePresentation} from "../../src/core/estimate-publication.js";
import {localPreviewDocument} from "../../src/local/estimate-ui.js";
import {renderEstimatePdf} from "../../src/local/estimate-pdf.js";
import {jcsSha256} from "../../src/core/canonical.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {saveRun,readRun} from "../../src/local/runs.js";
import {generatedRules} from "../fixtures/measurement.js";
import {prepareResultPreview,consentResultPublication,publicationInput,showResultPreview,regenerateResultPdf,migrateLegacyEstimate} from "../../src/local/estimate-result.js";
import {estimateSubmissionsRoot} from "../../src/local/estimate-submissions.js";
import {estimateCommitment} from "../../src/core/estimate-preview.js";
import {randomBytes,randomUUID} from "node:crypto";
import {sha256Hex} from "../../src/core/canonical.js";
import {publishResultPreview} from "../../src/local/publish-estimate.js";

it("one authenticated request saves once; retries and concurrent calls return the same URL without a transfer",async()=>{
 const f=await directFixture();try{const service=new EstimatePublicationService(f.db,f.catalog,true);
  const results=await Promise.all([service.publish(f.principal,f.request,f.now),service.publish(f.principal,f.request,f.now)]);
  expect(results[0].result_url).toBe(results[1].result_url);expect(f.db.count("saved_estimates")).toBe(1);expect(f.db.count("estimate_publications")).toBe(1);expect(f.db.count("preview_transfers")).toBe(0);
  expect(Date.parse(results[0].expires_at)-f.now).toBe(30*86400000);
  expect(await service.publish(f.principal,f.request,f.now+1000)).toEqual(results[0]);
  const changed=structuredClone(f.request);changed.snapshot.measured_at=new Date(f.now-1000).toISOString();changed.consent.snapshot_hash=jcsSha256(changed.snapshot);
  await expect(service.publish(f.principal,changed,f.now)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
 }finally{f.db.sqlite.close();}
});
it("enforces owner auth and exact consent and refuses mismatched numbers or FX without saving",async()=>{
 const f=await directFixture();try{const service=new EstimatePublicationService(f.db,f.catalog,true);
  for(const principal of [null,{...f.principal,scopes:[]},{...f.principal,expires_at:f.now}])await expect(service.publish(principal,f.request,f.now)).rejects.toThrow("AUTH_REQUIRED");
  for(const change of [(v:any)=>v.snapshot.result.calculation.effort.person_hours.median="1",(v:any)=>v.snapshot.display_quote.localized_reference.amount.median="1",(v:any)=>v.snapshot.input.evaluation.model.source="CANARY",(v:any)=>v.consent.destination="https://evil.example",(v:any)=>v.owner_id="owner-other",(v:any)=>v.consent.confirmed=false]){
   const bad=structuredClone(f.request);change(bad);bad.consent.snapshot_hash=jcsSha256(bad.snapshot);await expect(service.publish(f.principal,bad,f.now)).rejects.toThrow();
  }
  for(const change of [(v:any)=>v.snapshot.display_quote.locale="PRIVATE_PATH_CANARY",(v:any)=>v.snapshot.display_quote.limitation_codes.push("PRIVATE_CODE_CANARY")]){const bad=structuredClone(f.request);change(bad);bad.consent.snapshot_hash=jcsSha256(bad.snapshot);await expect(service.publish(f.principal,bad,f.now)).rejects.toThrow("RESULT_MISMATCH");}
  expect(f.db.count("saved_estimates")).toBe(0);
 }finally{f.db.sqlite.close();}
});
it("keeps the frozen result across private Web viewing, denies another owner, and protects extend/delete with CSRF",async()=>{
 const f=await directFixture();try{
  const result=await new EstimatePublicationService(f.db,f.catalog,true).publish(f.principal,f.request,f.now);
  const context={repository:{db:f.db},config:{origin:"https://open-estimate.ai-orchestration.jp"},ownerPreview:async()=>{throw Error("LEGACY_NOT_NEEDED");}};
  const sessions:any={mode:"test",read:async(req:Request)=>req.headers.has("Cookie")?{session_id:"test",expires_at:f.now+3600000,principal:{...f.principal,subject:req.headers.get("Cookie")==="other"?"owner-b":"owner-a"}}:null,csrfToken:async()=>"csrf",verifyCsrf:async(_:unknown,__:unknown,t:string)=>t==="csrf"};
  const get=(url=result.result_url,cookie="owner")=>savedEstimatePage(new Request(url,{headers:{Cookie:cookie}}),context,sessions,f.now);
  expect((await get(result.result_url,"other")).status).toBe(404);const html=await(await get()).text();expect(html).toContain(f.snapshot.result.calculation.effort.person_hours!.median!);expect(html).not.toContain("照合コード");expect(html).toContain("30日");
  const post=(origin:string,csrf:string)=>savedEstimatePage(new Request(result.result_url+"/extend",{method:"POST",headers:{Cookie:"owner",Origin:origin,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrf,consent:"yes"})}),context,sessions,f.now);
  expect((await post("https://evil.example","csrf")).status).toBe(403);expect((await post(context.config.origin,"bad")).status).toBe(403);expect((await post(context.config.origin,"csrf")).status).toBe(303);
  expect((await savedEstimatePage(new Request(result.result_url),context,sessions,f.now)).status).toBe(401);
 }finally{f.db.sqlite.close();}
});
it("uses the identical complete/partial presentation in local preview, PDF and Web",async()=>{
 const f=await directFixture();try{for(const coverage of ["COMPLETE","MISSING","UNKNOWN"] as const){f.snapshot.scope_coverage=coverage;await validateResultSnapshot(f.snapshot);
  const v=estimatePresentation(f.snapshot),html=localPreviewDocument(f.snapshot),pdf=await renderEstimatePdf(f.snapshot);expect(pdf.subarray(0,5).toString()).toBe("%PDF-");
  if(coverage!=="COMPLETE"){expect(v.median).toBeNull();expect(html).toContain("全体工数：未算出");expect(html).toContain("取得済み部分のみの参考工数");}else expect(v.median).toBe(f.snapshot.result.calculation.effort.person_hours!.median);
  expect(html).not.toContain("fetch(");
 }}finally{f.db.sqlite.close();}
});
it("prepares UI and PDF locally with zero Open Estimate requests; consent and retry reuse the exact operation and PDF failures recover",async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-result-local-"));vi.stubEnv("OES_RUNS_ROOT",path.join(temp,"runs"));const f=await directFixture();
 const send=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("NO_NETWORK"));
 try{const context={...generatedRules,context_hash:"synthetic"};const run=await saveRun(f.a,f.a,context,path.join(temp,"source"));
  const preview=await prepareResultPreview({run_id:run.run_id,display_currency:"USD"});expect(preview.status).toBe("READY_FOR_REVIEW");expect(preview.pdf?.path).toMatch(/\.pdf$/);expect(send).not.toHaveBeenCalled();
  const legacyId=randomUUID(),nonce=randomBytes(32).toString("base64url"),legacy={submission_id:legacyId,estimate_input:preview.snapshot.input,nonce,input_commitment:estimateCommitment(preview.snapshot.input,nonce)},legacyRaw=JSON.stringify(legacy),legacyDir=path.join(estimateSubmissionsRoot(),legacyId);
  await fs.mkdir(legacyDir,{recursive:true});await fs.writeFile(path.join(legacyDir,"submission.json"),legacyRaw);await fs.writeFile(path.join(legacyDir,"COMPLETE.json"),JSON.stringify({sha256:sha256Hex(legacyRaw)}));await fs.writeFile(path.join(legacyDir,"local-receipt.json"),JSON.stringify({run_id:run.run_id,checksums_hash:(await readRun(run.run_id)).checksums_hash}));
  const migrated=await migrateLegacyEstimate(legacyId);expect(migrated.transmitted).toBe(false);expect(migrated.snapshot.display_quote.display_currency).toBe("USD");expect(migrated.preview_id).not.toBe(preview.preview_id);await expect(publicationInput(migrated.preview_id)).rejects.toThrow();expect(send).not.toHaveBeenCalled();
  const before=await fs.readFile(preview.pdf!.path);await expect(consentResultPublication({preview_id:preview.preview_id,snapshot_hash:"0".repeat(64),user_confirmed:true})).rejects.toThrow("CONSENT_CONTENT_CHANGED");
  const consent=await consentResultPublication({preview_id:preview.preview_id,snapshot_hash:preview.snapshot_hash,user_confirmed:true});expect(await publicationInput(preview.preview_id)).toEqual(consent);expect(await consentResultPublication({preview_id:preview.preview_id,snapshot_hash:preview.snapshot_hash,user_confirmed:true})).toEqual(consent);
  expect(await fs.readFile(preview.pdf!.path)).toEqual(before);expect((await showResultPreview(preview.preview_id)).snapshot_hash).toBe(preview.snapshot_hash);expect(send).not.toHaveBeenCalled();
  const write=vi.spyOn(fs,"writeFile").mockRejectedValueOnce(new Error("DISK_FULL"));const failed=await regenerateResultPdf(preview.preview_id);write.mockRestore();expect(failed.status).toBe("PDF_INCOMPLETE");expect((await regenerateResultPdf(preview.preview_id)).status).toBe("READY_FOR_REVIEW");
  Object.assign(f.catalog.skills.releases[0],{skill_version:consent.request.snapshot.input.evaluation.skill_integrity.skill_version,package_sha256:consent.request.snapshot.input.evaluation.skill_integrity.package_sha256});
  const service=new EstimatePublicationService(f.db,f.catalog,true),payloads:string[]=[];
  const published=await publishResultPreview(preview.preview_id,{token:"SYNTHETIC_TOKEN",sleep:async()=>{},send:async(_,init)=>{payloads.push(String(init!.body));const value=await service.publish(f.principal,JSON.parse(String(init!.body)),f.now);if(payloads.length===1)throw Error("RESPONSE_LOST");return Response.json(value);}});
  expect(published.status).toBe("PUBLISHED");expect(payloads).toHaveLength(2);expect(payloads[0]).toBe(payloads[1]);expect(payloads[0]).not.toContain("SYNTHETIC_TOKEN");expect(f.db.count("saved_estimates")).toBe(1);
 }finally{send.mockRestore();vi.unstubAllEnvs();f.db.sqlite.close();await fs.rm(temp,{recursive:true,force:true});}
},30000);
