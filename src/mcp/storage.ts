import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createEvaluation, type EvaluationRecord, type FixedEvaluation } from "../core/evaluation.js";
import { jcsSha256 } from "../core/canonical.js";
import { validateAssessment } from "../core/validate.js";
import { getWorkspaceRoot } from "../collector/safe-paths.js";

import { privateDirectory } from "../local-files.js";
export { privateDirectory } from "../local-files.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function getStateRoot(): string {
  const base = process.env.OES_STATE_DIR ?? path.join(
    process.env.LOCALAPPDATA ?? (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state")),
    "OpenEstimate", "local-preview");
  return path.resolve(base);
}
async function workspaceHash() { return jcsSha256(await fs.realpath(getWorkspaceRoot())); }

export async function saveEvaluation(value: FixedEvaluation): Promise<EvaluationRecord> {
  const record: EvaluationRecord = {
    format: "open-estimate/local-evaluation/v3", evaluation_id: randomUUID(),
    evaluated_at: new Date().toISOString(), workspace_hash: await workspaceHash(), ...value
  };
  const dir = path.join(getStateRoot(), "evaluations");
  await privateDirectory(dir);
  const temp = path.join(dir, `.${record.evaluation_id}.tmp`);
  const file = await fs.open(temp, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
  finally { await file.close(); }
  await fs.rename(temp, path.join(dir, `${record.evaluation_id}.json`));
  return record;
}

export async function loadEvaluation(id: string): Promise<EvaluationRecord> {
  if (!UUID.test(id)) throw new Error("INVALID_EVALUATION_ID");
  const dir = path.join(getStateRoot(), "evaluations");
  await privateDirectory(dir);
  const file = path.join(dir, `${id}.json`);
  let record: EvaluationRecord;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("EVALUATION_CORRUPT");
    record = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e: any) { if (e.code === "ENOENT") throw new Error("EVALUATION_NOT_FOUND"); throw e; }
  if (record.format !== "open-estimate/local-evaluation/v3" || record.evaluation_id !== id
    || record.workspace_hash !== await workspaceHash()) throw new Error("EVALUATION_UNAVAILABLE_FOR_WORKSPACE");
  const recomputed = createEvaluation(validateAssessment(record.normalized_assessment), record.basis);
  if (jcsSha256(record.report) !== record.report_hash || recomputed.report_hash !== record.report_hash)
    throw new Error("EVALUATION_INTEGRITY_ERROR");
  return record;
}
