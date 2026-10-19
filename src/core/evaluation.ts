import { estimateAssessment } from "./estimate.js";
import { normalizeAssessment } from "./normalize.js";
import { measureAssessment } from "./measure.js";
import { extractFeatures } from "./features.js";
import { jcsSha256 } from "./canonical.js";
import type { Assessment, CalculationContext } from "./types.js";
import { isRecordedAssessment } from "./records.js";

export interface LocalProfile {
  profile_set_id: string;
  environment: "TEST";
  effort_scope_id: "oes-design-implementation-test-v1";
  effort_scope_name: string;
  notice: string;
  benchmark: NonNullable<CalculationContext["benchmarkProfile"]>;
  wage: NonNullable<CalculationContext["wageProfile"]>;
}

/** No clock, locale, network, or display FX enters this calculation. */
export function createEvaluation(assessment: Assessment, profile: LocalProfile) {
  const { normalized, assessment_hash } = normalizeAssessment(assessment);
  const basis = {
    domain: "open-estimate/calculation-basis/v3" as const,
    engine_version: assessment.quality ? "0.8.1-quality" : isRecordedAssessment(assessment) ? "0.5.0-records" : "0.2.0",
    mapping_version: "oes-cosmic-ph1-v1",
    ...structuredClone(profile)
  };
  const measurement = measureAssessment(normalized);
  const estimation = estimateAssessment(measurement, {
    locale: "en-US", display_currency: "USD",
    benchmarkProfile: basis.benchmark, wageProfile: basis.wage
  });
  const report = {
    domain: "open-estimate/report/ph1/v3" as const,
    assessment_id: normalized.assessment_id,
    assessment_hash,
    calculation_basis_hash: jcsSha256(basis),
    profile_set_id: basis.profile_set_id,
    measurement,
    assurance: {
      assessment_class: "COMMUNITY" as const,
      context_isolation: "not_enforced" as const,
      semantic_assessment: "NOT_INDEPENDENTLY_VERIFIED" as const
    },
    effort: estimation.effort,
    reference_usd: estimation.reference_usd,
    features: extractFeatures(normalized),
    limitation_codes: [...new Set([...estimation.limitation_codes, "TEST_DATA_ONLY"])].sort()
  };
  return { normalized_assessment: normalized, basis, report, report_hash: jcsSha256(report) };
}

export type FixedEvaluation = ReturnType<typeof createEvaluation>;
export interface EvaluationRecord extends FixedEvaluation {
  format: "open-estimate/local-evaluation/v3";
  evaluation_id: string;
  evaluated_at: string;
  workspace_hash: string;
}
