import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectModel, evaluateRemote as evaluateVerified } from "../../src/remote/model.js";
import { evaluateRemote, legacyRegistry, legacyIntegrity } from "../fixtures/skill-policy.js";
import { bindRules, measurementRegistry, skillRegistry } from "../fixtures/measurement.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import worker from "../../src/remote/worker.js";
import { FrbProvider } from "../../src/profiles/frb.js";
import { frbHtml, fxNow, htmlResponse } from "../fixtures/frb.js";
import type { Assessment } from "../../src/core/types.js";

const fixture: Assessment = JSON.parse(await fs.readFile("examples/basic-assessment.json", "utf8"));
const model = () => projectModel(structuredClone(fixture));
const args = () => ({ model: model(), display_currency: "USD", skill_integrity: legacyIntegrity });

describe("remote boundary", () => {
  it("recomputes CFP, effort, USD and FRB display from the numeric model", async () => {
    const result = await evaluateRemote({ ...args(), display_currency: "JPY" }, getLocalProfile(),
      new FrbProvider(async () => htmlResponse(frbHtml()), () => fxNow));
    expect(result.report.measurement.cfp).toBe(6);
    expect(result.report.effort.person_hours?.median).toBe("18");
    expect(result.report.reference_usd.amount_usd?.median).toBe("900");
    expect(result.display_quote.localized_reference.amount?.median).toBe("135000");
    expect(result.assurance.source_audit).toBe("NOT_INDEPENDENTLY_VERIFIED");
  });
  it.each(["cfp", "profile", "amount", "source", "path", "name", "assessment"])("rejects unapproved %s", async key => {
    await expect(evaluateRemote({ ...args(), [key]: "do not trust" }, getLocalProfile())).rejects.toThrow("INVALID_REMOTE_MODEL");
    const a: any = args(); a.model.processes[0][key] = "do not send";
    await expect(evaluateRemote(a, getLocalProfile())).rejects.toThrow("INVALID_REMOTE_MODEL");
  });
  it("removes arbitrary source strings rather than redacting field names", () => {
    const a = structuredClone(fixture);
    a.functional_processes[0].name = "SOURCE_SECRET_CANARY";
    a.evidence[0].description = "SOURCE_SECRET_CANARY";
    a.input.repository_label = "SOURCE_SECRET_CANARY";
    const sent = JSON.stringify(projectModel(a));
    expect(sent).not.toContain("SOURCE_SECRET_CANARY");
    expect(sent).not.toContain(a.evidence[0].file_path);
  });
  it("rejects broken references, missing trigger and duplicate movement", async () => {
    let a = args(); a.model.processes[0].movements[0].peer = 9999;
    await expect(evaluateRemote(a, getLocalProfile())).rejects.toThrow("INVALID_MODEL_REFERENCE");
    a = args(); a.model.processes[0].movements = a.model.processes[0].movements.filter(v => v.type !== "Entry");
    await expect(evaluateRemote(a, getLocalProfile())).rejects.toThrow("INVALID_ACCEPTED_PROCESS");
    a = args(); a.model.processes[0].movements.push(a.model.processes[0].movements[0]);
    await expect(evaluateRemote(a, getLocalProfile())).rejects.toThrow("DUPLICATE_MOVEMENT");
  });
  it("retains partial status and does not turn unavailable FX into zero", async () => {
    const a = args(); a.model.analysis_complete = false;
    const result = await evaluateRemote({ ...a, display_currency: "JPY" }, getLocalProfile(), {
      get: async () => ({ status: "FX_UNAVAILABLE", snapshot: null, limitation_codes: ["FX_UNAVAILABLE"] })
    });
    expect(result.report.measurement.status).toBe("PARTIAL");
    expect(result.display_quote.localized_reference.amount).toBeNull();
  });
  it("serves MCP initialization, list and tool calls over HTTP without session state", async () => {
    const call = async (method: string, params: unknown) => {
      const response = await worker.fetch(new Request("https://example.test/mcp", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      }), legacyRegistry, measurementRegistry());
      expect(response.status).toBe(200); return response.json() as Promise<any>;
    };
    expect((await call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } })).result.serverInfo.name).toBe("open-estimate-remote");
    const listed=(await call("tools/list",{})).result.tools;
    expect(listed.map((t:any)=>t.name)).toEqual(["get_estimate_experience","show_estimate_step","get_skill_policy","get_measurement_rules","publish_estimate"]);
    expect(listed.find((t:any)=>t.name==="publish_estimate").securitySchemes).toEqual([{type:"oauth2",scopes:["estimates:write"]}]);
    const ui=(await call("tools/call",{name:"show_estimate_step",arguments:{stage:"confirmation"}})).result;
    expect(ui.structuredContent).toEqual({stage:"confirmation"});
    const resource=(await call("resources/read",{uri:ui._meta.ui.resourceUri})).result.contents[0];expect(resource.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource.text).not.toContain("照合コードを入力");
    expect((await call("tools/call",{name:"evaluate_model",arguments:args()})).result.isError).toBe(true);
    expect((await call("tools/call",{name:"show_preview_confirmation",arguments:{transfer_id:"pt_"+"1".repeat(32)}})).result.isError).toBe(true);

  });
  it("rejects oversized bodies and foreign browser origins", async () => {
    expect((await worker.fetch(new Request("https://example.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(1024 * 1024 + 1) }))).status).toBe(413);
    expect((await worker.fetch(new Request("https://example.test/mcp", { method: "POST", headers: { origin: "https://evil.test" }, body: "{}" }))).status).toBe(403);
  });
});

describe("one-shot helper", () => {
  it("keeps confirmed scope and ledger across processes, rejects unread/tampered evidence, and purges", async () => {
    const state = await fs.mkdtemp(path.join(os.tmpdir(), "oes-helper-test-"));
    const root = path.resolve("examples/quality-check");
    const run = (command: string, input: any, ok = true) => {
      const child = spawnSync(process.execPath, ["dist/local/cli.js", command], {
        input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, OES_HELPER_STATE: state }, windowsHide: true
      });
      expect(child.status, child.stdout + child.stderr).toBe(ok ? 0 : 1);
      return JSON.parse(child.stdout);
    };
    const scan = run("scan", { root });
    const common = { root, session_id: scan.session_id };
    try {
      expect(scan.summary.source_content_read).toBe(false);
      expect(run("prepare", common, false).error.code).toBe("WORKSPACE_CONFIRMATION_REQUIRED");
      bindRules(run, common);
      run("confirm", { ...common, user_confirmed: true });
      expect(run("prepare", { ...common, root: path.resolve("examples") }, false).error.code).toBe("PROJECT_CHANGED_RECONFIRM_REQUIRED");
      const prep = run("prepare", common), a = structuredClone(fixture);
      a.assessment_id = prep.assessment_id; a.input = prep.assessment_input;
      a.assessor = { ...prep.assessor_defaults, finished_at: new Date().toISOString() };
      a.components[0].path_prefixes = ["notes.js"];
      a.data_groups[0].attributes = ["id", "title", "content"];
      a.functional_processes[1].movements.find(v => v.type === "Exit")!.data_group_id = "dg-note";
      a.evidence[0] = { ...a.evidence[0], file_path: "notes.js", line_start: 5, line_end: 14 };
      a.evidence[1] = { ...a.evidence[1], file_path: "notes.js", line_start: 16, line_end: 21 };
      const input = { ...common, snapshot_id: prep.snapshot_id, assessment: JSON.stringify(a) };
      run("export", input, false);
      run("read", { ...common, snapshot_id: prep.snapshot_id, file_id: "notes.js", max_lines: 10 });
      run("export", input, false);
      run("read", { ...common, snapshot_id: prep.snapshot_id, file_id: "notes.js", start_line: 11 });
      const exported = run("export", input);
      expect(exported.transmission).toBe("PREVIEW_ONLY_NOT_SENT");
      expect(JSON.stringify(exported.model)).not.toContain("notes.js");
      const result = await evaluateVerified({ model: exported.model, skill_integrity: exported.skill_integrity, ruleset_ref: exported.ruleset_ref, display_currency: "USD" }, getLocalProfile(), undefined, skillRegistry(exported.skill_integrity), Date.now(), measurementRegistry());
      expect(result.report.measurement.cfp).toBe(6);
      expect(result.assurance.skill_integrity.status).toBe("MATCHED_CLIENT_REPORTED");
      await fs.writeFile(path.join(state, scan.session_id, prep.snapshot_id, "files", "notes.js"), "tampered");
      expect(run("export", input, false).error.code).toBe("SNAPSHOT_CONTENT_CHANGED");
      const file = path.join(state, scan.session_id + ".json"), saved = JSON.parse(await fs.readFile(file, "utf8"));
      saved.created = 0; await fs.writeFile(file, JSON.stringify(saved));
      expect(run("prepare", common, false).error.code).toBe("SESSION_EXPIRED_PURGE_REQUIRED");
      run("purge", common);
      expect(await fs.readdir(state)).toEqual([]);
    } finally { await fs.rm(state, { recursive: true, force: true }); }
  }, 30000);
});
