import {it,expect} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
import {previewFixture} from "../fixtures/owner-preview.js";
import {ESTIMATE_POLICY,ESTIMATE_METADATA_HASH,estimateCommitment} from "../../src/core/estimate-preview.js";
import {transferSecretHash} from "../../src/core/preview-transfer-contract.js";
import {estimateCapabilities} from "../../src/web/estimate-capabilities.js";
import {experienceStep,getExperienceCapabilities} from "../../src/remote/experience.js";
import {directFixture} from "../fixtures/direct-estimate.js";
it("retires new numeric transfers without destroying legacy certificate paths",async()=>{
 const f=previewFixture(),d=await directFixture();try{const nonce=randomBytes(32).toString("base64url");
 await expect(f.service.create({input_commitment:estimateCommitment(d.snapshot.input,nonce),metadata_hash:ESTIMATE_METADATA_HASH,policy_version:ESTIMATE_POLICY,client_secret_hash:transferSecretHash(f.secret)},randomUUID(),null,f.now.value)).rejects.toThrow("ESTIMATE_FLOW_RETIRED");
 expect(f.db.count("preview_transfers")).toBe(0);
 const certificate=await f.create();expect(certificate.state).toBe("PENDING");
 }finally{f.db.sqlite.close();d.db.sqlite.close();}
});
it("capability discovery is metadata-only and the progress UI accepts only saved URLs, never estimates",async()=>{
 expect((await estimateCapabilities({})).web.reason).toBe("ESTIMATE_PUBLICATION_DISABLED");
 expect((await estimateCapabilities({ESTIMATE_PUBLICATION_ENABLED:"true"})).web.available).toBe(false);
 expect((await getExperienceCapabilities(async()=>{throw Error("PRIVATE");})).web.reason).toBe("STATUS_UNAVAILABLE");
 expect(experienceStep({stage:"confirmation"}).stage).toBe("confirmation");
 for(const bad of [{stage:"confirmation",transfer_id:"pt_"+"1".repeat(32)},{stage:"scope",source:"CANARY"},{stage:"result",result_url:"https://evil.example",expires_at:new Date().toISOString()}])expect(()=>experienceStep(bad)).toThrow();
 expect(experienceStep({stage:"result",result_url:"https://open-estimate.ai-orchestration.jp/manage/estimates/se_"+"1".repeat(32),expires_at:new Date(Date.now()+86400000).toISOString()}).stage).toBe("result");
});
