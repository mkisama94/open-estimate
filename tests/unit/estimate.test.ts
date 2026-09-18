import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { measureAssessment } from "../../src/core/measure.js";
import { estimateAssessment } from "../../src/core/estimate.js";
import type { Assessment, CalculationContext } from "../../src/core/types.js";

const basicAssessmentPath = path.resolve(__dirname, "../../examples/basic-assessment.json");
const contextPath = path.resolve(__dirname, "../../examples/calculation-context.test.json");

const basicAssessment: Assessment = JSON.parse(fs.readFileSync(basicAssessmentPath, "utf8"));
const testContext: CalculationContext = JSON.parse(fs.readFileSync(contextPath, "utf8"));

describe("Estimation Logic (T05 / A30, A31, A32)", () => {
  it("computes effort 12/18/30 person-hours for 6 CFP with q=[2,3,5] (A30)", () => {
    const measurement = measureAssessment(basicAssessment);
    const estimation = estimateAssessment(measurement, testContext);

    expect(estimation.effort.status).toBe("AVAILABLE");
    expect(estimation.effort.person_hours).toEqual({
      p25: "12",
      median: "18",
      p75: "30"
    });
  });

  it("computes USD 600/900/1500 with wage=50 USD/h (A31)", () => {
    const measurement = measureAssessment(basicAssessment);
    const estimation = estimateAssessment(measurement, testContext);

    expect(estimation.reference_usd.status).toBe("AVAILABLE");
    expect(estimation.reference_usd.amount_usd).toEqual({
      p25: "600",
      median: "900",
      p75: "1500"
    });
  });

  it("computes JPY 90000/135000/225000 with JPY150/USD (A32)", () => {
    const measurement = measureAssessment(basicAssessment);
    const estimation = estimateAssessment(measurement, testContext);

    expect(estimation.localized_reference.status).toBe("AVAILABLE");
    expect(estimation.localized_reference.currency).toBe("JPY");
    expect(estimation.localized_reference.amount).toEqual({
      p25: "90000",
      median: "135000",
      p75: "225000"
    });
  });

  it("returns null effort and amounts when benchmark is unavailable (A35)", () => {
    const measurement = measureAssessment(basicAssessment);
    const contextWithoutBenchmark: CalculationContext = {
      ...testContext,
      benchmarkProfile: null
    };
    const estimation = estimateAssessment(measurement, contextWithoutBenchmark);

    expect(estimation.effort.status).toBe("BENCHMARK_UNAVAILABLE");
    expect(estimation.effort.person_hours).toBeNull();
    expect(estimation.reference_usd.amount_usd).toBeNull();
    expect(estimation.limitation_codes).toContain("BENCHMARK_UNAVAILABLE");
  });
});
