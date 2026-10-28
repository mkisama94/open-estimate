import type {DocumentProofRequest} from '../contracts/document.js';
import {assertDocumentMarkdown} from '../document/markdown.js';
import {validatePublicResult,PUBLIC_LIMITATIONS} from '../core/public-result.js';
import {createDisplayQuote} from '../core/display-quote.js';
import {validateAndRecomputeNumericModel} from '../core/numeric-model.js';
import {certificateCalculationProfile,getCertificateBasis} from '../profiles/certificate-basis.js';
import {jcsSha256} from '../core/canonical.js';
import {checkSkillIntegrity} from '../remote/skill-integrity.js';
import {checkRulesetReference,clientRelease} from '../remote/measurement-rules.js';
import type {IssuanceCatalog} from '../core/certificate.js';
import type {FxProvider} from '../profiles/frb.js';
/** Explicit numeric verification, independent of Web publication and ownership. */
export async function validateDocumentCalculation(request:DocumentProofRequest,catalog:IssuanceCatalog){
 await validateCalculationData(request.document,request.validation_input,catalog);
 assertDocumentMarkdown(request.document,request.markdown);
}
export async function validateCalculationData(d:DocumentProofRequest['document'],input:DocumentProofRequest['validation_input'],catalog:IssuanceCatalog){
 const integrity=checkSkillIntegrity(input.skill_integrity,catalog.skills,catalog.now);
 checkRulesetReference(input.ruleset_ref,clientRelease(input.skill_integrity,catalog.skills),catalog.rules,catalog.now,integrity);
 if(integrity.status!=='MATCHED_CLIENT_REPORTED')throw new Error('DOCUMENT_CLIENT_NOT_SUPPORTED');
 if(jcsSha256(input.ruleset_ref)!==jcsSha256(d.ruleset_ref))throw new Error('DOCUMENT_RULESET_MISMATCH');
 const r=validatePublicResult(d.result),profile=certificateCalculationProfile(),report=validateAndRecomputeNumericModel(input.model,profile),hash=jcsSha256({model:input.model,profile,report});
 if(hash!==input.expected_report_hash||d.display_quote.source_report_hash!==hash||jcsSha256(r.calculation.basis)!==jcsSha256(getCertificateBasis().basis)||jcsSha256(report.measurement)!==jcsSha256(r.measurement)||jcsSha256(report.effort)!==jcsSha256(r.calculation.effort)||jcsSha256(report.reference_usd)!==jcsSha256(r.calculation.reference_usd)||jcsSha256(r.quality)!==jcsSha256(input.quality)||r.quality.analysis_complete!==input.model.analysis_complete||input.display_currency!==d.display_quote.display_currency)throw new Error('DOCUMENT_NUMERIC_MISMATCH');
 const q=d.display_quote,codes=new Set<string>([...PUBLIC_LIMITATIONS,'FX_UNAVAILABLE','FX_STALE','FX_CACHE_AFTER_FAILURE','FRB_REDIRECT_REJECTED','FRB_HTTP_ERROR','FRB_CONTENT_TYPE_INVALID','FRB_BODY_MISSING','FRB_RESPONSE_TOO_LARGE','FRB_UTF8_INVALID','FRB_RESPONSE_INVALID','FRB_TIMEOUT','FRB_FETCH_FAILED','FRB_CURRENCY_UNAVAILABLE']);
 if(!['ja-JP','en-US'].includes(q.locale)||q.limitation_codes.some(x=>!codes.has(x))||q.fx_snapshot&&(q.fx_snapshot.currency!==q.display_currency||q.fx_snapshot.source_url!=='https://www.federalreserve.gov/releases/h10/current/'))throw new Error('DOCUMENT_QUOTE_MISMATCH');
 const provider={get:async()=>({status:q.localized_reference.status,snapshot:q.fx_snapshot,limitation_codes:q.limitation_codes.filter(x=>!report.limitation_codes.includes(x))})} as FxProvider;
 const expected=await createDisplayQuote({report,basis:profile,report_hash:hash},provider,q.locale,q.display_currency,()=>new Date(q.displayed_at));
 if(jcsSha256(expected)!==jcsSha256(q))throw new Error('DOCUMENT_QUOTE_MISMATCH');
}
