import { randomBytes } from "node:crypto";
import { checkContract, previewRequestSchema, publishRequestSchema, POLICY_VERSION, type FrozenInput, type ApprovedDraft, type CertificateEnvelope, type EngineRef, approvedDraftSchema } from "../core/certificate-contract.js";
import { assertEnvironment, createApprovedDraft, createSignedObject, draftHash, inputCommitment, recomputeCertificateResult, type IssuanceCatalog } from "../core/certificate.js";
import { jcsSha256 } from "../core/canonical.js";
import { CertificateRepository, type ReceiptRow } from "./certificate-repository.js";
import type { Principal } from "./auth.js";
import type { ApprovalAdapter } from "./approval.js";
import { verifyCertificate, type TrustedSigningKey } from "../core/certificate-verify.js";
const id=(prefix:string)=>prefix+randomBytes(16).toString("hex");
export interface CertificateServiceConfig {environment:"test"|"production";origin:string;generation:string;engine:EngineRef;key_id:string;issuance_enabled:boolean;publication_read_enabled:boolean;auth_mode:"test"|"production";catalog:IssuanceCatalog;trusted_keys:readonly (TrustedSigningKey & {created_at:string})[]}
export class CertificateService {
  constructor(readonly repository:CertificateRepository,private readonly approvals:ApprovalAdapter,readonly config:CertificateServiceConfig,private readonly sign:(s:ReturnType<typeof createSignedObject>)=>Promise<CertificateEnvelope>) {
    assertEnvironment(config.origin,config.environment);
    if(config.environment==="production" && (config.auth_mode!=="production" || approvals.mode!=="production"))throw new Error("AUTH_CONSENT_NOT_READY");
  }
  private enabled() {if(!this.config.issuance_enabled)throw new Error("ISSUANCE_DISABLED");}
  private catalog(now:number) {return {...this.config.catalog,now};}
  async preview(principal:Principal,value:unknown,now:number) {
    this.enabled();
    const request=checkContract<{frozen_input:FrozenInput;nonce:string;metadata:unknown;policy_version:string;transfer_authorization_id:string}>(previewRequestSchema,value);
    const commitment=inputCommitment(request.frozen_input,request.nonce);
    if(!await this.approvals.verifyTransfer(request.transfer_authorization_id,{principal_id:principal.subject,operation:"prepare_certificate_preview",input_commitment:commitment,metadata_hash:jcsSha256(request.metadata),policy_version:POLICY_VERSION,now}))throw new Error("APPROVAL_REQUIRED");
    const draft=createApprovedDraft(request.frozen_input,request.nonce,request.metadata,{origin:this.config.origin,environment:this.config.environment,certificate_id:id("cert_"),share_id:id("sh_"),status_generation:this.config.generation,engine:this.config.engine,now},this.catalog(now));
    const preview_id=id("pv_"),approved_draft_hash=draftHash(draft);
    try {await this.repository.savePreview(preview_id,principal.subject,draft,approved_draft_hash,now);}
    catch(e) {throw new Error(e instanceof Error && /CHECK constraint failed/.test(e.message)?"RATE_LIMITED":"STATUS_UNAVAILABLE");}
    return {preview_id,approved_draft:draft,approved_draft_hash};
  }
  async getPreview(principal:Principal,preview:string,now:number) {
    const row=await this.repository.preview(preview,principal.subject);
    if(!row)throw new Error("NOT_FOUND");
    if(row.expires_at<=now)throw new Error("PREVIEW_EXPIRED");
    if(!row.draft_json)throw new Error("ALREADY_CONSUMED");
    return {preview_id:preview,approved_draft:checkContract<ApprovedDraft>(approvedDraftSchema,JSON.parse(row.draft_json)),approved_draft_hash:row.draft_hash};
  }
  private async recover(row:ReceiptRow,fingerprint:string) {
    if(row.fingerprint!==fingerprint)throw new Error("IDEMPOTENCY_CONFLICT");
    const publication=await this.repository.publication(row.share_id);
    if(!publication)throw new Error("STATUS_UNAVAILABLE");
    const readable=this.canRead(publication);
    return {certificate:readable?(await this.shared(row.share_id,Date.now())).certificate:null,publication:{share_id:row.share_id,certificate_id:row.certificate_id,state:publication.state,published_at:publication.published_at},receipt_id:row.receipt_id};
  }
  async publish(principal:Principal,value:unknown,key:string,now:number) {
    const request=checkContract<{preview_id:string;approved_draft_hash:string;frozen_input:FrozenInput;nonce:string;approval_receipt_id:string}>(publishRequestSchema,value);
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key))throw new Error("INVALID_INPUT");
    const commitment=inputCommitment(request.frozen_input,request.nonce);
    const fingerprint=jcsSha256({preview_id:request.preview_id,approved_draft_hash:request.approved_draft_hash,input_commitment:commitment,approval_receipt_id:request.approval_receipt_id});
    // Recovery precedes expiry, consumed approval and the new-issuance switch.
    const existing=await this.repository.receipt(principal.subject,key);
    if(existing)return {created:false,...await this.recover(existing,fingerprint)};
    this.enabled();
    const preview=await this.getPreview(principal,request.preview_id,now),draft=preview.approved_draft;
    if(preview.approved_draft_hash!==request.approved_draft_hash || draftHash(draft)!==request.approved_draft_hash || jcsSha256(draft.input_commitment)!==jcsSha256(commitment)
      || draft.status_generation!==this.config.generation || jcsSha256(draft.server_engine_ref)!==jcsSha256(this.config.engine))throw new Error("DRAFT_CHANGED");
    if(jcsSha256(recomputeCertificateResult(request.frozen_input,this.catalog(now)))!==jcsSha256(draft.result) || jcsSha256(request.frozen_input.ruleset_ref)!==jcsSha256(draft.ruleset_ref))throw new Error("DRAFT_CHANGED");
    const approval=await this.approvals.verifyPublication(request.approval_receipt_id,{principal_id:principal.subject,operation:"issue_and_publish",approved_draft_hash:request.approved_draft_hash,policy_version:POLICY_VERSION,now});
    if(!approval || approval.expires_at<=now)throw new Error("APPROVAL_REQUIRED");
    const envelope=await this.sign(createSignedObject(draft,this.config.key_id,now));
    const verification=await verifyCertificate(envelope,this.config.trusted_keys);
    if(verification.schema!=="VALID" || verification.hash!=="MATCH" || verification.signature!=="VALID" || verification.issuer_trust!=="TRUSTED")throw new Error("SIGNING_UNAVAILABLE");
    const receipt_id=id("req_");
    try {await this.repository.commit({owner:principal.subject,preview_id:request.preview_id,draft_hash:request.approved_draft_hash,receipt_id,idempotency_key:key,fingerprint,share_id:draft.share_id,envelope,approval,now});}
    catch {
      const won=await this.repository.receipt(principal.subject,key);
      if(won)return {created:false,...await this.recover(won,fingerprint)};
      const row=await this.repository.preview(request.preview_id,principal.subject);
      throw new Error(row?.consumed_receipt?"ALREADY_CONSUMED":"STATUS_UNAVAILABLE");
    }
    const saved=await this.repository.receipt(principal.subject,key);
    if(!saved)throw new Error("STATUS_UNAVAILABLE");
    return {created:true,...await this.recover(saved,fingerprint)};
  }
  private canRead(row:Awaited<ReturnType<CertificateRepository["publication"]>>) {
    return !!row && this.config.publication_read_enabled && row.state==="PUBLIC" && row.certificate_state==="ACTIVE" && (row.key_state==="ACTIVE" || row.key_state==="RETIRED") && row.status_generation===this.config.generation && !!row.envelope_json;
  }
  async shared(share:string,now:number) {
    const row=await this.repository.publication(share);
    if(!row)throw new Error("NOT_FOUND");
    if(!this.config.publication_read_enabled)throw new Error("STATUS_UNAVAILABLE");
    if(row.state==="WITHDRAWN" || row.certificate_state==="REVOKED" || row.key_state==="REVOKED")throw new Error("PUBLICATION_WITHDRAWN");
    if(!this.canRead(row))throw new Error("STATUS_UNAVAILABLE");
    const current_status=await this.repository.status(row.certificate_id,this.config.generation,now);
    if(current_status.publication_state!=="PUBLIC" || current_status.certificate_state!=="ACTIVE" || !["ACTIVE","RETIRED"].includes(current_status.key_state) || current_status.status_generation!==this.config.generation)throw new Error("STATUS_UNAVAILABLE");
    const certificate=JSON.parse(row.envelope_json!) as CertificateEnvelope;
    const verification=await verifyCertificate(certificate,this.config.trusted_keys);
    if(verification.schema!=="VALID" || verification.hash!=="MATCH" || verification.signature!=="VALID" || certificate.signed_object_hash!==row.signed_object_hash || certificate.signed_object.certificate_id!==row.certificate_id || certificate.signed_object.key_id!==row.key_id)throw new Error("STATUS_UNAVAILABLE");
    return {certificate,publication:{share_id:row.share_id,certificate_id:row.certificate_id,state:row.state,published_at:row.published_at},current_status};
  }
  async receipt(principal:Principal,key:string) {
    const row=await this.repository.receipt(principal.subject,key);
    if(!row)throw new Error("NOT_FOUND");
    const publication=await this.repository.publication(row.share_id,principal.subject);
    if(!publication)throw new Error("STATUS_UNAVAILABLE");
    return {outcome:"ISSUED",certificate_id:row.certificate_id,share_id:row.share_id,signed_object_hash:publication.signed_object_hash,publication_state:publication.state};
  }
  async withdraw(principal:Principal,share:string,approvalId:string,now:number) {
    const row=await this.repository.publication(share,principal.subject);
    if(!row)throw new Error("NOT_FOUND");
    if(!await this.approvals.verifyWithdrawal(approvalId,{principal_id:principal.subject,operation:"withdraw_publication",share_id:share,signed_object_hash:row.signed_object_hash,status_generation:row.status_generation,now}))throw new Error("APPROVAL_REQUIRED");
    await this.repository.withdraw(share,principal.subject,now);
    return {share_id:share,publication_state:"WITHDRAWN"};
  }
}
