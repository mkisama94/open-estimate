import { obj, checkContract, prepareContracts, hashSchema, type ServerResult } from "./certificate-contract.js";
import { remoteArgsSchema, evaluateRemote } from "../remote/model.js";
import { publicResultCandidateSchema, validatePublicResult, PROJECTION_VERSION, type PublicResultCandidate } from "./public-result.js";
import { jcsSha256 } from "./canonical.js";
import { certificateCalculationProfile, getCertificateBasis, INITIAL_CERTIFICATE_BASIS_HASH } from "../profiles/certificate-basis.js";
import type { IssuanceCatalog } from "./certificate.js";
import type { FxProvider } from "../profiles/frb.js";
import { CURRENCIES } from "../profiles/frb.js";

const decimal={type:"string",pattern:"^(0|[1-9][0-9]*)(\\.[0-9]+)?$",maxLength:256};
const nullable=(v:unknown)=>({anyOf:[v,{type:"null"}]});
const quartiles=nullable(obj({p25:nullable(decimal),median:nullable(decimal),p75:nullable(decimal)}));
const timestamp={type:"string",format:"date-time"};
export const displayQuoteSchema=obj({domain:{const:"open-estimate/display-quote/v1"},source_report_hash:hashSchema,conversion_policy_version:{const:"frb-display-time-v1"},displayed_at:timestamp,locale:{type:"string",maxLength:32},display_currency:{enum:[...CURRENCIES]},
  fx_snapshot:nullable(obj({currency:{enum:[...CURRENCIES]},source_url:{const:"https://www.federalreserve.gov/releases/h10/current/"},source_sha256:hashSchema,observed_on:{type:"string",format:"date"},published_on:{type:"string",format:"date"},fetched_at:timestamp,checked_at:timestamp,raw_value:decimal,quote_direction:{enum:["currency_per_usd","usd_per_currency"]},currency_per_usd:decimal})),
  localized_reference:obj({status:{enum:["AVAILABLE","FX_UNAVAILABLE","FX_STALE","UPSTREAM_UNAVAILABLE"]},currency:{enum:[...CURRENCIES]},currency_per_usd:nullable(decimal),amount:quartiles}),person_days:quartiles,limitation_codes:{type:"array",items:{type:"string",pattern:"^[A-Z_]+$"},maxItems:40}});

export const ESTIMATE_POLICY = "oes/owner-estimate-policy/v1";
export const ESTIMATE_METADATA = {title:"見積結果",description:null,publisher_label:null,scope_note:null,project_url:null,model_label:null};
export const ESTIMATE_METADATA_HASH = jcsSha256(ESTIMATE_METADATA);
export const estimateInputSchema = obj({
  schema_version:{const:"oes/owner-estimate-input/v1"},
  evaluation:{...remoteArgsSchema,required:["model","display_currency","skill_integrity","ruleset_ref"]},
  quality:publicResultCandidateSchema.properties.quality,
  expected_report_hash:hashSchema
});
export interface EstimateInput {
  schema_version:"oes/owner-estimate-input/v1";
  evaluation:Parameters<typeof evaluateRemote>[0] & {model:import("./numeric-model.js").NumericModel; display_currency:string;skill_integrity:import("./certificate-contract.js").SkillIntegrity;ruleset_ref:import("../rules/measurement-contract.js").RulesetRef};
  quality:PublicResultCandidate["quality"];
  expected_report_hash:string;
}
export const estimateCommitmentSchema=obj({domain:{const:"oes/owner-estimate-commitment/v1"},algorithm:{const:"SHA-256"},digest:hashSchema});
export function estimateCommitment(input:EstimateInput,nonce:string){
  checkContract(estimateInputSchema,input);
  if(!/^[A-Za-z0-9_-]{43}$/.test(nonce) || Buffer.from(nonce,"base64url").toString("base64url")!==nonce)throw new Error("INVALID_INPUT");
  return {domain:"oes/owner-estimate-commitment/v1" as const,algorithm:"SHA-256" as const,digest:jcsSha256({domain:"oes/owner-estimate-commitment/v1",nonce,input})};
}
export const estimateSubmissionSchema=obj({estimate_input:estimateInputSchema,nonce:{type:"string",pattern:"^[A-Za-z0-9_-]{43}$"},policy_version:{const:ESTIMATE_POLICY}});
export interface EstimateSubmission {estimate_input:EstimateInput;nonce:string;policy_version:typeof ESTIMATE_POLICY}
export async function recomputeEstimate(input:EstimateInput,catalog:IssuanceCatalog,provider?:FxProvider){
  checkContract(estimateInputSchema,input);
  const evaluated=await evaluateRemote(input.evaluation,certificateCalculationProfile(),provider,catalog.skills,catalog.now,catalog.rules);
  if(evaluated.assurance.skill_integrity.status!=="MATCHED_CLIENT_REPORTED" || evaluated.assurance.measurement_rules.status!=="ACCEPTED_CLIENT_REPORTED")throw new Error("BASIS_MISMATCH");
  if(evaluated.report_hash!==input.expected_report_hash || input.quality.analysis_complete!==input.evaluation.model.analysis_complete)throw new Error("RESULT_MISMATCH");
  const basis=getCertificateBasis();
  const candidate=validatePublicResult({schema_version:"oes/public-result-candidate/v1",projection_version:PROJECTION_VERSION,
    measurement:evaluated.report.measurement,quality:input.quality,
    calculation:{environment:basis.environment,effort_scope_id:basis.effort_scope_id,hours_per_day:basis.hours_per_day,basis:basis.basis,effort:evaluated.report.effort,reference_usd:evaluated.report.reference_usd},
    assurance:{input:"CLIENT_REPORTED",calculation_check:"LOCAL_RECOMPUTED_MATCH",semantic_assessment:"NOT_INDEPENDENTLY_VERIFIED",signed:false},
    limitation_codes:[...new Set([...evaluated.report.limitation_codes,"TEST_DATA_ONLY"])].sort()});
  const result:ServerResult={schema_version:"oes/server-recomputed-result/v1",measurement:candidate.measurement,quality:candidate.quality,calculation:candidate.calculation,
    assurance:{input:"CLIENT_REPORTED",calculation_check:"SERVER_RECOMPUTED_MATCH",quality_check:"CLIENT_REPORTED_CONSISTENCY_CHECKED",semantic_assessment:"NOT_INDEPENDENTLY_VERIFIED"},limitation_codes:candidate.limitation_codes};
  return {schema_version:"oes/owner-estimate-result/v1" as const,result,metadata:ESTIMATE_METADATA,display_quote:evaluated.display_quote,
    report_hash:evaluated.report_hash,calculation_basis_hash:INITIAL_CERTIFICATE_BASIS_HASH,ruleset_ref:input.evaluation.ruleset_ref,
    expires_at:new Date(catalog.now+900000).toISOString()};
}
export type EstimateDraft=Awaited<ReturnType<typeof recomputeEstimate>>;
prepareContracts([estimateInputSchema,estimateSubmissionSchema,displayQuoteSchema]);
