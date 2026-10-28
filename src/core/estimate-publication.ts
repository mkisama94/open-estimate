import {obj,hashSchema,checkContract,prepareContracts} from "./certificate-contract.js";
import {estimateInputSchema,displayQuoteSchema,type EstimateInput} from "./estimate-preview.js";
import {publicResultCandidateSchema,type PublicResultCandidate,validatePublicResult,PUBLIC_LIMITATIONS} from "./public-result.js";
import {createDisplayQuote,type DisplayQuote} from "./display-quote.js";
import {jcsSha256} from "./canonical.js";
import {validateAndRecomputeNumericModel} from "./numeric-model.js";
import {certificateCalculationProfile,getCertificateBasis} from "../profiles/certificate-basis.js";
import {checkSkillIntegrity} from "../remote/skill-integrity.js";
import {checkRulesetReference,clientRelease} from "../remote/measurement-rules.js";
import type {IssuanceCatalog} from "./certificate.js";
import type {FxProvider} from "../profiles/frb.js";

export const ESTIMATE_DESTINATION="https://open-estimate.ai-orchestration.jp";
export const PUBLICATION_POLICY="oes/private-estimate-30-days/v1";
const time={type:"string",format:"date-time",maxLength:24};
export const resultSnapshotSchema=obj({schema_version:{const:"oes/estimate-snapshot/v1"},
  input:estimateInputSchema,result:publicResultCandidateSchema,display_quote:displayQuoteSchema,
  scope_coverage:{enum:["COMPLETE","MISSING","UNKNOWN"]},measured_at:time,
  scope:{const:"AGREED_AS_BUILT_FUNCTIONAL_SCOPE"}});
export interface ResultSnapshot {schema_version:"oes/estimate-snapshot/v1";input:EstimateInput;result:PublicResultCandidate;
  display_quote:DisplayQuote;scope_coverage:"COMPLETE"|"MISSING"|"UNKNOWN";measured_at:string;scope:"AGREED_AS_BUILT_FUNCTIONAL_SCOPE"}
export const consentSchema=obj({confirmed:{const:true},snapshot_hash:hashSchema,policy:{const:PUBLICATION_POLICY},
  destination:{const:ESTIMATE_DESTINATION},audience:{const:"OWNER_ONLY"},retention_days:{const:30},confirmed_at:time});
export const publicationRequestSchema=obj({operation_id:{type:"string",pattern:"^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"},snapshot:resultSnapshotSchema,consent:consentSchema});
export interface PublicationRequest {operation_id:string;snapshot:ResultSnapshot;consent:{confirmed:true;snapshot_hash:string;policy:typeof PUBLICATION_POLICY;destination:typeof ESTIMATE_DESTINATION;audience:"OWNER_ONLY";retention_days:30;confirmed_at:string}}
export interface PublicationResult {status:"PUBLISHED";operation_id:string;snapshot_hash:string;result_url:string;expires_at:string;retention_days:30;audience:"OWNER_ONLY";signed:false;public:false}
export interface SavedEstimate {schema_version:"oes/saved-estimate/v2";snapshot:ResultSnapshot;snapshot_hash:string;saved_at:string;expires_at:string}

/** The same checked projection drives local UI, PDF and saved Web output. */
export function estimatePresentation(s:ResultSnapshot){
  const r=s.result,h=r.calculation.effort.person_hours,q=s.display_quote,whole=s.scope_coverage === "COMPLETE";
  return {headline:whole?"総工数の目安（中央値）":"全体工数：未算出",median:whole?h?.median??null:null,
    portion_median:whole?null:h?.median??null,effort_label:whole?"総工数の目安":"取得済み部分のみの参考工数",
    person_days:q.person_days,hours:h,amount:q.localized_reference.amount,currency:q.display_currency,
    measurement:r.measurement,quality:r.quality,scope_coverage:s.scope_coverage,measured_at:s.measured_at,
    conditions:r.calculation.basis,quote:q,limitations:r.limitation_codes,
    notice:whole?"TEST係数による参考値。人日は総作業量であり納期ではありません。":"主要ソースの充足を確認できないため、全体工数としては利用できません。"};
}
export async function validateResultSnapshot(value:unknown,catalog?:IssuanceCatalog):Promise<ResultSnapshot>{
  const s=checkContract<ResultSnapshot>(resultSnapshotSchema,value),candidate=validatePublicResult(s.result),profile=certificateCalculationProfile();
  if(catalog){
    const integrity=checkSkillIntegrity(s.input.evaluation.skill_integrity,catalog.skills,catalog.now);
    checkRulesetReference(s.input.evaluation.ruleset_ref,clientRelease(s.input.evaluation.skill_integrity,catalog.skills),catalog.rules,catalog.now,integrity);
    if(integrity.status!=="MATCHED_CLIENT_REPORTED")throw new Error("BASIS_MISMATCH");
  }
  const report=validateAndRecomputeNumericModel(s.input.evaluation.model,profile),reportHash=jcsSha256({model:s.input.evaluation.model,profile,report});
  if(jcsSha256(candidate.calculation.basis)!==jcsSha256(getCertificateBasis().basis)||reportHash!==s.input.expected_report_hash || s.display_quote.source_report_hash!==reportHash
    || jcsSha256(report.measurement)!==jcsSha256(candidate.measurement) || jcsSha256(report.effort)!==jcsSha256(candidate.calculation.effort)
    || jcsSha256(report.reference_usd)!==jcsSha256(candidate.calculation.reference_usd) || jcsSha256(candidate.quality)!==jcsSha256(s.input.quality)
    || candidate.quality.analysis_complete!==s.input.evaluation.model.analysis_complete || s.input.evaluation.display_currency!==s.display_quote.display_currency)throw new Error("RESULT_MISMATCH");
  const quote=s.display_quote;
  const quoteCodes=new Set<string>([...PUBLIC_LIMITATIONS,"FX_UNAVAILABLE","FX_STALE","FX_CACHE_AFTER_FAILURE","FRB_REDIRECT_REJECTED","FRB_HTTP_ERROR","FRB_CONTENT_TYPE_INVALID","FRB_BODY_MISSING","FRB_RESPONSE_TOO_LARGE","FRB_UTF8_INVALID","FRB_RESPONSE_INVALID","FRB_TIMEOUT","FRB_FETCH_FAILED","FRB_CURRENCY_UNAVAILABLE"]);
  if(!["ja-JP","en-US"].includes(quote.locale)||quote.limitation_codes.some(code=>!quoteCodes.has(code)))throw new Error("RESULT_MISMATCH");
  if(quote.fx_snapshot && (quote.fx_snapshot.currency!==quote.display_currency || quote.fx_snapshot.source_url!=="https://www.federalreserve.gov/releases/h10/current/"))throw new Error("RESULT_MISMATCH");
  const provider={get:async()=>({status:quote.localized_reference.status,snapshot:quote.fx_snapshot,limitation_codes:quote.limitation_codes.filter(c=>!report.limitation_codes.includes(c))})} as FxProvider;
  const expected=await createDisplayQuote({report,basis:profile,report_hash:reportHash},provider,quote.locale,quote.display_currency,()=>new Date(quote.displayed_at));
  if(jcsSha256(expected)!==jcsSha256(quote))throw new Error("RESULT_MISMATCH");
  return s;
}
prepareContracts([resultSnapshotSchema,consentSchema,publicationRequestSchema]);
