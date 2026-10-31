import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {EstimateProofRequest,EstimateProof,PublishEstimate,PublishedEstimate} from '../contracts/estimate-result.js';
import type {EstimateServices} from './estimate-services.js';
export interface WorkflowAdapters {issue(r:EstimateProofRequest):Promise<EstimateProof>;publish(r:PublishEstimate):Promise<PublishedEstimate>;lookup(operation:string,token:string):Promise<PublishedEstimate|{status:'WITHDRAWN'|'EXPIRED'|'NOT_FOUND'}>;withdraw(id:string,token:string):Promise<{status:'WITHDRAWN'}>}
export class WorkflowTransportError extends Error {constructor(public code:string,public retryable:boolean,public uncertain=false){super(code);}}
export function workflowAdapters(services:EstimateServices):WorkflowAdapters {
 const call=async(path:string,method:string,body?:unknown,token?:string)=>{
  let response:Response;try{response=await fetch(new URL(path,services.result_origin),{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new WorkflowTransportError('WEB_RESPONSE_UNKNOWN',true,true);}
  let v:any;try{const bytes=await response.arrayBuffer();if(bytes.byteLength>32768)throw Error();v=JSON.parse(new TextDecoder().decode(bytes));if(!v||typeof v!=='object'||Array.isArray(v))throw Error();}catch{throw new WorkflowTransportError('WEB_RESPONSE_INVALID',true,true);}
  if(response.status===410&&['WITHDRAWN','EXPIRED'].includes(v.error?.state))return {status:v.error.state};if(response.status===404&&method==='GET')return {status:'NOT_FOUND'};
  if(!response.ok)throw new WorkflowTransportError(v.error?.code??'WEB_REQUEST_FAILED',response.status===429||response.status>=500,response.status>=500);return v;
 };
 return {
  async issue(request){const client=new Client({name:'open-estimate-local',version:'0.12.0'});try{await client.connect(new StreamableHTTPClientTransport(new URL(services.proof_destination)),{timeout:20000});const r=await client.callTool({name:'issue_estimate_proof',arguments:request as any},undefined,{timeout:30000});const v:any=r.structuredContent;if(r.isError)throw new WorkflowTransportError(v?.error?.code??'PROOF_REQUEST_FAILED',/RATE_LIMIT|UNAVAILABLE/.test(v?.error?.code??''));return v as EstimateProof;}catch(e){if(e instanceof WorkflowTransportError)throw e;throw new WorkflowTransportError('PROOF_RESPONSE_UNKNOWN',true,true);}finally{await client.close().catch(()=>{});}},
  publish:r=>call('/api/results','POST',r) as Promise<PublishedEstimate>,lookup:(op,token)=>call('/api/result-operations/'+op,'GET',undefined,token),withdraw:(id,token)=>call('/api/results/'+id+'/withdraw','POST',undefined,token)
 };
}
