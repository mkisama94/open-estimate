import type { Assessment, TargetRef } from "./types.js";
import type { ValidationErrorDetail } from "./validate.js";
import { isRecordedAssessment, processAffected, targetExists, targetKey } from "./records.js";
import { normalizeAssessment } from "./normalize.js";

export function validateRecords(a: Assessment): ValidationErrorDetail[] {
  if (!isRecordedAssessment(a)) return [];
  const errors: ValidationErrorDetail[] = [];
  const fail = (pointer: string, code: string, message: string) => errors.push({ pointer, code, message });
  const refs = (ids: string[], pointer: string) => {
    for (const id of ids) if (!a.evidence.some(e => e.evidence_id === id)) fail(pointer, "UNRESOLVED_REFERENCE", `Evidence ${id} not found`);
  };
  const unique = (ids: string[], pointer: string) => {
    if (new Set(ids).size !== ids.length) fail(pointer, "DUPLICATE_ID", "IDs must be unique");
  };
  const targets = (items: TargetRef[], pointer: string, model = a) => {
    unique(items.map(targetKey), pointer);
    for (const t of items) if (!targetExists(model,t)) fail(pointer, "UNRESOLVED_REFERENCE", `Target ${targetKey(t)} not found`);
  };
  const scope = a.scope_record!, candidates = a.function_candidates!, judgments = a.judgments!;
  unique(scope.confirmations.map(c => c.confirmation_id), "/scope_record/confirmations");
  unique(scope.files.map(f => f.path), "/scope_record/files");
  unique(candidates.map(c => c.candidate_id), "/function_candidates");
  unique(judgments.map(j => j.judgment_id), "/judgments");
  unique(a.findings.map(f => f.finding_id), "/findings");
  unique(a.input.manifest.files.map(f => f.path), "/input/manifest/files");
  for (const [i, f] of scope.files.entries()) {
    const ptr = `/scope_record/files/${i}`;
    const file = a.input.manifest.files.find(x=>x.path===f.path);
    if (!file) fail(ptr, "UNRESOLVED_REFERENCE", "Scope path not in snapshot");
    refs(f.evidence_refs,ptr);
    const confirmation = scope.confirmations.find(c => c.confirmation_id === f.confirmation_ref);
    if (f.confirmation_ref !== null && !confirmation) fail(ptr, "UNRESOLVED_REFERENCE", "Scope confirmation not found");
    // A reason string alone cannot relabel unread files outside to obtain completion.
    if (["outside","supporting"].includes(f.membership) && confirmation?.actor !== "user" && f.evidence_refs.length === 0)
      fail(ptr, "SCOPE_BASIS_REQUIRED", "Outside/supporting needs user scope confirmation or read evidence");
    if (f.membership === "included" && file?.disposition === "excluded") fail(ptr,"STATE_CONFLICT","Included file excluded by collector; scope reading cannot complete");
  }
  for (const [i,c] of candidates.entries()) {
    const ptr = `/function_candidates/${i}`;
    refs(c.evidence_refs,ptr);
    const component = a.components.find(x=>x.component_id===c.component_id);
    if (!component) fail(ptr,"UNRESOLVED_REFERENCE","Candidate component not found");
    const proc = a.functional_processes.find(p=>p.process_id===c.process_id);
    if (c.process_id !== null && (!proc || proc.component_id !== c.component_id)) fail(ptr,"UNRESOLVED_REFERENCE","Candidate process/component mismatch");
    if (c.disposition === "counted" && proc?.status !== "accepted") fail(ptr,"STATE_CONFLICT","Counted candidate needs accepted process");
    if (c.disposition === "unresolved" && proc?.status === "accepted") fail(ptr,"STATE_CONFLICT","Unadopted unresolved candidate cannot link an accepted process");
    if (["outside","merged"].includes(c.disposition) && c.process_id !== null) fail(ptr,"STATE_CONFLICT","Non-counted candidate cannot have its own process");
    if (c.disposition === "merged") {
      const seen = new Set([c.candidate_id]); let next: typeof c | undefined = c;
      while (next?.disposition === "merged") {
        const dest = candidates.find(x=>x.candidate_id===next!.merged_into);
        if (!dest || seen.has(dest.candidate_id)) { fail(ptr,"INVALID_MERGE_TARGET","Missing/cyclic merge destination"); break; }
        seen.add(dest.candidate_id); next=dest;
      }
      if (next && next.disposition !== "counted" && next.disposition !== "unresolved") fail(ptr,"INVALID_MERGE_TARGET","Merge must resolve to counted or unresolved candidate");
    } else if (c.merged_into !== null) fail(ptr,"STATE_CONFLICT","Only merged candidates may have a merge destination");
    if (!judgments.some(j=>j.targets.some(t=>t.kind==="candidate" && t.id===c.candidate_id))) fail(ptr,"JUDGMENT_REQUIRED","Every identified candidate needs a judgment");
    if (c.disposition === "outside" && !judgments.some(j=>j.kind==="not_counted" && j.targets.some(t=>t.kind==="candidate" && t.id===c.candidate_id))) fail(ptr,"STATE_CONFLICT","Outside candidate requires not_counted judgment");
    if (c.disposition === "unresolved" && !judgments.some(j=>j.status==="unresolved" && j.targets.some(t=>t.kind==="candidate" && t.id===c.candidate_id))) fail(ptr,"STATE_CONFLICT","Unadopted unresolved candidate requires unresolved judgment");
    if (c.disposition === "merged" && !judgments.some(j=>j.kind==="merge" && j.targets.some(t=>t.kind==="candidate" && t.id===c.candidate_id))) fail(ptr,"STATE_CONFLICT","Merged candidate requires merge judgment");
  }
  for (const [i,j] of judgments.entries()) {
    const ptr = `/judgments/${i}`; targets(j.targets,ptr); refs(j.evidence_refs,ptr);
    if (j.targets.some(t=>t.kind === "judgment")) fail(ptr,"INVALID_TARGET","Judgments must target model elements, not judgments");
    if (j.evidence_status === "missing" ? j.evidence_refs.length > 0 : j.evidence_refs.length === 0) fail(ptr,"STATE_CONFLICT","Evidence presence/status mismatch");
    if (j.status === "recorded" && (j.evidence_status !== "sufficient" || j.unresolved_points.length)) fail(ptr,"STATE_CONFLICT","Recorded judgment must have sufficient evidence and no open points");
    if (j.status !== "recorded" && !j.unresolved_points.length) fail(ptr,"UNRESOLVED_POINTS_REQUIRED","Pending judgment needs unresolved points");
    const affectsAccepted = a.functional_processes.some(p=>p.status==="accepted" && processAffected(a,p.process_id,j.targets));
    if (affectsAccepted && (j.status === "unresolved" || j.evidence_status === "missing" || !j.evidence_refs.some(id=>a.evidence.some(e=>e.evidence_id===id && ["source","schema","configuration"].includes(e.evidence_type)))))
      fail(ptr,"UNADOPTED_OR_UNSUPPORTED_JUDGMENT","Counted targets need recorded/provisional judgment with implementation evidence");
    if (affectsAccepted && j.kind === "not_counted") fail(ptr,"STATE_CONFLICT","Non-counted judgment targets an accepted model element");
  }
  for (const [i,p] of a.functional_processes.entries()) {
    const ptr = `/functional_processes/${i}/boundary`, b=p.boundary!;
    refs(b.evidence_refs,ptr);
    if (p.status === "accepted" && !a.function_candidates!.some(c=>c.disposition==="counted" && c.process_id===p.process_id)) fail(ptr,"CANDIDATE_REQUIRED","Accepted process needs counted candidate");
    if (b.functional_user_id !== p.trigger_user_id) fail(ptr,"STATE_CONFLICT","Boundary user must match trigger user");
    for (const id of b.judgment_refs) {
      const j=judgments.find(j=>j.judgment_id===id);
      if (!j || !j.targets.some(t=>t.kind==="process" && t.id===p.process_id)) fail(ptr,"UNRESOLVED_REFERENCE","Boundary judgment must target this process");
    }
    for (const m of p.movements) {
      const applicable=judgments.filter(j=>j.targets.some(t=>t.kind==="movement" && t.id===m.movement_id && t.process_id===p.process_id));
      if (p.status === "accepted" && !applicable.some(j=>j.status!=="unresolved" && j.kind!=="not_counted")) fail(ptr,"JUDGMENT_REQUIRED",`Counted movement ${m.movement_id} needs explicit judgment`);
      if (p.status === "accepted" && !m.evidence_refs.some(id=>a.evidence.some(e=>e.evidence_id===id && ["source","schema","configuration"].includes(e.evidence_type)))) fail(ptr,"IMPLEMENTATION_EVIDENCE_REQUIRED",`Movement ${m.movement_id} lacks implementation evidence`);
      if (p.status === "accepted" && !m.evidence_refs.some(id=>a.evidence.some(e=>e.evidence_id===id && scope.files.some(f=>f.path===e.file_path && f.membership==="included")))) fail(ptr,"SCOPE_EVIDENCE_REQUIRED",`Movement ${m.movement_id} needs evidence in the included scope`);
    }
  }
  for (const [i,g] of a.data_groups.entries()) {
    const d=g.definition!, ptr=`/data_groups/${i}/definition`; refs(d.evidence_refs,ptr);
    if (d.identifiers.length === 0 ? !d.no_identifier_reason : d.no_identifier_reason !== null) fail(ptr,"STATE_CONFLICT","Identifiers or reason for no identifiers required");
    const counted=a.functional_processes.some(p=>p.status==="accepted" && p.movements.some(m=>m.data_group_id===g.data_group_id));
    if (counted && d.unconfirmed.length && !judgments.some(j=>j.status==="provisional" && j.targets.some(t=>t.kind==="data_group" && t.id===g.data_group_id))) fail(ptr,"PROVISIONAL_JUDGMENT_REQUIRED","Counted data group with unconfirmed details needs explicit provisional judgment");
  }
  for (const [i,f] of a.findings.entries()) {
    const ptr=`/findings/${i}`; refs(f.evidence_refs,ptr); targets(f.targets!,ptr);
    const linked=judgments.filter(j=>f.targets!.some(t=>t.kind === "judgment" ? t.id===j.judgment_id : j.targets.some(x=>targetKey(x)===targetKey(t))));
    if (f.impact !== "explanation" && f.resolution === "open" && linked.some(j=>j.status==="recorded")) fail(ptr,"STATE_CONFLICT","Open impactful finding conflicts with recorded target judgment");
    if (f.resolution === "resolved" && linked.some(j=>j.status!=="recorded")) fail(ptr,"STATE_CONFLICT","Resolved finding conflicts with pending judgment");
  }
  if (a.comparison) {
    const c=a.comparison, prev=c.previous_assessment;
    if (normalizeAssessment(prev).assessment_hash !== c.previous_hash) fail("/comparison/previous_hash","BASELINE_HASH_MISMATCH","Previous saved assessment hash mismatch");
    if (prev.assessment_id === a.assessment_id && prev.scope_record?.scope_id === scope.scope_id && prev.scope_record.revision > scope.revision) fail("/scope_record/revision","STATE_CONFLICT","Scope revision cannot go backwards");
    const changedScope=prev.scope_record && (prev.scope_record.scope_id !== scope.scope_id || prev.scope_record.revision !== scope.revision);
    const membership = (model: Assessment) => JSON.stringify(model.scope_record?.files.map(f=>[f.path,f.membership]).sort((a,b)=>a[0].localeCompare(b[0])));
    if (prev.scope_record?.scope_id === scope.scope_id && prev.scope_record.revision === scope.revision && membership(prev) !== membership(a)) fail("/scope_record/revision","SCOPE_REVISION_REQUIRED","File membership changed without scope revision");
    if (changedScope && !c.scope_changes.length) fail("/comparison/scope_changes","SCOPE_CHANGE_REQUIRED","Changed scope requires mapping/reasons");
    if (c.scope_changes.length && prev.scope_record?.scope_id===scope.scope_id && prev.scope_record?.revision===scope.revision) fail("/scope_record/revision","SCOPE_REVISION_REQUIRED","Scope change requires new scope identity/revision");
    const usedBefore=new Set<string>(), usedAfter=new Set<string>();
    for (const [i,change] of c.movement_changes.entries()) {
      const ptr=`/comparison/movement_changes/${i}`;
      targets(change.before,ptr,prev); targets(change.after,ptr);
      if ([...change.before,...change.after].some(t=>t.kind!=="movement")) fail(ptr,"INVALID_CHANGE","Movement mappings must reference movements");
      const n=change.before.length, m=change.after.length;
      if ((change.kind==="add" && (n!==0 || m===0)) || (change.kind==="delete" && (n===0 || m!==0)) || (change.kind==="merge" && (n<2 || m!==1)) || (change.kind==="split" && (n!==1 || m<2)) || (change.kind==="retained" && (n!==1 || m!==1)) || (change.kind==="unmatched" && n+m===0)) fail(ptr,"INVALID_CHANGE","Change cardinality conflicts with kind");
      for (const [side,used] of [[change.before,usedBefore],[change.after,usedAfter]] as const) for(const t of side) { const k=targetKey(t); if(used.has(k)) fail(ptr,"DUPLICATE_MAPPING","Movement mapped twice"); used.add(k); }
      for (const id of change.judgment_refs) if (!judgments.some(j=>j.judgment_id===id)) fail(ptr,"UNRESOLVED_REFERENCE","Change judgment not found");
    }
    for (const change of c.scope_changes) { targets(change.before,"/comparison/scope_changes",prev); targets(change.after,"/comparison/scope_changes"); refs(change.evidence_refs,"/comparison/scope_changes"); }
  }
  return errors;
}
