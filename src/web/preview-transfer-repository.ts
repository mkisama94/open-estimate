import type { CertificateDatabase } from "./certificate-repository.js";
import type { ApprovedDraft } from "../core/certificate-contract.js";
import type { TransferState } from "../core/preview-transfer-contract.js";
import { ESTIMATE_POLICY,type EstimateDraft } from "../core/estimate-preview.js";
export interface TransferRow {transfer_id:string;idempotency_key:string;client_secret_hash:string;binding_hash:string;input_commitment:string;metadata_hash:string;policy_version:string;code_hmac:string;attempts:number;state:TransferState;owner_id:string|null;created_at:number;approved_at:number|null;expires_at:number;submit_expires_at:number|null;preview_id:string|null;draft_hash:string|null;preview_expires_at:number|null;next_poll_at:number}
export class PreviewTransferRepository {
  readonly db:CertificateDatabase;
  constructor(database:CertificateDatabase & {withSession?(constraint:string):CertificateDatabase}){this.db=database.withSession?.("first-primary")??database;}
  private s(sql:string,...v:unknown[]){return this.db.prepare(sql).bind(...v);}
  get(id:string){return this.s("SELECT * FROM preview_transfers WHERE transfer_id=?",id).first<TransferRow>();}
  byKey(key:string){return this.s("SELECT * FROM preview_transfers WHERE idempotency_key=?",key).first<TransferRow>();}
  async create(r:TransferRow){await this.db.batch([
    this.s("INSERT INTO operation_guards VALUES (?,CASE WHEN (SELECT COUNT(*) FROM preview_transfers WHERE COALESCE(preview_expires_at,expires_at)>?)<100 THEN 1 ELSE 0 END)",r.transfer_id,r.created_at),
    this.s("INSERT INTO preview_transfers (transfer_id,idempotency_key,client_secret_hash,binding_hash,input_commitment,metadata_hash,policy_version,code_hmac,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,'PENDING',?,?)",r.transfer_id,r.idempotency_key,r.client_secret_hash,r.binding_hash,r.input_commitment,r.metadata_hash,r.policy_version,r.code_hmac,r.created_at,r.expires_at),
    this.s("DELETE FROM operation_guards WHERE operation_id=?",r.transfer_id)]);}
  async rotate(r:TransferRow,hmac:string,now:number){await this.db.batch([
    this.s("INSERT INTO operation_guards VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM preview_transfers WHERE transfer_id=? AND state='PENDING' AND expires_at>? AND attempts<5) THEN 1 ELSE 0 END)","rotate:"+r.transfer_id,r.transfer_id,now),
    this.s("UPDATE preview_transfers SET code_hmac=? WHERE transfer_id=?",hmac,r.transfer_id),this.s("DELETE FROM operation_guards WHERE operation_id=?","rotate:"+r.transfer_id)]);}
  async wrongCode(id:string,code:string,now:number){await this.db.batch([this.s("UPDATE preview_transfers SET attempts=attempts+1,state=CASE WHEN attempts+1>=5 THEN 'LOCKED' ELSE 'PENDING' END WHERE transfer_id=? AND state='PENDING' AND expires_at>? AND attempts<5 AND code_hmac<>?",id,now,code)]);}
  async approve(r:TransferRow,owner:string,code:string,now:number){const until=Math.min(now+300000,r.expires_at);await this.db.batch([
    this.s(`INSERT INTO operation_guards VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM preview_transfers WHERE transfer_id=? AND binding_hash=? AND state='PENDING' AND owner_id IS NULL AND code_hmac=? AND attempts<5 AND expires_at>?)
      AND (SELECT COUNT(*) FROM preview_transfers WHERE owner_id=? AND approved_at>?)<5
      AND (SELECT COUNT(*) FROM certificate_previews WHERE owner_id=? AND created_at>?)<5
      AND (SELECT COUNT(*) FROM certificate_previews WHERE owner_id=? AND expires_at>? AND consumed_receipt IS NULL)<5 THEN 1 ELSE 0 END)`,"approve:"+r.transfer_id,r.transfer_id,r.binding_hash,code,now,owner,now-60000,owner,now-60000,owner,now),
    this.s("INSERT INTO preview_transfer_consents VALUES (?,?,?,?,?,?)",r.transfer_id,owner,r.policy_version===ESTIMATE_POLICY?"prepare_estimate_preview":"prepare_certificate_preview",r.binding_hash,now,until),
    this.s("UPDATE preview_transfers SET state='APPROVED',owner_id=?,approved_at=?,submit_expires_at=? WHERE transfer_id=?",owner,now,until,r.transfer_id),
    this.s("DELETE FROM operation_guards WHERE operation_id=?","approve:"+r.transfer_id)]);}
  async poll(id:string,now:number){await this.db.batch([
    this.s("INSERT INTO operation_guards VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM preview_transfers WHERE transfer_id=? AND next_poll_at<=?) THEN 1 ELSE 0 END)","poll:"+id,id,now),
    this.s("UPDATE preview_transfers SET next_poll_at=? WHERE transfer_id=?",now+5000,id),this.s("DELETE FROM operation_guards WHERE operation_id=?","poll:"+id)]);}
  async commit(r:TransferRow,id:string,draft:ApprovedDraft|EstimateDraft,hash:string,now:number){await this.db.batch([
    this.s(`INSERT INTO operation_guards VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM preview_transfers t JOIN preview_transfer_consents c USING(transfer_id)
      WHERE t.transfer_id=? AND t.state='APPROVED' AND t.preview_id IS NULL AND t.client_secret_hash=? AND t.binding_hash=? AND t.owner_id=? AND t.expires_at>? AND t.submit_expires_at>?
      AND c.owner_id=t.owner_id AND c.binding_hash=t.binding_hash AND c.operation=? AND c.expires_at>?)
      AND (SELECT COUNT(*) FROM certificate_previews WHERE owner_id=? AND created_at>?)<5
      AND (SELECT COUNT(*) FROM certificate_previews WHERE owner_id=? AND expires_at>? AND consumed_receipt IS NULL)<5 THEN 1 ELSE 0 END)`,"ready:"+r.transfer_id,r.transfer_id,r.client_secret_hash,r.binding_hash,r.owner_id,now,now,r.policy_version===ESTIMATE_POLICY?"prepare_estimate_preview":"prepare_certificate_preview",now,r.owner_id,now-60000,r.owner_id,now),
    this.s("INSERT INTO certificate_previews VALUES (?,?,?,?,?,?,NULL)",id,r.owner_id,JSON.stringify(draft),hash,Date.parse(draft.expires_at),now),
    this.s("UPDATE preview_transfers SET state='READY',preview_id=?,draft_hash=?,preview_expires_at=? WHERE transfer_id=?",id,hash,Date.parse(draft.expires_at),r.transfer_id),
    this.s("DELETE FROM operation_guards WHERE operation_id=?","ready:"+r.transfer_id)]);}
  preview(id:string,owner:string){return this.s("SELECT preview_id,draft_json,draft_hash,expires_at FROM certificate_previews WHERE preview_id=? AND owner_id=? AND preview_id IN (SELECT preview_id FROM preview_transfers WHERE state='READY' AND owner_id=?)",id,owner,owner).first<{preview_id:string;draft_json:string;draft_hash:string;expires_at:number}>();}
  async purge(now:number){await this.db.batch([
    // With the 15-minute cron, a 45-minute cutoff guarantees deletion within one hour.
    this.s("DELETE FROM certificate_previews WHERE preview_id IN (SELECT preview_id FROM preview_transfers WHERE preview_expires_at<=?)",now-2700000),
    this.s("DELETE FROM preview_transfer_consents WHERE transfer_id IN (SELECT transfer_id FROM preview_transfers WHERE COALESCE(preview_expires_at,expires_at)<=?)",now-2700000),
    this.s("DELETE FROM preview_transfers WHERE COALESCE(preview_expires_at,expires_at)<=?",now-2700000)]);}
}
