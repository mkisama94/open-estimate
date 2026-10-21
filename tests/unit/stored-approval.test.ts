import { it,expect } from "vitest";
import { approvalBindingHash,approvalGrantHash,createStoredApprovalAdapter,type WebApprovalGrant } from "../../src/web/stored-approval.js";
const now=Date.parse("2026-10-20T00:00:00Z"),id="wa_"+"1".repeat(64);
const binding={principal_id:"owner-1",operation:"issue_and_publish" as const,approved_draft_hash:"a".repeat(64),policy_version:"oes/certificate-publication-policy/v1",now};
const grant=():WebApprovalGrant=>({grant_hash:approvalGrantHash(id),owner_id:binding.principal_id,operation:binding.operation,binding_hash:approvalBindingHash(binding),expires_at:now+300000,trusted_channel:"WEB_USER_CONFIRMATION_V1"});
it("returns a stable one-time ID hash for atomic publication consumption, never the bearer receipt",async()=>{
  const row=grant(),a=createStoredApprovalAdapter({find:async hash=>hash===row.grant_hash?row:null});
  const result=await a.verifyPublication(id,binding);
  expect(result).toEqual({one_time_id:row.grant_hash,expires_at:row.expires_at,trusted_channel:"WEB_USER_CONFIRMATION_V1"});
  expect(result?.one_time_id).not.toBe(id);expect(await a.verifyPublication("confirmed=true",binding)).toBeNull();
});
it.each([{principal_id:"other"},{approved_draft_hash:"b".repeat(64)},{policy_version:"changed"},{now:now+300000}])("rejects changed approval binding %j",async changes=>{
  const row=grant(),a=createStoredApprovalAdapter({find:async()=>row});
  expect(await a.verifyPublication(id,{...binding,...changes})).toBeNull();
});
it("does not treat login, a transfer grant or a withdrawal grant as publication approval",async()=>{
  const row=grant(),a=createStoredApprovalAdapter({find:async()=>row});
  expect(await a.verifyTransfer(id,{principal_id:"owner-1",operation:"prepare_certificate_preview",input_commitment:{domain:"oes/certificate-input-commitment/v1",algorithm:"SHA-256",digest:"a".repeat(64)},metadata_hash:"b".repeat(64),policy_version:binding.policy_version,now})).toBe(false);
  expect(await a.verifyWithdrawal(id,{principal_id:"owner-1",operation:"withdraw_publication",share_id:"sh_"+"1".repeat(32),signed_object_hash:"c".repeat(64),status_generation:"sg_"+"1".repeat(32),now})).toBe(false);
  expect(await createStoredApprovalAdapter({find:async()=>null}).verifyPublication(id,binding)).toBeNull();
});
it("fails closed if the approval store is unavailable",async()=>{
  const a=createStoredApprovalAdapter({find:async()=>{throw Error("DB_UNAVAILABLE");}});
  await expect(a.verifyPublication(id,binding)).rejects.toThrow("DB_UNAVAILABLE");
});
