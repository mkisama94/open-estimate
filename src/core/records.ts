import type { Assessment, TargetRef } from "./types.js";
import { operationalFinding, qualityWarnings } from "./quality.js";

export const isRecordedAssessment = (a: Assessment) => a.format_version === "oes/assessment/v2";
export const targetKey = (t: TargetRef) => JSON.stringify([t.kind, t.process_id, t.id]);
export function targetExists(a: Assessment, t: TargetRef): boolean {
  if (t.kind === "movement") return a.functional_processes.some(p => p.process_id === t.process_id && p.movements.some(m => m.movement_id === t.id));
  if (t.process_id !== null) return false;
  if (t.kind === "candidate") return !!a.function_candidates?.some(c => c.candidate_id === t.id);
  if (t.kind === "process") return a.functional_processes.some(p => p.process_id === t.id);
  if (t.kind === "judgment") return !!a.judgments?.some(j => j.judgment_id === t.id);
  return a.data_groups.some(g => g.data_group_id === t.id);
}
export function processAffected(a: Assessment, id: string, targets: TargetRef[]): boolean {
  const p = a.functional_processes.find(p => p.process_id === id)!;
  return targets.some(t => t.kind === "process" ? t.id === id
    : t.kind === "movement" ? t.process_id === id
    : t.kind === "candidate" ? a.function_candidates?.find(c => c.candidate_id === t.id)?.process_id === id
    : t.kind === "data_group" && p.movements.some(m => m.data_group_id === t.id));
}

/** Completion describes the declared scope, never semantic correctness. Scan state stays independent. */
export function recordState(a: Assessment) {
  const legacy = !isRecordedAssessment(a);
  const files = a.input.manifest.files;
  const membership = new Map(a.scope_record?.files.map(f => [f.path, f.membership]));
  const unread = (kind: string) => files.filter(f => membership.get(f.path) === kind && f.disposition === "unread").map(f => f.path);
  const inScopeUnread = legacy ? files.filter(f => f.disposition === "unread").map(f => f.path) : files.filter(f => membership.get(f.path) === "included" && ["unread", "excluded"].includes(f.disposition)).map(f => f.path);
  const unknownFiles = legacy ? [] : files.filter(f => !membership.has(f.path) || membership.get(f.path) === "unresolved").map(f => f.path);
  const candidates = a.function_candidates ?? [];
  const unresolvedCandidates = candidates.filter(c => c.disposition === "unresolved");
  const pendingJudgments = (a.judgments ?? []).filter(j => j.status !== "recorded" || j.evidence_status !== "sufficient");
  const provisional = a.functional_processes.filter(p => p.status === "accepted" && pendingJudgments.some(j => processAffected(a, p.process_id, j.targets)));
  const openFindings = a.findings.filter(f => legacy ? f.severity === "blocking" : f.resolution === "open" && f.impact !== "explanation" && !operationalFinding(a,f.finding_id));
  const unconfirmedGroups = a.data_groups.filter(g => g.definition?.unconfirmed.length);
  const missingCandidates = legacy ? [] : a.functional_processes.filter(p => !candidates.some(c => c.process_id === p.process_id));
  const reasons = [
    ...(!a.input.analysis_complete && (!a.quality || !a.input.acquisition?.discovery_complete) ? ["SCAN_INCOMPLETE_SCOPE_IMPACT_UNKNOWN"] : []),
    ...(a.quality?.limitations.filter(l => l.impact !== "outside").map(l => `ACQUISITION_${l.impact.toUpperCase()}:${l.path}`) ?? []),
    ...inScopeUnread.map(id => `IN_SCOPE_UNREAD:${id}`), ...unknownFiles.map(id => `FILE_SCOPE_UNRESOLVED:${id}`),
    ...unresolvedCandidates.map(c => `CANDIDATE_UNRESOLVED:${c.candidate_id}`),
    ...missingCandidates.map(p => `PROCESS_CANDIDATE_MISSING:${p.process_id}`),
    ...pendingJudgments.map(j => `JUDGMENT_${j.status.toUpperCase()}:${j.judgment_id}`),
    ...unconfirmedGroups.map(g => `DATA_GROUP_UNCONFIRMED:${g.data_group_id}`),
    ...a.functional_processes.filter(p => p.status === "unresolved").map(p => `PROCESS_UNRESOLVED:${p.process_id}`),
    ...a.components.filter(c => c.status === "unresolved" || (c.status === "excluded" && c.scope_impact)).map(c => `COMPONENT_SCOPE_IMPACT:${c.component_id}`),
    ...openFindings.map(f => `FINDING_OPEN:${f.finding_id}`)
  ];
  return {
    format: legacy ? "LEGACY_JUDGMENT_RECORDS_MISSING" : "RECORDED_V2",
    format_notice: legacy ? "旧形式・判断記録不足。旧数値とhashを保持し、新要件適合とは扱いません。" : "範囲・候補・判断を記録する形式です。意味解釈の正しさは保証しません。",
    scan_complete: a.input.analysis_complete,
    quality_version: a.quality?.version ?? null,
    quality_warnings: qualityWarnings(a),
    acquisition_limitations: a.quality?.limitations ?? null,
    analysis_complete: reasons.length === 0,
    partial: reasons.length > 0,
    partial_reasons: reasons,
    in_scope_unread: inScopeUnread,
    outside_unread: unread("outside"), supporting_unread: unread("supporting"), scope_unknown_files: unknownFiles,
    candidate_counts: { identified: candidates.length, counted: candidates.filter(c => c.disposition === "counted").length,
      outside: candidates.filter(c => c.disposition === "outside").length, merged: candidates.filter(c => c.disposition === "merged").length,
      unresolved: unresolvedCandidates.length },
    provisional_processes: provisional.map(p => ({ process_id: p.process_id, cfp: p.movements.length })),
    provisional_cfp_subtotal: provisional.reduce((n, p) => n + p.movements.length, 0),
    pending_judgments: pendingJudgments.map(j=>({ judgment_id:j.judgment_id, status:j.status, evidence_status:j.evidence_status, unresolved_points:j.unresolved_points })),
    record_gaps: legacy ? ["LEGACY_JUDGMENT_RECORDS_MISSING"] : [
      ...(!a.quality ? ["QUALITY_RECORDS_MISSING"] : []),
      ...pendingJudgments.filter(j=>j.evidence_status!=="sufficient").map(j=>`EVIDENCE_${j.evidence_status.toUpperCase()}:${j.judgment_id}`),
      ...missingCandidates.map(p=>`PROCESS_CANDIDATE_MISSING:${p.process_id}`)
    ],
    unresolved_processes: a.functional_processes.filter(p => p.status === "unresolved").map(p => ({ process_id: p.process_id, cfp: null })),
    unresolved_candidates: unresolvedCandidates.map(c => ({ candidate_id: c.candidate_id, cfp: null })),
    excluded_candidates: candidates.filter(c => c.disposition === "outside"),
    notice: "暫定CFP小計は合計の内数で、誤差幅ではありません。未採用機能の規模は未確定です。読取・記録の完了は意味解釈の独立監査ではありません。"
  };
}

export function comparisonSummary(a: Assessment) {
  if (!a.comparison) return null;
  const previous = a.comparison.previous_assessment;
  const movements = (model: Assessment) => model.functional_processes.flatMap(p => p.movements.map(m => ({
    key: targetKey({ kind: "movement", process_id: p.process_id, id: m.movement_id }), cfp: p.status === "accepted" ? 1 : 0
  })));
  const before = movements(previous), after = movements(a);
  const counted = (items: typeof before, targets: TargetRef[]) => items.filter(m => targets.some(t => targetKey(t) === m.key)).reduce((n,m) => n + m.cfp,0);
  const changes = a.comparison.movement_changes.map(c => ({ ...c, cfp_delta: c.kind === "unmatched" ? null : counted(after,c.after) - counted(before,c.before) }));
  const covered = (side: "before" | "after", items: typeof before) => items.filter(m => !changes.some(c => c[side].some(t => targetKey(t) === m.key)));
  const totalDelta = a.functional_processes.some(p=>p.status==="accepted") && previous.functional_processes.some(p=>p.status==="accepted")
    ? after.reduce((n,m) => n+m.cfp,0) - before.reduce((n,m) => n+m.cfp,0) : null;
  const explainedDelta = changes.reduce((n,c) => n+(c.cfp_delta ?? 0),0);
  return { previous_scope: previous.scope_record ? { scope_id: previous.scope_record.scope_id, revision: previous.scope_record.revision } : null,
    current_scope: a.scope_record ? { scope_id: a.scope_record.scope_id, revision: a.scope_record.revision } : null,
    scope_changes: a.comparison.scope_changes, movements: changes, cfp_delta: totalDelta, explained_cfp_delta: explainedDelta,
    unexplained_cfp_delta: totalDelta === null ? null : totalDelta-explainedDelta,
    unmapped_before: covered("before",before).map(m=>m.key), unmapped_after: covered("after",after).map(m=>m.key),
    notice: "IDや配列順から同一性を推定しません。対応記録のない移動とunmatchedは比較未確定です。" };
}
