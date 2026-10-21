import { it,expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { withQuality } from "../fixtures/quality.js";
import { validateAssessment } from "../../src/core/validate.js";
import { createEvaluation } from "../../src/core/evaluation.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { projectPublicResult,validatePublicResult,publicCandidateHash,publicReasonCodes,publicResultCandidateSchema } from "../../src/core/public-result.js";
import { jcsSha256 } from "../../src/core/canonical.js";
import type { Assessment } from "../../src/core/types.js";

export function savedResult(a:Assessment,profile=getLocalProfile()) {
  const e=createEvaluation(a,profile);
  return {measurement:e.report.measurement,calculation:{environment:"TEST",basis:e.basis,effort:e.report.effort,reference_usd:e.report.reference_usd,limitation_codes:e.report.limitation_codes}};
}
export function unadopted(a=withQuality()) {
  const p=a.functional_processes[0];p.status="unresolved";p.movements=[];
  a.function_candidates![0].disposition="unresolved";
  const j=a.judgments![0];j.status="unresolved";j.unresolved_points=["Movement and request boundary not selected"];
  j.targets=j.targets.filter(t=>t.kind!=="movement");return a;
}
const freeze=(value:any):any=>{if(value && typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
it("P01/P12 projects explicit schema fields and matches saved numbers without mutating inputs",()=>{
  const a=withQuality(),saved=savedResult(a),before=JSON.stringify({a,saved});validateAssessment(a);
  freeze(a);freeze(saved);
  const c=projectPublicResult(a,saved);
  expect(new Ajv2020({strict:true}).compile(publicResultCandidateSchema)(c)).toBe(true);
  expect(c.measurement).toEqual(saved.measurement);expect(c.calculation.effort).toEqual(saved.calculation.effort);expect(c.calculation.reference_usd).toEqual(saved.calculation.reference_usd);
  expect(JSON.stringify({a,saved})).toBe(before);expect(c.measurement).not.toBe(saved.measurement);
  expect(publicCandidateHash(c)).toBe(jcsSha256({domain:"oes/public-result-candidate-hash/v1",candidate:c}));
});
it.each(["rerun","continuation","both"] as const)("P02 preserves %s unknown, pending reasons and provisional inner subtotal",field=>{
  const a=withQuality(),b=a.quality!.boundaries[0],p=a.functional_processes[0],j=a.judgments![0];
  if(field!=="continuation")b.rerun="unknown";if(field!=="rerun")b.continuation="unknown";
  j.status="provisional";j.unresolved_points=["Confirm continuation and independent retry"];
  validateAssessment(a);const c=projectPublicResult(a,savedResult(a));
  expect(c.measurement.status).toBe("PARTIAL");expect(c.quality.provisional_cfp_subtotal).toBe(p.movements.length);
  expect(c.quality.provisional_process_count).toBe(1);expect(c.quality.unknown_boundary_counts).toEqual({rerun:field==="continuation"?0:1,continuation:field==="rerun"?0:1});
  expect(c.quality.partial_reason_codes).toContain("JUDGMENT_PENDING");
  if(field!=="continuation")expect(c.quality.partial_reason_codes).toContain("BOUNDARY_RERUN_UNKNOWN");
  if(field!=="rerun")expect(c.quality.partial_reason_codes).toContain("BOUNDARY_CONTINUATION_UNKNOWN");
});
it("P03 keeps unadopted candidates and independent unread categories without inventing CFP",()=>{
  const a=unadopted();
  for(const [path,membership] of [["src/unread.js","included"],["outside/guide.md","outside"],["support/guide.md","supporting"],["unknown.js","unresolved"]] as const){
    a.input.manifest.files.push({path,sha256:"a".repeat(64),bytes:1,line_count:1,disposition:"unread",exclusion_reason:null});
    a.scope_record!.files.push({path,membership,reason:"Declared review scope",confirmation_ref:"scope-confirmed",evidence_refs:[]});
    if(membership!=="unresolved")a.quality!.scope_rules.push({rule_id:path,path_prefix:path,membership,reason:"Explicit scope rule"});
  }
  a.input.analysis_complete=false;
  a.input.manifest.files.push({path:"src/excluded.js",sha256:"0".repeat(64),bytes:3000000,line_count:0,disposition:"excluded",exclusion_reason:"FILE_SIZE_LIMIT"});
  a.scope_record!.files.push({path:"src/excluded.js",membership:"included",reason:"Included but unavailable",confirmation_ref:"scope-confirmed",evidence_refs:[]});
  a.input.acquisition!.issues.push({path:"src/excluded.js",cause:"FILE_SIZE_LIMIT"});
  a.quality!.limitations.push({path:"src/excluded.js",cause:"FILE_SIZE_LIMIT",impact:"in_scope",rule_id:"application",reason:"Required implementation exceeds acquisition size",missing:null});
  validateAssessment(a);const c=projectPublicResult(a,savedResult(a));
  expect(c.measurement.cfp).toBe(3);expect(c.quality.unresolved_process_count).toBe(1);expect(c.quality.candidate_counts.unresolved).toBe(1);
  expect(c.quality.unread_counts).toEqual({in_scope:2,outside:1,supporting:1,scope_unknown:1});
  expect(c.quality.partial_reason_codes).toEqual(["ACQUISITION_IN_SCOPE","CANDIDATE_UNRESOLVED","FILE_SCOPE_UNRESOLVED","IN_SCOPE_UNCONFIRMED","JUDGMENT_PENDING","PROCESS_UNRESOLVED"]);
});
it.each(["INCOMPLETE","UNSUPPORTED"] as const)("P04 keeps %s and null estimates rather than 0 or PARTIAL",status=>{
  const a=withQuality();a.functional_processes=[];a.function_candidates=[];a.judgments=[];a.quality!.boundaries=[];
  if(status==="UNSUPPORTED"){
    a.findings=[{finding_id:"unsupported",category:"applicability_limit",severity:"blocking",message:"Applicability unknown",evidence_refs:[],targets:[],impact:"scope",resolution:"open"}];
    a.quality!.findings=[{finding_id:"unsupported",subject:"implementation"}];
  }
  validateAssessment(a);const c=projectPublicResult(a,savedResult(a));expect(c.measurement.status).toBe(status);expect(c.measurement.cfp).toBeNull();
  expect(c.calculation.effort).toEqual({status:"UNSUPPORTED",hours_per_cfp:null,person_hours:null});
  expect(c.calculation.reference_usd).toEqual({status:"UNSUPPORTED",hourly_wage_usd:null,amount_usd:null});expect(c.limitation_codes).toContain("TEST_DATA_ONLY");
});
it("P04/P08 uses saved numeric coefficients/range and preserves unavailable conversion",()=>{
  const a=withQuality(),profile=getLocalProfile();profile.benchmark.min_cfp=10;
  const saved=savedResult(a,profile),c=projectPublicResult(a,saved);
  expect(c.calculation.effort.status).toBe("OUTSIDE_REFERENCE_RANGE");expect(c.calculation.reference_usd.amount_usd).toBeNull();
  expect(c.limitation_codes).toContain("BENCHMARK_OUT_OF_RANGE");
  const other=getLocalProfile();other.benchmark.hours_per_cfp={p25:"2.5",median:"4",p75:"6"};other.wage.hourly_wage_usd="80";
  const historical=savedResult(a,other);expect(projectPublicResult(a,historical).calculation.reference_usd.amount_usd?.median).toBe("1920");
});
it("P05 excludes names, source, identifiers, paths, symbols, scope and arbitrary summary data",()=>{
  const a=withQuality(),canary="PRIVATE_CANARY_9c57";
  a.scope.description=canary;a.input.repository_label=canary;a.assessor.model_name=canary;a.assessment_id=canary;
  a.components.forEach(c=>{c.name=canary;c.reason=canary;});a.functional_processes.forEach(p=>{p.name=canary;p.description=canary;p.decision_reason=canary;});
  a.evidence.forEach(e=>{e.symbol=canary;e.description=canary;});a.data_groups.forEach(g=>{g.name=canary;g.description=canary;});
  a.judgments![0].status="provisional";a.judgments![0].unresolved_points=[canary];a.judgments![0].judgment_id=canary;
  a.functional_processes[0].boundary!.judgment_refs=[canary];
  validateAssessment(a);const s=savedResult(a) as any;s.arbitrary={scope:canary,path:canary};s.calculation.basis.notice=canary;s.calculation.basis.effort_scope_name=canary;
  const c=projectPublicResult(a,s);expect(JSON.stringify(c)).not.toContain(canary);expect(c.quality.partial_reason_codes).toContain("JUDGMENT_PENDING");
  expect(Object.keys(c)).toEqual(["schema_version","projection_version","measurement","quality","calculation","assurance","limitation_codes"]);
});
it("P06 rejects legacy/quality gaps, unknown catalog IDs/engines/fields and limitations",()=>{
  const a=withQuality(),s=savedResult(a);
  const old=structuredClone(a);delete old.quality;expect(()=>projectPublicResult(old,s)).toThrow("PUBLIC_SOURCE_UNSUPPORTED");
  for(const field of ["engine_version","mapping_version","profile_set_id"] as const){const bad=structuredClone(s);(bad.calculation.basis as any)[field]="PRIVATE_CANARY";expect(()=>projectPublicResult(a,bad)).toThrow("PUBLIC_BASIS_UNSUPPORTED");}
  for(const field of ["benchmark","wage"] as const){const bad=structuredClone(s);bad.calculation.basis[field].id="PRIVATE_CANARY";expect(()=>projectPublicResult(a,bad)).toThrow("PUBLIC_BASIS_UNSUPPORTED");}
  const extra=structuredClone(s) as any;extra.calculation.basis.extra="PRIVATE_CANARY";expect(()=>projectPublicResult(a,extra)).toThrow("PUBLIC_BASIS_UNSUPPORTED");
  s.calculation.limitation_codes.push("PRIVATE_CANARY");expect(()=>projectPublicResult(a,s)).toThrow("PUBLIC_LIMITATION_UNSUPPORTED");
});
it("P06 maps only explicit reasons/gaps, rejects unknown or empty prefixes, and strips identifiers",()=>{
  expect(publicReasonCodes(["JUDGMENT_RECORDED:private","JUDGMENT_PROVISIONAL:other","SCAN_INCOMPLETE_SCOPE_IMPACT_UNKNOWN"],
    ["EVIDENCE_MISSING:private","EVIDENCE_INSUFFICIENT:other"])).toEqual({partial_reason_codes:["JUDGMENT_PENDING","SCAN_SCOPE_IMPACT_UNKNOWN"],record_gap_codes:["EVIDENCE_INSUFFICIENT"]});
  for(const code of ["PRIVATE:secret","FINDING_OPEN:","FINDING_OPEN: ","SCAN_INCOMPLETE_SCOPE_IMPACT_UNKNOWN:secret"]){expect(()=>publicReasonCodes([code],[])).toThrow("PUBLIC_REASON_UNSUPPORTED");}
  expect(()=>publicReasonCodes([],["QUALITY_RECORDS_MISSING"])).toThrow("PUBLIC_REASON_UNSUPPORTED");
});
it("P07 rejects saved totals that disagree with recomputation",()=>{
  const a=withQuality(),s=savedResult(a);s.measurement.cfp=999;expect(()=>projectPublicResult(a,s)).toThrow("PUBLIC_RESULT_MISMATCH");
});
it.each(["negative","nonfinite","exponent","quartile","count","unknown","extra","unsorted","missing_test"])("P12 rejects candidate invariant violation %s",kind=>{
  const a=withQuality(),c=projectPublicResult(a,savedResult(a));
  if(kind==="negative")c.calculation.effort.person_hours!.median="-1";
  if(kind==="nonfinite")c.calculation.reference_usd.amount_usd!.median="Infinity";
  if(kind==="exponent")c.calculation.basis.wage.hourly_wage_usd="1e3";
  if(kind==="quartile")c.calculation.effort.person_hours!.p25="999";
  if(kind==="count")c.measurement.counts.entry=Number.MAX_SAFE_INTEGER+1;
  if(kind==="unknown")c.quality.unknown_boundary_counts.rerun=1;
  if(kind==="extra")(c.calculation.basis as any).run_id="PRIVATE_CANARY";
  if(kind==="unsorted")c.limitation_codes.reverse();
  if(kind==="missing_test")c.limitation_codes=c.limitation_codes.filter(x=>x!=="TEST_DATA_ONLY");
  expect(()=>validatePublicResult(c)).toThrow("PUBLIC_CANDIDATE_INVALID");
});
