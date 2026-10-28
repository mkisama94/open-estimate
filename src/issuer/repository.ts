import type {DocumentProof} from '../contracts/document.js';
export interface IssuerStatement {bind(...values:unknown[]):IssuerStatement;first<T>():Promise<T|null>}
export interface IssuerDatabase {prepare(sql:string):IssuerStatement;batch(statements:IssuerStatement[]):Promise<unknown>}
export interface IssuanceRecord {operation_id:string;fingerprint:string;proof_json:string;issued_at:number;state:'ISSUED'}
export interface IssuerRepository {get(operation:string):Promise<IssuanceRecord|null>;commit(operation:string,fingerprint:string,proof:DocumentProof,now:number):Promise<void>}
/** Independent tables only. No model, Markdown, owner or user-facing history. */
export class DocumentIssuerRepository implements IssuerRepository {
 constructor(private db:IssuerDatabase,private capacity=1000000,private perMinute=100){}
 get(id:string){return this.db.prepare('SELECT * FROM document_proof_issuances WHERE operation_id=?').bind(id).first<IssuanceRecord>();}
 async commit(id:string,fingerprint:string,proof:DocumentProof,now:number){
  await this.db.batch([
   this.db.prepare('INSERT INTO document_proof_guards VALUES (?,CASE WHEN (SELECT COUNT(*) FROM document_proof_issuances)<? AND (SELECT COUNT(*) FROM document_proof_issuances WHERE issued_at>?)<? THEN 1 ELSE 0 END)').bind(id,this.capacity,now-60000,this.perMinute),
   this.db.prepare("INSERT INTO document_proof_issuances VALUES (?,?,?,?,?,'ISSUED')").bind(id,fingerprint,proof.statement.proof_id,JSON.stringify(proof),now),
   this.db.prepare('DELETE FROM document_proof_guards WHERE operation_id=?').bind(id)
  ]);
 }
}
