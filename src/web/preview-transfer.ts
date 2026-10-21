import { createHmac,randomBytes,randomInt,timingSafeEqual } from "node:crypto";
import { checkContract,approvedDraftSchema,type ApprovedDraft,type EngineRef } from "../core/certificate-contract.js";
import { transferCreateSchema,transferSubmissionSchema,transferSecretHash,transferBinding,uuidSchema,type TransferCreate,type TransferSubmission,type TransferStatus,type OwnerPreview } from "../core/preview-transfer-contract.js";
import { assertEnvironment,inputCommitment,createApprovedDraft,draftHash,type IssuanceCatalog } from "../core/certificate.js";
import { jcsSha256 } from "../core/canonical.js";
import { PreviewTransferRepository,type TransferRow } from "./preview-transfer-repository.js";
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);};
const opaque=(prefix:string)=>prefix+randomBytes(16).toString("hex");
export interface PreviewTransferConfig {origin:string;environment:"test"|"production";enabled:boolean;code_secret:string;generation:string;engine:EngineRef;catalog:IssuanceCatalog}
/** No issuance gate, signer, signing key or management-scoped auth adapter is a dependency. */
export class PreviewTransferService {
  constructor(readonly repository:PreviewTransferRepository,readonly config:PreviewTransferConfig){
    assertEnvironment(config.origin,config.environment);
    if(!/^[A-Za-z0-9_-]{43}$/.test(config.code_secret) || Buffer.from(config.code_secret,"base64url").toString("base64url")!==config.code_secret
      || !/^sg_[a-f0-9]{32}$/.test(config.generation) || !/^[a-f0-9]{64}$/.test(config.engine.artifact_sha256) || !config.engine.engine_version)throw new Error("STATUS_UNAVAILABLE");
  }
  gate(){if(!this.config.enabled)throw new Error("OWNER_PREVIEW_DISABLED");}
  private codeHash(id:string,code:string){return createHmac("sha256",Buffer.from(this.config.code_secret,"base64url")).update(JSON.stringify(["oes/preview-transfer-code/v1",this.config.origin,id,code])).digest("hex");}
  private code(){return String(randomInt(100000000)).padStart(8,"0");}
  private state(r:TransferRow,now:number):TransferStatus {
    const expires=r.state==="READY"?r.preview_expires_at!:r.state==="APPROVED"?r.submit_expires_at!:r.expires_at;
    const state=expires<=now?"EXPIRED":r.state;
    return {state,transfer_id:r.transfer_id,expires_at:new Date(expires).toISOString(),preview_id:state==="READY"?r.preview_id:null,draft_hash:state==="READY"?r.draft_hash:null,
      preview_url:state==="READY"?this.config.origin+"/manage/certificate-previews/"+r.preview_id:null};
  }
  private active(r:TransferRow,now:number){if(this.state(r,now).state==="EXPIRED")throw new Error("PREVIEW_EXPIRED");}
  private async authorized(id:string,secret:string) {
    this.gate();if(!/^pt_[a-f0-9]{32}$/.test(id))throw new Error("NOT_FOUND");
    const hash=transferSecretHash(secret),row=await this.repository.get(id);
    if(!row || !equal(hash,row.client_secret_hash))throw new Error("AUTH_REQUIRED");return row;
  }
  private pending(r:TransferRow,code:string){return {state:"PENDING" as const,transfer_id:r.transfer_id,verification_url:this.config.origin+"/manage/preview-transfers/"+r.transfer_id,
    user_code:code,expires_at:new Date(r.expires_at).toISOString(),poll_interval_seconds:5 as const};}
  async create(value:unknown,key:string,secret:string|null,now:number):Promise<ReturnType<PreviewTransferService["pending"]>|TransferStatus> {
    this.gate();checkContract(uuidSchema,key);const body=checkContract<TransferCreate>(transferCreateSchema,value),binding=transferBinding(this.config.origin,body);
    let existing=await this.repository.byKey(key);
    if(!existing){
      if(secret!==null && !equal(transferSecretHash(secret),body.client_secret_hash))throw new Error("AUTH_REQUIRED");
      const id=opaque("pt_"),code=this.code();
      const row:TransferRow={transfer_id:id,idempotency_key:key,client_secret_hash:body.client_secret_hash,binding_hash:binding,input_commitment:JSON.stringify(body.input_commitment),metadata_hash:body.metadata_hash,
        policy_version:body.policy_version,code_hmac:this.codeHash(id,code),attempts:0,state:"PENDING",owner_id:null,created_at:now,approved_at:null,expires_at:now+600000,
        submit_expires_at:null,preview_id:null,draft_hash:null,preview_expires_at:null,next_poll_at:0};
      try {await this.repository.create(row);return this.pending(row,code);}
      catch(e){existing=await this.repository.byKey(key);if(!existing)throw new Error(e instanceof Error && /CHECK constraint failed/.test(e.message)?"RATE_LIMITED":"STATUS_UNAVAILABLE");}
    }
    // Knowing the registered hash is not proof of knowing its preimage.
    if(secret===null)throw new Error("AUTH_REQUIRED");
    if(!equal(existing.client_secret_hash,transferSecretHash(secret)) || !equal(existing.client_secret_hash,body.client_secret_hash) || !equal(existing.binding_hash,binding))throw new Error("IDEMPOTENCY_CONFLICT");
    this.active(existing,now);if(existing.state!=="PENDING")return this.state(existing,now);
    let code=this.code();
    while(equal(this.codeHash(existing.transfer_id,code),existing.code_hmac))code=this.code();
    try{await this.repository.rotate(existing,this.codeHash(existing.transfer_id,code),now);}
    catch{const latest=await this.repository.get(existing.transfer_id);if(latest && latest.state!=="PENDING")return this.state(latest,now);throw new Error("STATUS_UNAVAILABLE");}
    return this.pending(existing,code);
  }
  async browserContext(id:string,owner:string,now:number){
    this.gate();const row=await this.repository.get(id);
    if(!row || (row.owner_id!==null && row.owner_id!==owner))throw new Error("NOT_FOUND");this.active(row,now);return row;
  }
  async approve(id:string,owner:string,code:string,now:number){
    const row=await this.browserContext(id,owner,now);
    if(row.state==="APPROVED" || row.state==="READY")return this.state(row,now);
    if(row.state!=="PENDING")throw new Error("APPROVAL_REQUIRED");
    const hmac=this.codeHash(id,code);
    if(!/^[0-9]{8}$/.test(code) || !equal(hmac,row.code_hmac)){await this.repository.wrongCode(id,hmac,now);throw new Error("APPROVAL_REQUIRED");}
    try{await this.repository.approve(row,owner,hmac,now);}
    catch(e){
      const latest=await this.repository.get(id);
      if(latest?.owner_id===owner && ["APPROVED","READY"].includes(latest.state))return this.state(latest,now);
      if(latest?.owner_id && latest.owner_id!==owner)throw new Error("NOT_FOUND");
      if(latest?.state!=="PENDING" || latest.code_hmac!==hmac)throw new Error("APPROVAL_REQUIRED");
      throw new Error(e instanceof Error && /CHECK constraint failed/.test(e.message)?"RATE_LIMITED":"STATUS_UNAVAILABLE");
    }
    return this.state((await this.repository.get(id))!,now);
  }
  async status(id:string,secret:string,now:number){
    const row=await this.authorized(id,secret),result=this.state(row,now);
    if(["PENDING","APPROVED"].includes(result.state)){
      try{await this.repository.poll(id,now);}catch(e){throw new Error(e instanceof Error && /CHECK constraint failed/.test(e.message)?"RATE_LIMITED":"STATUS_UNAVAILABLE");}
    }
    return result;
  }
  async submit(id:string,secret:string,value:unknown,now:number):Promise<TransferStatus> {
    const row=await this.authorized(id,secret);
    if(row.state!=="READY"){this.active(row,now);if(row.state!=="APPROVED" || !row.owner_id)throw new Error("APPROVAL_REQUIRED");}
    const body=checkContract<TransferSubmission>(transferSubmissionSchema,value);
    let commitment;try{commitment=inputCommitment(body.frozen_input,body.nonce);}catch{throw new Error("RESULT_MISMATCH");}
    if(transferBinding(this.config.origin,{input_commitment:commitment,metadata_hash:jcsSha256(body.metadata),policy_version:body.policy_version})!==row.binding_hash)throw new Error("DRAFT_CHANGED");
    // Recovery comes before the (shorter) submission approval deadline, but never extends a preview.
    if(row.state==="READY"){this.active(row,now);return this.state(row,now);}
    const draft=createApprovedDraft(body.frozen_input,body.nonce,body.metadata,{origin:this.config.origin,environment:this.config.environment,certificate_id:opaque("cert_"),share_id:opaque("sh_"),
      status_generation:this.config.generation,engine:this.config.engine,now},{skills:this.config.catalog.skills,rules:this.config.catalog.rules,now});
    const previewId=opaque("pv_"),hash=draftHash(draft);
    try{await this.repository.commit(row,previewId,draft,hash,now);}
    catch(e){
      const won=await this.repository.get(id);if(won?.state==="READY" && won.binding_hash===row.binding_hash){this.active(won,now);return this.state(won,now);}
      throw new Error(e instanceof Error && /CHECK constraint failed/.test(e.message)?"RATE_LIMITED":"STATUS_UNAVAILABLE");
    }
    return this.state((await this.repository.get(id))!,now);
  }
  async ownerPreview(id:string,owner:string,now:number):Promise<OwnerPreview> {
    this.gate();const row=await this.repository.preview(id,owner);if(!row)throw new Error("NOT_FOUND");if(row.expires_at<=now)throw new Error("PREVIEW_EXPIRED");
    const draft=checkContract<ApprovedDraft>(approvedDraftSchema,JSON.parse(row.draft_json));if(draftHash(draft)!==row.draft_hash)throw new Error("STATUS_UNAVAILABLE");
    return {preview_id:row.preview_id,draft_hash:row.draft_hash,expires_at:draft.expires_at,result:draft.result,metadata:draft.metadata,calculation_basis_hash:draft.calculation_basis_hash,
      ruleset_ref:draft.ruleset_ref,server_engine_ref:draft.server_engine_ref,issued:false,published:false,signed:false};
  }
}
