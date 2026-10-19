import { Ajv2020 } from "ajv/dist/2020.js";
import { jcsSha256 } from "../core/canonical.js";
import { checkSkillIntegrity, defaultRegistry, skillIntegritySchema, type SkillRegistry } from "./skill-integrity.js";
import initialRules from "../../profiles/measurement-rules.json" with { type: "json" };
import { assertCompatible, CLIENT_PROTOCOL, parseRulesetRef, rulesetRefSchema, strictObject, validateRulesRegistry, type RulesRegistry, type RulesetRef } from "../rules/measurement-contract.js";

export const defaultRulesRegistry = initialRules as RulesRegistry;
export const measurementRulesArgsSchema = strictObject({ skill_integrity: skillIntegritySchema,
  client_protocol: { type: "string", minLength: 1, maxLength: 128 }, ruleset_ref: rulesetRefSchema }, ["skill_integrity", "client_protocol"]);
const validateRequest = new Ajv2020({ strict: false }).compile(measurementRulesArgsSchema);
export function clientRelease(integrity: unknown, skills: SkillRegistry) {
  const v = integrity as any;
  return skills.releases.find(r => r.skill_id === v?.skill_id && r.skill_version === v?.skill_version && r.package_sha256 === v?.package_sha256);
}
export function checkRulesetReference(ref: unknown, release: ReturnType<typeof clientRelease>, registry: RulesRegistry = defaultRulesRegistry, now = Date.now(), skillCheck?: ReturnType<typeof checkSkillIntegrity>) {
  validateRulesRegistry(registry);
  if (ref === undefined) {
    const unreportedLegacy = !release && skillCheck?.status === "LEGACY_UNCHECKED"
      && typeof skillCheck.enforcement_at === "string" && now < Date.parse(skillCheck.enforcement_at);
    const registeredLegacy = !!release && !release.measurement_client_protocol;
    if ((unreportedLegacy || registeredLegacy) && registry.rules_enforcement_at !== null && now < Date.parse(registry.rules_enforcement_at))
      return { status: "LEGACY_LOCAL_RULES", ruleset_ref: null, application: "NOT_INDEPENDENTLY_VERIFIED",
        notice: "旧方式のローカルルール。生成時の中央ルール版は不明です。対応プラグインで再解析してください。" };
    throw new Error("RULESET_REQUIRED");
  }
  const value = parseRulesetRef(ref);
  const r = registry.revisions.find(r => r.revision === value.revision);
  if (!r) throw new Error("RULESET_UNKNOWN");
  if (r.status === "withdrawn") throw new Error("RULESET_WITHDRAWN");
  assertCompatible(r.bundle, release?.measurement_client_protocol);
  return { status: "ACCEPTED_CLIENT_REPORTED", ruleset_ref: value, application: "NOT_INDEPENDENTLY_VERIFIED",
    notice: "申告された測定ルールの版を確認。AIによる適用の正確性は独立検証していません。モデル生成履歴の証明ではありません。" };
}
export function resolveMeasurementRules(request: unknown, rules: RulesRegistry = defaultRulesRegistry, skills: SkillRegistry = defaultRegistry, now = Date.now()) {
  if (!validateRequest(request)) throw new Error("INVALID_MEASUREMENT_RULES_REQUEST");
  const input = request as { skill_integrity: unknown; client_protocol: string; ruleset_ref?: RulesetRef };
  const skill_integrity = checkSkillIntegrity(input.skill_integrity, skills, now);
  if (skill_integrity.status !== "MATCHED_CLIENT_REPORTED") throw new Error("SKILL_INTEGRITY_REQUIRED");
  const release = clientRelease(input.skill_integrity, skills);
  if (input.client_protocol !== CLIENT_PROTOCOL || release?.measurement_client_protocol !== input.client_protocol) throw new Error("RULESET_INCOMPATIBLE");
  validateRulesRegistry(rules);
  if (!input.ruleset_ref && !rules.current_revision) throw new Error("RULESET_UNAVAILABLE");
  const ruleset_ref = input.ruleset_ref ?? { ruleset_id: "oes-measurement" as const, revision: rules.current_revision! };
  checkRulesetReference(ruleset_ref, release, rules, now);
  const bundle = rules.revisions.find(r => r.revision === ruleset_ref.revision)!.bundle;
  const response = { format: "oes/measurement-rules-response/v1" as const, ruleset_ref, bundle, skill_integrity };
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > 131072) throw new Error("RULESET_UNAVAILABLE");
  return response;
}
export function evaluationContextHash(report_hash: string, ruleset_ref: RulesetRef | null) {
  return ruleset_ref ? jcsSha256({ domain: "oes/evaluation-context/v1", report_hash, ruleset_ref }) : null;
}
