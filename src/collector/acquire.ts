import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { privateDirectory } from "../local-files.js";
import { getWorkspaceRoot, resolveSafePath } from "./safe-paths.js";
import { classifyFile } from "./classification.js";
import { planAcquisition, LIMITS, type ScopeRule, type AcquisitionPlan } from "./acquisition-plan.js";
import { calculateLineCount, getCacheRoot, type SnapshotResult } from "./snapshot.js";
import { sha256Hex, jcsSha256 } from "../core/canonical.js";
import type { ManifestFileEntry, SourceManifest } from "../core/types.js";

export interface AcquisitionOptions { scope?: ScopeRule[]; preflight?: AcquisitionPlan; partial_authorized?: boolean; previous_snapshot_id?: string; split_acquisition?: boolean }
export async function acquireRepository(targetRelativePath = "", options: AcquisitionOptions = {}): Promise<SnapshotResult> {
  const targetDir = await resolveSafePath(targetRelativePath,getWorkspaceRoot());
  if (classifyFile(targetRelativePath.replaceAll("\\","/")+"/dummy").isExcluded) throw new Error("EXCLUDED_TARGET_DIRECTORY");
  if (!(await fs.lstat(targetDir)).isDirectory()) throw new Error("TARGET_MUST_BE_DIRECTORY");
  const plan = await planAcquisition(targetDir,options.scope);
  const snapshot_id=crypto.randomUUID(), cacheDir=path.join(getCacheRoot(),snapshot_id), cacheFilesDir=path.join(cacheDir,"files");
  await privateDirectory(cacheFilesDir);
  const entries: ManifestFileEntry[] = [], issues=[...plan.summary.issues], missing: string[]=[];
  const ready = options.split_acquisition ? plan.summary.splittable : plan.summary.ready;
  let totalBytes=0, blocked=!ready && options.partial_authorized !== true;
  const batches: Array<{batch_id:number;bytes:number;paths:string[]}>=[{batch_id:1,bytes:0,paths:[]}];
  if (options.preflight && options.preflight.fingerprint !== plan.fingerprint) {
    blocked=true; issues.push({path:".",cause:"PREFLIGHT_CHANGED"});
  }
  const exclude=(f:typeof plan.files[number],cause:string)=>{
    entries.push({path:f.path,sha256:"0".repeat(64),bytes:f.bytes,line_count:0,disposition:"excluded",exclusion_reason:cause});
    issues.push({path:f.path,cause});
    if (f.role === "measurement" && f.cause !== "AGREED_EXCLUSION") missing.push(f.path);
  };
  const ordered=[...plan.files].sort((a,b)=>(a.role === "measurement"?0:1)-(b.role === "measurement"?0:1)||(a.path<b.path?-1:1));
  for (const f of ordered) {
    if (f.cause) { exclude(f,f.cause); continue; }
    if (blocked) { exclude(f,"PREFLIGHT_BLOCKED"); continue; }
    if (f.bytes>LIMITS.single) { exclude(f,"SINGLE_FILE_LIMIT"); continue; }
    let batch=batches[batches.length-1];
    if (batch.bytes+f.bytes>LIMITS.bytes) {
      if (!options.split_acquisition) { exclude(f,"CAPACITY_LIMIT"); continue; }
      batch={batch_id:batches.length+1,bytes:0,paths:[]};batches.push(batch);
    }
    try {
      const full=await resolveSafePath(f.path,targetDir), handle=await fs.open(full,"r");
      let content:Buffer;
      try {
        const before=await handle.stat();
        if (before.size!==f.bytes || before.mtimeMs!==f.mtime_ms) { exclude(f,"SOURCE_CHANGED"); continue; }
        const buffer=Buffer.alloc(f.bytes+1); let length=0;
        while (length<buffer.length) { const read=await handle.read(buffer,length,buffer.length-length,null); if (!read.bytesRead) break; length+=read.bytesRead; }
        content=buffer.subarray(0,length);
        const after=await handle.stat();
        if (length!==f.bytes || before.mtimeMs!==after.mtimeMs || before.size!==after.size) { exclude(f,"SOURCE_CHANGED"); continue; }
      } finally { await handle.close(); }
      try { if (content.includes(0)) throw new Error(); new TextDecoder("utf-8",{fatal:true}).decode(content); }
      catch { exclude(f,"BINARY_OR_INVALID_UTF8"); continue; }
      const dest=path.join(cacheFilesDir,...f.path.split("/"));
      await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
      await fs.writeFile(dest,content,{flag:"wx",mode:0o600});
      totalBytes+=content.length;
      batch.bytes+=content.length;batch.paths.push(f.path);
      entries.push({path:f.path,sha256:sha256Hex(content),bytes:content.length,line_count:calculateLineCount(content),disposition:"unread",exclusion_reason:null});
    } catch (e:any) {
      if (!["EACCES","EPERM","ENOENT"].includes(e.code)) throw e;
      exclude(f,e.code === "ENOENT" ? "SOURCE_CHANGED" : "FILE_PERMISSION");
    }
  }
  let after=await planAcquisition(targetDir,options.scope);
  if (after.fingerprint!==plan.fingerprint) { blocked=true; issues.push({path:".",cause:"SOURCE_CHANGED"}); }
  // All batches belong to the same manifest; no per-batch estimate is summed.
  const acquired=entries.filter(e=>e.disposition!=="excluded");
  const batchPaths=batches.flatMap(b=>b.paths);
  if (new Set(batchPaths).size!==batchPaths.length || batchPaths.length!==acquired.length) throw new Error("ACQUISITION_BATCH_INVENTORY_MISMATCH");
  if (options.split_acquisition && !blocked) for (const f of acquired) {
    try {
      const full=await resolveSafePath(f.path,targetDir), handle=await fs.open(full,"r");
      try {
        const buffer=Buffer.alloc(f.bytes+1);let length=0;
        while(length<buffer.length){const r=await handle.read(buffer,length,buffer.length-length,null);if(!r.bytesRead)break;length+=r.bytesRead;}
        if(length!==f.bytes || sha256Hex(buffer.subarray(0,length))!==f.sha256){blocked=true;issues.push({path:f.path,cause:"SOURCE_CHANGED_BETWEEN_BATCHES"});}
      } finally {await handle.close();}
    } catch(e:any) {if(!["EACCES","EPERM","ENOENT"].includes(e.code))throw e;blocked=true;issues.push({path:f.path,cause:"SOURCE_UNAVAILABLE_BETWEEN_BATCHES"});}
  }
  if (options.split_acquisition) {
    after=await planAcquisition(targetDir,options.scope);
    if (after.fingerprint!==plan.fingerprint) {blocked=true;issues.push({path:".",cause:"SOURCE_CHANGED_AFTER_BATCH_VERIFICATION"});}
  }
  for(const issue of issues.filter(i=>i.cause.startsWith("SOURCE_"))) {
    if(plan.files.some(f=>f.path===issue.path&&f.role === "measurement")&&!missing.includes(issue.path))missing.push(issue.path);
  }
  const scopeComplete=ready && !blocked && missing.length===0;
  entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const manifest:SourceManifest={domain:"oes/source-manifest/v1",files:entries};
  const acquisition_record={version:"oes/acquisition/v1",snapshot_id,previous_snapshot_id:options.previous_snapshot_id??null,
    scope:plan.scope,preflight:options.preflight??plan,observed:plan,postflight_fingerprint:after.fingerprint,
    batches,split_acquisition:options.split_acquisition===true,manifest_hash:jcsSha256(manifest),
    scope_complete:scopeComplete,missing_measurement:missing,issues,total_bytes:totalBytes,
    next_action:scopeComplete?"ANALYZE":"ADJUST_ACQUISITION_OR_EXPLICIT_PARTIAL"};
  await fs.writeFile(path.join(cacheDir,"acquisition.json"),JSON.stringify(acquisition_record,null,2)+"\n",{flag:"wx",mode:0o600});
  return {snapshot_id,manifest,manifest_hash:jcsSha256(manifest),
    acquisition:{discovery_complete:plan.summary.discovery_complete,issues,scope_coverage:scopeComplete?"COMPLETE":"MISSING",partial_authorized:options.partial_authorized===true},
    acquisition_record,analysis_ready:scopeComplete||options.partial_authorized===true,
    analysis_complete:scopeComplete && !entries.some(e=>e.disposition === "excluded" && !["AGREED_EXCLUSION","POLICY_EXCLUSION","SAFETY_EXCLUSION"].includes(e.exclusion_reason!)),
    total_files:entries.length,analyzed_candidates:entries.filter(e=>e.disposition!=="excluded").length,
    excluded_files:entries.filter(e=>e.disposition === "excluded").length,total_bytes:totalBytes,cache_dir:cacheDir,
    source_identity:{repository_label:path.basename(targetDir),snapshot_type:"worktree",commit:null,dirty:true,source_binding:"client_reported"}};
}
