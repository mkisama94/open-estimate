import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { handleGetAssessorContract } from "../../src/mcp/tools/get-assessor-contract.js";
import { handlePrepareRepository } from "../../src/mcp/tools/prepare-repository.js";
import { handleReadRepositoryFile } from "../../src/mcp/tools/read-repository-file.js";
import { handleEvaluateAssessment } from "../../src/mcp/tools/evaluate-assessment.js";
import { handleGetEvaluation } from "../../src/mcp/tools/get-evaluation.js";
import { handleRenderReport } from "../../src/mcp/tools/render-report.js";
import { loadEvaluation } from "../../src/mcp/storage.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { FrbProvider } from "../../src/profiles/frb.js";
import { frbHtml, fxNow, htmlResponse } from "../fixtures/frb.js";
import type { Assessment } from "../../src/core/types.js";

const fixture: Assessment = JSON.parse(await fs.readFile(new URL("../../examples/basic-assessment.json", import.meta.url), "utf8"));
const fx = () => new FrbProvider(async () => htmlResponse(frbHtml()), () => fxNow);
async function prepare(read = true) {
  const prep = await handlePrepareRepository({ relative_path: "examples/quality-check" });
  if (read) for (const file of prep.manifest.files) if (file.disposition !== "excluded") {
    await handleReadRepositoryFile({ snapshot_id: prep.snapshot_id, file_id: file.path });
  }
  const a = structuredClone(fixture);
  a.assessment_id = prep.assessment_id;
  a.input = prep.assessment_input;
  a.assessor = { ...prep.assessor_defaults, finished_at: new Date().toISOString() };
  a.components[0].path_prefixes = ["notes.js"];
  a.data_groups[0].attributes = ["id", "title", "content"];
  a.functional_processes[1].movements.find(m => m.type === "Exit")!.data_group_id = "dg-note";
  a.evidence[0] = { ...a.evidence[0], file_path: "notes.js", line_start: 5, line_end: 14 };
  a.evidence[1] = { ...a.evidence[1], file_path: "notes.js", line_start: 16, line_end: 21 };
  return { prep, a };
}

beforeAll(async () => {
  process.env.OES_STATE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "oes-test-state-"));
});

describe("Local preview end-to-end", () => {
  it("exposes three versioned resources and a verified assessor contract", async () => {
    const { OES_RESOURCES, handleReadResource } = await import("../../src/mcp/resources.js");
    expect(OES_RESOURCES.length).toBe(3);
    expect((await handleReadResource("open-estimate://contracts/local-preview")).text).toContain("DisplayQuote");
    const c = await handleGetAssessorContract();
    expect(c.skill.skill_version).toBe("0.4.0");
    expect(c.profile.environment).toBe("TEST");
    expect(c.capabilities.publishing).toBe(false);
  });
  it("reads real source, evaluates 6 CFP, persists, reopens and renders", async () => {
    const { prep, a } = await prepare();
    const result = await handleEvaluateAssessment({ snapshot_id: prep.snapshot_id, assessment: JSON.stringify(a) }, fx());
    expect(result.report.measurement.status).toBe("COMPLETE");
    expect(result.report.measurement.cfp).toBe(6);
    expect(result.report.effort.person_hours?.median).toBe("18");
    expect(result.report.reference_usd.amount_usd?.median).toBe("900");
    expect(result.display_quote.localized_reference.amount?.median).toBe("135000");
    expect(result.input_reconciled).toBe(true);
    expect((await loadEvaluation(result.evaluation_id)).report_hash).toBe(result.report_hash);
    const later = await handleGetEvaluation({ evaluation_id: result.evaluation_id }, new FrbProvider(async () => htmlResponse(frbHtml("160")), () => fxNow));
    expect(later.report_hash).toBe(result.report_hash);
    expect(later.display_quote.localized_reference.amount?.median).toBe("144000");
    const report = await handleRenderReport({ evaluation_id: result.evaluation_id }, fx());
    const html = await fs.readFile(report.path, "utf8");
    expect(html).toContain("TEST試算");
    expect(html).toContain("notes.js");
    expect(html).toContain("このHTMLは生成時点の記録");
    expect(html).toContain("設計・実装・テスト");
  });
  it("rejects unread evidence despite submitted analyzed flags", async () => {
    const { prep, a } = await prepare(false);
    a.input.manifest.files[0].disposition = "analyzed";
    await expect(handleEvaluateAssessment({ snapshot_id: prep.snapshot_id, assessment: a }, fx())).rejects.toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ code: "UNREAD_EVIDENCE_SOURCE" })]) });
  });
  it("rejects omitted manifest entries, modified digests and mismatched skills", async () => {
    const { prep, a } = await prepare();
    const omit = structuredClone(a); omit.input.manifest.files = [];
    await expect(handleEvaluateAssessment({ snapshot_id: prep.snapshot_id, assessment: omit }, fx())).rejects.toThrow("SNAPSHOT_MANIFEST_MISMATCH");
    const forged = structuredClone(a); forged.input.manifest.files[0].sha256 = "0".repeat(64);
    await expect(handleEvaluateAssessment({ snapshot_id: prep.snapshot_id, assessment: forged }, fx())).rejects.toThrow("SNAPSHOT_MANIFEST_MISMATCH");
    a.assessor.skill_version = "0.0.0";
    await expect(handleEvaluateAssessment({ snapshot_id: prep.snapshot_id, assessment: a }, fx())).rejects.toThrow("ASSESSOR_SKILL_MISMATCH");
  });
  it("verifies saved content and rejects cross-workspace lookup", async () => {
    const { prep, a } = await prepare();
    const result = await handleEvaluateAssessment({ snapshot_id: prep.snapshot_id, assessment: a, display_currency: "USD" }, fx());
    const original = process.env.OES_WORKSPACE_ROOT;
    process.env.OES_WORKSPACE_ROOT = path.join(process.cwd(), "examples");
    try { await expect(loadEvaluation(result.evaluation_id)).rejects.toThrow("EVALUATION_UNAVAILABLE_FOR_WORKSPACE"); }
    finally { if (original === undefined) delete process.env.OES_WORKSPACE_ROOT; else process.env.OES_WORKSPACE_ROOT = original; }
    const filename = path.join(process.env.OES_STATE_DIR!, "evaluations", `${result.evaluation_id}.json`);
    const data = JSON.parse(await fs.readFile(filename, "utf8"));
    data.report.measurement.cfp = 100;
    await fs.writeFile(filename, JSON.stringify(data));
    await expect(loadEvaluation(result.evaluation_id)).rejects.toThrow("EVALUATION_INTEGRITY_ERROR");
  });
  it("rejects fabricated Git/source metadata", async () => {
    const { prep, a } = await prepare();
    a.input.dirty = false;
    await expect(handleEvaluateAssessment({ snapshot_id: prep.snapshot_id, assessment: a }, fx())).rejects.toThrow("SNAPSHOT_SOURCE_IDENTITY_MISMATCH");
  });
  it("validates actual MCP arguments and structured output through a client", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const client = new Client({ name: "test", version: "1.0.0" });
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map(t => t.name)).toEqual(["discover_workspace", "confirm_workspace", "get_assessor_contract", "prepare_repository", "read_repository_file", "evaluate_assessment", "get_evaluation", "render_report"]);
      const blocked = await client.callTool({ name: "prepare_repository", arguments: {} });
      expect(blocked.isError).toBe(true);
      const discovery = await client.callTool({ name: "discover_workspace", arguments: { context_path: process.cwd() } });
      expect(discovery.isError).not.toBe(true);
      await client.callTool({ name: "confirm_workspace", arguments: { candidate_id: discovery.structuredContent?.candidate_id, user_confirmed: true } });
      const invalid = await client.callTool({ name: "evaluate_assessment", arguments: { snapshot_id: "x", assessment: {} } });
      expect(invalid.isError).toBe(true);
      const { prep, a } = await prepare();
      const result = await client.callTool({ name: "evaluate_assessment", arguments: { snapshot_id: prep.snapshot_id, assessment: JSON.stringify(a), display_currency: "USD" } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent?.report_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse((result.content as any)[0].text)).toEqual(result.structuredContent);
      const reopened = await client.callTool({ name: "get_evaluation", arguments: { evaluation_id: result.structuredContent?.evaluation_id, display_currency: "USD" } });
      expect(reopened.isError).not.toBe(true);
      const rendered = await client.callTool({ name: "render_report", arguments: { evaluation_id: result.structuredContent?.evaluation_id, display_currency: "USD" } });
      expect(rendered.isError).not.toBe(true);
    } finally { await client.close(); await server.close(); }
  });
});
