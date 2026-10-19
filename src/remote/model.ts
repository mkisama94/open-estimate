import { Ajv2020 } from "ajv/dist/2020.js";
import type { Assessment } from "../core/types.js";
import { isRecordedAssessment, recordState } from "../core/records.js";
import { validateRecords } from "../core/validate-records.js";
import { measureAssessment } from "../core/measure.js";
import { estimateAssessment } from "../core/estimate.js";
import { createDisplayQuote } from "../core/display-quote.js";
import type { FixedEvaluation, LocalProfile } from "../core/evaluation.js";
import { jcsSha256 } from "../core/canonical.js";
import { frbProvider, CURRENCIES, type FxProvider } from "../profiles/frb.js";
import { checkSkillIntegrity, skillIntegritySchema, defaultRegistry, type SkillRegistry } from "./skill-integrity.js";
import { checkRulesetReference, clientRelease, defaultRulesRegistry, evaluationContextHash } from "./measurement-rules.js";
import { rulesetRefSchema, type RulesRegistry } from "../rules/measurement-contract.js";

const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const id = { type: "integer", minimum: 0, maximum: 9999 };
const nullableId = { anyOf: [id, { type: "null" }] };
const array = (items: unknown, maxItems = 10000) => ({ type: "array", items, maxItems });
const bool = { type: "boolean" };
export const modelSchema = object({
  version: { const: "oes/remote-model/v1" },
  analysis_complete: bool, partial: bool, applicability_limit: bool,
  users: id, stores: id, groups: array(id),
  processes: array(object({
    status: { enum: ["accepted", "unresolved"] }, trigger_user: id, trigger_group: id,
    movements: array(object({ type: { enum: ["Entry", "Exit", "Read", "Write"] }, group: id,
      peer: nullableId, store: nullableId, distinct: bool, variant: nullableId }), 1000)
  }), 1000)
});
export const remoteArgsSchema = { ...object({ model: modelSchema, display_currency: { enum: [...CURRENCIES] }, skill_integrity: skillIntegritySchema, ruleset_ref: rulesetRefSchema }), required: ["model", "display_currency"] };
const validate = new Ajv2020({ strict: false }).compile(remoteArgsSchema);

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
    version: "oes/remote-model/v1", analysis_complete: state?.analysis_complete ?? a.input.analysis_complete,
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

export async function evaluateRemote(args: unknown, profile: LocalProfile, provider: FxProvider = frbProvider, registry: SkillRegistry = defaultRegistry, now = Date.now(), rules: RulesRegistry = defaultRulesRegistry) {
  const skill_integrity = checkSkillIntegrity((args as any)?.skill_integrity, registry, now);
  const measurement_rules = checkRulesetReference((args as any)?.ruleset_ref, clientRelease((args as any)?.skill_integrity, registry), rules, now, skill_integrity);
  if (!validate(args)) throw new Error("INVALID_REMOTE_MODEL");
  const input = args as { model: ReturnType<typeof projectModel>; display_currency: string };
  const m = input.model;
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
  const estimation = estimateAssessment(measurement, { locale: "en-US", display_currency: "USD", benchmarkProfile: profile.benchmark, wageProfile: profile.wage });
  const report = { measurement, effort: estimation.effort, reference_usd: estimation.reference_usd, limitation_codes: estimation.limitation_codes };
  const report_hash = jcsSha256({ model: m, profile, report });
  const display_quote = await createDisplayQuote({ report, basis: profile, report_hash } as unknown as FixedEvaluation, provider, "en-US", input.display_currency);
  return { report, report_hash, evaluation_context_hash: evaluationContextHash(report_hash, measurement_rules.ruleset_ref), profile_set_id: profile.profile_set_id, display_quote,
    assurance: { input: "CLIENT_REPORTED", source_audit: "NOT_INDEPENDENTLY_VERIFIED", signed: false, persisted: false, published: false, skill_integrity, measurement_rules },
    notice: "受領した機能モデルにサーバーの計数規則とTEST換算基準を適用しました。ソースの実在性・網羅性・意味解釈は独立検証していません。" };
}
