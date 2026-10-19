import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { measurementRegistry } from "../fixtures/measurement.js";
// Exercise the same public scripts used by npm, with isolated adapters and histories.
// @ts-ignore script modules are intentionally native ESM
import { emptyRegistry, registerCandidate, preserveHistory, atomicJson, inventory, contentHash, inspectPlugin } from "../../scripts/build-skill-registry.mjs";
// @ts-ignore
import { publishCandidate, verifyCandidate, validatePluginCandidate } from "../../scripts/release-plugin.mjs";

it("retains previous accepted releases, rejects same-version replacement and never revives revoked versions", () => {
  const a = { skill_id: "open-estimate-assessor", skill_version: "1.0.0", hash_rule: "oes/skill-package/v1", package_sha256: "a".repeat(64) };
  const first = registerCandidate(emptyRegistry(), a);
  first.releases[0].publication = "published";
  expect(registerCandidate(first, a)).toEqual(first);
  expect(() => registerCandidate(first, { ...a, package_sha256: "b".repeat(64) })).toThrow("SKILL_VERSION_COLLISION");
  first.releases[0].acceptance = "revoked";
  expect(registerCandidate(first, a).releases[0].acceptance).toBe("revoked");
  const next = registerCandidate(first, { ...a, skill_version: "2.0.0", package_sha256: "c".repeat(64) });
  expect(next.releases).toHaveLength(2);
  expect(() => preserveHistory(first, emptyRegistry())).toThrow("SKILL_HISTORY_LOST");
  first.enforcement_at = "2026-11-01T00:00:00Z";
  expect(() => preserveHistory(first, { ...first, enforcement_at: "2026-12-01T00:00:00Z" })).toThrow("ENFORCEMENT_DATE_CHANGED");
});

async function candidate(run: (context: any) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oes-release-test-"));
  try {
    const dir = path.join(root, "candidate"), historyPath = path.join(root, "history.json");
    const history = emptyRegistry(); await atomicJson(historyPath, history);
    const plugin = path.join(dir, "marketplace/plugins/open-estimate");
    for (const prefix of ["skills", "server/skills"]) await fs.cp("skills/open-estimate-assessor", path.join(plugin, prefix, "open-estimate-assessor"), { recursive: true });
    const skill = JSON.parse(await fs.readFile("skills/open-estimate-assessor/skill.manifest.json", "utf8"));
    await atomicJson(path.join(plugin, ".codex-plugin/plugin.json"), { version: skill.skill_version });
    const integrity = await inspectPlugin(path.join(dir, "marketplace"));
    const registry = registerCandidate(history, integrity);
    const now = Date.parse("2026-10-19T00:00:00Z");
    registry.enforcement_at = new Date(now + 15 * 86400000).toISOString();
    await atomicJson(path.join(dir, "history.json"), history);
    await atomicJson(path.join(dir, "registry.json"), registry);
    await atomicJson(path.join(dir, "artifacts/worker.js"), { frozen: true });
    const record = { version: skill.skill_version, integrity, registry_sha256: contentHash(registry),
      package_sha256: contentHash(await inventory(path.join(dir, "marketplace"))), artifacts_sha256: contentHash(await inventory(path.join(dir, "artifacts"))) };
    await atomicJson(path.join(dir, "candidate.json"), record);
    await validatePluginCandidate(dir, history, undefined, async () => {});
    const calls: string[] = [];
    const adapters = { historyPath, deploy: async () => { calls.push("deploy"); }, confirm: async () => { calls.push("confirm"); }, promote: async () => { calls.push("promote"); } };
    await run({ root, dir, historyPath, registry, history, now, adapters, calls, plugin });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

it.each(["deploy", "confirm"])("does not promote or save published history after %s failure", async step => candidate(async c => {
  c.adapters[step] = async () => { throw new Error("UNAVAILABLE"); };
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow("UNAVAILABLE");
  expect(c.calls).not.toContain("promote");
  expect(JSON.parse(await fs.readFile(c.historyPath, "utf8"))).toEqual(c.history);
}));

it("resumes the same artifact after promotion failure and rechecks production without redeployment", async () => candidate(async c => {
  const promote = c.adapters.promote;
  c.adapters.promote = async () => { throw new Error("DISK_FAILURE"); };
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow("DISK_FAILURE");
  c.adapters.promote = promote;
  await publishCandidate(c.dir, c.adapters, c.now);
  expect(c.calls).toEqual(["deploy", "confirm", "confirm", "promote"]);
  const history = JSON.parse(await fs.readFile(c.historyPath, "utf8"));
  expect(history.enforcement_at).toBe(c.registry.enforcement_at);
  expect(history.releases[0].publication).toBe("published");
}));

it.each(["skills/open-estimate-assessor/SKILL.md", "server/skills/open-estimate-assessor/SKILL.md"])("rejects changed copy %s before deploy", async file => candidate(async c => {
  await fs.appendFile(path.join(c.plugin, file), "changed");
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow();
  expect(c.calls).toEqual([]);
}));

it.each(["registry.json", "artifacts/worker.js"])("rejects changed %s before deploy", async file => candidate(async c => {
  await fs.appendFile(path.join(c.dir, file), file === "registry.json" ? " " : "changed");
  if (file === "registry.json") {
    const r = JSON.parse(await fs.readFile(path.join(c.dir, file), "utf8")); r.enforcement_at = "2099-01-01T00:00:00Z";
    await atomicJson(path.join(c.dir, file), r);
  }
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow("CANDIDATE_CHANGED");
  expect(c.calls).toEqual([]);
}));

it("rejects a shortened initial migration without deploying", async () => candidate(async c => {
  await expect(publishCandidate(c.dir, c.adapters, c.now + 2 * 86400000)).rejects.toThrow("MIGRATION_WINDOW_TOO_SHORT");
  expect(c.calls).toEqual([]);
}));

it("never promotes when saving history fails", async () => candidate(async c => {
  c.adapters.confirm = async () => {
    await fs.unlink(c.historyPath); await fs.mkdir(c.historyPath);
  };
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow();
  expect(c.calls).not.toContain("promote");
}));

it("assigns the first enforcement date at publication and preserves it on resume", async () => candidate(async c => {
  const r = { ...c.registry, enforcement_at: null };
  await atomicJson(path.join(c.dir, "registry.json"), r);
  const record = JSON.parse(await fs.readFile(path.join(c.dir, "candidate.json"), "utf8"));
  record.registry_sha256 = contentHash(r); await atomicJson(path.join(c.dir, "candidate.json"), record);
  await validatePluginCandidate(c.dir, c.history, undefined, async () => {});
  let applied: any;
  c.adapters.deploy = async (_dir: string, policy: any) => { applied = policy; };
  await publishCandidate(c.dir, c.adapters, c.now);
  expect(Date.parse(applied.enforcement_at) - c.now).toBeGreaterThanOrEqual(14 * 86400000);
  const first = JSON.parse(await fs.readFile(c.historyPath, "utf8"));
  await publishCandidate(c.dir, c.adapters, c.now + 10 * 86400000);
  expect(JSON.parse(await fs.readFile(c.historyPath, "utf8")).enforcement_at).toBe(first.enforcement_at);
}));

async function attachCentralRules(c: any) {
  const rules = measurementRegistry(); rules.rules_enforcement_at = null;
  const baseline = { ...rules, current_revision: null, revisions: [] };
  c.adapters.rulesHistoryPath = path.join(c.root, "measurement-history.json");
  await atomicJson(c.adapters.rulesHistoryPath, baseline);
  await atomicJson(path.join(c.dir, "rules-history.json"), baseline);
  await atomicJson(path.join(c.dir, "measurement-rules.json"), rules);
  c.registry.releases[0].measurement_client_protocol = "oes/measurement-client/v1";
  c.registry.enforcement_at = null;
  await atomicJson(path.join(c.dir, "registry.json"), c.registry);
  const record = JSON.parse(await fs.readFile(path.join(c.dir, "candidate.json"), "utf8"));
  Object.assign(record, { baseline_skill_sha256: contentHash(c.history), baseline_rules_sha256: contentHash(baseline),
    measurement_rules_sha256: contentHash(rules), registry_sha256: contentHash(c.registry) });
  await atomicJson(path.join(c.dir, "candidate.json"), record);
  await validatePluginCandidate(c.dir, c.history, baseline, async () => {});
}
it("requires Worker validation after failure, retries the same plugin candidate and blocks direct publication", async () => candidate(async c => {
  await fs.unlink(path.join(c.dir, "validation.json"));
  let attempts = 0;
  const smoke = async () => { if (++attempts === 1) throw new Error("SMOKE_FAILED"); };
  await expect(validatePluginCandidate(c.dir, c.history, undefined, smoke)).rejects.toThrow("SMOKE_FAILED");
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow("CANDIDATE_NOT_VALIDATED");
  expect(c.calls).toEqual([]);
  await validatePluginCandidate(c.dir, c.history, undefined, smoke);
  expect(attempts).toBe(2);
  await validatePluginCandidate(c.dir, c.history, undefined, smoke);
  expect(attempts).toBe(2);
  await publishCandidate(c.dir, c.adapters, c.now);
  expect(c.calls).toEqual(["deploy", "confirm", "promote"]);
}));
it("does not reuse validation when the plugin candidate record changes", async () => candidate(async c => {
  const record = JSON.parse(await fs.readFile(path.join(c.dir, "candidate.json"), "utf8"));
  record.validation_test = "changed record"; await atomicJson(path.join(c.dir, "candidate.json"), record);
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow("CANDIDATE_NOT_VALIDATED");
  expect(c.calls).toEqual([]);
}));
it("renews the initial rules window after a delayed first promotion and locks it after publication", async () => candidate(async c => {
  await attachCentralRules(c);
  const promote = c.adapters.promote;
  c.adapters.promote = async () => { throw new Error("PROMOTION_INTERRUPTED"); };
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow("PROMOTION_INTERRUPTED");
  const initial = JSON.parse(await fs.readFile(c.adapters.rulesHistoryPath, "utf8"));
  c.adapters.promote = promote;
  const later = c.now + 10 * 86400000;
  await publishCandidate(c.dir, c.adapters, later);
  const final = JSON.parse(await fs.readFile(c.adapters.rulesHistoryPath, "utf8"));
  expect(Date.parse(final.rules_enforcement_at) - later).toBeGreaterThanOrEqual(14 * 86400000);
  expect(final.rules_enforcement_at).not.toBe(initial.rules_enforcement_at);
  await publishCandidate(c.dir, c.adapters, later + 10 * 86400000);
  expect(JSON.parse(await fs.readFile(c.adapters.rulesHistoryPath, "utf8")).rules_enforcement_at).toBe(final.rules_enforcement_at);
}));
it("rejects normal plugin candidates after rule history changes instead of reverting current", async () => candidate(async c => {
  await attachCentralRules(c);
  const changed = { format: "oes/measurement-rules-registry/v1", current_revision: null, revisions: [], rules_enforcement_at: "2100-01-01T00:00:00Z" };
  await atomicJson(c.adapters.rulesHistoryPath, changed);
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow("STALE_RELEASE_CANDIDATE");
  expect(c.calls).toEqual([]);
}));
it("rechecks normal release histories after production I/O before saving or promoting", async () => candidate(async c => {
  await attachCentralRules(c);
  c.adapters.confirm = async () => {
    await atomicJson(c.adapters.rulesHistoryPath, { format: "oes/measurement-rules-registry/v1", rules_enforcement_at: "2100-01-01T00:00:00Z", current_revision: null, revisions: [] });
  };
  await expect(publishCandidate(c.dir, c.adapters, c.now)).rejects.toThrow("STALE_RELEASE_CANDIDATE");
  expect(c.calls).not.toContain("promote");
}));

it("rejects missing history present when preparing a rollback candidate", async () => candidate(async c => {
  const prior = registerCandidate(c.history, { ...c.registry.releases[0], skill_version: "0.0.1", package_sha256: "e".repeat(64) });
  prior.releases[0].publication = "published";
  await atomicJson(path.join(c.dir, "history.json"), prior);
  await expect(verifyCandidate(c.dir, c.history)).rejects.toThrow("SKILL_HISTORY_LOST");
}));

it("passes the AI-read root to CLI, catches copy mismatch and changes after scan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oes-cli-integrity-"));
  try {
    const plugin = path.join(root, "plugin"), project = path.join(root, "project");
    await fs.cp("dist", path.join(plugin, "server/dist"), { recursive: true });
    await fs.cp("profiles", path.join(plugin, "server/profiles"), { recursive: true });
    await fs.cp("contracts", path.join(plugin, "server/contracts"), { recursive: true });
    await fs.symlink(path.resolve("node_modules"), path.join(plugin, "server/node_modules"), "junction");
    await fs.copyFile("package.json", path.join(plugin, "server/package.json"));
    await atomicJson(path.join(plugin, ".codex-plugin/plugin.json"), { name: "open-estimate" });
    for (const prefix of ["skills", "server/skills"]) await fs.cp("skills/open-estimate-assessor", path.join(plugin, prefix, "open-estimate-assessor"), { recursive: true });
    await fs.mkdir(project); await fs.writeFile(path.join(project, "main.js"), "export const x = 1;");
    const run = (command: string, input: unknown) => {
      const res = spawnSync(process.execPath, [path.join(plugin, "skills/open-estimate-assessor/scripts/oes.mjs"), command], { input: JSON.stringify(input), encoding: "utf8", windowsHide: true, env: { ...process.env, OES_HELPER_STATE: path.join(root, "state") } });
      expect(res.stdout, res.stderr).not.toBe("");
      return JSON.parse(res.stdout);
    };
    expect(run("skill-integrity", {}).package_sha256).toMatch(/^[a-f0-9]{64}$/);
    const direct = spawnSync(process.execPath, [path.join(plugin, "server/dist/local/cli.js"), "skill-integrity"], { input: "{}", encoding: "utf8", windowsHide: true });
    expect(JSON.parse(direct.stdout).error.code).toBe("SKILL_ROOT_REQUIRED");
    const scan = run("scan", { root: project });
    const common = { root: project, session_id: scan.session_id };
    run("confirm", { ...common, user_confirmed: true });
    await fs.appendFile(path.join(plugin, "skills/open-estimate-assessor/SKILL.md"), "modified AI instructions");
    expect(run("skill-integrity", {}).error.code).toBe("INVALID_SKILL_INTEGRITY");
    expect(run("prepare", common).error.code).toBe("SKILL_CHANGED_DURING_ANALYSIS");
    expect(run("export", common).error.code).toBe("SKILL_CHANGED_DURING_ANALYSIS");
    expect((await fs.readdir(path.join(root, "state"))).some(f => f.endsWith(".json"))).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 60000);
