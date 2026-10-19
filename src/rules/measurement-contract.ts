import { Ajv2020 } from "ajv/dist/2020.js";
import { jcsSha256 } from "../core/canonical.js";

export const CLIENT_PROTOCOL = "oes/measurement-client/v1";
export const COMPATIBILITY = { client_protocol: CLIENT_PROTOCOL, assessment_format: "oes/assessment/v2",
  model_format: "oes/remote-model/v1", engine_contract_id: "oes-cosmic-ph1-v1" } as const;
export interface RulesetRef { ruleset_id: "oes-measurement"; revision: string }
export interface RulesBundle {
  format: "oes/measurement-rules/v1"; ruleset_id: "oes-measurement";
  compatibility: { client_protocol: string; assessment_format: string; model_format: string; engine_contract_id: string };
  instructions_markdown: string; rule_ids: string[];
}
export interface RulesRegistry {
  format: "oes/measurement-rules-registry/v1"; rules_enforcement_at: string | null; current_revision: string | null;
  revisions: { revision: string; status: "available" | "withdrawn"; bundle: RulesBundle }[];
}
export const emptyRulesRegistry = (): RulesRegistry => ({ format: "oes/measurement-rules-registry/v1", rules_enforcement_at: null, current_revision: null, revisions: [] });
export const strictObject = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const identifier = { type: "string", minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9/_.-]+$" };
export const rulesetRefSchema = strictObject({ ruleset_id: { const: "oes-measurement" }, revision: hash });
export const rulesBundleSchema = strictObject({ format: { const: "oes/measurement-rules/v1" }, ruleset_id: { const: "oes-measurement" },
  compatibility: strictObject({ client_protocol: identifier, assessment_format: identifier, model_format: identifier, engine_contract_id: identifier }),
  instructions_markdown: { type: "string", minLength: 1 }, rule_ids: { type: "array", minItems: 1, maxItems: 1000, uniqueItems: true, items: { type: "string", pattern: "^OES-[A-Z]+-[0-9]{3}$" } } });
const ajv = new Ajv2020({ strict: false });
const validBundle = ajv.compile(rulesBundleSchema), validRef = ajv.compile(rulesetRefSchema);
export function normalizeRulesSource(text: string) { return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); }
export function extractRuleIds(text: string) {
  const ids = [...text.matchAll(/^#{1,6} (OES-[A-Z]+-[0-9]{3})(?:\s|$).*/gm)].map(m => m[1]);
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("INVALID_MEASUREMENT_RULES");
  const references = [...text.matchAll(/\bOES-[A-Z]+-[0-9]{3}\b/g)].map(m => m[0]);
  if (references.some(id => !ids.includes(id))) throw new Error("INVALID_MEASUREMENT_RULES");
  // Every normative heading must have a non-empty body.
  const sections = text.split(/^#{1,6} OES-[A-Z]+-[0-9]{3}[^\n]*\n/gm).slice(1);
  if (sections.some(body => !body.trim())) throw new Error("INVALID_MEASUREMENT_RULES");
  return ids.sort();
}
export function parseRulesetRef(ref: unknown): RulesetRef {
  if (!validRef(ref)) throw new Error("INVALID_RULESET_REF");
  return ref as unknown as RulesetRef;
}
export function validateRulesBundle(value: unknown, expected?: RulesetRef): RulesBundle {
  if (!validBundle(value)) throw new Error("INVALID_MEASUREMENT_RULES");
  const b = value as unknown as RulesBundle;
  if (b.instructions_markdown !== normalizeRulesSource(b.instructions_markdown)
    || Buffer.byteLength(b.instructions_markdown, "utf8") > 65536
    || Buffer.byteLength(JSON.stringify(b), "utf8") + 1024 > 131072
    || JSON.stringify(b.rule_ids) !== JSON.stringify(extractRuleIds(b.instructions_markdown))) throw new Error("INVALID_MEASUREMENT_RULES");
  const revision = jcsSha256(b);
  if (expected && (expected.ruleset_id !== b.ruleset_id || expected.revision !== revision)) throw new Error("RULESET_CHANGED");
  return b;
}
export function createRulesBundle(source: string, contract: Omit<RulesBundle, "instructions_markdown" | "rule_ids">) {
  const instructions_markdown = normalizeRulesSource(source);
  const bundle = validateRulesBundle({ ...contract, instructions_markdown, rule_ids: extractRuleIds(instructions_markdown) });
  return { bundle, ruleset_ref: { ruleset_id: "oes-measurement" as const, revision: jcsSha256(bundle) } };
}
export function assertCompatible(bundle: RulesBundle, protocol: string | null | undefined) {
  if (protocol !== CLIENT_PROTOCOL || Object.entries(COMPATIBILITY).some(([k, v]) => bundle.compatibility[k as keyof typeof COMPATIBILITY] !== v)) throw new Error("RULESET_INCOMPATIBLE");
}
export function validateRulesRegistry(registry: RulesRegistry, requireCurrent = false) {
  if (!registry || registry.format !== "oes/measurement-rules-registry/v1" || !Array.isArray(registry.revisions)
    || (registry.rules_enforcement_at !== null && (typeof registry.rules_enforcement_at !== "string" || !Number.isFinite(Date.parse(registry.rules_enforcement_at))))) throw new Error("INVALID_MEASUREMENT_RULES");
  const seen = new Set<string>();
  for (const r of registry.revisions) {
    parseRulesetRef({ ruleset_id: "oes-measurement", revision: r.revision });
    if (seen.has(r.revision) || !["available", "withdrawn"].includes(r.status)) throw new Error("INVALID_MEASUREMENT_RULES");
    seen.add(r.revision); validateRulesBundle(r.bundle, { ruleset_id: "oes-measurement", revision: r.revision });
  }
  if (registry.current_revision !== null && !registry.revisions.some(r => r.revision === registry.current_revision && r.status === "available")) throw new Error("RULESET_UNAVAILABLE");
  if (requireCurrent && !registry.current_revision) throw new Error("RULESET_UNAVAILABLE");
  return registry;
}
