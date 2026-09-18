import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { normalizeAssessment } from "../../src/core/normalize.js";
import { jcsSha256 } from "../../src/core/canonical.js";
import type { Assessment } from "../../src/core/types.js";

const basicAssessmentPath = path.resolve(__dirname, "../../examples/basic-assessment.json");
const basicAssessment: Assessment = JSON.parse(fs.readFileSync(basicAssessmentPath, "utf8"));

describe("Canonicalization and Determinism (T07 / A02, A03)", () => {
  it("produces identical assessment_hash regardless of object key order (A02)", () => {
    const origHash = normalizeAssessment(basicAssessment).assessment_hash;

    // Shuffle keys by re-serializing with different order
    const shuffled: any = {
      scope: basicAssessment.scope,
      assessment_id: basicAssessment.assessment_id,
      input: basicAssessment.input,
      assessor: basicAssessment.assessor,
      functional_processes: basicAssessment.functional_processes,
      human_amendments: basicAssessment.human_amendments,
      findings: basicAssessment.findings,
      evidence: basicAssessment.evidence,
      data_groups: basicAssessment.data_groups,
      objects_of_interest: basicAssessment.objects_of_interest,
      persistent_stores: basicAssessment.persistent_stores,
      functional_users: basicAssessment.functional_users,
      components: basicAssessment.components
    };

    const shuffledHash = normalizeAssessment(shuffled).assessment_hash;
    expect(shuffledHash).toBe(origHash);
  });

  it("produces identical hash after normalizing shuffled ID collections (A03)", () => {
    const origHash = normalizeAssessment(basicAssessment).assessment_hash;

    const clone: Assessment = JSON.parse(JSON.stringify(basicAssessment));
    // Reverse processes order
    clone.functional_processes.reverse();

    const normalizedHash = normalizeAssessment(clone).assessment_hash;
    expect(normalizedHash).toBe(origHash);
  });
});
