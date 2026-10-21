import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import { privateDirectory } from "../local-files.js";
import { resolveSafePath } from "../collector/safe-paths.js";
import { parseStrictJson } from "../core/json-parser.js";
import { sha256Hex } from "../core/canonical.js";
import { projectPublicResult, publicCandidateHash, validatePublicResult, PublicResultError, PROJECTION_VERSION } from "../core/public-result.js";
import { readRun, runsRoot } from "./runs.js";

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const preparePublicResultInputSchema={type:"object",additionalProperties:false,required:["run_id"],properties:{run_id:{type:"string"}}};
const validInput=new Ajv2020({strict:true,ownProperties:true}).compile(preparePublicResultInputSchema);
const runErrors=new Set(["INVALID_RUN_ID","UNSAFE_RUN_FILE","UNSAFE_RUN_DIRECTORY","RUN_CHECKSUM_MISMATCH","INVALID_RUN_CHECKSUMS","RUN_ASSESSMENT_HASH_MISMATCH","ABSOLUTE_RUN_DIRECTORY_REQUIRED"]);
export function publicCandidatesRoot() { return path.join(path.dirname(runsRoot()),"public-result-candidates"); }
const write=(file:string,value:unknown)=>fs.writeFile(file,JSON.stringify(value,null,2)+"\n",{flag:"wx",mode:0o600});

/** This command only writes a new sibling artifact. It never modifies the run or contacts a server. */
export async function preparePublicResult(args: unknown) {
  if(!validInput(args))throw new PublicResultError("PUBLIC_SOURCE_UNSUPPORTED");
  const runId=(args as {run_id:string}).run_id;
  let run: Awaited<ReturnType<typeof readRun>>;
  try { run=await readRun(runId); }
  catch(e: any) {
    // Keep existing run error codes but never expose source validation pointers/messages.
    if(runErrors.has(e?.message))throw new Error(e.message);
    if(e?.name==="SemanticValidationError")throw new PublicResultError("PUBLIC_SOURCE_UNSUPPORTED");
    throw new Error("HELPER_EXECUTION_FAILED");
  }
  const candidate=projectPublicResult(run.assessment,run.summary),candidateHash=publicCandidateHash(candidate);
  const receipt={schema_version:"oes/local-projection-receipt/v1",run_id:runId,assessment_hash:run.metadata.assessment_hash,
    checksums_hash:run.checksums_hash,candidate_hash:candidateHash,projection_version:PROJECTION_VERSION,generated_at:new Date().toISOString()};
  let ownedDirectory: string | null=null;
  try {
    const root=publicCandidatesRoot();
    if(root===runsRoot())throw new Error("UNSAFE_OUTPUT_DIRECTORY");
    await privateDirectory(root);
    const id=randomUUID(),dir=await resolveSafePath(id,root);await fs.mkdir(dir,{mode:0o700});
    ownedDirectory=dir;
    const candidatePath=path.join(dir,"candidate.json"),receiptPath=path.join(dir,"local-receipt.json");
    await write(candidatePath,candidate);await write(receiptPath,receipt);
    // Reopen both files and verify their saved bytes before creating the final marker.
    const candidateBytes=await fs.readFile(candidatePath),receiptBytes=await fs.readFile(receiptPath);
    if(publicCandidateHash(validatePublicResult(parseStrictJson(candidateBytes.toString("utf8"))))!==candidateHash
      || sha256Hex(receiptBytes)!==sha256Hex(JSON.stringify(receipt,null,2)+"\n"))throw new Error("OUTPUT_MISMATCH");
    await write(path.join(dir,"COMPLETE.json"),{projection_id:id,projection_version:PROJECTION_VERSION,candidate_hash:candidateHash,
      candidate_sha256:sha256Hex(candidateBytes),receipt_sha256:sha256Hex(receiptBytes)});
    return {status:"LOCAL_CANDIDATE_READY",candidate_path:candidatePath,receipt_path:receiptPath,candidate_hash:candidateHash,transmitted:false,published:false};
  } catch {
    // Only remove a marker in the new UUID directory reserved by this invocation.
    if(ownedDirectory!==null)await fs.unlink(path.join(ownedDirectory,"COMPLETE.json")).catch(()=>{});
    throw new PublicResultError("PUBLIC_CANDIDATE_WRITE_FAILED");
  }
}

/** Local-only reopening by UUID; candidate and private receipt remain separate values. */
export async function readPublicResultCandidate(id:string) {
  try {
    if(!uuid.test(id))throw new Error("INVALID_ID");
    const dir=await resolveSafePath(id,publicCandidatesRoot());
    const load=async(name:string)=>{
      const full=await resolveSafePath(name,dir),stat=await fs.lstat(full);
      if(!stat.isFile() || stat.isSymbolicLink())throw new Error("UNSAFE_FILE");
      return fs.readFile(full);
    };
    const marker=parseStrictJson((await load("COMPLETE.json")).toString("utf8")) as any;
    const candidateBytes=await load("candidate.json"),receiptBytes=await load("local-receipt.json");
    if(marker.projection_id!==id || marker.projection_version!==PROJECTION_VERSION || marker.candidate_sha256!==sha256Hex(candidateBytes)
      || marker.receipt_sha256!==sha256Hex(receiptBytes))throw new Error("CHECKSUM_MISMATCH");
    const candidate=validatePublicResult(parseStrictJson(candidateBytes.toString("utf8"))),receipt=parseStrictJson(receiptBytes.toString("utf8")) as any;
    const hash=publicCandidateHash(candidate);
    if(marker.candidate_hash!==hash || receipt.candidate_hash!==hash || receipt.projection_version!==PROJECTION_VERSION)throw new Error("HASH_MISMATCH");
    return {candidate,receipt,candidate_hash:hash};
  } catch { throw new PublicResultError("PUBLIC_CANDIDATE_INVALID"); }
}
