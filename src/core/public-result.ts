import { Ajv2020 } from "ajv/dist/2020.js";
import { Decimal } from "decimal.js";
import { jcsSha256 } from "./canonical.js";
import { measureAssessment } from "./measure.js";
import { estimateAssessment } from "./estimate.js";
import { recordState } from "./records.js";
import type { Assessment, MeasurementResult, EffortEstimate, ReferenceUsdEstimate, QuartileValues } from "./types.js";

export const PROJECTION_VERSION = "oes/public-result-projection/1.0.0" as const;
export const PUBLIC_LIMITATIONS = ["TEST_DATA_ONLY","AI_SEMANTICS_UNVERIFIED","COMMUNITY_CLAIMS_UNATTESTED","REFERENCE_NOT_MARKET_VALUE",
  "PARTIAL_MEASUREMENT","BENCHMARK_UNAVAILABLE","BENCHMARK_OUT_OF_RANGE","WAGE_UNAVAILABLE"] as const;
const reasonPrefixes: ReadonlyArray<readonly [string,string]> = [
  ["ACQUISITION_IN_SCOPE:","ACQUISITION_IN_SCOPE"],["ACQUISITION_UNKNOWN:","ACQUISITION_SCOPE_UNKNOWN"],
  ["BOUNDARY_RERUN_UNKNOWN:","BOUNDARY_RERUN_UNKNOWN"],["BOUNDARY_CONTINUATION_UNKNOWN:","BOUNDARY_CONTINUATION_UNKNOWN"],
  ["IN_SCOPE_UNREAD:","IN_SCOPE_UNCONFIRMED"],["FILE_SCOPE_UNRESOLVED:","FILE_SCOPE_UNRESOLVED"],
  ["CANDIDATE_UNRESOLVED:","CANDIDATE_UNRESOLVED"],["PROCESS_CANDIDATE_MISSING:","PROCESS_CANDIDATE_MISSING"],
  ["JUDGMENT_RECORDED:","JUDGMENT_PENDING"],["JUDGMENT_PROVISIONAL:","JUDGMENT_PENDING"],["JUDGMENT_UNRESOLVED:","JUDGMENT_PENDING"],
  ["DATA_GROUP_UNCONFIRMED:","DATA_GROUP_UNCONFIRMED"],["PROCESS_UNRESOLVED:","PROCESS_UNRESOLVED"],
  ["COMPONENT_SCOPE_IMPACT:","COMPONENT_SCOPE_IMPACT"],["FINDING_OPEN:","FINDING_OPEN"]
];
const gapPrefixes: ReadonlyArray<readonly [string,string]> = [["EVIDENCE_INSUFFICIENT:","EVIDENCE_INSUFFICIENT"],
  ["EVIDENCE_MISSING:","EVIDENCE_INSUFFICIENT"],["PROCESS_CANDIDATE_MISSING:","PROCESS_CANDIDATE_MISSING"]];
const sorted = (values: readonly string[]) => Array.from(new Set(values)).sort();
const reasonCodes = sorted(["SCAN_SCOPE_IMPACT_UNKNOWN"].concat(reasonPrefixes.map(p=>p[1])));
const gapCodes = sorted(gapPrefixes.map(p=>p[1]));

export type PublicResultErrorCode = "PUBLIC_SOURCE_UNSUPPORTED" | "PUBLIC_BASIS_UNSUPPORTED" | "PUBLIC_RESULT_MISMATCH"
  | "PUBLIC_REASON_UNSUPPORTED" | "PUBLIC_LIMITATION_UNSUPPORTED" | "PUBLIC_CANDIDATE_INVALID" | "PUBLIC_CANDIDATE_WRITE_FAILED";
export class PublicResultError extends Error {
  constructor(public readonly code: PublicResultErrorCode) { super(code); this.name="PublicResultError"; }
}
const fail = (code: PublicResultErrorCode): never => { throw new PublicResultError(code); };
const object = (properties: Record<string,unknown>) => ({type:"object",additionalProperties:false,properties,required:Object.keys(properties)});
const count = {type:"integer",minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const decimal = {type:"string",maxLength:256,pattern:"^(0|[1-9][0-9]*)(\\.[0-9]+)?$"};
const quartet = object({p25:decimal,median:decimal,p75:decimal});
const nullable = (schema: unknown) => ({anyOf:[schema,{type:"null"}]});
const codes = (values: readonly string[]) => ({type:"array",items:{enum:values},uniqueItems:true});
const measurementSchema = object({status:{enum:["COMPLETE","PARTIAL","UNSUPPORTED","INCOMPLETE"]},cfp:nullable(count),
  counts:object({entry:count,exit:count,read:count,write:count,total_processes:count,accepted_processes:count})});
const effortSchema = object({status:{enum:["AVAILABLE","BENCHMARK_UNAVAILABLE","OUTSIDE_REFERENCE_RANGE","UNSUPPORTED"]},hours_per_cfp:nullable(quartet),person_hours:nullable(quartet)});
const usdSchema = object({status:{enum:["AVAILABLE","WAGE_UNAVAILABLE","UNSUPPORTED"]},hourly_wage_usd:nullable(decimal),amount_usd:nullable(quartet)});
// This is an explicit public ID/version catalog, independent of the mutable default profile.
const benchmarkSchema = object({id:{const:"oes-test-benchmark-design-implementation-test-v1"},is_test:{const:true},sample_size:count,
  min_cfp:count,max_cfp:count,hours_per_cfp:quartet});
const wageSchema = object({id:{const:"oes-test-wage-50usd-v1"},is_test:{const:true},hourly_wage_usd:decimal});
const basisProperties = {profile_set_id:{const:"oes-local-test-2026-10-v1"},engine_version:{const:"0.8.1-quality"},mapping_version:{const:"oes-cosmic-ph1-v1"},benchmark:benchmarkSchema,wage:wageSchema};
const savedBasisSchema = object({domain:{const:"open-estimate/calculation-basis/v3"},
  environment:{const:"TEST"},effort_scope_id:{const:"oes-design-implementation-test-v1"},
  effort_scope_name:{type:"string",minLength:1},notice:{type:"string",minLength:1},
  profile_set_id:basisProperties.profile_set_id,engine_version:basisProperties.engine_version,mapping_version:basisProperties.mapping_version,
  benchmark:benchmarkSchema,wage:wageSchema});

export interface PublicBasis {
  profile_set_id:"oes-local-test-2026-10-v1";engine_version:"0.8.1-quality";mapping_version:"oes-cosmic-ph1-v1";
  benchmark:{id:"oes-test-benchmark-design-implementation-test-v1";is_test:true;sample_size:number;min_cfp:number;max_cfp:number;hours_per_cfp:{p25:string;median:string;p75:string}};
  wage:{id:"oes-test-wage-50usd-v1";is_test:true;hourly_wage_usd:string};
}
export interface PublicResultCandidate {
  schema_version:"oes/public-result-candidate/v1";projection_version:typeof PROJECTION_VERSION;
  measurement:MeasurementResult;
  quality:{record_format:"RECORDED_V2";quality_version:"oes/quality-records/v1";analysis_complete:boolean;scan_complete:boolean;
    provisional_process_count:number;provisional_cfp_subtotal:number;unresolved_process_count:number;
    candidate_counts:{identified:number;counted:number;outside:number;merged:number;unresolved:number};
    unread_counts:{in_scope:number;outside:number;supporting:number;scope_unknown:number};unknown_boundary_counts:{rerun:number;continuation:number};
    partial_reason_codes:string[];record_gap_codes:string[]};
  calculation:{environment:"TEST";effort_scope_id:"oes-design-implementation-test-v1";hours_per_day:8;basis:PublicBasis;effort:EffortEstimate;reference_usd:ReferenceUsdEstimate};
  assurance:{input:"CLIENT_REPORTED";calculation_check:"LOCAL_RECOMPUTED_MATCH";semantic_assessment:"NOT_INDEPENDENTLY_VERIFIED";signed:false};
  limitation_codes:string[];
}
export const publicResultCandidateSchema = {
  $schema:"https://json-schema.org/draft/2020-12/schema",title:"Open Estimate public result candidate v1",
  ...object({schema_version:{const:"oes/public-result-candidate/v1"},projection_version:{const:PROJECTION_VERSION},measurement:measurementSchema,
    quality:object({record_format:{const:"RECORDED_V2"},quality_version:{const:"oes/quality-records/v1"},analysis_complete:{type:"boolean"},scan_complete:{type:"boolean"},
      provisional_process_count:count,provisional_cfp_subtotal:count,unresolved_process_count:count,
      candidate_counts:object({identified:count,counted:count,outside:count,merged:count,unresolved:count}),
      unread_counts:object({in_scope:count,outside:count,supporting:count,scope_unknown:count}),unknown_boundary_counts:object({rerun:count,continuation:count}),
      partial_reason_codes:codes(reasonCodes),record_gap_codes:codes(gapCodes)}),
    calculation:object({environment:{const:"TEST"},effort_scope_id:{const:"oes-design-implementation-test-v1"},hours_per_day:{const:8},
      basis:object(basisProperties),effort:effortSchema,reference_usd:usdSchema}),
    assurance:object({input:{const:"CLIENT_REPORTED"},calculation_check:{const:"LOCAL_RECOMPUTED_MATCH"},semantic_assessment:{const:"NOT_INDEPENDENTLY_VERIFIED"},signed:{const:false}}),
    limitation_codes:codes(PUBLIC_LIMITATIONS)})
};
const ajv = new Ajv2020({strict:true,ownProperties:true});
const validCandidate = ajv.compile(publicResultCandidateSchema),validSavedBasis=ajv.compile(savedBasisSchema);
const validMeasurement=ajv.compile(measurementSchema),validEffort=ajv.compile(effortSchema),validUsd=ajv.compile(usdSchema);
const equal = (left: unknown,right: unknown) => jcsSha256(left)===jcsSha256(right);
function checkQuartiles(q: QuartileValues | null) {
  if(q===null)return;
  if(q.p25===null || q.median===null || q.p75===null)fail("PUBLIC_CANDIDATE_INVALID");
  const low=new Decimal(q.p25!),middle=new Decimal(q.median!),high=new Decimal(q.p75!);
  if(!low.isFinite() || !middle.isFinite() || !high.isFinite() || low.lt(0) || !low.lte(middle) || !middle.lte(high))fail("PUBLIC_CANDIDATE_INVALID");
}
function publicBasis(saved: unknown): PublicBasis {
  if(!validSavedBasis(saved))fail("PUBLIC_BASIS_UNSUPPORTED");
  const b=saved as PublicBasis;
  if(b.benchmark.min_cfp>b.benchmark.max_cfp)fail("PUBLIC_BASIS_UNSUPPORTED");
  try { checkQuartiles(b.benchmark.hours_per_cfp); } catch { fail("PUBLIC_BASIS_UNSUPPORTED"); }
  return {profile_set_id:b.profile_set_id,engine_version:b.engine_version,mapping_version:b.mapping_version,
    benchmark:{id:b.benchmark.id,is_test:true,sample_size:b.benchmark.sample_size,min_cfp:b.benchmark.min_cfp,max_cfp:b.benchmark.max_cfp,
      hours_per_cfp:{p25:b.benchmark.hours_per_cfp.p25,median:b.benchmark.hours_per_cfp.median,p75:b.benchmark.hours_per_cfp.p75}},
    wage:{id:b.wage.id,is_test:true,hourly_wage_usd:b.wage.hourly_wage_usd}};
}
function estimate(measurement: MeasurementResult,basis: PublicBasis) {
  return estimateAssessment(measurement,{locale:"en-US",display_currency:"USD",benchmarkProfile:basis.benchmark,wageProfile:basis.wage});
}
function mapCodes(input: readonly string[],prefixes: ReadonlyArray<readonly [string,string]>,scan=false) {
  return sorted(input.map(value=>{
    if(scan && value==="SCAN_INCOMPLETE_SCOPE_IMPACT_UNKNOWN")return "SCAN_SCOPE_IMPACT_UNKNOWN";
    const found=prefixes.find(p=>typeof value==="string" && value.startsWith(p[0]) && value.slice(p[0].length).trim().length>0);
    return found ? found[1] : fail("PUBLIC_REASON_UNSUPPORTED");
  }));
}
export function publicReasonCodes(partial: readonly string[],gaps: readonly string[]) {
  return {partial_reason_codes:mapCodes(partial,reasonPrefixes,true),record_gap_codes:mapCodes(gaps,gapPrefixes)};
}
function checkedLimitations(input: unknown) {
  if(!Array.isArray(input) || input.some(c=>!PUBLIC_LIMITATIONS.some(x=>x===c)))fail("PUBLIC_LIMITATION_UNSUPPORTED");
  return input as string[];
}
const copyQuartiles = (q: QuartileValues | null) => q===null ? null : {p25:q.p25,median:q.median,p75:q.p75};
function copyMeasurement(m: MeasurementResult): MeasurementResult {
  return {status:m.status,cfp:m.cfp,counts:{entry:m.counts.entry,exit:m.counts.exit,read:m.counts.read,write:m.counts.write,
    total_processes:m.counts.total_processes,accepted_processes:m.counts.accepted_processes}};
}

/** Pure allowlist projection from a validated Assessment and its saved result, never from current defaults. */
export function projectPublicResult(a: Assessment,saved: unknown): PublicResultCandidate {
  try {
    if(a.format_version!=="oes/assessment/v2" || a.quality?.version!=="oes/quality-records/v1")fail("PUBLIC_SOURCE_UNSUPPORTED");
    const quality=a.quality!;
    const source=saved as {measurement:MeasurementResult;calculation:{environment:unknown;basis:unknown;effort:EffortEstimate;reference_usd:ReferenceUsdEstimate;limitation_codes:unknown}};
    if(source?.calculation?.environment!=="TEST")fail("PUBLIC_BASIS_UNSUPPORTED");
    const basis=publicBasis(source.calculation.basis),measurement=measureAssessment(a),recomputed=estimate(measurement,basis);
    if(!validMeasurement(source.measurement) || !validEffort(source.calculation.effort) || !validUsd(source.calculation.reference_usd)
      || !equal(measurement,source.measurement) || !equal(recomputed.effort,source.calculation.effort) || !equal(recomputed.reference_usd,source.calculation.reference_usd))fail("PUBLIC_RESULT_MISMATCH");
    const limitationCodes=checkedLimitations(source.calculation.limitation_codes);
    if(!equal(limitationCodes,sorted(recomputed.limitation_codes.concat("TEST_DATA_ONLY"))))fail("PUBLIC_RESULT_MISMATCH");
    const state=recordState(a),mapped=publicReasonCodes(state.partial_reasons,state.record_gaps);
    const candidate: PublicResultCandidate={schema_version:"oes/public-result-candidate/v1",projection_version:PROJECTION_VERSION,
      measurement:copyMeasurement(source.measurement),
      quality:{record_format:"RECORDED_V2",quality_version:"oes/quality-records/v1",analysis_complete:state.analysis_complete,scan_complete:state.scan_complete,
        provisional_process_count:state.provisional_processes.length,provisional_cfp_subtotal:state.provisional_cfp_subtotal,
        unresolved_process_count:a.functional_processes.filter(p=>p.status==="unresolved").length,
        candidate_counts:{identified:state.candidate_counts.identified,counted:state.candidate_counts.counted,outside:state.candidate_counts.outside,merged:state.candidate_counts.merged,unresolved:state.candidate_counts.unresolved},
        unread_counts:{in_scope:state.in_scope_unread.length,outside:state.outside_unread.length,supporting:state.supporting_unread.length,scope_unknown:state.scope_unknown_files.length},
        unknown_boundary_counts:{rerun:quality.boundaries.filter(b=>b.rerun==="unknown").length,continuation:quality.boundaries.filter(b=>b.continuation==="unknown").length},
        partial_reason_codes:mapped.partial_reason_codes,record_gap_codes:mapped.record_gap_codes},
      calculation:{environment:"TEST",effort_scope_id:"oes-design-implementation-test-v1",hours_per_day:8,basis,
        effort:{status:source.calculation.effort.status,hours_per_cfp:copyQuartiles(source.calculation.effort.hours_per_cfp),person_hours:copyQuartiles(source.calculation.effort.person_hours)},
        reference_usd:{status:source.calculation.reference_usd.status,hourly_wage_usd:source.calculation.reference_usd.hourly_wage_usd,amount_usd:copyQuartiles(source.calculation.reference_usd.amount_usd)}},
      assurance:{input:"CLIENT_REPORTED",calculation_check:"LOCAL_RECOMPUTED_MATCH",semantic_assessment:"NOT_INDEPENDENTLY_VERIFIED",signed:false},limitation_codes:limitationCodes.slice()};
    return validatePublicResult(candidate);
  } catch(e) { if(e instanceof PublicResultError)throw e;return fail("PUBLIC_CANDIDATE_INVALID"); }
}

/** Strict schema and internal arithmetic/quality checks, also used after loading candidate.json. */
export function validatePublicResult(input: unknown): PublicResultCandidate {
  try {
    if(!validCandidate(input))fail("PUBLIC_CANDIDATE_INVALID");
    const c=input as PublicResultCandidate,m=c.measurement,q=c.quality,b=c.calculation.basis;
    const sum=m.counts.entry+m.counts.exit+m.counts.read+m.counts.write;
    if(!Number.isSafeInteger(sum) || m.counts.accepted_processes>m.counts.total_processes || q.unresolved_process_count!==m.counts.total_processes-m.counts.accepted_processes)fail("PUBLIC_CANDIDATE_INVALID");
    if(m.cfp===null ? sum!==0 || m.counts.accepted_processes!==0 || !["UNSUPPORTED","INCOMPLETE"].includes(m.status)
      : m.cfp!==sum || m.cfp<=0 || m.counts.accepted_processes===0 || !["COMPLETE","PARTIAL"].includes(m.status))fail("PUBLIC_CANDIDATE_INVALID");
    const totalCandidates=q.candidate_counts.counted+q.candidate_counts.outside+q.candidate_counts.merged+q.candidate_counts.unresolved;
    if(!Number.isSafeInteger(totalCandidates) || totalCandidates!==q.candidate_counts.identified || q.provisional_process_count>m.counts.accepted_processes
      || q.provisional_cfp_subtotal>(m.cfp??0) || (q.provisional_process_count===0)!==(q.provisional_cfp_subtotal===0))fail("PUBLIC_CANDIDATE_INVALID");
    if(q.unknown_boundary_counts.rerun>m.counts.total_processes || q.unknown_boundary_counts.continuation>m.counts.total_processes)fail("PUBLIC_CANDIDATE_INVALID");
    if(q.analysis_complete!==(q.partial_reason_codes.length===0) || (m.status==="COMPLETE" && (!q.analysis_complete || q.provisional_process_count || q.unresolved_process_count || q.candidate_counts.unresolved || q.record_gap_codes.length))
      || (m.status==="PARTIAL" && q.analysis_complete))fail("PUBLIC_CANDIDATE_INVALID");
    for(const [n,code] of [[q.unknown_boundary_counts.rerun,"BOUNDARY_RERUN_UNKNOWN"],[q.unknown_boundary_counts.continuation,"BOUNDARY_CONTINUATION_UNKNOWN"],
      [q.unread_counts.in_scope,"IN_SCOPE_UNCONFIRMED"],[q.unread_counts.scope_unknown,"FILE_SCOPE_UNRESOLVED"],
      [q.unresolved_process_count,"PROCESS_UNRESOLVED"],[q.candidate_counts.unresolved,"CANDIDATE_UNRESOLVED"]] as const) {
      if((n>0)!==q.partial_reason_codes.includes(code))fail("PUBLIC_CANDIDATE_INVALID");
    }
    for(const values of [q.partial_reason_codes,q.record_gap_codes,c.limitation_codes])if(!equal(values,sorted(values)))fail("PUBLIC_CANDIDATE_INVALID");
    if(!c.limitation_codes.includes("TEST_DATA_ONLY") || c.limitation_codes.includes("PARTIAL_MEASUREMENT")!==(m.status==="PARTIAL"))fail("PUBLIC_CANDIDATE_INVALID");
    if(b.benchmark.min_cfp>b.benchmark.max_cfp)fail("PUBLIC_CANDIDATE_INVALID");
    for(const quartet of [b.benchmark.hours_per_cfp,c.calculation.effort.hours_per_cfp,c.calculation.effort.person_hours,c.calculation.reference_usd.amount_usd])checkQuartiles(quartet);
    const estimated=estimate(m,b);
    if(!equal(estimated.effort,c.calculation.effort) || !equal(estimated.reference_usd,c.calculation.reference_usd)
      || !equal(sorted(estimated.limitation_codes.concat("TEST_DATA_ONLY")),c.limitation_codes))fail("PUBLIC_CANDIDATE_INVALID");
    return c;
  } catch(e) { if(e instanceof PublicResultError)throw e;return fail("PUBLIC_CANDIDATE_INVALID"); }
}
export function publicCandidateHash(candidate: PublicResultCandidate) {
  validatePublicResult(candidate);
  return jcsSha256({domain:"oes/public-result-candidate-hash/v1",candidate});
}
