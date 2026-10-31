import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {privateDirectory} from '../local-files.js';
import {resolveSafePath} from '../collector/safe-paths.js';
import {withProcessLock} from './workflow-lock.js';
export const WORKFLOW_FILE_BYTES=4*1024*1024;
export function workflowsRoot(){const r=process.env.OES_WORKFLOWS_ROOT??path.join(os.homedir(),'.open-estimate','workflows');if(!path.isAbsolute(r))throw Error('ABSOLUTE_WORKFLOW_DIRECTORY_REQUIRED');return r;}
export async function workflowDirectory(id:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw Error('INVALID_WORKFLOW_ID');await privateDirectory(workflowsRoot());return resolveSafePath(id,workflowsRoot());}
export async function createWorkflowDirectory(id:string){await privateDirectory(workflowsRoot());const dir=path.join(workflowsRoot(),id);await fs.mkdir(dir,{mode:0o700});return dir;}
export async function readWorkflowFile<T>(id:string,name:string):Promise<T>{const dir=await workflowDirectory(id),file=await resolveSafePath(name,dir),s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>WORKFLOW_FILE_BYTES)throw Error('WORKFLOW_STATE_INVALID');return JSON.parse(await fs.readFile(file,'utf8'));}
export async function writeWorkflowFile(id:string,name:string,value:unknown){const json=JSON.stringify(value);if(json===undefined)throw Error('WORKFLOW_STATE_INVALID');if(Buffer.byteLength(json,'utf8')>WORKFLOW_FILE_BYTES)throw Error('WORKFLOW_STATE_TOO_LARGE');const dir=await workflowDirectory(id);await resolveSafePath(name,dir).catch((e:any)=>{if(e.code!=='ENOENT')throw e;});const tmp=path.join(dir,randomUUID()+'.tmp');try{await fs.writeFile(tmp,json,{flag:'wx',mode:0o600});await fs.rename(tmp,path.join(dir,name));}finally{await fs.rm(tmp,{force:true});}}
export async function withWorkflowLock<T>(id:string,fn:()=>Promise<T>):Promise<T>{return withProcessLock(await workflowDirectory(id),fn);}
export async function isWorkflowCancelled(id:string){try{await readWorkflowFile(id,'cancel.json');return true;}catch(e:any){if(e.code==='ENOENT')return false;throw e;}}
