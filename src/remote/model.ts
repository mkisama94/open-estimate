import { Ajv2020 } from "ajv/dist/2020.js";
import { createDisplayQuote } from "../core/display-quote.js";
import type { FixedEvaluation, LocalProfile } from "../core/evaluation.js";
import { jcsSha256 } from "../core/canonical.js";
import { frbProvider, CURRENCIES, type FxProvider } from "../profiles/frb.js";
import { checkSkillIntegrity, skillIntegritySchema, defaultRegistry, type SkillRegistry } from "./skill-integrity.js";
import { checkRulesetReference, clientRelease, defaultRulesRegistry, evaluationContextHash } from "./measurement-rules.js";
import { rulesetRefSchema, type RulesRegistry } from "../rules/measurement-contract.js";

import { modelSchema, validateAndRecomputeNumericModel } from "../core/numeric-model.js";
import type { projectModel } from "../core/numeric-model.js";
export { modelSchema, projectModel } from "../core/numeric-model.js";
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const remoteArgsSchema = { ...object({ model: modelSchema, display_currency: { enum: [...CURRENCIES] }, skill_integrity: skillIntegritySchema, ruleset_ref: rulesetRefSchema }), required: ["model", "display_currency"] };
const validate = new Ajv2020({ strict: false }).compile(remoteArgsSchema);

export async function evaluateRemote(args: unknown, profile: LocalProfile, provider: FxProvider = frbProvider, registry: SkillRegistry = defaultRegistry, now = Date.now(), rules: RulesRegistry = defaultRulesRegistry) {
  const skill_integrity = checkSkillIntegrity((args as any)?.skill_integrity, registry, now);
  const measurement_rules = checkRulesetReference((args as any)?.ruleset_ref, clientRelease((args as any)?.skill_integrity, registry), rules, now, skill_integrity);
  if (!validate(args)) throw new Error("INVALID_REMOTE_MODEL");
  const input = args as { model: ReturnType<typeof projectModel>; display_currency: string };
  const m = input.model;
  const report = validateAndRecomputeNumericModel(m, profile);
  const report_hash = jcsSha256({ model: m, profile, report });
  const display_quote = await createDisplayQuote({ report, basis: profile, report_hash } as unknown as FixedEvaluation, provider, "en-US", input.display_currency);
  return { report, report_hash, evaluation_context_hash: evaluationContextHash(report_hash, measurement_rules.ruleset_ref), profile_set_id: profile.profile_set_id, display_quote,
    assurance: { input: "CLIENT_REPORTED", source_audit: "NOT_INDEPENDENTLY_VERIFIED", signed: false, persisted: false, published: false, skill_integrity, measurement_rules },
    notice: "受領した機能モデルにサーバーの計数規則とTEST換算基準を適用しました。ソースの実在性・網羅性・意味解釈は独立検証していません。" };
}
