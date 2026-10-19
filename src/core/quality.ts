import type { Assessment } from "./types.js";
import type { ValidationErrorDetail } from "./validate.js";
import { targetExists } from "./records.js";

export const under = (p: string, prefix: string) => prefix === "." || p === prefix || p.startsWith(prefix + "/");
const safe = (p: string) => p === "." || (!p.startsWith("/") && !p.includes("\\") && !p.includes(":") && p.split("/").every(x => x && x !== "." && x !== ".."));
export function operationalFinding(a: Assessment, id: string) {
  return a.quality?.findings.some(f => f.finding_id === id && ["deployment", "production"].includes(f.subject)) ?? false;
}
export function validateQuality(a: Assessment): ValidationErrorDetail[] {
  if (!a.quality) return [];
  const q = a.quality, errors: ValidationErrorDetail[] = [];
  const fail = (code: string, message: string) => errors.push({ pointer: "/quality", code, message });
  const unique = (values: string[]) => { if (new Set(values).size !== values.length) fail("DUPLICATE_ID", "Duplicate quality record"); };
  unique(q.scope_rules.map(r => r.rule_id)); unique(q.scope_rules.map(r => r.path_prefix));
  unique(q.limitations.map(r => r.path)); unique(q.boundaries.map(r => r.process_id));
  unique(q.attributes.map(r => r.data_group_id)); unique(q.findings.map(r => r.finding_id));
  for (const r of q.scope_rules) if (!safe(r.path_prefix)) fail("INVALID_PATH", r.path_prefix);
  const ruleFor = (p: string) => q.scope_rules.filter(r => under(p,r.path_prefix)).sort((a,b) => b.path_prefix.length-a.path_prefix.length)[0];
  for (const f of a.scope_record!.files) {
    const r = ruleFor(f.path);
    if (f.membership !== "unresolved" && (!r || r.membership !== f.membership)) fail("SCOPE_RULE_CONFLICT", f.path);
  }
  const issues = a.input.acquisition!.issues;
  for (const issue of issues) if (!q.limitations.some(l => l.path === issue.path && l.cause === issue.cause)) fail("LIMITATION_REQUIRED", issue.path);
  for (const l of q.limitations) {
    if (!safe(l.path)) fail("INVALID_PATH", l.path);
    if (!issues.some(i => i.path === l.path && i.cause === l.cause)) fail("UNRESOLVED_REFERENCE", `Acquisition issue ${l.path}`);
    const rule = ruleFor(l.path);
    if (l.rule_id !== null && !q.scope_rules.some(r => r.rule_id === l.rule_id)) fail("UNRESOLVED_REFERENCE", "Scope rule");
    if (l.impact === "outside" && (!rule || rule.rule_id !== l.rule_id || rule.membership !== "outside"
      || a.scope_record!.files.some(f => under(f.path,l.path) && f.membership !== "outside"))) fail("SCOPE_RULE_CONFLICT", l.path);
    if (l.impact === "in_scope" && (!rule || rule.rule_id !== l.rule_id || rule.membership !== "included")) fail("SCOPE_RULE_CONFLICT", l.path);
    if (l.impact === "unknown" && !l.missing?.trim()) fail("MISSING_DETAIL", "Unknown impact requires concrete missing information");
  }
  for (const p of a.functional_processes) if (!q.boundaries.some(b => b.process_id === p.process_id)) fail("BOUNDARY_REQUIRED",p.process_id);
  for (const b of q.boundaries) {
    const p = a.functional_processes.find(p => p.process_id === b.process_id);
    if (!p) fail("UNRESOLVED_REFERENCE",b.process_id);
    if ((b.rerun === "unknown" || b.continuation === "unknown") && !p?.boundary?.judgment_refs.some(id =>
      a.judgments?.some(j => j.judgment_id === id && j.status !== "recorded"
        && j.targets.some(t => t.kind === "process" && t.id === b.process_id)))) {
      fail("PROVISIONAL_JUDGMENT_REQUIRED", `Unknown rerun/continuation requires a pending boundary judgment for ${b.process_id}`);
    }
    unique(b.queues.map(x => x.store_id));
    for (const m of p?.movements ?? []) if (a.persistent_stores.some(s => s.store_id === m.store_id && s.storage_type === "queue")
      && !b.queues.some(x => x.store_id === m.store_id)) fail("QUEUE_REVIEW_REQUIRED",m.movement_id);
    for (const queue of b.queues) {
      if (!a.persistent_stores.some(s => s.store_id === queue.store_id && s.storage_type === "queue")) fail("UNRESOLVED_REFERENCE",queue.store_id);
      for (const t of queue.movement_refs) if (t.kind !== "movement" || t.process_id !== b.process_id || !targetExists(a,t)) fail("UNRESOLVED_REFERENCE",t.id);
      if (queue.boundary === "unknown" && !queue.unresolved.length) fail("MISSING_DETAIL", "Unknown queue boundary");
      if (queue.unresolved.length && !a.judgments?.some(j => j.status !== "recorded" && j.targets.some(t => (t.kind === "process" && t.id === b.process_id) || (t.kind === "movement" && t.process_id === b.process_id)))) fail("PROVISIONAL_JUDGMENT_REQUIRED", b.process_id);
    }
  }
  for (const g of a.data_groups) {
    const mapping = q.attributes.find(x => x.data_group_id === g.data_group_id);
    if (!mapping) { fail("ATTRIBUTE_MAPPING_REQUIRED",g.data_group_id); continue; }
    unique(mapping.mappings.map(m => m.attribute));
    for (const attribute of g.attributes) if (!mapping.mappings.some(m => m.attribute === attribute)) fail("ATTRIBUTE_MAPPING_REQUIRED",`${g.data_group_id}/${attribute}`);
  }
  for (const row of q.attributes) for (const m of row.mappings) {
    if (!a.data_groups.some(g => g.data_group_id === row.data_group_id && g.attributes.includes(m.attribute))) fail("UNRESOLVED_REFERENCE",m.attribute);
    for (const ref of m.evidence_refs) if (!a.evidence.some(e => e.evidence_id === ref && ["source","schema","configuration"].includes(e.evidence_type))) fail("UNRESOLVED_REFERENCE",ref);
  }
  for (const f of a.findings) if (!q.findings.some(x => x.finding_id === f.finding_id)) fail("FINDING_SUBJECT_REQUIRED",f.finding_id);
  for (const f of q.findings) {
    const finding = a.findings.find(x => x.finding_id === f.finding_id);
    if (!finding) fail("UNRESOLVED_REFERENCE",f.finding_id);
    if (operationalFinding(a,f.finding_id) && finding?.impact !== "explanation") fail("STATE_CONFLICT", "Deployment/production observations must use explanation impact; record implementation uncertainty separately");
  }
  return errors;
}

/** Heuristics are warnings, never correctness claims or text-length gates. */
export function qualityWarnings(a: Assessment) {
  const warnings: Array<{code:string; target:string}> = [];
  if (!a.quality) warnings.push({code:"QUALITY_RECORDS_MISSING",target:a.assessment_id});
  const generic = /同名または対応|corresponding fields|same.?named|適切な属性/i;
  for (const g of a.data_groups) if (generic.test(g.definition?.attribute_mapping ?? "") || a.quality?.attributes.some(x => x.data_group_id === g.data_group_id && x.mappings.some(m => generic.test(m.implementation)))) warnings.push({code:"ATTRIBUTE_MAPPING_VAGUE",target:g.data_group_id});
  const texts = (a.judgments ?? []).map(j => j.application_reason);
  for (const j of a.judgments ?? []) if (texts.filter(t => t === j.application_reason).length > 1) warnings.push({code:"REPEATED_REASON_REVIEW",target:j.judgment_id});
  for (const b of a.quality?.boundaries ?? []) for (const queue of b.queues) {
    const p = a.functional_processes.find(p => p.process_id === b.process_id);
    const moves = p?.movements.filter(m => queue.movement_refs.some(t => t.id === m.movement_id)) ?? [];
    if (moves.some(m => m.type === "Entry") && moves.some(m => m.type === "Read")) warnings.push({code:"QUEUE_NOTIFICATION_READ_REVIEW",target:b.process_id});
  }
  return warnings;
}
