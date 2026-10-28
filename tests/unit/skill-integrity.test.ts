import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashSkillPackage, inspectSkillPackage } from "../../src/profiles/skill-package.js";
import { checkSkillIntegrity, getSkillPolicy, type SkillRegistry } from "../../src/remote/skill-integrity.js";
import { evaluateRemote, projectModel } from "../../src/remote/model.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import worker from "../../src/remote/worker.js";
import { measurementRegistry } from "../fixtures/measurement.js";

const integrity = { format: "oes/skill-integrity/v1", skill_id: "open-estimate-assessor", skill_version: "1.2.3", hash_rule: "oes/skill-package/v1", package_sha256: "a".repeat(64) };
const registry = (): SkillRegistry => ({ policy_version: "oes/skill-integrity-policy/v1", enforcement_at: "2026-11-01T00:00:00Z",
  releases: [{ skill_id: integrity.skill_id, skill_version: integrity.skill_version, hash_rule: integrity.hash_rule, package_sha256: integrity.package_sha256, publication: "published", acceptance: "accepted" }] });
const deadline = Date.parse(registry().enforcement_at!);
const fixture = JSON.parse(fs.readFileSync("examples/basic-assessment.json", "utf8"));
const args = () => ({ model: projectModel(fixture), display_currency: "USD", skill_integrity: integrity });

describe("skill policy", () => {
  it("uses a fixed clock and does not extend the transition", () => {
    expect(checkSkillIntegrity(undefined, registry(), deadline - 1).status).toBe("LEGACY_UNCHECKED");
    expect(() => checkSkillIntegrity(undefined, registry(), deadline)).toThrow("SKILL_INTEGRITY_REQUIRED");
    expect(() => checkSkillIntegrity(undefined, { ...registry(), enforcement_at: null })).toThrow("SKILL_INTEGRITY_REQUIRED");
    expect(checkSkillIntegrity(integrity, registry(), deadline).status).toBe("MATCHED_CLIENT_REPORTED");
  });
  it.each([
    [{ ...integrity, verified: true }, "INVALID_SKILL_INTEGRITY"],
    [{ ...integrity, package_sha256: "A".repeat(64) }, "INVALID_SKILL_INTEGRITY"],
    [{ ...integrity, skill_version: "x".repeat(65) }, "INVALID_SKILL_INTEGRITY"],
    [{ ...integrity, skill_version: "9.9.9" }, "SKILL_VERSION_UNSUPPORTED"],
    [{ ...integrity, skill_id: "unknown-skill" }, "SKILL_VERSION_UNSUPPORTED"],
    [{ ...integrity, hash_rule: "unknown-rule" }, "SKILL_VERSION_UNSUPPORTED"],
    [{ ...integrity, package_sha256: "b".repeat(64) }, "SKILL_INTEGRITY_MISMATCH"],
    [null, "INVALID_SKILL_INTEGRITY"]
  ])("rejects unsupported declarations %j", (value, code) => {
    expect(() => checkSkillIntegrity(value, registry(), deadline - 1)).toThrow(code);
  });
  it("revokes explicitly and retains the assurance boundary", () => {
    const r = registry(); r.releases[0].acceptance = "revoked";
    expect(() => checkSkillIntegrity(integrity, r)).toThrow("SKILL_VERSION_REVOKED");
    expect(getSkillPolicy(r).accepted_releases).toEqual([]);
    // Public hashes can be deliberately falsely declared: this is not proof of execution.
    expect(checkSkillIntegrity(integrity, registry()).status).toBe("MATCHED_CLIENT_REPORTED");
    expect(getSkillPolicy(registry()).assurance).toContain("自己申告");
  });
  it("preserves numeric results and report_hash exactly", async () => {
    const r = registry(), p = getLocalProfile();
    const legacy = await evaluateRemote(args(), p, undefined, r, deadline - 1, measurementRegistry());
    const matched = await evaluateRemote(args(), p, undefined, r, deadline, measurementRegistry());
    expect(matched.report).toEqual(legacy.report);
    expect(matched.report_hash).toBe(legacy.report_hash);
    expect(matched.report.measurement.cfp).toBe(6);
    expect(matched.report.effort.person_hours?.median).toBe("18");
    expect(matched.report.reference_usd.amount_usd?.median).toBe("900");
    expect(matched.assurance.source_audit).toBe("NOT_INDEPENDENTLY_VERIFIED");
  });
  it("checks before FX or model computation on direct calls", async () => {
    let called = false;
    await expect(evaluateRemote({ ...args(), skill_integrity: { ...integrity, package_sha256: "c".repeat(64) } }, getLocalProfile(),
      { get: async () => { called = true; throw new Error("NETWORK_DOWN"); } }, registry())).rejects.toThrow("SKILL_INTEGRITY_MISMATCH");
    expect(called).toBe(false);
  });
  it("enforces on real HTTP MCP calls and returns no report on rejection", async () => {
    const r = registry(); r.enforcement_at = "2020-01-01T00:00:00Z";
    r.releases[0].measurement_client_protocol="oes/measurement-client/v1";
    const call = async (name: string, arguments_: unknown) => {
      const res = await worker.fetch(new Request("https://example.test/mcp", { method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: arguments_ } }) }), r, measurementRegistry());
      return (await res.json() as any).result;
    };
    expect((await call("get_skill_policy", {})).structuredContent.accepted_releases).toHaveLength(1);
    expect((await call("get_skill_policy", { path: "SECRET" })).isError).toBe(true);
    expect((await call("get_measurement_rules", {skill_integrity:integrity,client_protocol:"oes/measurement-client/v1"})).structuredContent.skill_integrity.status).toBe("MATCHED_CLIENT_REPORTED");
    for (const [value, code] of [[undefined, "INVALID_MEASUREMENT_RULES_REQUEST"], [{ ...integrity, package_sha256: "c".repeat(64) }, "SKILL_INTEGRITY_MISMATCH"],
      [{ ...integrity, source: "SOURCE_CANARY" }, "INVALID_MEASUREMENT_RULES_REQUEST"]] as const) {
      const bad = await call("get_measurement_rules", { skill_integrity: value,client_protocol:"oes/measurement-client/v1" });
      expect(bad.isError).toBe(true); expect(bad.structuredContent.error.code).toBe(code);
      expect(JSON.stringify(bad)).not.toMatch(/SOURCE_CANARY|report|cfp|person_hours|amount_usd/);
    }
  });
});

describe("actual skill files", () => {
  function sample(run: (root: string) => void) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oes-skill-test-"));
    try { fs.mkdirSync(path.join(root, "scripts")); fs.writeFileSync(path.join(root, "SKILL.md"), "rules\n"); fs.writeFileSync(path.join(root, "scripts/oes.mjs"), "// cli\n"); run(root); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
  function manifest(root: string) {
    fs.writeFileSync(path.join(root, "skill.manifest.json"), JSON.stringify({ domain: "oes/skill-manifest/v1", skill_id: integrity.skill_id,
      skill_version: integrity.skill_version, hash_rule: "SHA256(JCS({domain:oes/skill-package/v1,files:[{path,sha256},...]}))", ...hashSkillPackage(root) }));
  }
  it.each(["SKILL.md", "scripts/oes.mjs", "new-rule.md"])("detects modified or added %s despite regenerated manifest", file => sample(root => {
    manifest(root); const before = inspectSkillPackage(root);
    const r = registry(); r.releases[0].package_sha256 = before.package_sha256;
    fs.appendFileSync(path.join(root, file), "changed\r\n");
    expect(() => inspectSkillPackage(root)).toThrow("INVALID_SKILL_INTEGRITY");
    manifest(root); const after = inspectSkillPackage(root);
    expect(() => checkSkillIntegrity(after, r)).toThrow("SKILL_INTEGRITY_MISMATCH");
  }));
  it("rejects missing required files", () => sample(root => {
    manifest(root); fs.unlinkSync(path.join(root, "SKILL.md"));
    expect(() => hashSkillPackage(root)).toThrow();
  }));
  it("rejects non-string manifest versions rather than coercing them", () => sample(root => {
    manifest(root);
    const file = path.join(root, "skill.manifest.json"), data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.skill_version = [integrity.skill_version]; fs.writeFileSync(file, JSON.stringify(data));
    expect(() => inspectSkillPackage(root)).toThrow("INVALID_SKILL_INTEGRITY");
  }));
  it("fails closed on unreadable file bytes", () => sample(root => {
    const original = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((file: any, ...rest: any[]) => {
      if (file === path.join(root, "SKILL.md")) throw new Error("EACCES");
      return (original as any)(file, ...rest);
    }) as any);
    try { expect(() => hashSkillPackage(root)).toThrow("EACCES"); } finally { spy.mockRestore(); }
  }));
  it("rejects directory junctions without following them", () => sample(root => {
    fs.symlinkSync(path.join(root, "scripts"), path.join(root, "linked"), "junction");
    expect(() => hashSkillPackage(root)).toThrow("UNSAFE_SKILL_PACKAGE");
  }));
});
