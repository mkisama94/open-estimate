import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {publicationFixture} from '../fixtures/estimate-publication.js';
import {prepareEstimateStart,startEstimateWorkflow,freezeEstimateWorkflow,resumeEstimateWorkflow,showEstimateWorkflow,cancelEstimateWorkflow,withdrawEstimateWorkflow} from '../../src/local/estimate-workflow.js';
import {readWorkflowFile,withWorkflowLock} from '../../src/local/workflow-store.js';
import {WorkflowTransportError,type WorkflowAdapters} from '../../src/local/publication-client.js';
import {jcsSha256} from '../../src/core/canonical.js';
async function setup(selection={read:true,verify:true,publish:true}){
 const f=await publicationFixture();process.env.OES_WORKFLOWS_ROOT=await fs.mkdtemp(path.join(os.tmpdir(),'oes-workflow-'));const origin={target_hash:'a'.repeat(64),plan_hash:'b'.repeat(64)};
 const draft=await prepareEstimateStart({target_ref:path.resolve('examples/quality-check'),...origin,plan_ref:'local-plan',ruleset_ref:f.result.ruleset_ref,display_currency:'USD'},f.services);
 const adapters:WorkflowAdapters={issue:r=>f.issuer.issue(r,f.now),publish:async r=>(await f.service.register(r)).response,lookup:async(op,t)=>{try{return await f.service.operation(op,t);}catch(e:any){if(e.status===404)return {status:'NOT_FOUND'};throw e;}},withdraw:(id,t)=>f.service.withdraw(id,t) as any};
 return {...f,origin,draft,adapters,options:{adapters,services:f.services,keys:[f.key]},start:()=>startEstimateWorkflow({workflow_id:draft.workflow_id,terms_hash:draft.terms_hash,selection,explicit_answer:'[合成試験] 選択して開始'})};
}
it('sends nothing before consent or for unselected operations; preserves local outputs for each selection',async()=>{
 for(const selection of [{read:true,verify:false,publish:false},{read:true,verify:true,publish:false},{read:true,verify:true,publish:true}]){const f=await setup(selection);try{
  expect(f.draft.initial_selection).toEqual({read:false,verify:false,publish:false});await expect(freezeEstimateWorkflow(f.draft.workflow_id,f.result,f.input,f.origin)).rejects.toThrow('START_REQUIRED');
  await f.start();await freezeEstimateWorkflow(f.draft.workflow_id,f.result,f.input,f.origin);let proofs=0,publications=0;const adapters={...f.adapters,issue:async(r:any)=>{proofs++;return f.adapters.issue(r)},publish:async(r:any)=>{publications++;return f.adapters.publish(r)}};
  const v=await resumeEstimateWorkflow(f.draft.workflow_id,{...f.options,adapters});expect(v.pdf_status).toBe('READY');expect(v.proof_status).toBe(selection.verify?'VERIFIED':'NOT_SELECTED');expect(publications).toBe(selection.publish?1:0);expect(proofs).toBe(selection.verify?1:0);expect(v.product_additional_consent_count).toBe(0);
  const secret=await readWorkflowFile<any>(f.draft.workflow_id,'management-secret.json');expect(JSON.stringify(v)).not.toContain(secret.token);expect(JSON.stringify(v)).not.toContain('withdrawal_token_hash');
  const later=await resumeEstimateWorkflow(f.draft.workflow_id,{...f.options,adapters});expect(later.publication).toEqual(v.publication);expect(publications).toBe(selection.publish?1:0);expect(proofs).toBe(selection.verify?1:0);
 }finally{f.db.sqlite.close();}}
},60000);
it('resumes only Web registration after failure with the identical operation and frozen rate, no extra consent',async()=>{const f=await setup();try{
 await f.start();await freezeEstimateWorkflow(f.draft.workflow_id,f.result,f.input,f.origin);let issue=0,publish=0;const requests:any[]=[];
 const failing={...f.adapters,issue:async(r:any)=>{issue++;return f.adapters.issue(r)},publish:async(r:any)=>{publish++;requests.push(r);throw new WorkflowTransportError('WEB_DOWN',true,true)}};
 const v=await resumeEstimateWorkflow(f.draft.workflow_id,{...f.options,adapters:failing});expect(v.proof_status).toBe('VERIFIED');expect(v.publication_status).toBe('PUBLICATION_UNCONFIRMED');expect(v.pdf_status).toBe('READY');expect(publish).toBe(1);
 const success={...f.adapters,issue:failing.issue,publish:async(r:any)=>{requests.push(r);return f.adapters.publish(r)}};const done=await resumeEstimateWorkflow(f.draft.workflow_id,{...f.options,adapters:success});expect(issue).toBe(1);expect(done.publication_status).toBe('PUBLISHED');expect(new Set(requests.map(jcsSha256)).size).toBe(1);expect(done.result?.display_quote).toEqual(f.result.display_quote);
 await withdrawEstimateWorkflow(f.draft.workflow_id,f.adapters);expect((await resumeEstimateWorkflow(f.draft.workflow_id,f.options)).publication_status).toBe('WITHDRAWN');
 }finally{f.db.sqlite.close();}},30000);
it('cancels unsent stages and resolves a committed but lost publish response using only a private read-only lookup',async()=>{const f=await setup();try{
 await f.start();await freezeEstimateWorkflow(f.draft.workflow_id,f.result,f.input,f.origin);let posts=0,lookups=0;
 const adapters={...f.adapters,publish:async(r:any)=>{posts++;await f.adapters.publish(r);await cancelEstimateWorkflow(f.draft.workflow_id);throw new WorkflowTransportError('LOST',true,true)},lookup:async(op:string,t:string)=>{lookups++;return f.adapters.lookup(op,t)}};
 await resumeEstimateWorkflow(f.draft.workflow_id,{...f.options,adapters});const view=await resumeEstimateWorkflow(f.draft.workflow_id,{...f.options,adapters});expect(posts).toBe(1);expect(lookups).toBe(1);expect(view.status).toBe('CANCELLED');expect(view.publication_status).toBe('PUBLISHED');expect(view.publication?.canonical_url).toMatch(/\/results\/res_/);
 const g=await setup();try{await g.start();await freezeEstimateWorkflow(g.draft.workflow_id,g.result,g.input,g.origin);await cancelEstimateWorkflow(g.draft.workflow_id);let sends=0;await resumeEstimateWorkflow(g.draft.workflow_id,{...g.options,adapters:{...g.adapters,issue:async()=>{sends++;throw Error()}}});expect(sends).toBe(0);}finally{g.db.sqlite.close();}
 }finally{f.db.sqlite.close();}});
it('blocks scope/destination expansion, malformed responses and altered fixed data',async()=>{const f=await setup();try{
 await f.start();await expect(freezeEstimateWorkflow(f.draft.workflow_id,f.result,f.input,{...f.origin,target_hash:'c'.repeat(64)})).rejects.toThrow('SCOPE_CHANGE');await freezeEstimateWorkflow(f.draft.workflow_id,f.result,f.input,f.origin);
 await expect(freezeEstimateWorkflow(f.draft.workflow_id,{...f.result,scope_coverage:'MISSING'},f.input,f.origin)).rejects.toThrow('FROZEN');
 await expect(resumeEstimateWorkflow(f.draft.workflow_id,{...f.options,services:{...f.services,result_origin:'https://evil.example'}})).rejects.toThrow('DESTINATION_CHANGED');
 const adapters={...f.adapters,publish:async(r:any)=>({...await f.adapters.publish(r),canonical_url:'https://evil.example/results/res_'+'a'.repeat(32)})};expect((await resumeEstimateWorkflow(f.draft.workflow_id,{...f.options,adapters})).last_error).toBe('PUBLICATION_RESPONSE_MISMATCH');
 }finally{f.db.sqlite.close();}});

it('retains an inflight cancelled publication after repeated 404 and transport failure, then discovers a late commit without POST',async()=>{
 const f=await setup();try{
  const id=f.draft.workflow_id;await f.start();await freezeEstimateWorkflow(id,f.result,f.input,f.origin);
  let posts=0,proofs=0,lookups=0,pending:any,lookupMode='missing';
  const requests:string[]=[];
  const adapters:WorkflowAdapters={...f.adapters,
   issue:async r=>{proofs++;return f.adapters.issue(r);},
   publish:async r=>{posts++;pending=r;await cancelEstimateWorkflow(id);throw new WorkflowTransportError('LOST',true,true);},
   lookup:async(op,token)=>{lookups++;requests.push(jcsSha256({op,token}));if(lookupMode==='missing')return {status:'NOT_FOUND'};if(lookupMode==='offline')throw new WorkflowTransportError('LOOKUP_DOWN',true);return f.adapters.lookup(op,token);}
  };
  const options={...f.options,adapters};await resumeEstimateWorkflow(id,options);
  for(const mode of ['missing','missing','offline']){
   lookupMode=mode;const view=await resumeEstimateWorkflow(id,options);
   expect(view.publication_status).toBe('CANCELLED_PUBLICATION_UNCONFIRMED');expect(view.publication).toBeNull();
   expect((await readWorkflowFile<any>(id,'state.json')).publish_inflight).toBe(true);
  }
  await f.adapters.publish(pending);lookupMode='committed';
  const view=await resumeEstimateWorkflow(id,options);expect(view.status).toBe('CANCELLED');expect(view.publication_status).toBe('PUBLISHED');expect(view.publication).not.toBeNull();
  expect((await readWorkflowFile<any>(id,'state.json')).publish_inflight).toBe(false);
  await resumeEstimateWorkflow(id,options);expect(lookups).toBe(4);expect(posts).toBe(1);expect(proofs).toBe(1);expect(new Set(requests).size).toBe(1);
 }finally{f.db.sqlite.close();}
},30000);

it('recovers the same workflow after killing its publishing process and preserves mutual exclusion between reclaimers',async()=>{
 const f=await setup();let child:ReturnType<typeof fork>|undefined;try{
  const id=f.draft.workflow_id;await f.start();await freezeEstimateWorkflow(id,f.result,f.input,f.origin);
  await resumeEstimateWorkflow(id,{...f.options,adapters:{...f.adapters,publish:async()=>{throw new WorkflowTransportError('WEB_DOWN',true,true);}}});
  const before=await readWorkflowFile<any>(id,'state.json'),secret=await readWorkflowFile<any>(id,'management-secret.json');
  child=fork(fileURLToPath(new URL('../fixtures/workflow-crash-child.mjs',import.meta.url)),[],{env:{...process.env},stdio:['ignore','ignore','pipe','ipc']});
  const message=once(child,'message');child.send({id,mode:'resume',services:f.services,keys:[f.key]});
  expect((await message)[0]).toEqual({phase:'PUBLISH_PENDING',operation_id:secret.publish_operation_id});
  await expect(withWorkflowLock(id,async()=>{})).rejects.toThrow('BUSY_RETRY');
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  // All contenders see the dead owner. Exactly one enters; no contender may
  // remove the next owner's marker while reclaiming the old one.
  let active=0,maximum=0,entered=0,rejected=0;let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const contenders=Array.from({length:6},()=>withWorkflowLock(id,async()=>{active++;entered++;maximum=Math.max(maximum,active);await gate;active--;}));
  const settled=contenders.map(p=>p.then(()=>null,e=>{rejected++;return e.message;}));
  const deadline=Date.now()+5000;while((entered===0||rejected<5)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  expect(entered).toBe(1);await expect(withWorkflowLock(id,async()=>{})).rejects.toThrow('BUSY_RETRY');release();
  expect((await Promise.all(settled)).filter(x=>x===null)).toHaveLength(1);expect(maximum).toBe(1);
  const done=await resumeEstimateWorkflow(id,f.options);expect(done.publication_status).toBe('PUBLISHED');expect(done.proof).toEqual(before.proof);
  const after=await readWorkflowFile<any>(id,'state.json');expect(after.publish_request).toEqual(before.publish_request);expect(after.proof_request.operation_id).toBe(before.proof_request.operation_id);expect(await readWorkflowFile(id,'management-secret.json')).toEqual(secret);
 }finally{if(child&&!child.killed)child.kill('SIGKILL');f.db.sqlite.close();}
},30000);
