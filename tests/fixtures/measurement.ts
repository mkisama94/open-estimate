import fs from "node:fs";
import { createRulesBundle, type RulesRegistry, CLIENT_PROTOCOL } from "../../src/rules/measurement-contract.js";
import { resolveMeasurementRules } from "../../src/remote/measurement-rules.js";
import type { SkillRegistry } from "../../src/remote/skill-integrity.js";

export const generatedRules = createRulesBundle(fs.readFileSync("rules/measurement/source.md", "utf8"), JSON.parse(fs.readFileSync("rules/measurement/contract.json", "utf8")));
export function measurementRegistry(): RulesRegistry {
  return { format: "oes/measurement-rules-registry/v1", rules_enforcement_at: "2100-01-01T00:00:00Z", current_revision: generatedRules.ruleset_ref.revision,
    revisions: [{ revision: generatedRules.ruleset_ref.revision, status: "available", bundle: structuredClone(generatedRules.bundle) }] };
}
export function skillRegistry(integrity: any, protocol: string | null = CLIENT_PROTOCOL): SkillRegistry {
  const { format, ...release } = integrity;
  return { policy_version: "oes/skill-integrity-policy/v1", enforcement_at: "2100-01-01T00:00:00Z",
    releases: [{ ...release, publication: "published", acceptance: "accepted", measurement_client_protocol: protocol }] };
}
export function responseFor(integrity: unknown, rules = measurementRegistry()) {
  return resolveMeasurementRules({ skill_integrity: integrity, client_protocol: CLIENT_PROTOCOL }, rules, skillRegistry(integrity));
}
export function bindRules(run: (command: string, input: any, ok?: boolean) => any, common: any) {
  const response = responseFor(run("skill-integrity", {}));
  run("bind-rules", { ...common, rules_response: response }); return response;
}
export function setRuleReferences(assessment: any, revision = generatedRules.ruleset_ref.revision) {
  for (const j of assessment.judgments ?? []) if (j.rule.source === "skill") j.rule = { source: "skill", id: "OES-MEASURE-001", version: revision };
}
