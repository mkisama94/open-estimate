import { envelopeSchema, checkContract, validateMetadata, type CertificateEnvelope, type FrozenInput } from "./certificate-contract.js";
import { signedObjectBytes, inputCommitment, recomputeCertificateResult, reproduceCertificateResult, assertEnvironment, type IssuanceCatalog } from "./certificate.js";
import { jcsSha256 } from "./canonical.js";
import { base64url, decodeBase64url } from "../proof/crypto.js";
import { INITIAL_CERTIFICATE_BASIS_HASH } from "../profiles/certificate-basis.js";

export interface TrustedSigningKey {key_id:string;algorithm:"Ed25519";public_key:string;issuer_origin:string;deployment_environment:"test"|"production"}
export interface OfflineVerification {schema:"VALID"|"INVALID";hash:"MATCH"|"MISMATCH";signature:"VALID"|"INVALID"|"UNKNOWN_KEY";issuer_trust:"TRUSTED"|"UNTRUSTED";current_status:"NOT_CHECKED"}
/** No network. Keys must come from an independently trusted catalog or explicit user trust. */
export async function verifyCertificate(value: unknown, trustedKeys: readonly TrustedSigningKey[]): Promise<OfflineVerification> {
  const result:OfflineVerification={schema:"INVALID",hash:"MISMATCH",signature:"INVALID",issuer_trust:"UNTRUSTED",current_status:"NOT_CHECKED"};
  let envelope:CertificateEnvelope;
  try {
    envelope=checkContract<CertificateEnvelope>(envelopeSchema,value);
    validateMetadata(envelope.signed_object.metadata);
    const s=envelope.signed_object;
    assertEnvironment(s.issuer.origin,s.deployment_environment);
    if (!s.key_id.startsWith(s.deployment_environment==="production"?"key_prod_":"key_test_")) return result;
    result.schema="VALID";
  } catch {return result;}
  const s=envelope.signed_object;
  result.hash=jcsSha256(s)===envelope.signed_object_hash?"MATCH":"MISMATCH";
  const key=trustedKeys.find(k=>k.key_id===s.key_id && k.algorithm==="Ed25519" && k.issuer_origin===s.issuer.origin && k.deployment_environment===s.deployment_environment);
  if (!key) {result.signature="UNKNOWN_KEY";return result;}
  result.issuer_trust="TRUSTED";
  try {
    const raw=decodeBase64url(key.public_key);
    if(raw.length!==32 || base64url(raw)!==key.public_key) return result;
    const publicKey=await crypto.subtle.importKey("raw",raw,{name:"Ed25519"},false,["verify"]);
    result.signature=await crypto.subtle.verify("Ed25519",publicKey,decodeBase64url(envelope.signature),signedObjectBytes(s))?"VALID":"INVALID";
  } catch {result.signature="INVALID";}
  return result;
}
/** Reproduction is separate from signature trust and does not attest source semantics. */
export function verifyCertificateInput(envelope: CertificateEnvelope, frozen: FrozenInput, nonce: string, catalog?: IssuanceCatalog) {
  checkContract(envelopeSchema,envelope);
  const s=envelope.signed_object;
  const commitment=jcsSha256(inputCommitment(frozen,nonce))===jcsSha256(s.input_commitment);
  if (!commitment) return {commitment:"MISMATCH",calculation:"NOT_CHECKED"} as const;
  if (s.calculation_basis_hash!==INITIAL_CERTIFICATE_BASIS_HASH || jcsSha256(frozen.ruleset_ref)!==jcsSha256(s.ruleset_ref)) return {commitment:"MATCH",calculation:"MISMATCH"} as const;
  const result=catalog?recomputeCertificateResult(frozen,catalog):reproduceCertificateResult(frozen);
  return {commitment:"MATCH",calculation:jcsSha256(result)===jcsSha256(s.result)?"MATCH":"MISMATCH"} as const;
}
