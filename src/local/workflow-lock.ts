import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';

interface Owner {version:1;token:string;pid:number;hostname:string;created_at:string}
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
async function removeOwnedMarker(dir:string,marker:string){
 try{await fs.unlink(path.join(dir,marker));}catch(e){if(missing(e))return;throw e;}
 // Another contender may already have replaced the now-empty directory.
 try{await fs.rmdir(dir);}catch(e){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes((e as NodeJS.ErrnoException).code??''))throw e;}
}
async function reclaimDeadOwner(dir:string){
 let stat;try{stat=await fs.lstat(dir);}catch(e){if(missing(e))return;throw e;}
 // Old empty-file locks have no process identity. Never guess that their owner died.
 if(stat.isFile()&&!stat.isSymbolicLink())throw Error('WORKFLOW_LEGACY_LOCK_REQUIRES_CHECK');
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('WORKFLOW_LOCK_INVALID');
 const entries=await fs.readdir(dir).catch(e=>{if(missing(e))return [];throw e;});
 if(entries.length===0){try{await fs.rmdir(dir);}catch(e){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes((e as NodeJS.ErrnoException).code??''))throw e;}return;}
 if(entries.length!==1||!/^owner-[a-f0-9-]{36}\.json$/.test(entries[0]))throw Error('WORKFLOW_LOCK_INVALID');
 const marker=entries[0],file=path.join(dir,marker);
 let owner:Owner;
 try{
  const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>2048)throw Error('WORKFLOW_LOCK_INVALID');
  owner=JSON.parse(await fs.readFile(file,'utf8'));
 }catch(e){if(missing(e))return;throw e;}
 if(owner.version!==1||marker!==`owner-${owner.token}.json`||!Number.isSafeInteger(owner.pid)||owner.pid<=0||typeof owner.hostname!=='string')throw Error('WORKFLOW_LOCK_INVALID');
 if(owner.hostname!==os.hostname())throw Error('WORKFLOW_LOCK_OWNER_UNVERIFIABLE');
 try{process.kill(owner.pid,0);}catch(e){
  if((e as NodeJS.ErrnoException).code==='ESRCH'){
   // Delete only this owner's unique marker, never an unconditionally renamed lock.
   await removeOwnedMarker(dir,marker);return;
  }
  throw Error('WORKFLOW_LOCK_OWNER_UNVERIFIABLE');
 }
 throw Error('WORKFLOW_BUSY_RETRY');
}

/** Publish a fully populated directory atomically; a live lock is never empty. */
export async function withProcessLock<T>(workflowDir:string,fn:()=>Promise<T>):Promise<T>{
 const token=randomUUID(),marker=`owner-${token}.json`,prepared=path.join(workflowDir,`.workflow-lock-${token}`),lock=path.join(workflowDir,'workflow.lock');
 await fs.mkdir(prepared,{mode:0o700});
 let acquired=false;
 try{
  const handle=await fs.open(path.join(prepared,marker),'wx',0o600);
  try{await handle.writeFile(JSON.stringify({version:1,token,pid:process.pid,hostname:os.hostname(),created_at:new Date().toISOString()} satisfies Owner));await handle.sync();}finally{await handle.close();}
  for(let attempt=0;attempt<8;attempt++){
   // On Windows rename can replace a legacy regular file. Inspect it before
   // attempting directory publication and require an explicit legacy check.
   await reclaimDeadOwner(lock);
   try{await fs.rename(prepared,lock);acquired=true;break;}
   catch(e){
    // Windows may report EPERM instead of EEXIST for an occupied directory.
    const exists=await fs.lstat(lock).then(()=>true,e=>{if(missing(e))return false;throw e;});
    if(!exists){if(['ENOENT','EEXIST','ENOTEMPTY'].includes((e as NodeJS.ErrnoException).code??''))continue;throw e;}
    await reclaimDeadOwner(lock);
   }
  }
  if(!acquired)throw Error('WORKFLOW_BUSY_RETRY');
  return await fn();
 }finally{
  await removeOwnedMarker(acquired?lock:prepared,marker);
 }
}
