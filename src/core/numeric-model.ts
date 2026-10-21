import { Ajv2020 } from "ajv/dist/2020.js";
import type { Assessment } from "./types.js";
import { isRecordedAssessment, recordState } from "./records.js";
import { validateRecords } from "./validate-records.js";
import { measureAssessment } from "./measure.js";
import { estimateAssessment } from "./estimate.js";
import type { LocalProfile } from "./evaluation.js";
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const id = { type: "integer", minimum: 0, maximum: 9999 };
const nullableId = { anyOf: [id, { type: "null" }] };
const array = (items: unknown, maxItems = 10000) => ({ type: "array", items, maxItems });
const bool = { type: "boolean" };
const modelProperties = {
  version: { enum: ["oes/remote-model/v1", "oes/remote-model/v2"] },
  unadopted_process_count: { type: "integer", minimum: 1, maximum: 1000 },
  analysis_complete: bool, partial: bool, applicability_limit: bool,
  users: id, stores: id, groups: array(id),
  processes: array(object({
    status: { enum: ["accepted", "unresolved"] }, trigger_user: id, trigger_group: id,
    movements: array(object({ type: { enum: ["Entry", "Exit", "Read", "Write"] }, group: id,
      peer: nullableId, store: nullableId, distinct: bool, variant: nullableId }), 1000)
  }), 1000)
};
// v2 adds only the number of unadopted processes whose trigger cannot be transported.
// No placeholder user/group or movement is invented. Existing v1 retains its exact shape.
export const modelSchema = { ...object(modelProperties), required:Object.keys(modelProperties).filter(k=>k!=="unadopted_process_count"),
  allOf:[{if:{properties:{version:{const:"oes/remote-model/v2"}}},then:{required:["unadopted_process_count"]},else:{not:{required:["unadopted_process_count"]}}}] };

/** Only enums, booleans and generated integers cross the OES boundary. */
export function projectModel(a: Assessment) {
  if (isRecordedAssessment(a) && validateRecords(a).length) throw new Error("INVALID_ASSESSMENT_RECORDS");
  const state = isRecordedAssessment(a) ? recordState(a) : null;
  const users = a.functional_users.map(u => u.user_id), stores = a.persistent_stores.map(s => s.store_id);
  const groups = a.data_groups.map(g => g.data_group_id);
  const objects = [...new Set(a.data_groups.map(g => g.object_of_interest_id))];
  const variants = [...new Set(a.functional_processes.flatMap(p => p.movements.map(v => v.semantic_variant_key)))];
  // v1 cannot encode an unknown trigger. Retain that unadopted function locally
  // with partial=true; never invent a group or movement to satisfy transport.
  const processes = a.functional_processes.filter(p => !state || p.status === "accepted"
    || p.movements.some(m => m.movement_id === p.trigger_movement_id));
  return {
    version: processes.length === a.functional_processes.length ? "oes/remote-model/v1" : "oes/remote-model/v2",
    ...(processes.length < a.functional_processes.length ? {unadopted_process_count:a.functional_processes.length-processes.length} : {}),
    analysis_complete: state?.analysis_complete ?? a.input.analysis_complete,
    partial: state?.partial ?? (a.components.some(c => c.status === "unresolved" || (c.status === "excluded" && c.scope_impact))
      || a.findings.some(f => f.severity === "blocking")),
    applicability_limit: a.findings.some(f => f.category === "applicability_limit")
      || (!isRecordedAssessment(a) && a.components.some(c => c.status === "excluded" && c.scope_impact && c.reason.toLowerCase().includes("applicability"))),
    users: users.length, stores: stores.length, groups: a.data_groups.map(g => objects.indexOf(g.object_of_interest_id)),
    processes: processes.map(p => ({ status: p.status,
      trigger_user: users.indexOf(p.trigger_user_id), trigger_group: groups.indexOf(p.movements.find(v => v.movement_id === p.trigger_movement_id)?.data_group_id ?? ""),
      movements: p.movements.map(m => ({ type: m.type, group: groups.indexOf(m.data_group_id),
        peer: m.peer_id === null ? null : users.indexOf(m.peer_id), store: m.store_id === null ? null : stores.indexOf(m.store_id),
        distinct: m.distinctness_basis !== "default" && !!m.distinctness_reason,
        variant: m.semantic_variant_key === null ? null : variants.indexOf(m.semantic_variant_key) })) }))
  };
}


export type NumericModel = ReturnType<typeof projectModel>;
const validModel = new Ajv2020({strict:false,ownProperties:true}).compile(modelSchema);
/** Deterministic calculation: no FX, network, clock or persistence. */
export function validateAndRecomputeNumericModel(model: unknown, profile: LocalProfile) {
  if (!validModel(model)) throw new Error("INVALID_REMOTE_MODEL");
  const m = model as NumericModel;
  let total = 0;
  for (const p of m.processes) {
    if (p.trigger_user >= m.users || p.trigger_group >= m.groups.length) throw new Error("INVALID_MODEL_REFERENCE");
    const seen = new Set<string>(), ooiSeen = new Set<string>();
    for (const v of p.movements) {
      if (++total > 10000) throw new Error("MODEL_TOO_LARGE");
      if (v.group >= m.groups.length) throw new Error("INVALID_MODEL_REFERENCE");
      const external = v.type === "Entry" || v.type === "Exit";
      if (external ? v.peer === null || v.peer >= m.users || v.store !== null
        : v.store === null || v.store >= m.stores || v.peer !== null) throw new Error("INVALID_MODEL_REFERENCE");
      const key = `${v.type}/${v.group}/${v.peer}/${v.store}/${v.variant}`;
      const ooi = `${v.type}/${m.groups[v.group]}`;
      if (seen.has(key) || (ooiSeen.has(ooi) && !v.distinct)) throw new Error("DUPLICATE_MOVEMENT");
      seen.add(key); ooiSeen.add(ooi);
    }
    if (p.status === "accepted" && (!p.movements.some(v => v.type === "Entry" && v.peer === p.trigger_user && v.group === p.trigger_group)
      || !p.movements.some(v => v.type === "Exit" || v.type === "Write"))) throw new Error("INVALID_ACCEPTED_PROCESS");
  }
  // Reuse counting/estimation only. No local totals, profile, paths or source are accepted.
  const measurement = measureAssessment({ input: { analysis_complete: m.analysis_complete }, components: [],
    findings: [...(m.partial ? [{ severity: "blocking" }] : []), ...(m.applicability_limit ? [{ category: "applicability_limit" }] : [])],
    functional_processes: m.processes } as unknown as Assessment);
  if (m.unadopted_process_count) {
    if (!m.partial || m.analysis_complete || m.processes.length+m.unadopted_process_count>1000) throw new Error("INVALID_REMOTE_MODEL");
    measurement.counts.total_processes += m.unadopted_process_count;
  }
  const estimation = estimateAssessment(measurement, { locale: "en-US", display_currency: "USD", benchmarkProfile: profile.benchmark, wageProfile: profile.wage });
  const report = { measurement, effort: estimation.effort, reference_usd: estimation.reference_usd, limitation_codes: estimation.limitation_codes };

  return report;
}
