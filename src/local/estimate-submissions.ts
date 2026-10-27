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
export async function prepareEstimate(value:unknown){
  const args=checkContract<{run_id:string;display_currency:string}>(obj({run_id:uuidSchema,display_currency:{enum:[...CURRENCIES]}}),value);
  const run=await readRun(args.run_id),model=readCertificateJson(await fs.readFile(await resolveSafePath("model.json",run.dir))) as EstimateInput["evaluation"]["model"];
  if(jcsSha256(model)!==run.metadata.numeric_model_hash)throw new Error("RUN_CHECKSUM_MISMATCH");
  const context=run.metadata.rules_context as any;
  if(!context?.ruleset_ref || !context.bundle)throw new Error("RULESET_NOT_BOUND");
  validateRulesBundle(context.bundle,context.ruleset_ref);
  const candidate=projectPublicResult(run.assessment,run.summary),profile=certificateCalculationProfile(),report=validateAndRecomputeNumericModel(model,profile);
  if(jcsSha256(report.measurement)!==jcsSha256(candidate.measurement))throw new Error("RESULT_MISMATCH");
  const input:EstimateInput={schema_version:"oes/owner-estimate-input/v1",evaluation:{model,display_currency:args.display_currency,
    skill_integrity:{format:"oes/skill-integrity/v1",skill_id:"open-estimate-assessor",skill_version:run.metadata.skill.version,hash_rule:"oes/skill-package/v1",package_sha256:run.metadata.skill.declared_package_sha256},ruleset_ref:context.ruleset_ref},
    quality:candidate.quality,expected_report_hash:jcsSha256({model,profile,report})};
  checkContract(estimateInputSchema,input);
  const nonce=randomBytes(32).toString("base64url"),submission_id=randomUUID();
  const submission={submission_id,estimate_input:input,nonce,input_commitment:estimateCommitment(input,nonce)};
  await privateDirectory(estimateSubmissionsRoot());
  const dir=await resolveSafePath(submission_id,estimateSubmissionsRoot());await fs.mkdir(dir,{mode:0o700});
  const raw=JSON.stringify(submission);await fs.writeFile(path.join(dir,"submission.json"),raw,{flag:"wx",mode:0o600});
  await fs.writeFile(path.join(dir,"local-receipt.json"),JSON.stringify({run_id:args.run_id,checksums_hash:run.checksums_hash}),{flag:"wx",mode:0o600});
  await fs.writeFile(path.join(dir,"COMPLETE.json"),JSON.stringify({sha256:sha256Hex(raw)}),{flag:"wx",mode:0o600});
  return {submission_id,status:"PREPARED",transmitted:false,web_complete:false,next_action:"preview-estimate"};
}
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
