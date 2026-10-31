import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWorkflowDirectory,readWorkflowFile,writeWorkflowFile,WORKFLOW_FILE_BYTES} from '../../src/local/workflow-store.js';
import {readWorkflowData,writeWorkflowData} from '../../src/local/workflow-data.js';
import {SnapshotCoverageTracker} from '../../src/collector/coverage.js';
import {saveWorkflowSnapshot,restoreWorkflowSnapshot} from '../../src/mcp/workflow-snapshot.js';
import {handlePrepareRepository} from '../../src/mcp/tools/prepare-repository.js';
import {workspaceContext} from '../../src/collector/workspace-context.js';
import {mcpState} from '../../src/mcp/state.js';

async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oes-storage-')),keys=['OES_WORKFLOWS_ROOT','OES_CACHE_ROOT'],prior=keys.map(k=>process.env[k]);
 process.env.OES_WORKFLOWS_ROOT=path.join(root,'workflows');process.env.OES_CACHE_ROOT=path.join(root,'cache');const id=randomUUID(),dir=await createWorkflowDirectory(id);
 return {root,id,dir,cleanup:async()=>{vi.restoreAllMocks();for(const [i,k]of keys.entries()){if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];}await fs.rm(root,{recursive:true,force:true});}};
}
it('rejects oversized UTF-8 state before publishing and preserves a readable previous record',async()=>{
 const f=await fixture();try{
  await writeWorkflowFile(f.id,'state.json',{value:'previous'});await expect(writeWorkflowFile(f.id,'state.json',{value:'あ'.repeat(Math.ceil(WORKFLOW_FILE_BYTES/3))})).rejects.toThrow('WORKFLOW_STATE_TOO_LARGE');expect(await readWorkflowFile(f.id,'state.json')).toEqual({value:'previous'});
  const exact={value:'x'.repeat(WORKFLOW_FILE_BYTES-12)};expect(Buffer.byteLength(JSON.stringify(exact))).toBe(WORKFLOW_FILE_BYTES);await writeWorkflowFile(f.id,'state.json',exact);expect(await readWorkflowFile(f.id,'state.json')).toEqual(exact);expect((await fs.readdir(f.dir)).some(p=>p.endsWith('.tmp'))).toBe(false);
 }finally{await f.cleanup();}
});
it('round-trips large resume data and preserves the old generation when publishing a new index fails',async()=>{
 const f=await fixture();try{
  const original={value:'あ'.repeat(1600000)},next={value:'い'.repeat(1600000)};await writeWorkflowData(f.id,'large.json',original);const index=await readWorkflowFile<any>(f.id,'large.json');expect(index.format).toBe('oes/workflow-data/v1');expect(await readWorkflowData(f.id,'large.json')).toEqual(original);
  for(const name of await fs.readdir(f.dir))expect((await fs.stat(path.join(f.dir,name))).size).toBeLessThanOrEqual(WORKFLOW_FILE_BYTES);
  const rename=fs.rename.bind(fs),spy=vi.spyOn(fs,'rename').mockImplementation(async(a,b)=>{if(String(b)===path.join(f.dir,'large.json'))throw Object.assign(Error('synthetic publish failure'),{code:'EACCES'});return rename(a,b);});
  await expect(writeWorkflowData(f.id,'large.json',next)).rejects.toMatchObject({code:'EACCES'});spy.mockRestore();expect(await readWorkflowData(f.id,'large.json')).toEqual(original);
  await fs.unlink(path.join(f.dir,index.parts[0]));await expect(readWorkflowData(f.id,'large.json')).rejects.toThrow('WORKFLOW_DATA_INCOMPLETE');
 }finally{await f.cleanup();}
});
it('compacts repeated reads and restores a snapshot with metadata above four MiB',async()=>{
 const f=await fixture();try{
  const project=path.join(f.root,'project');await fs.mkdir(project);await fs.copyFile('examples/quality-check/notes.js',path.join(project,'notes.js'));
  const p=await workspaceContext.run(project,()=>handlePrepareRepository({})),entry=mcpState.getSnapshot(p.snapshot_id)!;
  (entry.snapshot.acquisition_record as any).synthetic_padding='あ'.repeat(1600000);
  for(let n=0;n<10000;n++){entry.tracker.recordRead('notes.js',1,10);entry.tracker.recordRead('notes.js',8,20);}
  expect(entry.tracker.exportReads()[0].readRanges).toEqual([{start:1,end:20}]);await saveWorkflowSnapshot(f.id,p.snapshot_id);
  const head=await readWorkflowFile<any>(f.id,'mcp-snapshot.json');expect(head.version).toBe(2);expect((await fs.stat(path.join(f.dir,head.metadata_file))).size).toBeLessThan(4096);
  const before=await fs.readFile(path.join(f.dir,head.metadata_file));mcpState.clearSnapshots();expect(await restoreWorkflowSnapshot(f.id,project)).toEqual({snapshot_id:p.snapshot_id,available:true});
  const restored=mcpState.getSnapshot(p.snapshot_id)!;expect((restored.snapshot.acquisition_record as any).synthetic_padding.length).toBe(1600000);expect(restored.tracker.exportReads()[0].readRanges).toEqual([{start:1,end:20}]);restored.tracker.recordRead('notes.js',21,21);await saveWorkflowSnapshot(f.id,p.snapshot_id);
  expect(await fs.readFile(path.join(f.dir,head.metadata_file))).toEqual(before);expect(restored.tracker.exportReads()[0].readRanges).toEqual([{start:1,end:21}]);
  restored.snapshot.analysis_ready=false;restored.snapshot.acquisition!.partial_authorized=false;await saveWorkflowSnapshot(f.id,p.snapshot_id);mcpState.clearSnapshots();await restoreWorkflowSnapshot(f.id,project);expect(mcpState.getSnapshot(p.snapshot_id)!.snapshot.analysis_ready).toBe(false);expect(mcpState.getSnapshot(p.snapshot_id)!.snapshot.acquisition!.partial_authorized).toBe(false);
 }finally{await f.cleanup();}
});
it('restores legacy read ranges without retaining duplicate or overlapping history',()=>{
 const manifest={domain:'oes/source-manifest/v1' as const,files:[{path:'app.ts',sha256:'a'.repeat(64),bytes:100,line_count:20,disposition:'unread' as const,exclusion_reason:null}]};
 const tracker=new SnapshotCoverageTracker(manifest);tracker.restoreReads([{path:'app.ts',totalLines:20,readRanges:[{start:10,end:20},{start:1,end:10},{start:1,end:10}]}]);expect(tracker.exportReads()[0].readRanges).toEqual([{start:1,end:20}]);expect(tracker.getDisposition('app.ts')).toBe('analyzed');
});
it('restores an existing v1 snapshot and upgrades its next saved record without reacquiring sources',async()=>{
 const f=await fixture();try{
  const project=path.join(f.root,'project');await fs.mkdir(project);await fs.writeFile(path.join(project,'app.ts'),'export const x=1;\n');const p=await workspaceContext.run(project,()=>handlePrepareRepository({})),entry=mcpState.getSnapshot(p.snapshot_id)!;entry.tracker.recordRead('app.ts',1,1);
  await writeWorkflowFile(f.id,'mcp-snapshot.json',{version:1,workspace_root:project,snapshot:entry.snapshot,preparation:entry.preparation,reads:entry.tracker.exportReads()});mcpState.clearSnapshots();expect(await restoreWorkflowSnapshot(f.id,project)).toEqual({snapshot_id:p.snapshot_id,available:true});expect(mcpState.getSnapshot(p.snapshot_id)!.tracker.exportReads()[0].readRanges).toEqual([{start:1,end:1}]);
  await saveWorkflowSnapshot(f.id,p.snapshot_id);expect((await readWorkflowFile<any>(f.id,'mcp-snapshot.json')).version).toBe(2);expect(await fs.readdir(process.env.OES_CACHE_ROOT!)).toEqual([p.snapshot_id]);
 }finally{await f.cleanup();}
});
