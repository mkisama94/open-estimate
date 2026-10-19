import { expect, it } from "vitest";
import { withQuality } from "../fixtures/quality.js";
import { target } from "../fixtures/recorded.js";
import { validateAssessment, SemanticValidationError } from "../../src/core/validate.js";
import { recordState } from "../../src/core/records.js";
import { measureAssessment } from "../../src/core/measure.js";
import { projectModel } from "../../src/remote/model.js";
import { evaluateRemote } from "../fixtures/skill-policy.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { normalizeAssessment } from "../../src/core/normalize.js";

function limited(impact: "outside" | "in_scope" | "unknown") {
  const a=withQuality();a.input.analysis_complete=false;
  a.input.manifest.files.push({path:"generated/large.js",sha256:"0".repeat(64),bytes:3000000,line_count:0,disposition:"excluded",exclusion_reason:"FILE_SIZE_LIMIT"});
  a.input.acquisition!.issues=[{path:"generated/large.js",cause:"FILE_SIZE_LIMIT"}];
  a.scope_record!.files.push({path:"generated/large.js",membership:impact==="outside"?"outside":impact==="in_scope"?"included":"unresolved",reason:"Declared build output",confirmation_ref:"scope-confirmed",evidence_refs:[]});
  a.quality!.scope_rules.push({rule_id:"generated",path_prefix:"generated",membership:impact==="outside"?"outside":"included",reason:"Explicit scope decision"});
  a.quality!.limitations.push({path:"generated/large.js",cause:"FILE_SIZE_LIMIT",impact,rule_id:impact==="unknown"?null:"generated",reason:"Collector limit mapped to declared scope",missing:impact==="unknown"?"Unknown whether generated output contains application behavior":null});
  return a;
}
it("separates acquisition from scope completion and keeps local/remote counting identical",async()=>{
  for (const impact of ["outside","in_scope","unknown"] as const) {
    const a=limited(impact);validateAssessment(a);
    const measurement=measureAssessment(a);expect(measurement.status).toBe(impact==="outside"?"COMPLETE":"PARTIAL");
    expect(recordState(a).scan_complete).toBe(false);
    const remote=await evaluateRemote({model:projectModel(a),display_currency:"USD"},getLocalProfile());
    expect(remote.report.measurement).toEqual(measurement);
    if(impact!=="outside")expect(recordState(a).partial_reasons.join()).toContain("generated/large.js");
  }
  const a=limited("outside");a.input.acquisition!.discovery_complete=false;
  expect(measureAssessment(validateAssessment(a)).status).toBe("PARTIAL");
});
it("rejects claimed outside paths conflicting with rules and concrete record gaps/references",()=>{
  const a=limited("outside");a.quality!.scope_rules.pop();expect(()=>validateAssessment(a)).toThrow();
  const b=withQuality();b.quality!.attributes[0].mappings=[];expect(()=>validateAssessment(b)).toThrow();
  b.quality!.attributes[0].mappings=[{attribute:b.data_groups[0].attributes[0],implementation:"notes.id",evidence_refs:["nonexistent"]}];
  expect(()=>validateAssessment(b)).toThrow();
  const c=withQuality();c.quality!.boundaries[0].process_id="nonexistent";expect(()=>validateAssessment(c)).toThrow();
  const d=withQuality();d.quality!.limitations.push({path:"../escape",cause:"size",impact:"outside",rule_id:null,reason:"text",missing:null});expect(()=>validateAssessment(d)).toThrow();
});
it("stores alternative integration/split interpretations without manufacturing an answer",()=>{
  const a=withQuality(),b=structuredClone(a);
  a.judgments![0].kind="merge";a.judgments![0].interpretation="Manual retry continues original request";
  b.judgments![0].kind="split";b.judgments![0].interpretation="Timer starts a distinct result request";
  for(const x of [a,b]){x.judgments![0].status="provisional";x.judgments![0].unresolved_points=["Confirm requester and completion boundary"];validateAssessment(x);}
  expect(normalizeAssessment(a).assessment_hash).not.toBe(normalizeAssessment(b).assessment_hash);
});
it("warns about queue notification/read overlap while requiring boundary and rule records",()=>{
  const a=withQuality(),p=a.functional_processes[0];
  a.persistent_stores.push({store_id:"queue",name:"Internal work",storage_type:"queue",description:"Internal application store"});
  const read=p.movements.find(m=>m.type==="Read")??p.movements.find(m=>m.type==="Write")!;read.type="Read";read.store_id="queue";
  const entry=p.movements.find(m=>m.type==="Entry")!;
  a.quality!.boundaries[0].queues=[{store_id:"queue",boundary:"inside",rule:"Notification and durable retrieval reviewed separately",reason:"Application-owned queue",movement_refs:[target("movement",entry.movement_id,p.process_id),target("movement",read.movement_id,p.process_id)],duplicate_review:"Content may repeat; requires semantic review",unresolved:[]}];
  // Structural queue review is separate from accepted-process validity.
  expect(recordState(a).quality_warnings.some(w=>w.code==="QUEUE_NOTIFICATION_READ_REVIEW")).toBe(true);
});
it("deployment observations do not change size; implementation uncertainty does",()=>{
  const a=withQuality();
  a.findings.push({finding_id:"deployment",category:"ambiguity",severity:"warning",message:"Generated config exists, deployment not checked",evidence_refs:[],targets:[],impact:"explanation",resolution:"open"});
  a.quality!.findings.push({finding_id:"deployment",subject:"deployment"});
  const before=measureAssessment(validateAssessment(a));expect(before.status).toBe("COMPLETE");
  a.findings[0].impact="boundary";expect(()=>validateAssessment(a)).toThrow(SemanticValidationError);
  a.quality!.findings[0].subject="implementation";
  expect(measureAssessment(validateAssessment(a)).status).toBe("PARTIAL");
});
it("deduplicates provisional process subtotal and reports unadopted unresolved as null",()=>{
  const a=withQuality();for(const j of a.judgments!){j.status="provisional";j.unresolved_points=["Review boundary"];}a.judgments!.push({...a.judgments![0],judgment_id:"overlap"});
  const state=recordState(validateAssessment(a));expect(state.provisional_cfp_subtotal).toBe(measureAssessment(a).cfp);
  expect(recordState(withQuality()).quality_version).toBe("oes/quality-records/v1");
  const old=withQuality();delete old.quality;expect(recordState(validateAssessment(old)).quality_warnings).toContainEqual({code:"QUALITY_RECORDS_MISSING",target:old.assessment_id});
});
