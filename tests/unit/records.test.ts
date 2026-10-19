import { describe,it,expect } from "vitest";
import { recorded,target } from "../fixtures/recorded.js";
import { validateAssessment, SemanticValidationError } from "../../src/core/validate.js";
import { normalizeAssessment } from "../../src/core/normalize.js";
import { measureAssessment } from "../../src/core/measure.js";
import { recordState, comparisonSummary } from "../../src/core/records.js";
import { projectModel } from "../../src/remote/model.js";
import { evaluateRemote } from "../fixtures/skill-policy.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { SnapshotCoverageTracker } from "../../src/collector/coverage.js";
import fs from "node:fs";
const errorCodes = (a: unknown) => { try { validateAssessment(a); return []; } catch(e) { if(e instanceof SemanticValidationError)return e.errors.map(e=>e.code);throw e; } };

describe("recorded assessment contract and uncertainty",()=>{
  it("retains excluded and merged candidates with explicit non-counted judgments",()=>{
    const a=recorded(),base=a.function_candidates![0],judgment=a.judgments![0];
    a.function_candidates!.push({...base,candidate_id:"outside-job",name:"Deployment operation",disposition:"outside",process_id:null,reason:"Operation task outside development scope"});
    a.function_candidates!.push({...base,candidate_id:"shared-helper",name:"Shared internal helper",disposition:"merged",process_id:null,merged_into:base.candidate_id,reason:"Same functional start and completion"});
    a.judgments!.push({...judgment,judgment_id:"exclude-operation",kind:"not_counted",targets:[target("candidate","outside-job")]});
    a.judgments!.push({...judgment,judgment_id:"merge-helper",kind:"merge",targets:[target("candidate","shared-helper")]});
    expect(validateAssessment(a)).toBe(a);expect(measureAssessment(a).cfp).toBe(6);
    expect(recordState(a).candidate_counts).toMatchObject({identified:4,counted:2,outside:1,merged:1});
  });
  it("requires provisional group interpretation and deduplicates its affected process subtotal",()=>{
    const a=recorded();a.data_groups[0].definition!.unconfirmed=["Logical object identity requires review"];
    expect(errorCodes(a)).toContain("PROVISIONAL_JUDGMENT_REQUIRED");
    a.judgments!.push({...a.judgments![0],judgment_id:"group-review",status:"provisional",targets:[target("data_group",a.data_groups[0].data_group_id)],unresolved_points:["Logical object identity requires review"]});
    a.judgments![0].status="provisional";a.judgments![0].unresolved_points=["Same review"];
    expect(validateAssessment(a)).toBe(a);expect(recordState(a).provisional_cfp_subtotal).toBe(6);
    expect(measureAssessment(a)).toMatchObject({status:"PARTIAL",cfp:6});
  });
  it("counts a structurally recorded model without claiming semantic verification",()=>{
    const a=recorded();expect(validateAssessment(a)).toBe(a);
    expect(measureAssessment(a)).toMatchObject({status:"COMPLETE",cfp:6});
    expect(recordState(a)).toMatchObject({candidate_counts:{counted:2},provisional_cfp_subtotal:0});
  });
  it("retains legacy hash and distinguishes old records; rejects v2 fields in v1",()=>{
    const a=JSON.parse(fs.readFileSync("examples/basic-assessment.json","utf8"));
    const hash=normalizeAssessment(a).assessment_hash;
    expect(hash).toBe("c412c63dc70e0458b2b4ac3495da91763e7b29bcaaeb85bd41a7551ebb13ac9e");
    expect(recordState(a).format).toBe("LEGACY_JUDGMENT_RECORDS_MISSING");
    expect(normalizeAssessment(a).assessment_hash).toBe(hash);
    const b=recorded();delete b.format_version;expect(errorCodes(b)).toContain("SCHEMA_INVALID");
    expect(a).not.toHaveProperty("judgments");
  });
  it("normalizes record sets and hashes judgment changes",()=>{
    const a=recorded(), b=structuredClone(a);b.judgments!.reverse();b.judgments![0].targets.reverse();b.function_candidates!.reverse();
    expect(normalizeAssessment(a).assessment_hash).toBe(normalizeAssessment(b).assessment_hash);
    b.judgments![0].application_reason+=" Clarified";
    expect(normalizeAssessment(a).assessment_hash).not.toBe(normalizeAssessment(b).assessment_hash);
  });
  it("counts provisional judgments once, aligns local and remote status without leaking records",async()=>{
    const a=recorded(),j=a.judgments![0];j.status="provisional";j.unresolved_points=["Independent completion may exist"];
    expect(validateAssessment(a)).toBe(a);
    const local=measureAssessment(a), model=projectModel(a);
    expect(recordState(a).provisional_cfp_subtotal).toBe(3);
    expect(local).toMatchObject({status:"PARTIAL",cfp:6});
    expect((await evaluateRemote({model,display_currency:"USD"},getLocalProfile())).report.measurement).toEqual(local);
    expect(JSON.stringify(model)).not.toContain(j.unresolved_points[0]);
    expect(JSON.stringify(model)).not.toContain(a.scope_record!.scope_id);
  });
  it("does not count unresolved functions or represent their size as zero",()=>{
    const a=recorded();a.functional_processes[0].status="unresolved";a.function_candidates![0].disposition="unresolved";
    a.judgments![0].status="unresolved";a.judgments![0].unresolved_points=["Boundary not selected"];
    expect(validateAssessment(a)).toBe(a);expect(measureAssessment(a)).toMatchObject({status:"PARTIAL",cfp:3});
    expect(recordState(a).unresolved_candidates[0].cfp).toBeNull();
    a.functional_processes[1].status="unresolved";a.function_candidates![1].disposition="unresolved";
    expect(measureAssessment(a)).toMatchObject({status:"INCOMPLETE",cfp:null});
  });
  it("exports the selected model while retaining an unknown unresolved trigger locally",async()=>{
    const a=recorded(),p=a.functional_processes[0];p.status="unresolved";p.movements=[];
    a.function_candidates![0].disposition="unresolved";
    const j=a.judgments![0];j.status="unresolved";j.unresolved_points=["Trigger and movement model not selected"];j.targets=j.targets.filter(t=>t.kind!=="movement");
    expect(validateAssessment(a)).toBe(a);const model=projectModel(a);
    expect(model.processes).toHaveLength(1);expect(recordState(a).unresolved_processes).toHaveLength(1);
    const remote=await evaluateRemote({model,display_currency:"USD"},getLocalProfile());
    expect(remote.report.measurement.cfp).toBe(measureAssessment(a).cfp);
    expect(remote.report.measurement.status).toBe("PARTIAL");
  });
  it.each(["missing", "unresolved"] as const)("prevents %s judgment from supporting counted movements",value=>{
    const a=recorded(),j=a.judgments![0];
    if(value==="missing"){j.evidence_status="missing";j.evidence_refs=[];j.status="provisional";}else j.status="unresolved";
    j.unresolved_points=["Need confirmation"];
    expect(errorCodes(a)).toContain("UNADOPTED_OR_UNSUPPORTED_JUDGMENT");
    expect(()=>projectModel(a)).toThrow("INVALID_ASSESSMENT_RECORDS");
  });
  it("requires per-movement implementation evidence and judgment targets",()=>{
    const a=recorded();a.functional_processes[0].movements[1].evidence_refs=[];
    expect(errorCodes(a)).toContain("IMPLEMENTATION_EVIDENCE_REQUIRED");
    const b=recorded();b.judgments![0].targets=b.judgments![0].targets.filter(t=>t.kind!=="movement");
    expect(errorCodes(b)).toContain("JUDGMENT_REQUIRED");
  });
  it("detects missing evidence, line ranges, nonexistent merge and cycles",()=>{
    let a=recorded();a.judgments![0].evidence_refs=["missing"];expect(errorCodes(a)).toContain("UNRESOLVED_REFERENCE");
    a=recorded();a.evidence[0].line_end=999;expect(errorCodes(a)).toContain("LINE_RANGE_OUT_OF_BOUNDS");
    a=recorded();Object.assign(a.function_candidates![0],{disposition:"merged",process_id:null,merged_into:"absent"});expect(errorCodes(a)).toContain("INVALID_MERGE_TARGET");
    a.function_candidates![0].merged_into=a.function_candidates![0].candidate_id;expect(errorCodes(a)).toContain("INVALID_MERGE_TARGET");
    a=recorded();a.function_candidates![0].reason=" ";expect(errorCodes(a)).toContain("SCHEMA_INVALID");
  });
  it("separates scan, scope reading, outside and supporting unread; prevents reason-only relabeling",async()=>{
    const a=recorded();a.input.manifest.files.push({...a.input.manifest.files[0],path:"generated/copy.ts",disposition:"unread"});
    a.scope_record!.files.push({path:"generated/copy.ts",membership:"outside",reason:"Confirmed duplicate output",confirmation_ref:"scope-confirmed",evidence_refs:[]});
    expect(validateAssessment(a)).toBe(a);expect(measureAssessment(a).status).toBe("COMPLETE");
    expect(recordState(a)).toMatchObject({outside_unread:["generated/copy.ts"],in_scope_unread:[]});
    const model=projectModel(a);expect((await evaluateRemote({model,display_currency:"USD"},getLocalProfile())).report.measurement.status).toBe("COMPLETE");
    a.scope_record!.files[1].confirmation_ref=null;expect(errorCodes(a)).toContain("SCOPE_BASIS_REQUIRED");
    a.scope_record!.files[1].membership="included";expect(measureAssessment(a).status).toBe("PARTIAL");
    a.scope_record!.files.pop();expect(recordState(a).scope_unknown_files).toContain("generated/copy.ts");
    const tracker=new SnapshotCoverageTracker(a.input.manifest,false);const result=tracker.reconcileInput(a.input,true);
    expect(result.reconciledInput.analysis_complete).toBe(false);
  });
  it("derives scoped acquisition from tracker, and cannot claim completion after scan truncation",()=>{
    const a=recorded(),tracker=new SnapshotCoverageTracker(a.input.manifest);
    a.input.analysis_complete=false;
    expect(tracker.reconcileInput(a.input,true).reconciledInput.analysis_complete).toBe(true);
    expect(tracker.reconcileInput(a.input).reconciledInput.analysis_complete).toBe(false);
    expect(measureAssessment(a).status).toBe("PARTIAL");
  });
  it("detects structured finding conflicts and treats explanation as non-impacting",()=>{
    const a=recorded();a.findings=[{finding_id:"f",category:"ambiguity",severity:"blocking",message:"Boundary review",evidence_refs:["ev-1"],targets:[target("judgment",a.judgments![0].judgment_id)],impact:"boundary",resolution:"open"}];
    expect(errorCodes(a)).toContain("STATE_CONFLICT");
    a.judgments![0].status="provisional";a.judgments![0].unresolved_points=["Boundary review"];
    expect(validateAssessment(a)).toBe(a);expect(measureAssessment(a).status).toBe("PARTIAL");
    a.findings[0].resolution="resolved";expect(errorCodes(a)).toContain("STATE_CONFLICT");
    a.findings[0].resolution="open";a.findings[0].impact="explanation";a.judgments![0].status="recorded";a.judgments![0].unresolved_points=[];
    expect(validateAssessment(a)).toBe(a);expect(measureAssessment(a).status).toBe("COMPLETE");
  });
  it("does not infer correspondence; computes delta from stored movements and exposes unmatched parts",()=>{
    const a=recorded(),previous=recorded();
    a.functional_processes[0].movements.splice(1,1);
    a.judgments![0].targets=a.judgments![0].targets.filter(t=>t.id!=="mov-create-write");
    a.comparison={previous_assessment:previous,previous_hash:normalizeAssessment(previous).assessment_hash,reason:"Removed storage movement",scope_changes:[],movement_changes:[{
      kind:"delete",before:[target("movement","mov-create-write",previous.functional_processes[0].process_id)],after:[],judgment_refs:[a.judgments![0].judgment_id],reason:"Storage was duplicate"}]};
    expect(validateAssessment(a)).toBe(a);
    expect(comparisonSummary(a)).toMatchObject({cfp_delta:-1,explained_cfp_delta:-1,unexplained_cfp_delta:0});
    expect(comparisonSummary(a)!.unmapped_after).toHaveLength(5);
    a.comparison.previous_hash="0".repeat(64);expect(errorCodes(a)).toContain("BASELINE_HASH_MISMATCH");
  });
  it("requires scope revision and rationale separate from counting changes",()=>{
    const a=recorded(),previous=recorded();
    a.scope_record!.files[0].membership="supporting";
    a.comparison={previous_assessment:previous,previous_hash:normalizeAssessment(previous).assessment_hash,reason:"Scope narrowed",scope_changes:[],movement_changes:[]};
    expect(errorCodes(a)).toContain("SCOPE_REVISION_REQUIRED");
    a.scope_record!.revision=2;expect(errorCodes(a)).toContain("SCOPE_CHANGE_REQUIRED");
  });
});
