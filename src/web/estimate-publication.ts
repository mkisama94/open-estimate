import {jcsSha256} from "../core/canonical.js";
import {checkContract} from "../core/certificate-contract.js";
import {publicationRequestSchema,validateResultSnapshot,ESTIMATE_DESTINATION,type PublicationRequest,type PublicationResult,type SavedEstimate} from "../core/estimate-publication.js";
import {requirePrincipal,type Principal} from "./auth.js";
import type {CertificateDatabase} from "./certificate-repository.js";
import type {IssuanceCatalog} from "../core/certificate.js";

interface Receipt {fingerprint:string;response_json:string;expires_at:number}
export class EstimatePublicationService {
  constructor(readonly db:CertificateDatabase,readonly catalog:Omit<IssuanceCatalog,"now">,readonly enabled:boolean){}
  private stmt(sql:string,...values:unknown[]){return this.db.prepare(sql).bind(...values);}
  async publish(principal:Principal|null,value:unknown,now=Date.now()):Promise<PublicationResult>{
    const owner=requirePrincipal(principal,"estimates:write",now).subject;
    if(!this.enabled)throw new Error("ESTIMATE_PUBLICATION_DISABLED");
    const request=checkContract<PublicationRequest>(publicationRequestSchema,value),fingerprint=jcsSha256(request),hash=jcsSha256(request.snapshot);
    if(hash!==request.consent.snapshot_hash)throw new Error("CONSENT_CONTENT_CHANGED");
    const confirmed=Date.parse(request.consent.confirmed_at);
    if(confirmed>now+30000||confirmed<now-30*86400000)throw new Error("CONSENT_EXPIRED");
    const receipt=()=>this.stmt("SELECT fingerprint,response_json,expires_at FROM estimate_publications WHERE owner_id=? AND operation_id=?",owner,request.operation_id).first<Receipt>();
    const existing=await receipt();
    if(existing){if(existing.fingerprint!==fingerprint)throw new Error("IDEMPOTENCY_CONFLICT");return JSON.parse(existing.response_json);}
    await validateResultSnapshot(request.snapshot,{...this.catalog,now});
    if(Date.parse(request.snapshot.measured_at)>now+30000||Date.parse(request.snapshot.display_quote.displayed_at)>now+30000)throw new Error("RESULT_MISMATCH");
    const id="se_"+jcsSha256({owner,operation:request.operation_id}).slice(0,32),expiry=now+30*86400000;
    const result:PublicationResult={status:"PUBLISHED",operation_id:request.operation_id,snapshot_hash:hash,result_url:ESTIMATE_DESTINATION+"/manage/estimates/"+id,expires_at:new Date(expiry).toISOString(),retention_days:30,audience:"OWNER_ONLY",signed:false,public:false};
    const saved:SavedEstimate={schema_version:"oes/saved-estimate/v2",snapshot:request.snapshot,snapshot_hash:hash,saved_at:new Date(now).toISOString(),expires_at:result.expires_at};
    const guard="ep_"+jcsSha256({owner,operation:request.operation_id,fingerprint}).slice(0,32);
    try{await this.db.batch([
      this.stmt(`INSERT INTO operation_guards VALUES (?,CASE WHEN
        NOT EXISTS(SELECT 1 FROM estimate_publications WHERE owner_id=? AND operation_id=? AND fingerprint<>?)
        AND (EXISTS(SELECT 1 FROM estimate_publications WHERE owner_id=? AND operation_id=?) OR
        ((SELECT COUNT(*) FROM estimate_publications WHERE owner_id=? AND created_at>?)<5 AND (SELECT COUNT(*) FROM saved_estimates WHERE expires_at>?)<10000)) THEN 1 ELSE 0 END)`,guard,owner,request.operation_id,fingerprint,owner,request.operation_id,owner,now-60000,now),
      this.stmt("INSERT INTO saved_estimates VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",id,owner,JSON.stringify(saved),jcsSha256(saved),now,expiry),
      this.stmt("INSERT INTO estimate_publications (owner_id,operation_id,fingerprint,response_json,created_at,expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id,operation_id) DO NOTHING",owner,request.operation_id,fingerprint,JSON.stringify(result),now,expiry),
      this.stmt("DELETE FROM operation_guards WHERE operation_id=?",guard)
    ]);}catch(e){const latest=await receipt();if(latest){if(latest.fingerprint!==fingerprint)throw new Error("IDEMPOTENCY_CONFLICT");return JSON.parse(latest.response_json);}throw new Error(e instanceof Error&&/CHECK constraint failed/.test(e.message)?"RATE_LIMITED":"STATUS_UNAVAILABLE");}
    const stored=await receipt();if(!stored||stored.fingerprint!==fingerprint)throw new Error("IDEMPOTENCY_CONFLICT");return JSON.parse(stored.response_json);
  }
}
