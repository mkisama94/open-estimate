import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleGetAssessorContract } from "../../src/mcp/tools/get-assessor-contract.js";
import { handlePrepareRepository } from "../../src/mcp/tools/prepare-repository.js";
import { handleReadRepositoryFile } from "../../src/mcp/tools/read-repository-file.js";
import { handleEvaluateAssessment } from "../../src/mcp/tools/evaluate-assessment.js";
import { createMcpServer } from "../../src/mcp/server.js";
import type { Assessment } from "../../src/core/types.js";

const basicAssessmentPath = path.resolve(__dirname, "../../examples/basic-assessment.json");
const basicAssessment: Assessment = JSON.parse(fs.readFileSync(basicAssessmentPath, "utf8"));

describe("MCP Tools End-to-End Workflow (M1)", () => {
  it("server defines the 4 M1 tools in listTools", async () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });

  it("exposes contracts and instructions as MCP resources", async () => {
    const { OES_RESOURCES, handleReadResource } = await import("../../src/mcp/resources.js");
    expect(OES_RESOURCES.length).toBe(2);
    const schemaRes = await handleReadResource("open-estimate://contracts/assessment-schema");
    expect(schemaRes.mimeType).toBe("application/json");
    expect(schemaRes.text).toContain("Assessment");

    const instructionsRes = await handleReadResource("open-estimate://skills/assessor-instructions");
    expect(instructionsRes.mimeType).toBe("text/markdown");
    expect(instructionsRes.text).toContain("COSMIC");
  });

  it("completes full M1 workflow through the 4 tools", async () => {
    // 1. get_assessor_contract
    const contract = await handleGetAssessorContract();
    expect(contract.schema).toBeDefined();
    expect(contract.assessor_instructions).toContain("COSMIC");
    expect(contract.limits.max_read_lines_per_call).toBe(400);

    // 2. prepare_repository
    const prepResult = await handlePrepareRepository({ relative_path: "examples" });
    expect(prepResult.snapshot_id).toBeDefined();
    expect(prepResult.manifest.files.length).toBeGreaterThan(0);
    expect(prepResult.manifest_hash).toBeDefined();
    expect(prepResult.summary.total_files).toBeGreaterThan(0);

    const snapshotId = prepResult.snapshot_id;
    // 3. read_repository_file - Read all files so analysis coverage is complete
    for (const file of prepResult.manifest.files) {
      if (file.disposition !== "excluded") {
        let nextStart: number | null = 1;
        while (nextStart !== null) {
          const chunk = await handleReadRepositoryFile({
            snapshot_id: snapshotId,
            file_id: file.path,
            start_line: nextStart,
            max_lines: 400
          });
          nextStart = chunk.next_start_line;
        }
      }
    }
    const targetFile = prepResult.manifest.files[0];

    // 4. evaluate_assessment
    // Prepare an assessment tied to this snapshot
    const assessmentForSnapshot: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    assessmentForSnapshot.input.manifest = prepResult.manifest;
    assessmentForSnapshot.input.manifest_hash = prepResult.manifest_hash;
    // Map evidence file_path to existing snapshot file
    assessmentForSnapshot.evidence.forEach(e => {
      e.file_path = targetFile.path;
      e.line_start = 1;
      e.line_end = Math.min(10, targetFile.line_count || 1);
    });

    const evalResult = await handleEvaluateAssessment({
      snapshot_id: snapshotId,
      assessment: assessmentForSnapshot,
      locale: "ja-JP",
      display_currency: "JPY"
    });

    expect(evalResult.assessment_id).toBe(assessmentForSnapshot.assessment_id);
    expect(evalResult.report).toBeDefined();
    expect(evalResult.report.measurement.cfp).toBe(6);
    expect(evalResult.report.measurement.status).toBe("COMPLETE");
    expect(evalResult.report.effort.status).toBe("AVAILABLE");
    expect(evalResult.report.effort.person_hours.median).toBe("18"); // 6 * 3
    expect(evalResult.report.reference_usd.amount_usd.median).toBe("900"); // 18 * 50
    expect(evalResult.report.localized_reference.amount.median).toBe("135000"); // 900 * 150
    expect(evalResult.report_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
