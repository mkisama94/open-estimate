import { jcsSha256 } from "./canonical.js";
import { jcsBytes } from "./canonical-json.js";
import { validateAndRecomputeNumericModel } from "./numeric-model.js";
import { validatePublicResult } from "./public-result.js";
import { checkSkillIntegrity, defaultRegistry, type SkillRegistry } from "../remote/skill-integrity.js";
import { checkRulesetReference, clientRelease, defaultRulesRegistry } from "../remote/measurement-rules.js";
import type { RulesRegistry } from "../rules/measurement-contract.js";
import { certificateCalculationProfile, matchCertificateBasis, INITIAL_CERTIFICATE_BASIS_HASH } from "../profiles/certificate-basis.js";
import { POLICY_VERSION, approvedDraftSchema, checkContract, frozenInputSchema, signedObjectSchema, validateMetadata,
  type FrozenInput, type ServerResult, type InputCommitment, type ApprovedDraft, type Issuer, type EngineRef, type SignedObject } from "./certificate-contract.js";

export const PRODUCTION_ORIGIN = "https://open-estimate.ai-orchestration.jp";
export function issuerFor(origin: string): Issuer {
  const url=new URL(origin);
  if (url.origin!==origin || !["http:","https:"].includes(url.protocol)) throw new Error("INVALID_INPUT");
  return {legal_name:"AI Orchestration Inc.",service:"Open Estimate",origin,contact_url:"https://ai-orchestration.jp/security/"};
}
export function assertEnvironment(origin: string, environment: "test"|"production") {
  if ((environment==="production")!==(origin===PRODUCTION_ORIGIN)) throw new Error("INVALID_ENVIRONMENT");
  const url=new URL(origin);
  if (url.origin!==origin || (url.protocol!=="https:" && !(environment==="test" && url.protocol==="http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname)))) throw new Error("INVALID_ENVIRONMENT");
}
export function inputCommitment(input: FrozenInput, nonce: string): InputCommitment {
  checkContract(frozenInputSchema,input);
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(nonce)) throw new Error("INVALID_INPUT");
  return {domain:"oes/certificate-input-commitment/v1",algorithm:"SHA-256",digest:jcsSha256({domain:"oes/certificate-input-commitment/v1",nonce,frozen_input:input})};
}
export interface IssuanceCatalog {skills:SkillRegistry;rules:RulesRegistry;now:number}
/** Validates the entire input; only allowlisted public fields survive. */
export function recomputeCertificateResult(value: unknown, catalog: IssuanceCatalog = {skills:defaultRegistry,rules:defaultRulesRegistry,now:Date.now()}): ServerResult {
  const input=checkContract<FrozenInput>(frozenInputSchema,value);
  matchCertificateBasis(input.candidate.calculation);
  let skill:ReturnType<typeof checkSkillIntegrity>;
  try {skill=checkSkillIntegrity(input.skill_integrity,catalog.skills,catalog.now);}catch {throw new Error("SKILL_NOT_ISSUABLE");}
  const release=clientRelease(input.skill_integrity,catalog.skills);
  if (skill.status!=="MATCHED_CLIENT_REPORTED" || release?.publication!=="published") throw new Error("SKILL_NOT_ISSUABLE");
  let rules:ReturnType<typeof checkRulesetReference>;
  try {rules=checkRulesetReference(input.ruleset_ref,release,catalog.rules,catalog.now,skill);}catch {throw new Error("RULESET_NOT_ISSUABLE");}
  if (rules.status!=="ACCEPTED_CLIENT_REPORTED") throw new Error("RULESET_NOT_ISSUABLE");
  return reproduceCertificateResult(input);
}
/** Past calculations remain reproducible even when a skill/rules release is no longer issuable. */
export function reproduceCertificateResult(value: unknown): ServerResult {
  const input=checkContract<FrozenInput>(frozenInputSchema,value);
  matchCertificateBasis(input.candidate.calculation);
  const c=validatePublicResult(input.candidate);
  const report=validateAndRecomputeNumericModel(input.model,certificateCalculationProfile());
  const limitations=[...new Set(report.limitation_codes.concat("TEST_DATA_ONLY"))].sort();
  const expected={measurement:report.measurement,effort:report.effort,reference_usd:report.reference_usd,limitation_codes:limitations};
  const received={measurement:c.measurement,effort:c.calculation.effort,reference_usd:c.calculation.reference_usd,limitation_codes:c.limitation_codes};
  if (jcsSha256(expected)!==jcsSha256(received) || input.model.analysis_complete!==c.quality.analysis_complete) throw new Error("RESULT_MISMATCH");
  const b=matchCertificateBasis(c.calculation);
  return {schema_version:"oes/server-recomputed-result/v1",measurement:structuredClone(report.measurement),quality:structuredClone(c.quality),
    calculation:{environment:b.environment,effort_scope_id:b.effort_scope_id,hours_per_day:b.hours_per_day,basis:b.basis,effort:report.effort,reference_usd:report.reference_usd},
    assurance:{input:"CLIENT_REPORTED",calculation_check:"SERVER_RECOMPUTED_MATCH",quality_check:"CLIENT_REPORTED_CONSISTENCY_CHECKED",semantic_assessment:"NOT_INDEPENDENTLY_VERIFIED"},limitation_codes:limitations};
}
export function draftHash(draft: ApprovedDraft) {
  checkContract(approvedDraftSchema,draft);
  return jcsSha256({domain:"oes/certificate-approved-draft-hash/v1",draft});
}
export function createApprovedDraft(input: FrozenInput, nonce: string, metadata: unknown,
  server: {origin:string;environment:"production"|"test";certificate_id:string;share_id:string;status_generation:string;engine:EngineRef;now:number},catalog?:IssuanceCatalog): ApprovedDraft {
  assertEnvironment(server.origin,server.environment);
  const draft: ApprovedDraft={schema_version:"oes/certificate-approved-draft/v1",operation:"issue_and_publish",issuer:issuerFor(server.origin),deployment_environment:server.environment,
    certificate_id:server.certificate_id,share_id:server.share_id,input_commitment:inputCommitment(input,nonce),result:recomputeCertificateResult(input,catalog),metadata:structuredClone(validateMetadata(metadata)),
    calculation_basis_hash:INITIAL_CERTIFICATE_BASIS_HASH,ruleset_ref:structuredClone(input.ruleset_ref),server_engine_ref:structuredClone(server.engine),policy_version:POLICY_VERSION,
    status_generation:server.status_generation,expires_at:new Date(server.now+15*60*1000).toISOString()};
  return checkContract<ApprovedDraft>(approvedDraftSchema,draft);
}
/** Caller must separately authorize the owner and atomically consume approval before returning this payload. */
export function createSignedObject(draft: ApprovedDraft, keyId: string, now: number): SignedObject {
  const approved_draft_hash=draftHash(draft);
  validateMetadata(draft.metadata);assertEnvironment(draft.issuer.origin,draft.deployment_environment);
  if (now>=Date.parse(draft.expires_at)) throw new Error("PREVIEW_EXPIRED");
  if (!keyId.startsWith(draft.deployment_environment==="production"?"key_prod_":"key_test_")) throw new Error("INVALID_ENVIRONMENT");
  const signed: SignedObject={schema_version:"oes/signed-calculation-certificate/v1",domain:"oes/server-recomputed-certificate/v1",algorithm:"Ed25519",key_id:keyId,
    issuer:structuredClone(draft.issuer),certificate_id:draft.certificate_id,issued_at:new Date(now).toISOString(),deployment_environment:draft.deployment_environment,status_generation:draft.status_generation,
    approval:{approved_draft_hash,policy_version:POLICY_VERSION},input_commitment:structuredClone(draft.input_commitment),result:structuredClone(draft.result),metadata:structuredClone(draft.metadata),
    calculation_basis_hash:draft.calculation_basis_hash,ruleset_ref:structuredClone(draft.ruleset_ref),server_engine_ref:structuredClone(draft.server_engine_ref)};
  return checkContract<SignedObject>(signedObjectSchema,signed);
}
export function signedObjectBytes(value: SignedObject) {
  checkContract(signedObjectSchema,value);
  return jcsBytes(value);
}
