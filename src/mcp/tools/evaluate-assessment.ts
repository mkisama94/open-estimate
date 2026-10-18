import { mcpState } from "../state.js";
import { validateAssessment } from "../../core/validate.js";
import { parseStrictJson } from "../../core/json-parser.js";
import { createEvaluation } from "../../core/evaluation.js";
import { getLocalProfile } from "../../profiles/local-profile.js";
import { saveEvaluation } from "../storage.js";
import { presentEvaluation } from "../presentation.js";
import { handleGetAssessorContract } from "./get-assessor-contract.js";
import { frbProvider, type FxProvider } from "../../profiles/frb.js";
import type { Assessment } from "../../core/types.js";
import { classifyFile } from "../../collector/classification.js";

export interface EvaluateAssessmentArgs {
  snapshot_id: string;
  assessment: string | Assessment;
  locale?: string;
  display_currency?: string;
}

export async function validateSnapshotAssessment(args: EvaluateAssessmentArgs) {
  const entry = mcpState.getSnapshot(args.snapshot_id);
  if (!entry) throw new Error("SNAPSHOT_NOT_FOUND_OR_EXPIRED");
  const json = typeof args.assessment === "string" ? args.assessment : JSON.stringify(args.assessment);
  if (Buffer.byteLength(json, "utf8") > 8 * 1024 * 1024) throw new Error("ASSESSMENT_TOO_LARGE");
  const raw: any = parseStrictJson(json);
  if (!raw || typeof raw !== "object" || !raw.input?.manifest?.files || !Array.isArray(raw.input.manifest.files))
    throw new Error("ASSESSMENT_INPUT_REQUIRED");
  const { reconciledInput, wasReconciled } = entry.tracker.reconcileInput(raw.input);
  for (const [key, value] of Object.entries(entry.snapshot.source_identity))
    if (raw.input[key] !== value) throw new Error("SNAPSHOT_SOURCE_IDENTITY_MISMATCH");
  raw.input = reconciledInput;
  const validated = validateAssessment(raw);
  if (!entry.snapshot.analysis_complete && !validated.findings.some(f => f.category === "coverage_gap" && f.severity === "blocking"))
    throw new Error("COVERAGE_FINDING_REQUIRED");
  for (const evidence of validated.evidence) {
    const category = classifyFile(evidence.file_path).category;
    if (["source", "schema", "configuration"].includes(evidence.evidence_type)
      && ["test", "doc", "manifest", "secret", "binary", "asset"].includes(category))
      throw new Error("EVIDENCE_TYPE_MISMATCH");
  }
  const contract = await handleGetAssessorContract();
  if (validated.assessor.skill_id !== contract.skill.skill_id || validated.assessor.skill_version !== contract.skill.skill_version
    || validated.assessor.skill_sha256 !== contract.skill.package_sha256) throw new Error("ASSESSOR_SKILL_MISMATCH");
  if (Date.parse(validated.assessor.started_at) > Date.parse(validated.assessor.finished_at)) throw new Error("INVALID_ASSESSOR_TIMES");
  return { validated, wasReconciled };
}

export async function handleEvaluateAssessment(args: EvaluateAssessmentArgs, provider: FxProvider = frbProvider) {
  const { validated, wasReconciled } = await validateSnapshotAssessment(args);
  const record = await saveEvaluation(createEvaluation(validated, getLocalProfile()));
  return { ...await presentEvaluation(record, provider, args.locale, args.display_currency), input_reconciled: wasReconciled };
}
