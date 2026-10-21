import { jcsSha256 } from "../core/canonical.js";
import type { ApprovalAdapter } from "./approval.js";
import type { CertificateDatabase } from "./certificate-repository.js";

export interface WebApprovalGrant {grant_hash:string;owner_id:string;operation:string;binding_hash:string;expires_at:number;trusted_channel:"WEB_USER_CONFIRMATION_V1"}
export interface WebApprovalGrantReader {find(hash:string):Promise<WebApprovalGrant|null>}
export function approvalGrantHash(id:string) {
  if(!/^wa_[a-f0-9]{64}$/.test(id))throw new Error("APPROVAL_REQUIRED");
  return jcsSha256({domain:"oes/web-approval-grant/v1",id});
}
/** Called only with a server-derived binding after browser session/CSRF/confirmation verification. */
export function approvalBindingHash(binding:Record<string,unknown>) {
  const {now,...content}=binding;
  return jcsSha256({domain:"oes/approval-binding/v1",binding:content});
}
export function d1ApprovalGrantReader(db:CertificateDatabase):WebApprovalGrantReader {
  return {find:hash=>db.prepare("SELECT * FROM web_approval_grants WHERE grant_hash=?").bind(hash).first<WebApprovalGrant>()};
}
/** Read-only verifier. It cannot turn a bearer token, model flag or chat text into approval. */
export function createStoredApprovalAdapter(reader:WebApprovalGrantReader):ApprovalAdapter {
  const match=async(id:string,binding:{principal_id:string;operation:string;now:number}&Record<string,unknown>)=>{
    let hash:string;try {hash=approvalGrantHash(id);}catch {return null;}
    const grant=await reader.find(hash);
    if(!grant || grant.grant_hash!==hash || grant.owner_id!==binding.principal_id || grant.operation!==binding.operation
      || grant.binding_hash!==approvalBindingHash(binding) || !Number.isSafeInteger(grant.expires_at) || grant.expires_at<=binding.now || grant.trusted_channel!=="WEB_USER_CONFIRMATION_V1")return null;
    return grant;
  };
  return {mode:"production",
    verifyTransfer:async(id,binding)=>!!await match(id,binding),
    verifyPublication:async(id,binding)=>{const grant=await match(id,binding);return grant?{one_time_id:grant.grant_hash,expires_at:grant.expires_at,trusted_channel:grant.trusted_channel}:null;},
    verifyWithdrawal:async(id,binding)=>!!await match(id,binding)
  };
}
