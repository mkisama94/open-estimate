import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withProcessLock} from '../../src/local/workflow-lock.js';

async function fixture(){return fs.mkdtemp(path.join(os.tmpdir(),'oes-lock-'));}
it('protects a live owner regardless of age and releases even when the callback fails',async()=>{
 const dir=await fixture();try{
  await expect(withProcessLock(dir,async()=>{
   const lock=path.join(dir,'workflow.lock'),[marker]=await fs.readdir(lock),file=path.join(lock,marker);
   const owner=JSON.parse(await fs.readFile(file,'utf8'));owner.created_at='2000-01-01T00:00:00Z';await fs.writeFile(file,JSON.stringify(owner));
   await expect(withProcessLock(dir,async()=>{throw Error('OVERLAP');})).rejects.toThrow('WORKFLOW_BUSY_RETRY');
   throw Error('CALLBACK_FAILURE');
  })).rejects.toThrow('CALLBACK_FAILURE');
  expect(await withProcessLock(dir,async()=>42)).toBe(42);expect(await fs.readdir(dir)).toEqual([]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
it('does not guess the owner of legacy, foreign-host or malformed locks',async()=>{
 const dir=await fixture(),lock=path.join(dir,'workflow.lock');try{
  await fs.writeFile(lock,'');await expect(withProcessLock(dir,async()=>{})).rejects.toThrow('LEGACY_LOCK_REQUIRES_CHECK');expect((await fs.stat(lock)).isFile()).toBe(true);await fs.unlink(lock);
  await fs.mkdir(lock);const token=randomUUID(),file=path.join(lock,`owner-${token}.json`);
  await fs.writeFile(file,JSON.stringify({version:1,token,pid:process.pid,hostname:os.hostname()+'-other'}));await expect(withProcessLock(dir,async()=>{})).rejects.toThrow('OWNER_UNVERIFIABLE');
  await fs.writeFile(file,'{}');await expect(withProcessLock(dir,async()=>{})).rejects.toThrow('LOCK_INVALID');expect(await fs.readdir(lock)).toEqual([path.basename(file)]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
