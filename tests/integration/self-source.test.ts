import {it, expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {workspaceContext} from '../../src/collector/workspace-context.js';
import {LIMITS} from '../../src/collector/acquisition-plan.js';
import {acquireRepository} from '../../src/collector/acquire.js';
import {SnapshotCoverageTracker} from '../../src/collector/coverage.js';
import {mcpState} from '../../src/mcp/state.js';
import {handleReadRepositoryFile} from '../../src/mcp/tools/read-repository-file.js';

it('declares lines exceeding the reader byte limit as missing, including multibyte text',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'oes-line-limit-'));
  const root=path.join(base,'source');
  const previous=process.env.OES_CACHE_ROOT;
  try {
    await fs.mkdir(root);
    process.env.OES_CACHE_ROOT=path.join(base,'cache');
    const samples={'ascii-ok.ts':'a'.repeat(65535),'ascii-large.ts':'a'.repeat(65536),
      'utf8-ok.ts':'あ'.repeat(21845),'utf8-large.ts':'あ'.repeat(21846)};
    for(const [name,body] of Object.entries(samples))await fs.writeFile(path.join(root,name),body+'\n');
    await workspaceContext.run(root,async()=>{
      const snapshot=await acquireRepository();
      expect(snapshot.acquisition?.scope_coverage).toBe('MISSING');
      expect(snapshot.analysis_ready).toBe(false);
      expect(snapshot.analysis_complete).toBe(false);
      expect(snapshot.analyzed_candidates).toBe(2);
      for(const name of Object.keys(samples)){
        const file=snapshot.manifest.files.find(f=>f.path===name)!;
        if(name.includes('-large')){
          expect(file.exclusion_reason).toBe('LINE_SIZE_LIMIT');
          expect(snapshot.acquisition?.issues).toContainEqual({path:name,cause:'LINE_SIZE_LIMIT'});
        }else expect(file.disposition).toBe('unread');
      }
    });
  }finally{
    if(previous===undefined)delete process.env.OES_CACHE_ROOT;else process.env.OES_CACHE_ROOT=previous;
    await fs.rm(base,{recursive:true,force:true});
  }
});

// This is a real-source acquisition/read oracle, not an asserted CFP estimate.
// It never executes the acquired files or sends assessment data to a service.
it('accounts for its own source files and drains every readable file without gaps', async () => {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const source=path.join(root,'src');
  const cache=await fs.mkdtemp(path.join(os.tmpdir(),'oes-self-source-'));
  const previous=process.env.OES_CACHE_ROOT;
  process.env.OES_CACHE_ROOT=cache;
  try {
    await workspaceContext.run(root,async()=>{
      const names=await fs.readdir(source,{recursive:true});
      const expected:string[]=[];
      for(const name of names) if((await fs.lstat(path.join(source,name))).isFile()) expected.push(name.replaceAll('\\','/'));
      const snapshot=await acquireRepository('src',{partial_authorized:true});
      expect(snapshot.manifest.files.map(f=>f.path).sort()).toEqual(expected.sort());
      expect(snapshot.total_files).toBe(snapshot.analyzed_candidates+snapshot.excluded_files);
      mcpState.registerSnapshot(snapshot,root);
      const entry=mcpState.getSnapshot(snapshot.snapshot_id)!;
      let bytes=0, chunks=0;
      for(const file of snapshot.manifest.files){
        const raw=await fs.readFile(path.join(source,file.path));
        const limitCause=raw.length>LIMITS.single ? 'SINGLE_FILE_LIMIT'
          : raw.toString('utf8').split('\n').some(line=>Buffer.byteLength(line,'utf8')+1>64*1024) ? 'LINE_SIZE_LIMIT' : null;
        if(limitCause){
          expect(file).toMatchObject({disposition:'excluded',exclusion_reason:limitCause});
          expect(snapshot.acquisition?.scope_coverage).toBe('MISSING');
          expect(snapshot.acquisition?.issues).toContainEqual({path:file.path,cause:limitCause});
          await expect(handleReadRepositoryFile({snapshot_id:snapshot.snapshot_id,file_id:file.path})).rejects.toThrow('excluded');
          continue;
        }
        expect(file.disposition,file.path).not.toBe('excluded');
        expect(file.sha256).toBe(createHash('sha256').update(raw).digest('hex'));
        bytes+=raw.length;
        const lines=raw.toString('utf8').split('\n');
        if(lines.at(-1)==='') lines.pop();
        let start=1;
        const received:string[]=[];
        do {
          const read=await handleReadRepositoryFile({snapshot_id:snapshot.snapshot_id,file_id:file.path,start_line:start,max_lines:37});
          expect(read.start_line).toBe(start);
          const end=read.end_line;
          expect(read.content).toBe(lines.slice(start-1,end).map((line,i)=>`${start+i}: ${line}`).join('\n'));
          received.push(...lines.slice(start-1,end));
          chunks++;
          if(!read.has_more){expect(read.next_start_line).toBeNull();break;}
          expect(end).toBeGreaterThanOrEqual(start);
          expect(read.next_start_line).toBe(end+1);
          expect(entry.tracker.getDisposition(file.path)).toBe('unread');
          start=read.next_start_line;
        } while(start<=file.line_count);
        expect(received,file.path).toEqual(lines);
        expect(entry.tracker.getDisposition(file.path),file.path).not.toBe('unread');
      }
      expect(bytes).toBe(snapshot.total_bytes);
      expect(chunks).toBeGreaterThan(snapshot.analyzed_candidates);
      const restored=new SnapshotCoverageTracker(snapshot.manifest,snapshot.analysis_complete);
      restored.restoreReads(entry.tracker.exportReads());
      for(const file of snapshot.manifest.files) expect(restored.getDisposition(file.path)).toBe(entry.tracker.getDisposition(file.path));
      const readable=snapshot.manifest.files.find(f=>f.disposition!=='excluded')!;
      await fs.appendFile(path.join(snapshot.cache_dir,'files',readable.path),'\n// corrupted cached copy');
      await expect(handleReadRepositoryFile({snapshot_id:snapshot.snapshot_id,file_id:readable.path})).rejects.toThrow('SNAPSHOT_CONTENT_CHANGED');
    });
  } finally {
    mcpState.clearSnapshots();
    if(previous===undefined) delete process.env.OES_CACHE_ROOT; else process.env.OES_CACHE_ROOT=previous;
    // Exact temporary directory created above; never remove the repository.
    await fs.rm(cache,{recursive:true,force:true});
  }
},60000);
