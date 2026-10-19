import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { privateDirectory } from "../local-files.js";
import { jcsSha256, sha256Hex } from "../core/canonical.js";
import { normalizeAssessment } from "../core/normalize.js";
import { validateAssessment } from "../core/validate.js";
import { recordState } from "../core/records.js";
import { qualityWarnings } from "../core/quality.js";
import { projectModel } from "../remote/model.js";
import { createEvaluation } from "../core/evaluation.js";
import { getLocalProfile } from "../profiles/local-profile.js";
import type { Assessment } from "../core/types.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const installation = fileURLToPath(new URL("../../", import.meta.url));
const write = (file: string, value: unknown) => fs.writeFile(file, JSON.stringify(value,null,2)+"\n", {flag:"wx",mode:0o600});
export function runsRoot() {
  if (process.env.OES_RUNS_ROOT && !path.isAbsolute(process.env.OES_RUNS_ROOT)) throw new Error("ABSOLUTE_RUN_DIRECTORY_REQUIRED");
  return path.resolve(process.env.OES_RUNS_ROOT ?? path.join(os.homedir(),".open-estimate","runs"));
}
async function regular(dir: string, name: string) {
  const file = path.join(dir,name), stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("UNSAFE_RUN_FILE");
  return file;
}
async function checkedDirectory(dir: string) {
  let cursor = path.parse(path.resolve(dir)).root;
  for (const part of path.relative(cursor,path.resolve(dir)).split(path.sep)) {
    cursor = path.join(cursor,part);
    const s = await fs.lstat(cursor);
    if (s.isSymbolicLink() || !s.isDirectory()) throw new Error("UNSAFE_RUN_DIRECTORY");
  }
}
async function inventory(root: string, dirs: string[]) {
  const entries: Array<{path:string;sha256:string}> = [];
  const walk = async (relative: string): Promise<void> => {
    const full = path.join(root,relative), stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) throw new Error("UNSAFE_IMPLEMENTATION_FILE");
    if (stat.isDirectory()) for (const name of (await fs.readdir(full)).sort()) await walk(path.join(relative,name));
    else entries.push({path:relative.split(path.sep).join("/"),sha256:sha256Hex(await fs.readFile(full))});
  };
  for (const dir of dirs) await walk(dir);
  return entries.sort((a,b)=>a.path.localeCompare(b.path,"en"));
}
export function resultSummary(a: Assessment) {
  const evaluation = createEvaluation(a,getLocalProfile());
  return { version:"oes/result-summary/v1", assessment_hash:normalizeAssessment(a).assessment_hash,
    measurement:evaluation.report.measurement, records:recordState(a),
    calculation:{environment:"TEST",basis:evaluation.basis,effort:evaluation.report.effort,reference_usd:evaluation.report.reference_usd,limitation_codes:evaluation.report.limitation_codes},
    execution:{local:"VALIDATED",remote:"NOT_SENT"},
    fx:{status:"NOT_REQUESTED",observed_on:null,fetched_at:null},
    assurance:"Structure and arithmetic checked; source coverage and semantic interpretation not independently audited; hashes are not signatures." };
}
export async function saveRun(a: Assessment, submitted: unknown, context: unknown, target: string) {
  validateAssessment(a);
  const root = runsRoot();
  // Forbid target-contained storage, including ancestors that would place scans inside output.
  const rel = path.relative(path.resolve(target),root);
  if (!rel || (!rel.startsWith(".."+path.sep) && rel !== ".." && !path.isAbsolute(rel))) throw new Error("RUN_DIRECTORY_INSIDE_TARGET");
  await privateDirectory(root);
  const run_id = randomUUID(), dir = path.join(root,run_id);
  await fs.mkdir(dir,{mode:0o700}); // Exclusive reservation; failures never replace another run.
  try {
    const {normalized,assessment_hash} = normalizeAssessment(a), model = projectModel(a), summary = resultSummary(a);
    const code = await inventory(installation,["dist"]);
    const packageFiles = await inventory(installation,["dist","contracts","profiles","skills","package.json","package-lock.json"]);
    const pkg = JSON.parse(await fs.readFile(path.join(installation,"package.json"),"utf8"));
    const dependencies = [];
    for (const name of Object.keys(pkg.dependencies).sort()) {
      const bytes = await fs.readFile(path.join(installation,"node_modules",name,"package.json"));
      dependencies.push({name,version:JSON.parse(bytes.toString()).version,package_metadata_sha256:sha256Hex(bytes)});
    }
    const metadata = {format:"oes/run/v1",run_id,started_at:a.assessor.started_at,finished_at:a.assessor.finished_at,saved_at:new Date().toISOString(),
      target:{root:target,...a.input,manifest:undefined}, scope:a.scope,scope_record:a.scope_record??null,
      manifest_hash:a.input.manifest_hash,assessment_hash,numeric_model_hash:jcsSha256(model),
      skill:{id:a.assessor.skill_id,version:a.assessor.skill_version,declared_package_sha256:a.assessor.skill_sha256,
        skill_file_sha256:sha256Hex(await fs.readFile(path.join(installation,"skills/open-estimate-assessor/SKILL.md")))},
      helper:{version:pkg.version,execution_code_sha256:jcsSha256(code),package_content_sha256:jcsSha256(packageFiles),node_version:process.version},
      dependencies:{lock_sha256:sha256Hex(await fs.readFile(path.join(installation,"package-lock.json"))),installed:dependencies},
      model:{id:a.assessor.model_id,name:a.assessor.model_name,source:a.assessor.model_metadata_source},
      revision:a.human_amendments,transmission:"NOT_SENT",source_copy:"NOT_SAVED",rules_context:context};
    const files: Record<string,unknown> = {"run.json":metadata,"assessment.json":{assessment:normalized,assessment_hash,submitted_assessment:submitted},
      "manifest.json":a.input.manifest,"summary.json":summary,"validation.json":{status:"PASSED",errors:[],quality_warnings:qualityWarnings(a),semantic_audit:"NOT_PERFORMED"},
      "ledger.json":{judgments:a.judgments??null,candidates:a.function_candidates??null},"model.json":model,"context.json":context,
      "implementation.json":{execution_code:code,package_content:packageFiles}};
    for (const [name,data] of Object.entries(files)) await write(path.join(dir,name),data);
    await fs.mkdir(path.join(dir,"operations"),{mode:0o700});
    const checksums = [];
    for (const name of Object.keys(files).sort()) checksums.push({path:name,sha256:sha256Hex(await fs.readFile(path.join(dir,name)))});
    await write(path.join(dir,"checksums.json"),checksums);
    await write(path.join(dir,"COMPLETE.json"),{run_id,checksums_sha256:jcsSha256(checksums)});
    return {run_id,run_directory:dir,assessment_path:path.join(dir,"assessment.json"),assessment_hash,summary};
  } catch (e) {
    // Leave forensic incomplete files without COMPLETE marker; never report as a successful run.
    throw e;
  }
}
export async function readRun(run_id: string) {
  if (!uuid.test(run_id)) throw new Error("INVALID_RUN_ID");
  const dir = path.join(runsRoot(),run_id); await checkedDirectory(dir);
  const json = async (name: string) => JSON.parse(await fs.readFile(await regular(dir,name),"utf8"));
  const complete = await json("COMPLETE.json"), checksums = await json("checksums.json");
  if (complete.run_id !== run_id || complete.checksums_sha256 !== jcsSha256(checksums)) throw new Error("RUN_CHECKSUM_MISMATCH");
  const required = ["run.json","assessment.json","manifest.json","summary.json","validation.json","ledger.json","model.json","context.json","implementation.json"];
  if (!Array.isArray(checksums) || checksums.length !== required.length || new Set(checksums.map(x=>x.path)).size !== required.length) throw new Error("INVALID_RUN_CHECKSUMS");
  for (const entry of checksums) {
    if (!required.includes(entry.path)) throw new Error("INVALID_RUN_CHECKSUMS");
    if (sha256Hex(await fs.readFile(await regular(dir,entry.path))) !== entry.sha256) throw new Error("RUN_CHECKSUM_MISMATCH");
  }
  const artifact = await json("assessment.json"), metadata = await json("run.json");
  const assessment = validateAssessment(artifact.assessment);
  if (normalizeAssessment(assessment).assessment_hash !== artifact.assessment_hash || artifact.assessment_hash !== metadata.assessment_hash) throw new Error("RUN_ASSESSMENT_HASH_MISMATCH");
  return {dir,metadata,assessment,summary:await json("summary.json"),checksums_hash:complete.checksums_sha256};
}
export async function appendOperation(run_id: string, kind: "submission" | "display" | "comparison", payload: unknown) {
  const run = await readRun(run_id), parent = path.join(run.dir,"operations"); await checkedDirectory(parent);
  const operation_id = randomUUID(), dir = path.join(parent,operation_id); await fs.mkdir(dir,{mode:0o700});
  await write(path.join(dir,"operation.json"),{operation_id,run_id,kind,recorded_at:new Date().toISOString(),payload});
  const hash = sha256Hex(await fs.readFile(path.join(dir,"operation.json")));
  await write(path.join(dir,"COMPLETE.json"),{operation_id,sha256:hash});
  return {operation_id,operation_path:path.join(dir,"operation.json"),operation_hash:hash};
}
export async function saveRemoteOperation(run_id: string, args: any) {
  const run = await readRun(run_id);
  if (!["SUCCESS","FAILED"].includes(args.status)) throw new Error("INVALID_TRANSMISSION_STATUS");
  if (args.status === "FAILED" && (typeof args.error !== "string" || !args.error.trim())) throw new Error("REMOTE_ERROR_REQUIRED");
  let reconciliation: unknown = null;
  const response = args.response?.structuredContent ?? args.response;
  if (args.status === "SUCCESS") {
    if (!response?.report?.measurement || !response.report.effort || !response.report.reference_usd || !response.display_quote || args.response?.isError === true || response.isError === true) throw new Error("INVALID_REMOTE_RESPONSE");
    const local = run.summary;
    reconciliation = {measurement_matches:jcsSha256(local.measurement)===jcsSha256(response.report.measurement),
      effort_matches:jcsSha256(local.calculation.effort)===jcsSha256(response.report.effort),
      reference_usd_matches:jcsSha256(local.calculation.reference_usd)===jcsSha256(response.report.reference_usd),
      assurance:"Caller supplied response retained verbatim; this does not attest network transmission."};
  }
  const fx = response?.display_quote ? {status:response.display_quote.localized_reference?.status??"UNKNOWN",observed_on:response.display_quote.fx_snapshot?.observed_on??null,
    fetched_at:response.display_quote.fx_snapshot?.fetched_at??null,displayed_at:response.display_quote.displayed_at??null} : {status:"NOT_AVAILABLE",observed_on:null,fetched_at:null};
  const operation = await appendOperation(run_id,args.kind === "display" ? "display" : "submission",{status:args.status,request_model_hash:run.metadata.numeric_model_hash,
    local:run.summary,server_response:args.response??null,error:args.error??null,reconciliation,
    transmission_evidence:"CLIENT_REPORTED",display_quote:response?.display_quote??null,fx});
  return {...operation,execution:{local:"VALIDATED",remote:`CLIENT_REPORTED_${args.status}`},reconciliation,fx};
}

export async function showRun(run_id: string) {
  const run = await readRun(run_id), parent = path.join(run.dir,"operations");await checkedDirectory(parent);
  const operations: any[] = [], incomplete_operations: string[] = [];
  for (const id of await fs.readdir(parent)) {
    if (!uuid.test(id)) throw new Error("INVALID_OPERATION_ID");
    const dir = path.join(parent,id);await checkedDirectory(dir);
    let marker;
    try { marker = JSON.parse(await fs.readFile(await regular(dir,"COMPLETE.json"),"utf8")); }
    catch (e: any) { if(e.code!=="ENOENT")throw e;incomplete_operations.push(id);continue; }
    const bytes=await fs.readFile(await regular(dir,"operation.json"));
    if (marker.operation_id !== id || marker.sha256 !== sha256Hex(bytes)) throw new Error("OPERATION_CHECKSUM_MISMATCH");
    const operation=JSON.parse(bytes.toString());
    if(operation.run_id!==run_id || operation.operation_id!==id)throw new Error("INVALID_OPERATION_REFERENCE");
    operations.push(operation);
  }
  operations.sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at)||a.operation_id.localeCompare(b.operation_id));
  // All attempts are visible. No previous server response or display-time FX is overwritten.
  return {...run,operations,incomplete_operations,execution_history:operations.filter(o=>["submission","display"].includes(o.kind)).map(o=>({operation_id:o.operation_id,
    kind:o.kind,recorded_at:o.recorded_at,status:o.payload.status,reconciliation:o.payload.reconciliation,fx:o.payload.fx})),
    notice:"summary.json records the original local result (NOT_SENT). Subsequent client-reported attempts are listed independently in execution_history."};
}
