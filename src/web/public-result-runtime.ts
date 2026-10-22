import { CertificateRepository, type CertificateDatabase } from "./certificate-repository.js";
import { CertificateService } from "./certificate-service.js";
import { checkContract, obj } from "../core/certificate-contract.js";
import { readCertificateJson } from "../core/certificate-json.js";
import { PRODUCTION_ORIGIN } from "../core/certificate.js";
import { defaultRegistry } from "../remote/skill-integrity.js";
import { defaultRulesRegistry } from "../remote/measurement-rules.js";
import type { TrustedSigningKey } from "../core/certificate-verify.js";
export interface PublicResultEnvironment {PUBLICATION_READ_ENABLED?:string;PUBLIC_STATUS_GENERATION?:string;PUBLIC_SIGNING_KEYS_JSON?:string;CERTIFICATES_DB?:unknown}
const keysSchema={type:"array",minItems:1,maxItems:100,items:obj({key_id:{type:"string",pattern:"^key_prod_[a-f0-9]{32}$"},algorithm:{const:"Ed25519"},public_key:{type:"string",pattern:"^[A-Za-z0-9_-]{43}$"},issuer_origin:{const:PRODUCTION_ORIGIN},deployment_environment:{const:"production"},created_at:{type:"string",format:"date-time"}})};
/** Public reading needs public keys only. This adapter cannot issue or publish. */
export function publicResultService(env:PublicResultEnvironment){
  if(env.PUBLICATION_READ_ENABLED!=="true")throw new Error("STATUS_UNAVAILABLE");
  if(!/^sg_[a-f0-9]{32}$/.test(env.PUBLIC_STATUS_GENERATION??"") || !env.PUBLIC_SIGNING_KEYS_JSON || env.PUBLIC_SIGNING_KEYS_JSON.length>65536)throw new Error("STATUS_UNAVAILABLE");
  const db=env.CERTIFICATES_DB as CertificateDatabase|undefined;
  if(!db || typeof db.prepare!=="function" || typeof db.batch!=="function")throw new Error("STATUS_UNAVAILABLE");
  const trusted_keys=checkContract<(TrustedSigningKey & {created_at:string})[]>(keysSchema,readCertificateJson(new TextEncoder().encode(env.PUBLIC_SIGNING_KEYS_JSON)));
  if(new Set(trusted_keys.map(k=>k.key_id)).size!==trusted_keys.length)throw new Error("STATUS_UNAVAILABLE");
  return new CertificateService(new CertificateRepository(db),{mode:"production",verifyTransfer:async()=>false,verifyPublication:async()=>null,verifyWithdrawal:async()=>false},{
    origin:PRODUCTION_ORIGIN,environment:"production",generation:env.PUBLIC_STATUS_GENERATION!,trusted_keys,
    issuance_enabled:false,publication_read_enabled:true,auth_mode:"production",key_id:"",
    engine:{engine_version:"read-only",artifact_sha256:"0".repeat(64)},catalog:{skills:defaultRegistry,rules:defaultRulesRegistry,now:0}
  },async()=>{throw new Error("ISSUANCE_DISABLED");});
}
export function isPublicResultPath(path:string){return /^\/(?:e(?:\/|$)|verify(?:\/|$)|api\/v1\/(?:shared-estimates(?:\/|$)|certificates\/cert_[a-f0-9]{32}\/status$|calculation-bases(?:\/|$))|\.well-known\/oes-signing-keys\.json$)/.test(path);}
