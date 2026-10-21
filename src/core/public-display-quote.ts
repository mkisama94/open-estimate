import { createDisplayQuote } from "./display-quote.js";
import { obj, checkContract, hashSchema, type CertificateEnvelope } from "./certificate-contract.js";
import { certificateCalculationProfile, matchCertificateBasis } from "../profiles/certificate-basis.js";
import { CURRENCIES, FRB_URL, type FxProvider } from "../profiles/frb.js";
import { PUBLIC_LIMITATIONS } from "./public-result.js";
const string={type:"string"},nullable=(s:unknown)=>({anyOf:[s,{type:"null"}]}),decimal={type:"string",pattern:"^(0|[1-9][0-9]*)(\\.[0-9]+)?$"};
const quartile=nullable(obj({p25:decimal,median:decimal,p75:decimal}));
export const publicDisplayQuoteSchema=obj({schema_version:{const:"oes/public-display-quote/v1"},certificate_id:{type:"string",pattern:"^cert_[a-f0-9]{32}$"},signed_object_hash:hashSchema,
  conversion_policy_version:{const:"frb-display-time-v1"},quoted_at:string,locale:string,display_currency:{enum:CURRENCIES},person_days:quartile,
  localized_reference:obj({status:{enum:["AVAILABLE","UPSTREAM_UNAVAILABLE","FX_UNAVAILABLE","FX_STALE"]},currency:{enum:CURRENCIES},currency_per_usd:nullable(decimal),amount:quartile}),
  fx:nullable(obj({currency:{enum:CURRENCIES},source_url:{const:FRB_URL},source_sha256:hashSchema,observed_on:string,published_on:string,fetched_at:string,checked_at:string,raw_value:string,quote_direction:{enum:["currency_per_usd","usd_per_currency"]},currency_per_usd:decimal})),
  limitation_codes:{type:"array",uniqueItems:true,items:{enum:[...PUBLIC_LIMITATIONS,"FX_UNAVAILABLE","FX_STALE","FX_CACHE_AFTER_FAILURE","FRB_BODY_MISSING","FRB_CONTENT_TYPE_INVALID","FRB_CURRENCY_UNAVAILABLE","FRB_FETCH_FAILED","FRB_HTTP_ERROR","FRB_REDIRECT_REJECTED","FRB_RESPONSE_INVALID","FRB_RESPONSE_TOO_LARGE","FRB_TIMEOUT","FRB_UTF8_INVALID"]}},signed:{const:false}});
/** A public allowlist projection; no private source_report_hash is copied. */
export async function publicDisplayQuote(envelope:CertificateEnvelope,provider:FxProvider,locale:string,currency:string,now:()=>Date) {
  const s=envelope.signed_object,r=s.result;matchCertificateBasis(r.calculation);
  const quote=await createDisplayQuote({report:{measurement:r.measurement,effort:r.calculation.effort,reference_usd:r.calculation.reference_usd,limitation_codes:r.limitation_codes},basis:certificateCalculationProfile(),report_hash:envelope.signed_object_hash},provider,locale,currency,now);
  const fx=quote.fx_snapshot;
  const value={schema_version:"oes/public-display-quote/v1",certificate_id:s.certificate_id,signed_object_hash:envelope.signed_object_hash,conversion_policy_version:quote.conversion_policy_version,
    quoted_at:quote.displayed_at,locale:quote.locale,display_currency:quote.display_currency,person_days:quote.person_days,localized_reference:quote.localized_reference,
    fx:fx?{currency:fx.currency,source_url:fx.source_url,source_sha256:fx.source_sha256,observed_on:fx.observed_on,published_on:fx.published_on,fetched_at:fx.fetched_at,checked_at:fx.checked_at,raw_value:fx.raw_value,quote_direction:fx.quote_direction,currency_per_usd:fx.currency_per_usd}:null,
    limitation_codes:quote.limitation_codes,signed:false};
  return checkContract<typeof value>(publicDisplayQuoteSchema,value);
}
