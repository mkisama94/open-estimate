import { obj,hashSchema,commitmentSchema,frozenInputSchema,metadataSchema,serverResultSchema,engineSchema,POLICY_VERSION,type InputCommitment,type FrozenInput,type CertificateMetadata,type ServerResult,type EngineRef } from "./certificate-contract.js";
import { jcsSha256 } from "./canonical.js";
export const transferIdSchema={type:"string",pattern:"^pt_[a-f0-9]{32}$"};
export const previewIdSchema={type:"string",pattern:"^pv_[a-f0-9]{32}$"};
export const uuidSchema={type:"string",pattern:"^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"};
export const secretPattern=/^[A-Za-z0-9_-]{43}$/;
export const transferCreateSchema=obj({input_commitment:commitmentSchema,metadata_hash:hashSchema,policy_version:{const:POLICY_VERSION},client_secret_hash:hashSchema});
export interface TransferCreate {input_commitment:InputCommitment;metadata_hash:string;policy_version:typeof POLICY_VERSION;client_secret_hash:string}
export const transferSubmissionSchema=obj({frozen_input:frozenInputSchema,nonce:{type:"string",pattern:"^[A-Za-z0-9_-]{43}$"},metadata:metadataSchema,policy_version:{const:POLICY_VERSION}});
export interface TransferSubmission {frozen_input:FrozenInput;nonce:string;metadata:CertificateMetadata;policy_version:typeof POLICY_VERSION}
export const emptyTransferSchema=obj({});
export const previewErrorCodes=["INVALID_INPUT","INPUT_TOO_LARGE","AUTH_REQUIRED","APPROVAL_REQUIRED","NOT_FOUND","IDEMPOTENCY_CONFLICT","DRAFT_CHANGED","RESULT_MISMATCH","BASIS_MISMATCH","PREVIEW_EXPIRED","RATE_LIMITED","OWNER_PREVIEW_DISABLED","STATUS_UNAVAILABLE","MODEL_UNSUPPORTED","BASIS_UNSUPPORTED","RULESET_NOT_ISSUABLE","SKILL_NOT_ISSUABLE"] as const;
export const previewErrorSchema=obj({error:obj({code:{enum:previewErrorCodes},request_id:uuidSchema,retryable:{type:"boolean"}})});
export type TransferState="PENDING"|"APPROVED"|"READY"|"DENIED"|"LOCKED"|"EXPIRED";
const time={type:"string",format:"date-time",maxLength:24};
const link={type:"string",maxLength:256,format:"uri"};
export const transferPendingSchema=obj({state:{const:"PENDING"},transfer_id:transferIdSchema,verification_url:link,user_code:{type:"string",pattern:"^[0-9]{8}$"},expires_at:time,poll_interval_seconds:{const:5}});
export const transferStatusSchema=obj({state:{enum:["PENDING","APPROVED","READY","DENIED","LOCKED","EXPIRED"]},transfer_id:transferIdSchema,expires_at:time,
  preview_id:{anyOf:[previewIdSchema,{type:"null"}]},draft_hash:{anyOf:[hashSchema,{type:"null"}]},preview_url:{anyOf:[link,{type:"null"}]}});
export interface TransferStatus {state:TransferState;transfer_id:string;expires_at:string;preview_id:string|null;draft_hash:string|null;preview_url:string|null}
export const transferCreateResponseSchema={anyOf:[transferPendingSchema,transferStatusSchema]};
export const ownerPreviewSchema=obj({preview_id:previewIdSchema,draft_hash:hashSchema,expires_at:time,result:serverResultSchema,metadata:metadataSchema,calculation_basis_hash:hashSchema,
  ruleset_ref:obj({ruleset_id:{const:"oes-measurement"},revision:hashSchema}),server_engine_ref:engineSchema,issued:{const:false},published:{const:false},signed:{const:false}});
export interface OwnerPreview {preview_id:string;draft_hash:string;expires_at:string;result:ServerResult;metadata:CertificateMetadata;calculation_basis_hash:string;ruleset_ref:{ruleset_id:"oes-measurement";revision:string};server_engine_ref:EngineRef;issued:false;published:false;signed:false}
export function transferSecretHash(secret:string) {
  if(!secretPattern.test(secret) || Buffer.from(secret,"base64url").toString("base64url")!==secret)throw new Error("AUTH_REQUIRED");
  return jcsSha256({domain:"oes/preview-transfer-secret/v1",secret});
}
export function transferBinding(origin:string,value:Pick<TransferCreate,"input_commitment"|"metadata_hash"|"policy_version">) {
  return jcsSha256({domain:"oes/preview-transfer-binding/v1",origin,input_commitment:value.input_commitment,metadata_hash:value.metadata_hash,policy_version:value.policy_version});
}
