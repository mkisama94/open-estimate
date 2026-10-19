import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generatedRules, measurementRegistry, skillRegistry } from "../fixtures/measurement.js";
// Native release scripts use the same runtime paths as the npm entrypoints.
// @ts-ignore
import { prepareRulesCandidate, publishRulesCandidate, verifyRulesCandidate } from "../../scripts/release-rules.mjs";
// @ts-ignore
import { buildRulesHistory } from "../../scripts/build-measurement-rules.mjs";
// @ts-ignore
import { atomicJson, inventory, contentHash } from "../../scripts/build-skill-registry.mjs";
// @ts-ignore
import { buildFrozenWorker, run, withReleaseLock, claimPending, clearPending } from "../../scripts/release-common.mjs";
const actualRepo = path.resolve(".");
async function fixture(test: (c: any) => Promise<void>) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "oes-rules-release-"));
  try {
    const integrity = { format: "oes/skill-integrity/v1", skill_id: "open-estimate-assessor", skill_version: "0.7.0", hash_rule: "oes/skill-package/v1", package_sha256: "a".repeat(64) };
    const skills = skillRegistry(integrity); skills.enforcement_at = "2026-11-03T00:00:00Z";
    skills.releases.push({ ...skills.releases[0], skill_version: "0.0.1", package_sha256: "b".repeat(64), acceptance: "revoked" });
    const history = measurementRegistry(); history.rules_enforcement_at = "2026-11-04T00:00:00Z";
    const skillHistoryPath = path.join(repo, "profiles/skill-releases.json"), rulesHistoryPath = path.join(repo, "profiles/measurement-rules.json");
    await atomicJson(skillHistoryPath, skills); await atomicJson(rulesHistoryPath, history);
    await atomicJson(path.join(repo, "rules/measurement/contract.json"), { format: "oes/measurement-rules/v1", ruleset_id: "oes-measurement", compatibility: generatedRules.bundle.compatibility });
    await fs.writeFile(path.join(repo, "rules/measurement/source.md"), generatedRules.bundle.instructions_markdown + "\nルール専用更新の試験\n");
    await atomicJson(path.join(repo, "package.json"), { version: "0.7.0", type: "module" });
    await atomicJson(path.join(repo, "plugin/plugin.json"), { version: "0.7.0" });
    await atomicJson(path.join(repo, "skills/open-estimate-assessor/skill.manifest.json"), { package_sha256: integrity.package_sha256 });
    await atomicJson(path.join(repo, "release/desktop-marketplace/plugin.json"), { published: "unchanged" });
    const untouched = async () => contentHash({ package_json: await fs.readFile(path.join(repo, "package.json"), "utf8"),
      plugin: await inventory(path.join(repo, "plugin")), skills: await inventory(path.join(repo, "skills")), distribution: await inventory(path.join(repo, "release/desktop-marketplace")) });
    const initial = await untouched(), calls: string[] = [];
    const adapters = { skillHistoryPath, rulesHistoryPath, deploy: async () => { calls.push("deploy"); }, confirm: async () => { calls.push("confirm"); } };
    const build = async (_repo: string, dir: string) => atomicJson(path.join(dir, "artifacts/worker.js"), { frozen: true });
    const prepare = (action = {}) => prepareRulesCandidate(repo, { build, smoke: async () => {} }, action);
    await test({ repo, integrity, skills, history, skillHistoryPath, rulesHistoryPath, calls, adapters, prepare, untouched, initial });
  } finally { await fs.rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
it("generates revisions without plugin/version/hash changes, retains old rules and is idempotent", async () => fixture(async c => {
  const dir = await c.prepare(), record = JSON.parse(await fs.readFile(path.join(dir, "candidate.json"), "utf8"));
  expect(record.revision).not.toBe(c.history.current_revision);
  expect(await c.prepare()).toBe(dir);
  await publishRulesCandidate(dir, c.adapters);
  expect(await c.untouched()).toBe(c.initial);
  expect(JSON.parse(await fs.readFile(c.skillHistoryPath, "utf8"))).toEqual(c.skills);
  const rules = JSON.parse(await fs.readFile(c.rulesHistoryPath, "utf8"));
  expect(rules.revisions).toHaveLength(2); expect(rules.revisions[0]).toEqual(c.history.revisions[0]);
  expect(rules.rules_enforcement_at).toBe(c.history.rules_enforcement_at);
  expect(rules.current_revision).toBe(record.revision);
}));
it.each(["EPERM", "ENOENT"])("retries failed rules Worker validation (%s) on the same frozen candidate before publication", async code => fixture(async c => {
  let attempts = 0, builds = 0, dir: string | undefined;
  const adapters = { build: async (_repo: string, candidate: string) => { builds++; dir = candidate; await atomicJson(path.join(candidate, "artifacts/worker.js"), { frozen: true }); },
    smoke: async () => { if (++attempts <= 2) throw Object.assign(new Error("SMOKE_FAILED"), { code }); } };
  await expect(prepareRulesCandidate(c.repo, adapters)).rejects.toThrow("SMOKE_FAILED");
  await expect(publishRulesCandidate(dir!, c.adapters)).rejects.toThrow("CANDIDATE_NOT_VALIDATED");
  expect(c.calls).toEqual([]);
  await expect(prepareRulesCandidate(c.repo, adapters)).rejects.toThrow("SMOKE_FAILED");
  await expect(publishRulesCandidate(dir!, c.adapters)).rejects.toThrow("CANDIDATE_NOT_VALIDATED");
  expect(builds).toBe(1);
  expect(await prepareRulesCandidate(c.repo, adapters)).toBe(dir);
  expect(attempts).toBe(3); expect(builds).toBe(1);
  await prepareRulesCandidate(c.repo, adapters); expect(attempts).toBe(3);
  await publishRulesCandidate(dir!, c.adapters);
  expect(c.calls).toEqual(["deploy", "confirm"]);
}));
it("binds rules validation success to the complete candidate record", async () => fixture(async c => {
  const dir = await c.prepare(), file = path.join(dir, "candidate.json"), record = JSON.parse(await fs.readFile(file, "utf8"));
  record.validation_test = "changed record"; await atomicJson(file, record);
  await expect(publishRulesCandidate(dir, c.adapters)).rejects.toThrow("CANDIDATE_NOT_VALIDATED");
  expect(c.calls).toEqual([]);
}));
it.each(["deploy", "confirm"])("records publication as unconfirmed after %s failure and resumes the same candidate", async phase => fixture(async c => {
  const dir = await c.prepare(), original = c.adapters[phase];
  c.adapters[phase] = async () => { throw new Error("UNAVAILABLE"); };
  await expect(publishRulesCandidate(dir, c.adapters)).rejects.toThrow("UNAVAILABLE");
  const status = JSON.parse(await fs.readFile(path.join(dir, "publication.json"), "utf8"));
  expect(status.status).toBe("PUBLICATION_UNCONFIRMED"); expect(status.notice).toContain("切替済みの可能性");
  expect(JSON.parse(await fs.readFile(c.rulesHistoryPath, "utf8"))).toEqual(c.history);
  c.adapters[phase] = original; await publishRulesCandidate(dir, c.adapters);
  expect(c.calls.filter((v: string) => v === "deploy")).toHaveLength(1);
  expect(await c.untouched()).toBe(c.initial);
}));
it.each(["skills", "rules"])("rejects a stale candidate after concurrent %s history changes", async which => fixture(async c => {
  const dir = await c.prepare();
  if (which === "skills") { c.skills.releases[0].acceptance = "revoked"; await atomicJson(c.skillHistoryPath, c.skills); }
  else { c.history.rules_enforcement_at = "2026-12-01T00:00:00Z"; await atomicJson(c.rulesHistoryPath, c.history); }
  await expect(publishRulesCandidate(dir, c.adapters)).rejects.toThrow("STALE_RELEASE_CANDIDATE");
  expect(c.calls).toEqual([]);
}));
it("does not lose an update that occurs during the production confirmation callback", async () => fixture(async c => {
  const dir = await c.prepare();
  c.adapters.confirm = async () => { c.history.rules_enforcement_at = "2026-12-01T00:00:00Z"; await atomicJson(c.rulesHistoryPath, c.history); };
  await expect(publishRulesCandidate(dir, c.adapters)).rejects.toThrow("STALE_RELEASE_CANDIDATE");
  expect(JSON.parse(await fs.readFile(c.rulesHistoryPath, "utf8")).rules_enforcement_at).toBe("2026-12-01T00:00:00Z");
}));
it("rejects mutated Worker/registry artifacts and lost history", async () => fixture(async c => {
  const dir = await c.prepare(); await fs.appendFile(path.join(dir, "artifacts/worker.js"), "changed");
  await expect(publishRulesCandidate(dir, c.adapters)).rejects.toThrow("CANDIDATE_CHANGED");
  expect(c.calls).toEqual([]);
}));
it("supports explicit withdrawal and current restoration without reviving withdrawn revisions", async () => fixture(async c => {
  const dir = await c.prepare(); await publishRulesCandidate(dir, c.adapters);
  const current = JSON.parse(await fs.readFile(c.rulesHistoryPath, "utf8"));
  const management = await c.prepare({ withdraw: current.current_revision, current: generatedRules.ruleset_ref.revision });
  await publishRulesCandidate(management, c.adapters);
  const result = JSON.parse(await fs.readFile(c.rulesHistoryPath, "utf8"));
  expect(result.current_revision).toBe(generatedRules.ruleset_ref.revision);
  expect(result.revisions.find((r: any) => r.revision === current.current_revision).status).toBe("withdrawn");
  await expect(c.prepare()).rejects.toThrow("RULESET_WITHDRAWN");
  expect(JSON.parse(await fs.readFile(c.skillHistoryPath, "utf8")).releases.at(-1).acceptance).toBe("revoked");
}));
it("requires the first normal plugin release and shares the same operational lock", async () => fixture(async c => {
  const old = { ...c.skills, enforcement_at: null }; await atomicJson(c.skillHistoryPath, old);
  await expect(c.prepare()).rejects.toThrow("INITIAL_PLUGIN_RELEASE_REQUIRED");
  await withReleaseLock(c.repo, async () => { await expect(withReleaseLock(c.repo, async () => {})).rejects.toThrow(); });
}));
it("prevents a different candidate from dropping a deployment whose publication is unconfirmed", async () => fixture(async c => {
  const dir = await c.prepare(); await claimPending(c.repo, dir);
  await fs.appendFile(path.join(c.repo, "rules/measurement/source.md"), "\n後続編集\n");
  await expect(c.prepare()).rejects.toThrow("PENDING_RELEASE_REQUIRES_RESUME");
  await clearPending(c.repo, dir);
  expect(await c.prepare()).not.toBe(dir);
}));
it("does not mark history saved when the save fails, and can recover after the filesystem is restored", async () => fixture(async c => {
  const dir = await c.prepare();
  c.adapters.confirm = async () => { await fs.unlink(c.rulesHistoryPath); await fs.mkdir(c.rulesHistoryPath); };
  await expect(publishRulesCandidate(dir, c.adapters)).rejects.toThrow();
  expect(JSON.parse(await fs.readFile(path.join(dir, "publication.json"), "utf8")).status).not.toBe("PUBLISHED");
  await fs.rmdir(c.rulesHistoryPath); await atomicJson(c.rulesHistoryPath, c.history);
  c.adapters.confirm = async () => {}; await publishRulesCandidate(dir, c.adapters);
  expect(c.calls.filter((v: string) => v === "deploy")).toHaveLength(1);
}));
it("builds and runs a real rules-only Worker candidate while leaving plugin inputs unchanged", async () => fixture(async c => {
  await fs.cp(path.join(actualRepo, "src"), path.join(c.repo, "src"), { recursive: true });
  await fs.copyFile(path.join(actualRepo, "profiles/local-test.json"), path.join(c.repo, "profiles/local-test.json"));
  await fs.symlink(path.join(actualRepo, "node_modules"), path.join(c.repo, "node_modules"), "junction");
  const dir = await prepareRulesCandidate(c.repo, { build: buildFrozenWorker, smoke: async (_repo: string, candidate: string) => run(actualRepo, "scripts/smoke-worker.mjs", [candidate]) });
  expect(await c.untouched()).toBe(c.initial);
  await verifyRulesCandidate(dir, c.skills, c.history);
  expect(JSON.parse(await fs.readFile(path.join(dir, "candidate.json"), "utf8")).kind).toBe("measurement-rules");
}), 60000);
