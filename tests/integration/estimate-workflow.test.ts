import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publicationFixture} from '../fixtures/estimate-publication.js';
import {prepareEstimateStart,startEstimateWorkflow,freezeEstimateWorkflow,resumeEstimateWorkflow,showEstimateWorkflow,cancelEstimateWorkflow,withdrawEstimateWorkflow} from '../../src/local/estimate-workflow.js';
import {readWorkflowFile} from '../../src/local/workflow-store.js';
import {WorkflowTransportError,type WorkflowAdapters} from '../../src/local/publication-client.js';
import {jcsSha256} from '../../src/core/canonical.js';
async function setup(selection={read:true,verify:true,publish:true}){
 const f=await publicationFixture();process.env.OES_WORKFLOWS_ROOT=await fs.mkdtemp(path.join(os.tmpdir(),'oes-workflow-'));const origin={target_hash:'a'.repeat(64),plan_hash:'b'.repeat(64)};
 const draft=await prepareEstimateStart({target_ref:path.resolve('examples/quality-check'),...origin,plan_ref:'local-plan',ruleset_ref:f.result.ruleset_ref,display_currency:'USD'},f.services);
 const adapters:WorkflowAdapters={issue:r=>f.issuer.issue(r,f.now),publish:async r=>(await f.service.register(r)).response,lookup:async(op,t)=>f.service.operation(op,t),withdraw:(id,t)=>f.service.withdraw(id,t) as any};
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
 const v=await resumeEstimateWorkflow(f.draft.workflow_id,{...f.options,adapters:failing});expect(v.proof_status).toBe('VERIFIED');expect(v.publication_status).toBe('RETRY_PENDING');expect(v.pdf_status).toBe('READY');expect(publish).toBe(2);
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
