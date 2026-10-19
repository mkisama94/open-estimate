import { it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { bindRules, generatedRules, measurementRegistry, responseFor, setRuleReferences, skillRegistry } from "../fixtures/measurement.js";
import { createRulesBundle, COMPATIBILITY } from "../../src/rules/measurement-contract.js";
import { jcsSha256 } from "../../src/core/canonical.js";
import { recorded } from "../fixtures/recorded.js";
import { evaluateRemote } from "../../src/remote/model.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
vi.setConfig({ testTimeout: 30000 });

async function session(test: (c: any) => Promise<void>) {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "oes-measurement-context-"));
  const root = path.resolve("examples/quality-check");
  const run = (command: string, input: any, ok = true) => {
    const child = spawnSync(process.execPath, ["dist/local/cli.js", command], { input: JSON.stringify(input), encoding: "utf8", windowsHide: true, env: { ...process.env, OES_HELPER_STATE: state } });
    expect(child.status, child.stdout + child.stderr).toBe(ok ? 0 : 1); return JSON.parse(child.stdout);
  };
  try {
    const scan = run("scan", { root }), common = { root, session_id: scan.session_id };
    await test({ state, root, run, common, stateFile: path.join(state, scan.session_id + ".json") });
  } finally { await fs.rm(state, { recursive: true, force: true }); }
}
function prepared(c: any) {
  bindRules(c.run, c.common); c.run("confirm", { ...c.common, user_confirmed: true });
  const prep = c.run("prepare", c.common), a = recorded();
  a.assessment_id = prep.assessment_id; a.input = prep.assessment_input; a.assessor = { ...prep.assessor_defaults, finished_at: new Date().toISOString() };
  a.components[0].path_prefixes = ["notes.js"];
  a.scope_record!.files = a.input.manifest.files.map(f => ({ path: f.path, membership: "included", reason: "Notes implementation", confirmation_ref: "scope-confirmed", evidence_refs: [] }));
  a.evidence[0] = { ...a.evidence[0], file_path: "notes.js", line_start: 5, line_end: 14 };
  a.evidence[1] = { ...a.evidence[1], file_path: "notes.js", line_start: 16, line_end: 21 };
  setRuleReferences(a); c.run("read", { ...c.common, snapshot_id: prep.snapshot_id, file_id: "notes.js" });
  return { prep, a, input: { ...c.common, snapshot_id: prep.snapshot_id, assessment: JSON.stringify(a) } };
}
it("permits binding before consent, refuses prepare without binding and rescues drafts without rules", async () => session(async c => {
  const draft = c.run("draft", { ...c.common, assessment: recorded() });
  expect(draft.status).toBe("DRAFT_SAVED"); expect(draft.model).toBeUndefined();
  c.run("confirm", { ...c.common, user_confirmed: true });
  expect(c.run("prepare", c.common, false).error.code).toBe("RULESET_NOT_BOUND");
  const bound = bindRules(c.run, c.common);
  expect(c.run("bind-rules", { ...c.common, rules_response: bound }).ruleset_ref).toEqual(bound.ruleset_ref);
  expect(c.run("prepare", c.common).rule_ids).toEqual(bound.bundle.rule_ids);
}));
it("rejects alternate binding and corrupted stored bundles for prepare/read/export while preserving rescue/purge", async () => session(async c => {
  const { prep, input } = prepared(c);
  const r = measurementRegistry(), next = createRulesBundle(generatedRules.bundle.instructions_markdown + "\n別の版\n", { format: "oes/measurement-rules/v1", ruleset_id: "oes-measurement", compatibility: COMPATIBILITY });
  r.revisions.push({ revision: next.ruleset_ref.revision, status: "available", bundle: next.bundle }); r.current_revision = next.ruleset_ref.revision;
  const alternate = responseFor(c.run("skill-integrity", {}), r);
  expect(c.run("bind-rules", { ...c.common, rules_response: alternate }, false).error.code).toBe("RULESET_CHANGED");
  const state = JSON.parse(await fs.readFile(c.stateFile, "utf8")); state.measurement_rules.bundle.instructions_markdown += "改変";
  await fs.writeFile(c.stateFile, JSON.stringify(state));
  for (const command of ["prepare", "read", "export"]) expect(c.run(command, { ...input, file_id: "notes.js" }, false).error.code).toBe("RULESET_CHANGED");
  expect(c.run("draft", { ...input, assessment: recorded() }).status).toBe("DRAFT_SAVED");
  expect(c.run("purge", c.common).status).toBe("PURGED");
  expect(await fs.readdir(c.state)).toEqual([]);
}));
it("rejects altered or incomplete server responses before binding", async () => session(async c => {
  const response = responseFor(c.run("skill-integrity", {}));
  response.bundle.instructions_markdown += "tampered";
  expect(c.run("bind-rules", { ...c.common, rules_response: response }, false).error.code).toBe("RULESET_CHANGED");
  expect(c.run("bind-rules", { ...c.common, rules_response: { ...response, source: "SECRET" } }, false).error.code).toBe("RULESET_CHANGED");
}));
it("keeps a fixed revision after current changes, saves immutable context, and rejects withdrawal", async () => session(async c => {
  const { input } = prepared(c), first = c.run("export", input), second = c.run("export", input);
  expect(second.local.context_path).toBe(first.local.context_path);
  const saved = JSON.parse(await fs.readFile(first.local.context_path, "utf8"));
  const { context_hash, ...body } = saved;
  expect(context_hash).toBe(jcsSha256(body)); expect(body.assessment_hash).toBe(first.local.assessment_hash);
  expect(body.bundle).toEqual(generatedRules.bundle); expect(first.ruleset_ref).toEqual(generatedRules.ruleset_ref);
  const r = measurementRegistry(), next = createRulesBundle(generatedRules.bundle.instructions_markdown + "\n新規解析用の変更\n", { format: "oes/measurement-rules/v1", ruleset_id: "oes-measurement", compatibility: COMPATIBILITY });
  r.revisions.push({ revision: next.ruleset_ref.revision, status: "available", bundle: next.bundle }); r.current_revision = next.ruleset_ref.revision;
  const args = { model: first.model, skill_integrity: first.skill_integrity, ruleset_ref: first.ruleset_ref, display_currency: "USD" };
  expect((await evaluateRemote(args, getLocalProfile(), undefined, skillRegistry(first.skill_integrity), Date.now(), r)).assurance.measurement_rules.ruleset_ref).toEqual(first.ruleset_ref);
  expect(JSON.stringify(args)).not.toContain("notes.js"); expect(JSON.stringify(args)).not.toContain(generatedRules.bundle.instructions_markdown);
  r.revisions[0].status = "withdrawn";
  await expect(evaluateRemote(args, getLocalProfile(), undefined, skillRegistry(first.skill_integrity), Date.now(), r)).rejects.toThrow("RULESET_WITHDRAWN");
  expect(JSON.parse(await fs.readFile(first.local.context_path, "utf8"))).toEqual(saved);
}));
it("checks judgment references and ignores no caller override of the fixed revision", async () => session(async c => {
  const { input, a } = prepared(c);
  const saved = c.run("export", input), original = await fs.readFile(saved.local.assessment_path, "utf8");
  a.judgments![0].rule = { source: "skill", id: "OES-UNKNOWN-001", version: generatedRules.ruleset_ref.revision };
  expect(c.run("export", { ...input, assessment: JSON.stringify(a) }, false).error.code).toBe("RULE_REFERENCE_MISMATCH");
  setRuleReferences(a); a.judgments![0].rule.version = "0".repeat(64);
  expect(c.run("export", { ...input, assessment: JSON.stringify(a) }, false).error.code).toBe("RULE_REFERENCE_MISMATCH");
  expect(c.run("export", { ...input, ruleset_ref: { revision: "0".repeat(64) } }, false).error.code).toBe("INVALID_RULESET_REF");
  expect(await fs.readFile(saved.local.assessment_path, "utf8")).toBe(original);
  await fs.writeFile(saved.local.context_path, "modified context");
  expect(c.run("export", input, false).error.code).toBe("RULESET_CHANGED");
}));
