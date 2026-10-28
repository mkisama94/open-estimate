import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes,randomUUID } from "node:crypto";
import { readRun,runsRoot } from "./runs.js";
import { privateDirectory } from "../local-files.js";
import { resolveSafePath } from "../collector/safe-paths.js";
import { checkContract,obj } from "../core/certificate-contract.js";
import { uuidSchema } from "../core/preview-transfer-contract.js";
import { estimateInputSchema,estimateCommitment,type EstimateInput } from "../core/estimate-preview.js";
import { projectPublicResult } from "../core/public-result.js";
import { validateAndRecomputeNumericModel } from "../core/numeric-model.js";
import { certificateCalculationProfile } from "../profiles/certificate-basis.js";
import { jcsSha256,sha256Hex } from "../core/canonical.js";
import { readCertificateJson } from "../core/certificate-json.js";
import { validateRulesBundle } from "../rules/measurement-contract.js";
import { CURRENCIES } from "../profiles/frb.js";

export const estimateSubmissionsRoot=()=>path.join(path.dirname(runsRoot()),"estimate-submissions");
export async function readEstimateSubmission(id:string){
  checkContract(uuidSchema,id);const dir=await resolveSafePath(id,estimateSubmissionsRoot());
  const load=async(name:string)=>{const file=await resolveSafePath(name,dir),stat=await fs.lstat(file);if(!stat.isFile() || stat.isSymbolicLink() || stat.size>1024*1024)throw new Error("INVALID_SUBMISSION");return fs.readFile(file);};
  const raw=await load("submission.json"),marker=readCertificateJson(await load("COMPLETE.json")) as any;
  if(sha256Hex(raw)!==marker.sha256)throw new Error("INVALID_SUBMISSION");
  const s=readCertificateJson(raw) as {submission_id:string;estimate_input:EstimateInput;nonce:string;input_commitment:ReturnType<typeof estimateCommitment>};
  checkContract(estimateInputSchema,s.estimate_input);
  if(s.submission_id!==id || jcsSha256(s.input_commitment)!==jcsSha256(estimateCommitment(s.estimate_input,s.nonce)))throw new Error("INVALID_SUBMISSION");
  return s;
}
