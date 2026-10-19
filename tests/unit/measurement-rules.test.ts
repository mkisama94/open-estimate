import { describe, it, expect } from "vitest";
import { createRulesBundle, normalizeRulesSource, validateRulesBundle, validateRulesRegistry, extractRuleIds, CLIENT_PROTOCOL, COMPATIBILITY } from "../../src/rules/measurement-contract.js";
import { checkRulesetReference, resolveMeasurementRules } from "../../src/remote/measurement-rules.js";
import { evaluateRemote, projectModel } from "../../src/remote/model.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { generatedRules, measurementRegistry, skillRegistry } from "../fixtures/measurement.js";
import { jcsSha256 } from "../../src/core/canonical.js";
import worker from "../../src/remote/worker.js";
import fs from "node:fs";
const integrity = { format: "oes/skill-integrity/v1", skill_id: "open-estimate-assessor", skill_version: "0.7.0", hash_rule: "oes/skill-package/v1", package_sha256: "a".repeat(64) };
const request = () => ({ skill_integrity: integrity, client_protocol: CLIENT_PROTOCOL });
const contract = { format: "oes/measurement-rules/v1" as const, ruleset_id: "oes-measurement" as const, compatibility: COMPATIBILITY };
const model = projectModel(JSON.parse(fs.readFileSync("examples/basic-assessment.json", "utf8")));
const args = () => ({ model, skill_integrity: integrity, display_currency: "USD", ruleset_ref: generatedRules.ruleset_ref });

describe("immutable measurement bundle", () => {
  it("normalizes BOM and line endings, hashes only content, and separates compatibility", () => {
    const a = createRulesBundle("## OES-TEST-001\n\nrule\n", contract);
    const b = createRulesBundle("\uFEFF## OES-TEST-001\r\n\r\nrule\r\n", contract);
    expect(a).toEqual(b); expect(normalizeRulesSource("a\rb")).toBe("a\nb");
    expect(createRulesBundle("## OES-TEST-001\n\nnew rule\n", contract).ruleset_ref).not.toEqual(a.ruleset_ref);
    expect(createRulesBundle(a.bundle.instructions_markdown, { ...contract, compatibility: { ...COMPATIBILITY, engine_contract_id: "other" } }).ruleset_ref).not.toEqual(a.ruleset_ref);
    expect(a.ruleset_ref.revision).toBe(jcsSha256(a.bundle));
  });
  it.each(["", "## OES-TEST-001\n", "## OES-TEST-001\nbody\n## OES-TEST-001\nduplicate", "## OES-TEST-001\nOES-UNKNOWN-001"])("rejects invalid IDs/empty sections %j", source => {
    expect(() => createRulesBundle(source, contract)).toThrow("INVALID_MEASUREMENT_RULES");
  });
  it("rejects oversized text, JSON escaping growth and unknown bundle fields", () => {
    expect(() => createRulesBundle("## OES-TEST-001\n" + "あ".repeat(22000), contract)).toThrow();
    expect(() => createRulesBundle("## OES-TEST-001\n" + "\u0001".repeat(30000), contract)).toThrow();
    expect(() => validateRulesBundle({ ...generatedRules.bundle, source_path: "secret" })).toThrow();
    expect(() => validateRulesBundle({ ...generatedRules.bundle, rule_ids: [] })).toThrow();
  });
  it("rejects duplicate revisions, dangling/withdrawn current and modified bundle", () => {
    const r = measurementRegistry(); r.revisions.push(structuredClone(r.revisions[0]));
    expect(() => validateRulesRegistry(r)).toThrow(); r.revisions.pop();
    r.revisions[0].bundle.instructions_markdown += "changed";
    expect(() => validateRulesRegistry(r)).toThrow("RULESET_CHANGED");
    const bad = measurementRegistry(); bad.revisions[0].status = "withdrawn";
    expect(() => validateRulesRegistry(bad)).toThrow("RULESET_UNAVAILABLE");
    expect(extractRuleIds(generatedRules.bundle.instructions_markdown)).toEqual(generatedRules.bundle.rule_ids);
  });
});

describe("central rule acceptance", () => {
  it("accepts original model/currency-only requests only inside both migration windows", async () => {
    const now = Date.parse("2026-10-20T00:00:00Z"), future = new Date(now + 86400000).toISOString(), past = new Date(now - 1).toISOString();
    const skills = skillRegistry(integrity), rules = measurementRegistry();
    skills.enforcement_at = future; rules.rules_enforcement_at = future;
    const legacy = { model, display_currency: "USD" };
    const result = await evaluateRemote(legacy, getLocalProfile(), undefined, skills, now, rules);
    expect(result.assurance.skill_integrity.status).toBe("LEGACY_UNCHECKED");
    expect(result.assurance.measurement_rules.status).toBe("LEGACY_LOCAL_RULES");
    expect(result.assurance.measurement_rules.ruleset_ref).toBeNull(); expect(result.evaluation_context_hash).toBeNull();
    expect(result.report.measurement.cfp).toBe(6);
    for (const cutoff of [past, new Date(now).toISOString(), null]) {
      await expect(evaluateRemote(legacy, getLocalProfile(), undefined, { ...skills, enforcement_at: cutoff }, now, rules)).rejects.toThrow("SKILL_INTEGRITY_REQUIRED");
      await expect(evaluateRemote(legacy, getLocalProfile(), undefined, skills, now, { ...rules, rules_enforcement_at: cutoff })).rejects.toThrow("RULESET_REQUIRED");
    }
    await expect(evaluateRemote({ ...legacy, skill_integrity: integrity }, getLocalProfile(), undefined, skills, now, rules)).rejects.toThrow("RULESET_REQUIRED");
    await expect(evaluateRemote({ ...legacy, skill_integrity: { ...integrity, package_sha256: "b".repeat(64) } }, getLocalProfile(), undefined, skills, now, rules)).rejects.toThrow("SKILL_INTEGRITY_MISMATCH");
  });
  it("allows legacy requests over HTTP during migration without marking rules or skill as verified", async () => {
    const skills = skillRegistry(integrity), rules = measurementRegistry();
    skills.enforcement_at = rules.rules_enforcement_at = "2100-01-01T00:00:00Z";
    const res = await worker.fetch(new Request("https://example.test/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "evaluate_model", arguments: { model, display_currency: "USD" } } }) }), skills, rules);
    const result = (await res.json() as any).result;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.assurance.skill_integrity.status).toBe("LEGACY_UNCHECKED");
    expect(result.structuredContent.assurance.measurement_rules.status).toBe("LEGACY_LOCAL_RULES");
    expect(result.structuredContent.evaluation_context_hash).toBeNull();
  });
  it("returns the full current and an explicit old version without substituting current", () => {
    const r = measurementRegistry(), skills = skillRegistry(integrity);
    const old = resolveMeasurementRules(request(), r, skills);
    const next = createRulesBundle(generatedRules.bundle.instructions_markdown + "\n更新\n", contract);
    r.revisions.push({ revision: next.ruleset_ref.revision, status: "available", bundle: next.bundle }); r.current_revision = next.ruleset_ref.revision;
    expect(resolveMeasurementRules(request(), r, skills).bundle).toEqual(next.bundle);
    expect(resolveMeasurementRules({ ...request(), ruleset_ref: old.ruleset_ref }, r, skills).bundle).toEqual(old.bundle);
    expect(Buffer.byteLength(JSON.stringify(old))).toBeLessThanOrEqual(131072);
  });
  it("never silently upgrades legacy or a falsely declared client protocol", () => {
    expect(() => resolveMeasurementRules(request(), measurementRegistry(), skillRegistry(integrity, null))).toThrow("RULESET_INCOMPATIBLE");
    expect(() => resolveMeasurementRules({ ...request(), client_protocol: "v99" }, measurementRegistry(), skillRegistry(integrity))).toThrow("RULESET_INCOMPATIBLE");
    expect(() => resolveMeasurementRules({ client_protocol: CLIENT_PROTOCOL }, measurementRegistry(), skillRegistry(integrity))).toThrow();
  });
  it("fails closed when no current is registered or when source is injected", () => {
    const r = measurementRegistry(); r.current_revision = null;
    expect(() => resolveMeasurementRules(request(), r, skillRegistry(integrity))).toThrow("RULESET_UNAVAILABLE");
    expect(() => resolveMeasurementRules({ ...request(), path: "CANARY" }, measurementRegistry(), skillRegistry(integrity))).toThrow("INVALID_MEASUREMENT_RULES_REQUEST");
  });
  it.each(["unknown", "withdrawn", "incompatible"])("rejects %s on both retrieval and direct evaluation", async kind => {
    const r = measurementRegistry(), skills = skillRegistry(integrity);
    let ref = generatedRules.ruleset_ref, code = "RULESET_UNKNOWN";
    if (kind === "unknown") ref = { ruleset_id: "oes-measurement", revision: "0".repeat(64) };
    if (kind === "withdrawn") { r.current_revision = null; r.revisions[0].status = "withdrawn"; code = "RULESET_WITHDRAWN"; }
    if (kind === "incompatible") { skills.releases[0].measurement_client_protocol = null; code = "RULESET_INCOMPATIBLE"; }
    expect(() => resolveMeasurementRules({ ...request(), ruleset_ref: ref }, r, skills)).toThrow(code);
    await expect(evaluateRemote({ ...args(), ruleset_ref: ref }, getLocalProfile(), undefined, skills, Date.now(), r)).rejects.toThrow(code);
  });
  it("requires a reference from new clients immediately and switches old clients at a fixed deadline", async () => {
    const rules = measurementRegistry(), end = Date.parse(rules.rules_enforcement_at!);
    expect(() => checkRulesetReference(undefined, skillRegistry(integrity).releases[0], rules, end - 1)).toThrow("RULESET_REQUIRED");
    const old = skillRegistry(integrity, null);
    expect(checkRulesetReference(undefined, old.releases[0], rules, end - 1).status).toBe("LEGACY_LOCAL_RULES");
    expect(() => checkRulesetReference(undefined, old.releases[0], rules, end)).toThrow("RULESET_REQUIRED");
    const result = await evaluateRemote({ model, skill_integrity: integrity, display_currency: "USD" }, getLocalProfile(), undefined, old, end - 1, rules);
    expect(result.evaluation_context_hash).toBeNull(); expect(result.assurance.measurement_rules.ruleset_ref).toBeNull();
  });
  it("keeps report/hash/CFP/effort/USD unchanged and varies only the context hash by rule revision", async () => {
    const r = measurementRegistry(), skills = skillRegistry(integrity), p = getLocalProfile();
    const first = await evaluateRemote(args(), p, undefined, skills, Date.now(), r);
    const next = createRulesBundle(generatedRules.bundle.instructions_markdown + "\n誤字修正例\n", contract);
    r.revisions.push({ revision: next.ruleset_ref.revision, status: "available", bundle: next.bundle });
    const second = await evaluateRemote({ ...args(), ruleset_ref: next.ruleset_ref }, p, undefined, skills, Date.now(), r);
    const old = await evaluateRemote({ model, skill_integrity: integrity, display_currency: "USD" }, p, undefined, skillRegistry(integrity, null), Date.now(), r);
    expect(second.report).toEqual(first.report); expect(second.report_hash).toBe(first.report_hash); expect(old.report_hash).toBe(first.report_hash);
    expect(second.evaluation_context_hash).not.toBe(first.evaluation_context_hash);
    expect(first.evaluation_context_hash).toBe(jcsSha256({ domain: "oes/evaluation-context/v1", report_hash: first.report_hash, ruleset_ref: generatedRules.ruleset_ref }));
    expect(first.report.measurement.cfp).toBe(6); expect(first.report.effort.person_hours?.median).toBe("18"); expect(first.report.reference_usd.amount_usd?.median).toBe("900");
  });
  it("serves identical text/structuredContent and rejects direct missing reference over HTTP", async () => {
    const call = async (name: string, args: unknown) => {
      const response = await worker.fetch(new Request("https://example.test/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), skillRegistry(integrity), measurementRegistry());
      return (await response.json() as any).result;
    };
    const fetched = await call("get_measurement_rules", request());
    expect(JSON.parse(fetched.content[0].text)).toEqual(fetched.structuredContent);
    expect(fetched.structuredContent.bundle.instructions_markdown).toBe(generatedRules.bundle.instructions_markdown);
    const bad = await call("evaluate_model", { model, skill_integrity: integrity, display_currency: "USD" });
    expect(bad.isError).toBe(true); expect(bad.structuredContent.error.code).toBe("RULESET_REQUIRED"); expect(bad.structuredContent.report).toBeUndefined();
  });
});
