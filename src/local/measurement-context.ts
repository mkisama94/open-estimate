import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { jcsSha256 } from "../core/canonical.js";
import { assertCompatible, CLIENT_PROTOCOL, rulesBundleSchema, rulesetRefSchema, strictObject, validateRulesBundle, type RulesBundle, type RulesetRef } from "../rules/measurement-contract.js";
import type { inspectSkillPackage } from "../profiles/skill-package.js";
import type { Assessment } from "../core/types.js";

type Integrity = ReturnType<typeof inspectSkillPackage>;
export interface BoundRules { format: "oes/measurement-rules-response/v1"; ruleset_ref: RulesetRef; bundle: RulesBundle; skill_integrity: Record<string, unknown> }
const responseSchema = strictObject({ format: { const: "oes/measurement-rules-response/v1" }, ruleset_ref: rulesetRefSchema, bundle: rulesBundleSchema,
  skill_integrity: strictObject({ status: { const: "MATCHED_CLIENT_REPORTED" }, skill_id: { const: "open-estimate-assessor" }, skill_version: { type: "string", maxLength: 64 },
    hash_rule: { const: "oes/skill-package/v1" }, package_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, policy_version: { const: "oes/skill-integrity-policy/v1" }, notice: { type: "string", maxLength: 1000 } }) });
const validateResponse = new Ajv2020({ strict: false }).compile(responseSchema);
export function validateBoundRules(value: unknown, integrity: Integrity): BoundRules {
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 131072 || !validateResponse(value)) throw new Error("RULESET_CHANGED");
  const response = value as unknown as BoundRules;
  validateRulesBundle(response.bundle, response.ruleset_ref); assertCompatible(response.bundle, CLIENT_PROTOCOL);
  if (["skill_id", "skill_version", "hash_rule", "package_sha256"].some(k => response.skill_integrity[k] !== integrity[k as keyof Integrity])) throw new Error("RULESET_CHANGED");
  return response;
}
export function requireBoundRules(state: { measurement_rules?: unknown; skill_integrity: Integrity }): BoundRules {
  if (!state.measurement_rules) throw new Error("RULESET_NOT_BOUND");
  try { return validateBoundRules(state.measurement_rules, state.skill_integrity); }
  catch { throw new Error("RULESET_CHANGED"); }
}
export function validateRuleReferences(assessment: Assessment, rules: BoundRules) {
  for (const judgment of assessment.judgments ?? []) {
    const rule = judgment.rule;
    if (rule.source === "skill" && (!rules.bundle.rule_ids.includes(rule.id) || rule.version !== rules.ruleset_ref.revision)) throw new Error("RULE_REFERENCE_MISMATCH");
  }
}
export async function writeContentAddressed(file: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + "\n";
  try { await fs.writeFile(file, text, { flag: "wx", mode: 0o600 }); }
  catch (e: any) {
    if (e.code !== "EEXIST") throw e;
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== Buffer.byteLength(text) || await fs.readFile(file, "utf8") !== text) throw new Error("RULESET_CHANGED");
  }
}
export async function saveMeasurementContext(dir: string, assessment_hash: string, rules: BoundRules) {
  const context = { domain: "oes/local-measurement-context/v1", assessment_hash, ruleset_ref: rules.ruleset_ref, bundle: rules.bundle };
  const context_hash = jcsSha256(context);
  const context_path = path.join(dir, `measurement-context-${context_hash}.json`);
  await writeContentAddressed(context_path, { ...context, context_hash });
  return { context_path, context_hash };
}
