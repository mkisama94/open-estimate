import fs from 'node:fs/promises';
import path from 'node:path';
import {readWorkflowFile,writeWorkflowFile} from '../local/workflow-store.js';
import {readWorkflowData,writeWorkflowData} from '../local/workflow-data.js';
import {getCacheRoot,type SnapshotResult} from '../collector/snapshot.js';
import {resolveSafePath} from '../collector/safe-paths.js';
import type {FileCoverageRecord} from '../collector/coverage.js';
import {jcsSha256} from '../core/canonical.js';
import {mcpState} from './state.js';

interface SavedSnapshot {version:1;workspace_root:string;snapshot:SnapshotResult;preparation:{assessment_id:string;assessor_defaults:Record<string,unknown>};reads:FileCoverageRecord[]}
const writes=new Map<string,Promise<void>>();
const metadataSaved=new Set<string>();
export function saveWorkflowSnapshot(id:string,snapshot_id:string){
 const operation=(writes.get(id)??Promise.resolve()).then(async()=>{
 const e=mcpState.getSnapshot(snapshot_id);if(!e?.workspace_root||!e.preparation)throw Error('SNAPSHOT_NOT_FOUND_OR_EXPIRED');
 const metadata_file=`mcp-snapshot-${snapshot_id}.json`,reads_file=`mcp-reads-${snapshot_id}.json`,key=id+'/'+snapshot_id;
 if(!metadataSaved.has(key)){await writeWorkflowData(id,metadata_file,{version:1,workspace_root:e.workspace_root,snapshot:e.snapshot,preparation:e.preparation});metadataSaved.add(key);}
 await writeWorkflowData(id,reads_file,e.tracker.exportReads());
 const head={version:2,workspace_root:e.workspace_root,snapshot_id,metadata_file,reads_file,analysis_ready:e.snapshot.analysis_ready,partial_authorized:e.snapshot.acquisition?.partial_authorized};
 await writeWorkflowFile(id,`mcp-snapshot-index-${snapshot_id}.json`,head);await writeWorkflowFile(id,'mcp-snapshot.json',head);
 });
 const done=operation.then(()=>{},()=>{});writes.set(id,done);void done.then(()=>{if(writes.get(id)===done)writes.delete(id);});return operation;
}
export async function restoreWorkflowSnapshot(id:string,root:string,snapshot_id?:string){
 let saved:SavedSnapshot;
 let head:any;try{if(snapshot_id){if(!/^[a-f0-9-]{36}$/.test(snapshot_id))throw Error('INVALID_SNAPSHOT_ID');try{head=await readWorkflowFile(id,`mcp-snapshot-index-${snapshot_id}.json`);}catch(e:any){if(e.code!=='ENOENT')throw e;head=await readWorkflowFile(id,'mcp-snapshot.json');}if((head.snapshot_id??head.snapshot?.snapshot_id)!==snapshot_id)throw Error('SNAPSHOT_ARCHIVE_NOT_FOUND');}else head=await readWorkflowFile(id,'mcp-snapshot.json');}catch(e:any){if(e.code==='ENOENT')return;throw e;}
 if(head.version===2){
  if(head.workspace_root!==root||!/^[a-f0-9-]{36}$/.test(head.snapshot_id)||head.metadata_file!==`mcp-snapshot-${head.snapshot_id}.json`||head.reads_file!==`mcp-reads-${head.snapshot_id}.json`)throw Error('WORKFLOW_SNAPSHOT_INVALID');
  const metadata=await readWorkflowData<Omit<SavedSnapshot,'reads'>>(id,head.metadata_file);
  if(metadata.snapshot.snapshot_id!==head.snapshot_id)throw Error('WORKFLOW_SNAPSHOT_INVALID');
  saved={...metadata,reads:await readWorkflowData<FileCoverageRecord[]>(id,head.reads_file)};
  if(typeof head.analysis_ready==='boolean')saved.snapshot.analysis_ready=head.analysis_ready;
  if(saved.snapshot.acquisition&&typeof head.partial_authorized==='boolean')saved.snapshot.acquisition.partial_authorized=head.partial_authorized;
 }else saved=head;
 if(saved.version!==1||saved.workspace_root!==root||jcsSha256(saved.snapshot.manifest)!==saved.snapshot.manifest_hash)throw Error('WORKFLOW_SNAPSHOT_INVALID');
 const relative=path.relative(getCacheRoot(),saved.snapshot.cache_dir);
 try{
  const dir=await resolveSafePath(relative,getCacheRoot());if(!(await fs.lstat(dir)).isDirectory())throw Error('WORKFLOW_SNAPSHOT_INVALID');
 }catch(e:any){if(e.code==='ENOENT')return {snapshot_id:saved.snapshot.snapshot_id,available:false};throw e;}
 mcpState.registerSnapshot(saved.snapshot,root,saved.preparation);
 mcpState.getSnapshot(saved.snapshot.snapshot_id)!.tracker.restoreReads(saved.reads);
 if(head.version===2)metadataSaved.add(id+'/'+saved.snapshot.snapshot_id);
 return {snapshot_id:saved.snapshot.snapshot_id,available:true};
}
