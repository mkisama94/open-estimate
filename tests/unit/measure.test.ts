import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { measureAssessment } from "../../src/core/measure.js";
import type { Assessment } from "../../src/core/types.js";

const basicAssessmentPath = path.resolve(__dirname, "../../examples/basic-assessment.json");
const basicAssessment: Assessment = JSON.parse(fs.readFileSync(basicAssessmentPath, "utf8"));

describe("Deterministic Measurement (T04)", () => {
  it("measures basic-assessment as exactly 6 CFP (E2, X2, R1, W1) and COMPLETE (A01)", () => {
    const result = measureAssessment(basicAssessment);
    expect(result.cfp).toBe(6);
    expect(result.status).toBe("COMPLETE");
    expect(result.counts).toEqual({
      entry: 2,
      exit: 2,
      read: 1,
      write: 1,
      total_processes: 2,
      accepted_processes: 2
    });
  });

  it("marks as PARTIAL when unresolved process is mixed (A19)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.functional_processes[1].status = "unresolved";
    const result = measureAssessment(clone);
    expect(result.cfp).toBe(3); // only create-note (E1, W1, X1)
    expect(result.status).toBe("PARTIAL");
    expect(result.counts.accepted_processes).toBe(1);
    expect(result.counts.total_processes).toBe(2);
  });

  it("marks as INCOMPLETE when all processes are unresolved (A20)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.functional_processes.forEach(p => (p.status = "unresolved"));
    const result = measureAssessment(clone);
    expect(result.cfp).toBeNull();
    expect(result.status).toBe("INCOMPLETE");
  });

  it("marks as UNSUPPORTED when target is purely applicability limit (A21)", () => {
    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    clone.functional_processes = [];
    clone.components = [
      {
        component_id: "comp-ml",
        name: "ML Core",
        status: "excluded",
        scope_impact: true,
        path_prefixes: [],
        reason: "COSMIC applicability limit for statistical model"
      }
    ];
    const result = measureAssessment(clone);
    expect(result.cfp).toBeNull();
    expect(result.status).toBe("UNSUPPORTED");
  });
});
