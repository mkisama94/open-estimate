import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getStateRoot, privateDirectory } from "../storage.js";
import { handleGetEvaluation, type GetEvaluationArgs } from "./get-evaluation.js";
import { renderEvaluationHtml } from "../presentation.js";
import { frbProvider, type FxProvider } from "../../profiles/frb.js";

export async function handleRenderReport(args: GetEvaluationArgs, provider: FxProvider = frbProvider) {
  const view = await handleGetEvaluation(args, provider);
  const dir = path.join(getStateRoot(), "reports");
  await privateDirectory(dir);
  const output = path.join(dir, `${args.evaluation_id}-${randomUUID()}.html`);
  await fs.writeFile(output, renderEvaluationHtml(view), { flag: "wx", mode: 0o600 });
  return { evaluation_id: view.evaluation_id, path: output, format: "html", signed: false, published: false,
    report_hash: view.report_hash, display_quote: view.display_quote, notices: view.notices };
}
