import {createHash} from 'node:crypto';
import {readWorkflowFile,writeWorkflowFile,WORKFLOW_FILE_BYTES} from './workflow-store.js';

const CHUNK_BYTES=1024*1024;
export const WORKFLOW_DATA_BYTES=64*CHUNK_BYTES;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
interface Parts {format:'oes/workflow-data/v1';bytes:number;sha256:string;parts:string[]}
/** Publish the index last; immutable content-addressed chunks keep older readers safe. */
export async function writeWorkflowData(id:string,name:string,value:unknown){
 const text=JSON.stringify(value);if(text===undefined)throw Error('WORKFLOW_STATE_INVALID');
 const bytes=Buffer.from(text,'utf8');if(bytes.length>WORKFLOW_DATA_BYTES)throw Error('WORKFLOW_DATA_TOO_LARGE');
 if(bytes.length<=WORKFLOW_FILE_BYTES)return writeWorkflowFile(id,name,value);
 const parts:string[]=[];
 for(let offset=0;offset<bytes.length;offset+=CHUNK_BYTES){
  const chunk=bytes.subarray(offset,offset+CHUNK_BYTES),part=`workflow-data-${hash(chunk)}.json`;
  await writeWorkflowFile(id,part,{data:chunk.toString('base64')});parts.push(part);
 }
 await writeWorkflowFile(id,name,{format:'oes/workflow-data/v1',bytes:bytes.length,sha256:hash(bytes),parts} satisfies Parts);
}
export async function readWorkflowData<T>(id:string,name:string):Promise<T>{
 const index=await readWorkflowFile<any>(id,name);if(index?.format!=='oes/workflow-data/v1')return index;
 if(!Number.isSafeInteger(index.bytes)||index.bytes<=WORKFLOW_FILE_BYTES||index.bytes>WORKFLOW_DATA_BYTES||!Array.isArray(index.parts)||index.parts.length!==Math.ceil(index.bytes/CHUNK_BYTES)||!/^[a-f0-9]{64}$/.test(index.sha256))throw Error('WORKFLOW_DATA_INVALID');
 const chunks:Buffer[]=[];let length=0;
 for(const part of index.parts){
  if(typeof part!=='string'||!/^workflow-data-[a-f0-9]{64}\.json$/.test(part))throw Error('WORKFLOW_DATA_INVALID');
  let value:any;try{value=await readWorkflowFile(id,part);}catch(e:any){if(e.code==='ENOENT')throw Error('WORKFLOW_DATA_INCOMPLETE');throw e;}
  if(typeof value?.data!=='string'||value.data.length>Math.ceil(CHUNK_BYTES/3)*4)throw Error('WORKFLOW_DATA_INVALID');
  const bytes=Buffer.from(value.data,'base64');if(!bytes.length||bytes.length>CHUNK_BYTES||bytes.toString('base64')!==value.data||part!==`workflow-data-${hash(bytes)}.json`)throw Error('WORKFLOW_DATA_INVALID');
  chunks.push(bytes);length+=bytes.length;if(length>index.bytes)throw Error('WORKFLOW_DATA_INVALID');
 }
 const bytes=Buffer.concat(chunks);if(length!==index.bytes||hash(bytes)!==index.sha256)throw Error('WORKFLOW_DATA_INVALID');
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('WORKFLOW_DATA_INVALID');}
}
