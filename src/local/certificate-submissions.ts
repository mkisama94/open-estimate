import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { readRun, runsRoot } from "./runs.js";
import { privateDirectory } from "../local-files.js";
import { resolveSafePath } from "../collector/safe-paths.js";
import { checkContract, frozenInputSchema, metadataSchema, obj, validateMetadata, type FrozenInput, type SkillIntegrity, type CertificateMetadata } from "../core/certificate-contract.js";
import { inputCommitment } from "../core/certificate.js";
import { readCertificateJson } from "../core/certificate-json.js";
import { projectPublicResult } from "../core/public-result.js";
import { validateAndRecomputeNumericModel, type NumericModel } from "../core/numeric-model.js";
import { matchCertificateBasis, getCertificateBasis, certificateCalculationProfile } from "../profiles/certificate-basis.js";
import { validateRulesBundle, type RulesBundle, type RulesetRef } from "../rules/measurement-contract.js";
import { jcsSha256, sha256Hex } from "../core/canonical.js";
import { verifyCertificate, verifyCertificateInput, type TrustedSigningKey } from "../core/certificate-verify.js";
import type { CertificateEnvelope } from "../core/certificate-contract.js";

const uuid="^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$";
export const prepareCertificateSchema=obj({run_id:{type:"string",pattern:uuid},metadata:metadataSchema});
export const certificateSubmissionsRoot=()=>path.join(path.dirname(runsRoot()),"certificate-submissions");
async function durableWrite(file:string,value:unknown) {
  const handle=await fs.open(file,"wx",0o600);
  try {await handle.writeFile(JSON.stringify(value,null,2)+"\n");await handle.sync();}finally{await handle.close();}
}
/** Network-free preparation. Original run and its execution provenance are never changed. */
export async function prepareCertificate(value:unknown) {
  const args=checkContract<{run_id:string;metadata:CertificateMetadata}>(prepareCertificateSchema,value);
  validateMetadata(args.metadata);
  const run=await readRun(args.run_id);
  const candidate=projectPublicResult(run.assessment,run.summary);matchCertificateBasis(candidate.calculation);
  // Preserve the saved model's generated IDs/order: normalized Assessment order may differ.
  const modelPath=await resolveSafePath("model.json",run.dir),modelStat=await fs.lstat(modelPath);
  if(!modelStat.isFile() || modelStat.isSymbolicLink() || modelStat.size>1024*1024)throw new Error("RUN_CHECKSUM_MISMATCH");
  const model=readCertificateJson(await fs.readFile(modelPath)) as NumericModel;
  if(jcsSha256(model)!==run.metadata.numeric_model_hash)throw new Error("RUN_CHECKSUM_MISMATCH");
  validateAndRecomputeNumericModel(model,certificateCalculationProfile());
  const context=run.metadata.rules_context as {ruleset_ref?:RulesetRef;bundle?:RulesBundle};
  if(!context?.ruleset_ref || !context.bundle)throw new Error("RULESET_NOT_BOUND");
  validateRulesBundle(context.bundle,context.ruleset_ref);
  const skill_integrity:SkillIntegrity={format:"oes/skill-integrity/v1",skill_id:"open-estimate-assessor",skill_version:run.metadata.skill.version,hash_rule:"oes/skill-package/v1",package_sha256:run.metadata.skill.declared_package_sha256};
  const frozen:FrozenInput={schema_version:"oes/certificate-input/v1",model,candidate,skill_integrity,ruleset_ref:context.ruleset_ref};
  checkContract(frozenInputSchema,frozen);
  const nonce=randomBytes(32).toString("base64url"),submission_id=randomUUID(),idempotency_key=randomUUID();
  const prepared={schema_version:"oes/certificate-submission/v1",submission_id,state:"PREPARED",frozen_input:frozen,nonce,idempotency_key,metadata:args.metadata,input_commitment:inputCommitment(frozen,nonce),
    calculation_basis:getCertificateBasis(),rules_bundle:context.bundle};
  const root=certificateSubmissionsRoot();await privateDirectory(root);
  const dir=await resolveSafePath(submission_id,root);await fs.mkdir(dir,{mode:0o700});
  try {
    await durableWrite(path.join(dir,"submission.json"),prepared);
    await durableWrite(path.join(dir,"local-receipt.json"),{run_id:args.run_id,checksums_hash:run.checksums_hash,assessment_hash:run.metadata.assessment_hash,engine_provenance:run.metadata.helper});
    const checksums:Record<string,string>={};
    for(const name of ["submission.json","local-receipt.json"])checksums[name]=sha256Hex(await fs.readFile(path.join(dir,name)));
    await durableWrite(path.join(dir,"COMPLETE.json"),{submission_id,checksums});
    await readCertificateSubmission(submission_id);
  } catch {await fs.unlink(path.join(dir,"COMPLETE.json")).catch(()=>{});throw new Error("CERTIFICATE_SUBMISSION_WRITE_FAILED");}
  return {submission_id,status:"PREPARED",saved:true,transmitted:false,published:false};
}
export async function readCertificateSubmission(submission_id:string) {
  if(!new RegExp(uuid).test(submission_id))throw new Error("INVALID_SUBMISSION_ID");
  const dir=await resolveSafePath(submission_id,certificateSubmissionsRoot());
  const load=async(name:string)=>{const file=await resolveSafePath(name,dir),stat=await fs.lstat(file);if(!stat.isFile() || stat.isSymbolicLink() || stat.size>1024*1024)throw new Error("INVALID_SUBMISSION");return fs.readFile(file);};
  try {
    const marker=readCertificateJson(await load("COMPLETE.json")) as {submission_id:string;checksums:Record<string,string>};
    if(marker.submission_id!==submission_id || Object.keys(marker.checksums).sort().join()!=="local-receipt.json,submission.json")throw new Error("INVALID_SUBMISSION");
    for(const name of ["submission.json","local-receipt.json"])if(sha256Hex(await load(name))!==marker.checksums[name])throw new Error("INVALID_SUBMISSION");
    const prepared=readCertificateJson(await load("submission.json")) as {submission_id:string;state:"PREPARED";frozen_input:FrozenInput;nonce:string;idempotency_key:string;metadata:CertificateMetadata;input_commitment:unknown;rules_bundle:RulesBundle};
    checkContract(frozenInputSchema,prepared.frozen_input);validateMetadata(prepared.metadata);
    if(prepared.submission_id!==submission_id || prepared.state!=="PREPARED" || !new RegExp(uuid).test(prepared.idempotency_key) || jcsSha256(inputCommitment(prepared.frozen_input,prepared.nonce))!==jcsSha256(prepared.input_commitment))throw new Error("INVALID_SUBMISSION");
    validateRulesBundle(prepared.rules_bundle,prepared.frozen_input.ruleset_ref);
    return prepared;
  } catch {throw new Error("INVALID_SUBMISSION");}
}
export async function verifyCertificateFile(value:unknown) {
  const args=checkContract<{certificate_path:string;trusted_keys_path:string;submission_id?:string}>({type:"object",additionalProperties:false,required:["certificate_path","trusted_keys_path"],properties:{certificate_path:{type:"string"},trusted_keys_path:{type:"string"},submission_id:{type:"string",pattern:uuid}}},value);
  for(const name of [args.certificate_path,args.trusted_keys_path])if(!path.isAbsolute(name))throw new Error("ABSOLUTE_FILE_PATH_REQUIRED");
  const read=async(file:string)=>{const stat=await fs.lstat(file);if(!stat.isFile() || stat.isSymbolicLink() || stat.size>1024*1024)throw new Error("INVALID_INPUT");return readCertificateJson(await fs.readFile(file));};
  const envelope=await read(args.certificate_path),keys=await read(args.trusted_keys_path);
  const trusted=checkContract<TrustedSigningKey[]>({type:"array",maxItems:1000,items:obj({key_id:{type:"string",pattern:"^key_(prod|test)_[a-f0-9]{32}$"},algorithm:{const:"Ed25519"},public_key:{type:"string",pattern:"^[A-Za-z0-9_-]{43}$"},issuer_origin:{type:"string"},deployment_environment:{enum:["test","production"]}})},keys);
  const verification=await verifyCertificate(envelope,trusted);
  let reproduction:unknown=null;
  if(args.submission_id && verification.schema==="VALID" && verification.hash==="MATCH" && verification.signature==="VALID") {
    const submission=await readCertificateSubmission(args.submission_id);
    // Reproduction trusts only the locally installed, known calculation contract. No URL is fetched.
    reproduction=verifyCertificateInput(envelope as CertificateEnvelope,submission.frozen_input,submission.nonce);
  }
  return {verification,reproduction,network_used:false};
}
