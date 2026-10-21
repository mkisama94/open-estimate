import type { ApprovedDraft, CertificateEnvelope, CertificateStatus } from "../core/certificate-contract.js";
export interface D1Statement {bind(...args:unknown[]):D1Statement;first<T>():Promise<T|null>}
export interface CertificateDatabase {prepare(sql:string):D1Statement;batch(statements:D1Statement[]):Promise<unknown>}
interface PreviewRow {preview_id:string;owner_id:string;draft_json:string|null;draft_hash:string;expires_at:number;consumed_receipt:string|null}
interface PublicationRow {share_id:string;owner_id:string;certificate_id:string;state:"PUBLIC"|"WITHDRAWN";published_at:string;envelope_json:string|null;signed_object_hash:string;key_id:string;certificate_state:"ACTIVE"|"REVOKED";key_state:"ACTIVE"|"RETIRED"|"REVOKED"|null;status_generation:string;reason_code:string|null}
export interface ReceiptRow {receipt_id:string;fingerprint:string;certificate_id:string;share_id:string}
export class CertificateRepository {
  constructor(private readonly db:CertificateDatabase) {}
  private statement(sql:string,...values:unknown[]) {return this.db.prepare(sql).bind(...values);}
  preview(id:string,owner:string) {return this.statement("SELECT * FROM certificate_previews WHERE preview_id=? AND owner_id=?",id,owner).first<PreviewRow>();}
  receipt(owner:string,key:string) {return this.statement("SELECT * FROM issuance_receipts WHERE owner_id=? AND idempotency_key=?",owner,key).first<ReceiptRow>();}
  async savePreview(id:string,owner:string,draft:ApprovedDraft,hash:string,now:number) {
    await this.db.batch([
      this.statement("INSERT INTO operation_guards VALUES (?, CASE WHEN (SELECT COUNT(*) FROM certificate_previews WHERE owner_id=? AND created_at>?)<5 AND (SELECT COUNT(*) FROM certificate_previews WHERE owner_id=? AND expires_at>? AND consumed_receipt IS NULL)<5 THEN 1 ELSE 0 END)",id,owner,now-60000,owner,now),
      this.statement("INSERT INTO certificate_previews VALUES (?,?,?,?,?,?,NULL)",id,owner,JSON.stringify(draft),hash,Date.parse(draft.expires_at),now),
      this.statement("DELETE FROM operation_guards WHERE operation_id=?",id)
    ]);
  }
  async commit(input:{owner:string;preview_id:string;draft_hash:string;receipt_id:string;idempotency_key:string;fingerprint:string;share_id:string;envelope:CertificateEnvelope;approval:{one_time_id:string;expires_at:number;trusted_channel:string};now:number}) {
    const i=input,s=i.envelope.signed_object,approval=i.approval;
    // A false guard always attempts one failing CHECK insert. D1 batch rolls back every statement.
    await this.db.batch([
      this.statement(`INSERT INTO operation_guards VALUES (?, CASE WHEN
        EXISTS(SELECT 1 FROM certificate_previews WHERE preview_id=? AND owner_id=? AND draft_hash=? AND expires_at>? AND consumed_receipt IS NULL AND draft_json IS NOT NULL)
        AND EXISTS(SELECT 1 FROM signing_keys WHERE key_id=? AND state='ACTIVE')
        AND EXISTS(SELECT 1 FROM issuance_policy WHERE id=1 AND enabled=1 AND status_generation=?)
        AND ?>? AND (SELECT COUNT(*) FROM issuance_receipts WHERE owner_id=? AND created_at>?)<20
        THEN 1 ELSE 0 END)`,i.receipt_id,i.preview_id,i.owner,i.draft_hash,i.now,s.key_id,s.status_generation,approval.expires_at,i.now,i.owner,i.now-86400000),
      this.statement("INSERT INTO approval_receipts VALUES (?,?,'issue_and_publish',?,?,?,?)",approval.one_time_id,i.owner,i.draft_hash,approval.expires_at,approval.trusted_channel,i.receipt_id),
      this.statement("INSERT INTO certificates VALUES (?,?,?,?,'ACTIVE',?,NULL)",s.certificate_id,i.envelope.signed_object_hash,s.key_id,s.issued_at,s.status_generation),
      this.statement("INSERT INTO publications VALUES (?,?,?,'PUBLIC',?)",i.share_id,s.certificate_id,i.owner,s.issued_at),
      this.statement("INSERT INTO publication_contents VALUES (?,?)",i.share_id,JSON.stringify(i.envelope)),
      this.statement("INSERT INTO issuance_receipts VALUES (?,?,?,?,?,?,?)",i.receipt_id,i.owner,i.idempotency_key,i.fingerprint,s.certificate_id,i.share_id,i.now),
      this.statement("UPDATE certificate_previews SET draft_json=NULL,consumed_receipt=? WHERE preview_id=?",i.receipt_id,i.preview_id),
      this.statement("INSERT INTO audit_events VALUES (?,?,?,'ISSUED',?)",i.receipt_id,i.owner,s.certificate_id,i.now),
      this.statement("DELETE FROM operation_guards WHERE operation_id=?",i.receipt_id)
    ]);
  }
  publication(share:string,owner?:string) {
    return this.statement(`SELECT p.*,v.envelope_json,c.signed_object_hash,c.key_id,c.state AS certificate_state,c.status_generation,c.reason_code,k.state AS key_state
      FROM publications p JOIN certificates c USING(certificate_id) LEFT JOIN signing_keys k USING(key_id) LEFT JOIN publication_contents v USING(share_id)
      WHERE p.share_id=?${owner===undefined?"":" AND p.owner_id=?"}`,share,...(owner===undefined?[]:[owner])).first<PublicationRow>();
  }
  async status(id:string,generation:string,now:number):Promise<CertificateStatus> {
    const row=await this.statement(`SELECT c.*,p.state AS publication_state,k.state AS key_state FROM certificates c LEFT JOIN publications p USING(certificate_id) LEFT JOIN signing_keys k USING(key_id) WHERE certificate_id=?`,id).first<{signed_object_hash:string;key_id:string;state:"ACTIVE"|"REVOKED";publication_state:"PUBLIC"|"WITHDRAWN";key_state:"ACTIVE"|"RETIRED"|"REVOKED"|null;status_generation:string;reason_code:string|null}>();
    if(!row)return {certificate_id:id,signed_object_hash:null,key_id:null,registration:"NOT_FOUND",certificate_state:"UNKNOWN",publication_state:"UNKNOWN",key_state:"UNKNOWN",status_generation:null,status_checked_at:new Date(now).toISOString(),reason_code:"NOT_FOUND"};
    const stale=row.status_generation!==generation;
    return {certificate_id:id,signed_object_hash:row.signed_object_hash,key_id:row.key_id,registration:stale?"UNKNOWN":"REGISTERED",certificate_state:stale?"UNKNOWN":row.key_state==="REVOKED"?"REVOKED":row.state,
      publication_state:stale?"UNKNOWN":row.publication_state,key_state:row.key_state??"UNKNOWN",status_generation:row.status_generation,status_checked_at:new Date(now).toISOString(),reason_code:stale?"STATUS_GENERATION_MISMATCH":row.key_state===null?"KEY_STATUS_UNKNOWN":row.key_state==="REVOKED"?"KEY_COMPROMISE":row.reason_code};
  }
  async withdraw(share:string,owner:string,now:number) {
    await this.db.batch([
      this.statement("INSERT INTO operation_guards VALUES (?, CASE WHEN EXISTS(SELECT 1 FROM publications WHERE share_id=? AND owner_id=?) THEN 1 ELSE 0 END)",share,share,owner),
      this.statement("DELETE FROM publication_contents WHERE share_id=?",share),
      this.statement("UPDATE publications SET state='WITHDRAWN' WHERE share_id=? AND owner_id=?",share,owner),
      this.statement("INSERT OR IGNORE INTO audit_events VALUES (?,?,?,'WITHDRAWN',?)",share,owner,share,now),
      this.statement("DELETE FROM operation_guards WHERE operation_id=?",share)
    ]);
  }
  async purge(now:number) {await this.db.batch([
    this.statement("UPDATE certificate_previews SET draft_json=NULL WHERE expires_at<=?",now),
    this.statement("DELETE FROM audit_events WHERE created_at<?",now-30*86400000)
  ]);}
  async revoke(certificate:string,reason:string,operator:string,event:string,now:number) {
    if(!["ISSUER_ERROR","OWNER_REQUEST","ABUSE","KEY_COMPROMISE"].includes(reason))throw new Error("INVALID_INPUT");
    await this.db.batch([
      this.statement("UPDATE certificates SET state='REVOKED',reason_code=? WHERE certificate_id=?",reason,certificate),
      this.statement("DELETE FROM publication_contents WHERE share_id IN(SELECT share_id FROM publications WHERE certificate_id=?)",certificate),
      this.statement("UPDATE publications SET state='WITHDRAWN' WHERE certificate_id=?",certificate),
      this.statement("INSERT INTO audit_events VALUES (?,?,?,'REVOKED',?)",event,operator,certificate,now)
    ]);
  }
}
