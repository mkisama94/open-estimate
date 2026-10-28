export interface PublicStatement {bind(...values:unknown[]):PublicStatement;first<T>():Promise<T|null>}
export interface PublicDatabase {prepare(sql:string):PublicStatement;batch(statements:PublicStatement[]):Promise<unknown>}
export interface PublicRow {public_result_id:string;operation_id:string;fingerprint:string;result_hash:string;result_json:string|null;proof_json:string|null;withdrawal_token_hash:string;published_at:number;expires_at:number;state:'PUBLISHED'|'WITHDRAWN'|'EXPIRED';withdrawn_at:number|null}
export class PublicResultsRepository {
 constructor(private db:PublicDatabase){}
 operation(id:string){return this.db.prepare('SELECT * FROM public_estimate_results WHERE operation_id=?').bind(id).first<PublicRow>();}
 result(id:string){return this.db.prepare('SELECT * FROM public_estimate_results WHERE public_result_id=?').bind(id).first<PublicRow>();}
 async insert(r:PublicRow){await this.db.batch([this.db.prepare('INSERT INTO public_estimate_results SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM public_estimate_results)<1000000').bind(r.public_result_id,r.operation_id,r.fingerprint,r.result_hash,r.result_json,r.proof_json,r.withdrawal_token_hash,r.published_at,r.expires_at,r.state,null)]);}
 async withdraw(id:string,now:number){await this.db.batch([this.db.prepare("UPDATE public_estimate_results SET state='WITHDRAWN',withdrawn_at=?,result_json=NULL,proof_json=NULL WHERE public_result_id=? AND state='PUBLISHED'").bind(now,id)]);}
 async purge(now:number,limit=100){await this.db.batch([this.db.prepare("UPDATE public_estimate_results SET state='EXPIRED',result_json=NULL,proof_json=NULL WHERE public_result_id IN (SELECT public_result_id FROM public_estimate_results WHERE state='PUBLISHED' AND expires_at<=? LIMIT ?)").bind(now,Math.min(1000,Math.max(1,limit)))]);}
}
