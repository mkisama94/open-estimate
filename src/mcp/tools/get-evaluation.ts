import { loadEvaluation } from "../storage.js";
import { presentEvaluation } from "../presentation.js";
import { frbProvider, type FxProvider } from "../../profiles/frb.js";

export interface GetEvaluationArgs { evaluation_id: string; locale?: string; display_currency?: string; }
export async function handleGetEvaluation(args: GetEvaluationArgs, provider: FxProvider = frbProvider) {
  return presentEvaluation(await loadEvaluation(args.evaluation_id), provider, args.locale, args.display_currency);
}
