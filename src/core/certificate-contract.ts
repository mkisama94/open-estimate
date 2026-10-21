import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { publicResultCandidateSchema, type PublicResultCandidate } from "./public-result.js";
import { modelSchema, type NumericModel } from "./numeric-model.js";
import { skillIntegritySchema } from "../remote/skill-integrity.js";
import { rulesetRefSchema, type RulesetRef } from "../rules/measurement-contract.js";
import { assertCertificateJson } from "./certificate-json.js";

export const POLICY_VERSION = "oes/certificate-publication-policy/v1" as const;
export const obj = (properties: Record<string, unknown>) => ({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const nullable = (schema: unknown) => ({anyOf:[schema,{type:"null"}]});
export const hashSchema = {type:"string",pattern:"^[a-f0-9]{64}$"};
const id = (prefix: string) => ({type:"string",pattern:`^${prefix}[a-f0-9]{32}$`});
const text = (maxLength: number, minLength = 0) => ({type:"string",minLength,maxLength});
const time = {type:"string",format:"date-time",pattern:"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"};
export const metadataSchema = obj({title:text(80,1),description:nullable(text(240)),publisher_label:nullable(text(80)),scope_note:nullable(text(500)),project_url:nullable(text(2048)),model_label:nullable(text(80))});
export interface CertificateMetadata {title:string;description:string|null;publisher_label:string|null;scope_note:string|null;project_url:string|null;model_label:string|null}
export interface SkillIntegrity {format:"oes/skill-integrity/v1";skill_id:"open-estimate-assessor";skill_version:string;hash_rule:"oes/skill-package/v1";package_sha256:string}
export interface FrozenInput {schema_version:"oes/certificate-input/v1";model:NumericModel;candidate:PublicResultCandidate;skill_integrity:SkillIntegrity;ruleset_ref:RulesetRef}
export const frozenInputSchema = obj({schema_version:{const:"oes/certificate-input/v1"},model:modelSchema,candidate:publicResultCandidateSchema,skill_integrity:skillIntegritySchema,ruleset_ref:rulesetRefSchema});
export const commitmentSchema = obj({domain:{const:"oes/certificate-input-commitment/v1"},algorithm:{const:"SHA-256"},digest:hashSchema});
export type InputCommitment = {domain:"oes/certificate-input-commitment/v1";algorithm:"SHA-256";digest:string};
const candidate = publicResultCandidateSchema.properties;
const assuranceSchema = obj({input:{const:"CLIENT_REPORTED"},calculation_check:{const:"SERVER_RECOMPUTED_MATCH"},quality_check:{const:"CLIENT_REPORTED_CONSISTENCY_CHECKED"},semantic_assessment:{const:"NOT_INDEPENDENTLY_VERIFIED"}});
export const serverResultSchema = obj({schema_version:{const:"oes/server-recomputed-result/v1"},measurement:candidate.measurement,quality:candidate.quality,calculation:candidate.calculation,assurance:assuranceSchema,limitation_codes:candidate.limitation_codes});
export interface ServerResult {schema_version:"oes/server-recomputed-result/v1";measurement:PublicResultCandidate["measurement"];quality:PublicResultCandidate["quality"];calculation:PublicResultCandidate["calculation"];assurance:{input:"CLIENT_REPORTED";calculation_check:"SERVER_RECOMPUTED_MATCH";quality_check:"CLIENT_REPORTED_CONSISTENCY_CHECKED";semantic_assessment:"NOT_INDEPENDENTLY_VERIFIED"};limitation_codes:string[]}
export const issuerSchema = obj({legal_name:{const:"AI Orchestration Inc."},service:{const:"Open Estimate"},origin:{type:"string",format:"uri"},contact_url:{const:"https://ai-orchestration.jp/security/"}});
export type Issuer = {legal_name:"AI Orchestration Inc.";service:"Open Estimate";origin:string;contact_url:"https://ai-orchestration.jp/security/"};
export const engineSchema = obj({engine_version:text(128,1),artifact_sha256:hashSchema});
export type EngineRef = {engine_version:string;artifact_sha256:string};
const common = {issuer:issuerSchema,deployment_environment:{enum:["production","test"]},certificate_id:id("cert_"),input_commitment:commitmentSchema,result:serverResultSchema,metadata:metadataSchema,calculation_basis_hash:hashSchema,ruleset_ref:rulesetRefSchema,server_engine_ref:engineSchema,status_generation:id("sg_")};
export const approvedDraftSchema = obj({schema_version:{const:"oes/certificate-approved-draft/v1"},operation:{const:"issue_and_publish"},...common,share_id:id("sh_"),policy_version:{const:POLICY_VERSION},expires_at:time});
export interface ApprovedDraft {schema_version:"oes/certificate-approved-draft/v1";operation:"issue_and_publish";issuer:Issuer;deployment_environment:"production"|"test";certificate_id:string;share_id:string;input_commitment:InputCommitment;result:ServerResult;metadata:CertificateMetadata;calculation_basis_hash:string;ruleset_ref:RulesetRef;server_engine_ref:EngineRef;policy_version:typeof POLICY_VERSION;status_generation:string;expires_at:string}
export const signedObjectSchema = obj({schema_version:{const:"oes/signed-calculation-certificate/v1"},domain:{const:"oes/server-recomputed-certificate/v1"},algorithm:{const:"Ed25519"},...common,key_id:{type:"string",pattern:"^key_(prod|test)_[a-f0-9]{32}$"},issued_at:time,approval:obj({approved_draft_hash:hashSchema,policy_version:{const:POLICY_VERSION}})});
export type SignedObject = Omit<ApprovedDraft,"operation"|"share_id"|"expires_at"|"policy_version"|"schema_version"> & {schema_version:"oes/signed-calculation-certificate/v1";domain:"oes/server-recomputed-certificate/v1";algorithm:"Ed25519";key_id:string;issued_at:string;approval:{approved_draft_hash:string;policy_version:typeof POLICY_VERSION}};
export const envelopeSchema = obj({signed_object:signedObjectSchema,signed_object_hash:hashSchema,signature:{type:"string",pattern:"^[A-Za-z0-9_-]{85}[AQgw]$"}});
export interface CertificateEnvelope {signed_object:SignedObject;signed_object_hash:string;signature:string}
const calculationProperties = (candidate.calculation as {properties:Record<string,unknown>}).properties;
export const calculationBasisSchema = obj({schema_version:{const:"oes/calculation-basis/v1"},environment:calculationProperties.environment,effort_scope_id:calculationProperties.effort_scope_id,hours_per_day:calculationProperties.hours_per_day,basis:calculationProperties.basis});
const ajv = new Ajv2020({strict:false,ownProperties:true});
(addFormats as unknown as (ajv: Ajv2020)=>void)(ajv);
const validators = new Map<object, ReturnType<typeof ajv.compile>>();
export function checkContract<T>(schema: object, value: unknown): T {
  assertCertificateJson(value);
  let valid = validators.get(schema);
  if (!valid) { valid=ajv.compile(schema);validators.set(schema,valid); }
  if (!valid(value)) throw new Error("INVALID_INPUT");
  return value as T;
}
export function validateMetadata(value: unknown): CertificateMetadata {
  const m=checkContract<CertificateMetadata>(metadataSchema,value);
  if (!m.title.trim()) throw new Error("INVALID_INPUT");
  if (m.project_url !== null) {
    let url: URL;
    try { url=new URL(m.project_url); } catch { throw new Error("INVALID_INPUT"); }
    if (url.protocol!=="https:" || url.username || url.password || !m.project_url.startsWith("https://")) throw new Error("INVALID_INPUT");
  }
  return m;
}

export const statusSchema = obj({certificate_id:id("cert_"),signed_object_hash:nullable(hashSchema),key_id:nullable({type:"string",pattern:"^key_(prod|test)_[a-f0-9]{32}$"}),
  registration:{enum:["REGISTERED","NOT_FOUND","UNKNOWN"]},certificate_state:{enum:["ACTIVE","REVOKED","UNKNOWN"]},publication_state:{enum:["PUBLIC","WITHDRAWN","UNKNOWN"]},
  key_state:{enum:["ACTIVE","RETIRED","REVOKED","UNKNOWN"]},status_generation:nullable(id("sg_")),status_checked_at:time,
  reason_code:nullable({enum:["ISSUER_ERROR","OWNER_REQUEST","ABUSE","KEY_COMPROMISE","NOT_FOUND","STATUS_UNAVAILABLE","STATUS_GENERATION_MISMATCH","KEY_STATUS_UNKNOWN"]})});
export interface CertificateStatus {certificate_id:string;signed_object_hash:string|null;key_id:string|null;registration:"REGISTERED"|"NOT_FOUND"|"UNKNOWN";certificate_state:"ACTIVE"|"REVOKED"|"UNKNOWN";publication_state:"PUBLIC"|"WITHDRAWN"|"UNKNOWN";key_state:"ACTIVE"|"RETIRED"|"REVOKED"|"UNKNOWN";status_generation:string|null;status_checked_at:string;reason_code:string|null}
const opaque={type:"string",minLength:1,maxLength:256};
export const previewRequestSchema=obj({frozen_input:frozenInputSchema,nonce:{type:"string",pattern:"^[A-Za-z0-9_-]{43}$"},metadata:metadataSchema,policy_version:{const:POLICY_VERSION},transfer_authorization_id:opaque});
export const publishRequestSchema=obj({preview_id:id("pv_"),approved_draft_hash:hashSchema,frozen_input:frozenInputSchema,nonce:{type:"string",pattern:"^[A-Za-z0-9_-]{43}$"},approval_receipt_id:opaque});
export const withdrawRequestSchema=obj({approval_receipt_id:opaque});
export const previewResponseSchema=obj({preview_id:id("pv_"),approved_draft:approvedDraftSchema,approved_draft_hash:hashSchema});
export const publicationSchema=obj({share_id:id("sh_"),certificate_id:id("cert_"),state:{enum:["PUBLIC","WITHDRAWN"]},published_at:time});
export const publishResponseSchema=obj({certificate:nullable(envelopeSchema),publication:publicationSchema,receipt_id:id("req_")});
export const sharedResponseSchema=obj({certificate:envelopeSchema,publication:publicationSchema,current_status:statusSchema});
export const receiptResponseSchema=obj({outcome:{const:"ISSUED"},certificate_id:id("cert_"),share_id:id("sh_"),signed_object_hash:hashSchema,publication_state:{enum:["PUBLIC","WITHDRAWN"]}});
export const withdrawResponseSchema=obj({share_id:id("sh_"),publication_state:{const:"WITHDRAWN"}});
