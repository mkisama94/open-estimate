import {DocumentIssuerRepository,type IssuerDatabase} from './repository.js';
import {DocumentIssuerService} from './service.js';
import {createDocumentSigner} from './signing.js';
import type {IssuanceCatalog} from '../core/certificate.js';
export interface DocumentIssuerEnvironment {DOCUMENT_ISSUANCE_ENABLED?:string;DOCUMENT_ISSUER_ORIGIN?:string;DOCUMENT_ENVIRONMENT?:string;DOCUMENT_SIGNING_KEY_ID?:string;DOCUMENT_SIGNING_PRIVATE_KEY?:string;DOCUMENT_SIGNING_PUBLIC_KEY?:string;DOCUMENT_PROOF_DB?:IssuerDatabase;DOCUMENT_ISSUANCE_LIMITER?:{limit(o:{key:string}):Promise<{success:boolean}>}}
export async function issueDocumentProof(value:unknown,env:DocumentIssuerEnvironment,catalog:IssuanceCatalog){
 if(env.DOCUMENT_ISSUANCE_ENABLED!=='true')throw new Error('DOCUMENT_ISSUANCE_DISABLED');
 if(!env.DOCUMENT_PROOF_DB)throw new Error('DOCUMENT_RECORD_CONFIGURATION_REQUIRED');
 if(!env.DOCUMENT_ISSUANCE_LIMITER)throw new Error('DOCUMENT_RATE_LIMIT_CONFIGURATION_REQUIRED');
 if(!(await env.DOCUMENT_ISSUANCE_LIMITER.limit({key:'document-global'})).success)throw new Error('DOCUMENT_RATE_LIMITED');
 if(!env.DOCUMENT_SIGNING_KEY_ID||!env.DOCUMENT_SIGNING_PRIVATE_KEY||!env.DOCUMENT_SIGNING_PUBLIC_KEY||!env.DOCUMENT_ISSUER_ORIGIN||!['test','production'].includes(env.DOCUMENT_ENVIRONMENT??''))throw new Error('DOCUMENT_SIGNING_CONFIGURATION_REQUIRED');
 const environment=env.DOCUMENT_ENVIRONMENT as 'test'|'production',key={key_id:env.DOCUMENT_SIGNING_KEY_ID,algorithm:'Ed25519' as const,public_key:env.DOCUMENT_SIGNING_PUBLIC_KEY,issuer:env.DOCUMENT_ISSUER_ORIGIN,environment};
 const service=new DocumentIssuerService(new DocumentIssuerRepository(env.DOCUMENT_PROOF_DB),{enabled:true,issuer:key.issuer,environment,key},catalog,await createDocumentSigner(env.DOCUMENT_SIGNING_PRIVATE_KEY));
 return service.issue(value);
}
