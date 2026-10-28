import {checkDocumentContract,PROOF_SCOPE,PROOF_LIMITATIONS,type DocumentProofRequest,type DocumentProof,type ProofStatement,type TrustedDocumentKey} from '../contracts/document.js';
import {assertMarkdownBytes} from '../document/markdown.js';
import {documentHash} from '../proof/crypto.js';
import {verifyDocumentProof} from '../proof/verify.js';
import {jcsSha256} from '../core/canonical.js';
import type {IssuanceCatalog} from '../core/certificate.js';
import type {IssuerRepository} from './repository.js';
import {validateDocumentCalculation} from './validation.js';
export interface DocumentIssuerConfig {enabled:boolean;issuer:string;environment:'test'|'production';key:TrustedDocumentKey}
export class DocumentIssuerService {
 constructor(private repository:IssuerRepository,private config:DocumentIssuerConfig,private catalog:IssuanceCatalog,private sign:(s:ProofStatement)=>Promise<DocumentProof>){}
 async issue(value:unknown,now=Date.now()):Promise<DocumentProof>{
  const request=checkDocumentContract<DocumentProofRequest>('request',value);assertMarkdownBytes(request.markdown);
  // JSON body is bounded by transport; structural depth/items also checked here.
  let count=0;const visit=(v:unknown,depth=0)=>{if(++count>100000||depth>32)throw new Error('DOCUMENT_INPUT_TOO_COMPLEX');if(v&&typeof v==='object')for(const child of Object.values(v))visit(child,depth+1);};visit(value);
  const fingerprint=jcsSha256(request),old=await this.repository.get(request.operation_id);
  const same=(r:{fingerprint:string;proof_json:string})=>{if(r.fingerprint!==fingerprint)throw new Error('DOCUMENT_OPERATION_CONFLICT');return checkDocumentContract<DocumentProof>('proof',JSON.parse(r.proof_json));};
  if(old)return same(old);if(!this.config.enabled)throw new Error('DOCUMENT_ISSUANCE_DISABLED');
  const {issuer,environment,key}=this.config;
  if(new URL(issuer).origin!==issuer||!issuer.startsWith('https://')||key.issuer!==issuer||key.environment!==environment||!key.key_id.startsWith(environment==='test'?'doc_test_':'doc_prod_'))throw new Error('DOCUMENT_SIGNING_CONFIGURATION_INVALID');
  if(Date.parse(request.document.measured_at)>now+30000||Date.parse(request.document.display_quote.displayed_at)>now+30000)throw new Error('DOCUMENT_TIME_INVALID');
  await validateDocumentCalculation(request,{...this.catalog,now});
  const statement:ProofStatement={schema_version:'oes/document-proof/v1',domain:'oes/calculation-verified-document/v1',algorithm:'Ed25519',issuer,proof_id:'docp_'+jcsSha256({issuer,operation:request.operation_id}).slice(0,32),issued_at:new Date(now).toISOString(),document_sha256:await documentHash(request.markdown),ruleset_ref:request.document.ruleset_ref,verification:'CALCULATION_VERIFIED',verification_method:'oes/numeric-document-verification/v1',scope:PROOF_SCOPE,limitations:PROOF_LIMITATIONS,key_id:key.key_id,environment};
  const proof=await this.sign(statement),verified=await verifyDocumentProof(request.markdown,proof,[key]);
  if(verified.signature!=='VALID'||verified.document!=='MATCH'||verified.issuer!=='TRUSTED'||jcsSha256(proof.statement)!==jcsSha256(statement))throw new Error('DOCUMENT_SIGNING_UNAVAILABLE');
  try{await this.repository.commit(request.operation_id,fingerprint,proof,now);}catch{
   const raced=await this.repository.get(request.operation_id);if(raced)return same(raced);throw new Error('DOCUMENT_RECORD_UNAVAILABLE_OR_CAPACITY');
  }
  const committed=await this.repository.get(request.operation_id);if(!committed)throw new Error('DOCUMENT_RECORD_UNAVAILABLE');return same(committed);
 }
}
