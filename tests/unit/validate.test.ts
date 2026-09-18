import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateAssessment, SemanticValidationError } from "../../src/core/validate.js";
import type { Assessment } from "../../src/core/types.js";

const basicAssessmentPath = path.resolve(__dirname, "../../examples/basic-assessment.json");
const basicAssessment: Assessment = JSON.parse(fs.readFileSync(basicAssessmentPath, "utf8"));

describe("Assessment Validation (T01, T03)", () => {
  it("passes valid basic-assessment fixture", () => {
    const validated = validateAssessment(basicAssessment);
    expect(validated.assessment_id).toBe(basicAssessment.assessment_id);
  });

  it("rejects unknown properties like weight or multiplier (A06)", () => {
    const clone: any = JSON.parse(JSON.stringify(basicAssessment));
    clone.functional_processes[0].movements[0].weight = 2;
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });

  it("rejects duplicate component IDs (A07)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.components.push({
      component_id: "comp-1",
      name: "duplicate-comp",
      status: "measured",
      scope_impact: false,
      path_prefixes: [],
      reason: "duplicate"
    });
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });

  it("rejects unknown evidence file_path (A08)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.evidence[0].file_path = "non-existent-file.ts";
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });

  it("rejects line_start > line_end (A09)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.evidence[0].line_start = 30;
    clone.evidence[0].line_end = 10;
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });

  it("rejects line_end exceeding file line_count (A10)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.evidence[0].line_end = 999;
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });

  it("rejects accepted process with only Entry (A11)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.functional_processes[0].movements = [clone.functional_processes[0].movements[0]];
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });

  it("rejects accepted process with only Entry and Read without Exit or Write (A12)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.functional_processes[1].movements = [
      clone.functional_processes[1].movements[0], // Entry
      clone.functional_processes[1].movements[1]  // Read
    ];
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });

  it("rejects trigger_movement that is not an Entry (A13)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.functional_processes[0].trigger_movement_id = clone.functional_processes[0].movements[1].movement_id; // Write
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });

  it("rejects Entry movement with null peer_id or non-null store_id (A14)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.functional_processes[0].movements[0].peer_id = null;
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });

  it("rejects duplicate logical movement in same process (A16)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    const dupMov = {
      ...clone.functional_processes[0].movements[0],
      movement_id: "mov-new-dup"
    };
    clone.functional_processes[0].movements.push(dupMov);
    expect(() => validateAssessment(clone)).toThrow(SemanticValidationError);
  });
});
