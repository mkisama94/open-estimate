import { mcpState } from "../state.js";
import { validateAssessment } from "../../core/validate.js";
import { normalizeAssessment } from "../../core/normalize.js";
import { measureAssessment } from "../../core/measure.js";
import { estimateAssessment } from "../../core/estimate.js";
import { extractFeatures } from "../../core/features.js";
import { jcsSha256 } from "../../core/canonical.js";
import { parseStrictJson } from "../../core/json-parser.js";
import type { Assessment, CalculationContext, Report } from "../../core/types.js";

export interface EvaluateAssessmentArgs {
  snapshot_id: string;
  assessment: string | Assessment;
  locale?: string;
  display_currency?: string;
}

export async function handleEvaluateAssessment(args: EvaluateAssessmentArgs): Promise<any> {
  const { snapshot_id } = args;
  if (!snapshot_id) {
    throw new Error("snapshot_id is required");
  }

  const snapshotEntry = mcpState.getSnapshot(snapshot_id);
  if (!snapshotEntry) {
    throw new Error(`Snapshot '${snapshot_id}' not found or expired`);
  }
  const { snapshot, tracker } = snapshotEntry;

  // Parse raw JSON strictly if passed as string to detect duplicate keys
  let rawAssessment: any;
  if (typeof args.assessment === "string") {
    rawAssessment = parseStrictJson(args.assessment);
  } else {
    rawAssessment = args.assessment;
  }

  // 1. Reconcile input using coverage tracker
  let inputReconciled = false;
  if (rawAssessment.input && rawAssessment.input.manifest) {
    const { reconciledInput, wasReconciled } = tracker.reconcileInput(rawAssessment.input);
    rawAssessment.input = reconciledInput;
    inputReconciled = wasReconciled;
  }

  // 2. Validate Assessment strictly (Schema + Semantic)
  const validated = validateAssessment(rawAssessment);

  // 3. Normalize Assessment (deterministic IDs and Unicode code point ordering)
  const { normalized, assessment_hash } = normalizeAssessment(validated);

  // 4. Deterministic Measurement (COSMIC data movements counting and status)
  const measurement = measureAssessment(normalized);

  // 5. Estimation using TEST profile or available profile
  const locale = args.locale || "ja-JP";
  const displayCurrency = args.display_currency || (locale.includes("JP") ? "JPY" : "USD");

  // Standard Ph1 M1 TEST context
  const context: CalculationContext = {
    locale,
    display_currency: displayCurrency,
    benchmarkProfile: {
      id: "oes-test-benchmark-2026-v1",
      sample_size: 10,
      hours_per_cfp: {
        p25: "2",
        median: "3",
        p75: "5"
      },
      min_cfp: 1,
      max_cfp: 10000,
      is_test: true
    },
    wageProfile: {
      id: "oes-test-wage-2026-v1",
      hourly_wage_usd: "50",
      is_test: true
    },
    fxRate: displayCurrency === "JPY" ? { currency: "JPY", currency_per_usd: "150" } : undefined
  };

  const estimation = estimateAssessment(measurement, context);
  const features = extractFeatures(normalized);

  const report: Report = {
    domain: "open-estimate/report/ph1/v1",
    assessment_id: normalized.assessment_id,
    assessment_hash,
    profile_set_id: "oes-test-profile-set-2026-v1",
    measurement,
    assurance: {
      assessment_class: "COMMUNITY",
      context_isolation: "not_enforced",
      semantic_assessment: "NOT_INDEPENDENTLY_VERIFIED"
    },
    effort: estimation.effort,
    reference_usd: estimation.reference_usd,
    localized_reference: estimation.localized_reference,
    features,
    limitation_codes: estimation.limitation_codes,
    generated_at: new Date().toISOString()
  };

  const report_hash = jcsSha256(report);

  // Save to local MCP state
  mcpState.saveEvaluation({
    assessment_id: normalized.assessment_id,
    normalizedAssessment: normalized,
    report,
    report_hash,
    context
  });

  const issues = normalized.findings.map(f => ({
    finding_id: f.finding_id,
    category: f.category,
    severity: f.severity,
    message: f.message
  }));

  return {
    assessment_id: normalized.assessment_id,
    report,
    report_hash,
    profile_set_id: report.profile_set_id,
    input_reconciled: inputReconciled,
    issues
  };
}
