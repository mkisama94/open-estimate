import fs from 'node:fs/promises';
import path from 'node:path';
import {readWorkflowFile,writeWorkflowFile} from '../local/workflow-store.js';
import {getCacheRoot,type SnapshotResult} from '../collector/snapshot.js';
import {resolveSafePath} from '../collector/safe-paths.js';
import type {FileCoverageRecord} from '../collector/coverage.js';
import {jcsSha256} from '../core/canonical.js';
import {mcpState} from './state.js';

interface SavedSnapshot {version:1;workspace_root:string;snapshot:SnapshotResult;preparation:{assessment_id:string;assessor_defaults:Record<string,unknown>};reads:FileCoverageRecord[]}
const writes=new Map<string,Promise<void>>();
export function saveWorkflowSnapshot(id:string,snapshot_id:string){
 const operation=(writes.get(id)??Promise.resolve()).then(async()=>{
 const e=mcpState.getSnapshot(snapshot_id);if(!e?.workspace_root||!e.preparation)throw Error('SNAPSHOT_NOT_FOUND_OR_EXPIRED');
 await writeWorkflowFile(id,'mcp-snapshot.json',{version:1,workspace_root:e.workspace_root,snapshot:e.snapshot,preparation:e.preparation,reads:e.tracker.exportReads()} satisfies SavedSnapshot);
 });
 const done=operation.then(()=>{},()=>{});writes.set(id,done);void done.then(()=>{if(writes.get(id)===done)writes.delete(id);});return operation;
}
export async function restoreWorkflowSnapshot(id:string,root:string){
 let saved:SavedSnapshot;
 try{saved=await readWorkflowFile(id,'mcp-snapshot.json');}catch(e:any){if(e.code==='ENOENT')return;throw e;}
 if(saved.version!==1||saved.workspace_root!==root||jcsSha256(saved.snapshot.manifest)!==saved.snapshot.manifest_hash)throw Error('WORKFLOW_SNAPSHOT_INVALID');
 const relative=path.relative(getCacheRoot(),saved.snapshot.cache_dir);
 try{
  const dir=await resolveSafePath(relative,getCacheRoot());if(!(await fs.lstat(dir)).isDirectory())throw Error('WORKFLOW_SNAPSHOT_INVALID');
 }catch(e:any){if(e.code==='ENOENT')return {snapshot_id:saved.snapshot.snapshot_id,available:false};throw e;}
 mcpState.registerSnapshot(saved.snapshot,root,saved.preparation);
 mcpState.getSnapshot(saved.snapshot.snapshot_id)!.tracker.restoreReads(saved.reads);
 return {snapshot_id:saved.snapshot.snapshot_id,available:true};
}
