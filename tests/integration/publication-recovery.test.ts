import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {publicationFixture} from '../fixtures/estimate-publication.js';
import {prepareEstimateStart,startEstimateWorkflow,freezeEstimateWorkflow,resumeEstimateWorkflow} from '../../src/local/estimate-workflow.js';
import {workflowAdapters} from '../../src/local/publication-client.js';
import {readWorkflowFile,writeWorkflowFile} from '../../src/local/workflow-store.js';

async function setup(){
 const f=await publicationFixture(),prior=process.env.OES_WORKFLOWS_ROOT,root=await fs.mkdtemp(path.join(os.tmpdir(),'oes-unknown-'));process.env.OES_WORKFLOWS_ROOT=root;
 const origin={target_hash:'a'.repeat(64),plan_hash:'b'.repeat(64)},draft=await prepareEstimateStart({target_ref:path.resolve('examples/quality-check'),...origin,plan_ref:'synthetic',ruleset_ref:f.result.ruleset_ref,display_currency:'USD'},f.services);
 const id=draft.workflow_id;await startEstimateWorkflow({workflow_id:id,terms_hash:draft.terms_hash,selection:{read:true,verify:true,publish:true},explicit_answer:'[合成試験] 開始'});await freezeEstimateWorkflow(id,f.result,f.input,origin);
 const adapters={...workflowAdapters(f.services),issue:(r:any)=>f.issuer.issue(r,f.now)};
 return {...f,id,options:{adapters,services:f.services,keys:[f.key]},cleanup:async()=>{vi.unstubAllGlobals();f.db.sqlite.close();if(prior===undefined)delete process.env.OES_WORKFLOWS_ROOT;else process.env.OES_WORKFLOWS_ROOT=prior;await fs.rm(root,{recursive:true,force:true});}};
}
for(const [name,body,status]of [['HTML 502','<html>bad gateway</html>',502],['truncated JSON','{"status":',200],['oversized body',' '.repeat(32769),200],['null JSON','null',200]] as const){
 it('looks up a committed publication after '+name+' without another POST',async()=>{
  const f=await setup();try{let posts=0,lookups=0;vi.stubGlobal('fetch',async(_url:any,o:any)=>{
   if(o.method==='POST'){posts++;await f.service.register(JSON.parse(o.body));return new Response(body,{status});}
   lookups++;const m=await readWorkflowFile<any>(f.id,'management-secret.json');return Response.json(await f.service.operation(m.publish_operation_id,m.token));
  });
  const first=await resumeEstimateWorkflow(f.id,f.options);expect(first.publication_status).toBe('PUBLICATION_UNCONFIRMED');expect(first.last_error).toBe('WEB_RESPONSE_INVALID');expect(first.recovery_action).toBe('RESUME_TO_LOOK_UP_PUBLICATION');expect(posts).toBe(1);
  const before=await readWorkflowFile<any>(f.id,'state.json'),done=await resumeEstimateWorkflow(f.id,f.options);expect(done.publication_status).toBe('PUBLISHED');expect(posts).toBe(1);expect(lookups).toBe(1);expect(done.result).toEqual(first.result);expect(done.last_error).toBeNull();expect((await readWorkflowFile<any>(f.id,'state.json')).publish_request).toEqual(before.publish_request);
  }finally{await f.cleanup();}
 });
}
it('keeps unknown state through a broken lookup, and also recovers legacy FAILED inflight records',async()=>{
 const f=await setup();try{let posts=0,lookups=0;vi.stubGlobal('fetch',async(_url:any,o:any)=>{
  if(o.method==='POST'){posts++;await f.service.register(JSON.parse(o.body));return new Response('broken');}
  if(++lookups===1)return Response.json({error:{code:'PUBLICATION_SERVICE_UNAVAILABLE'}},{status:503});
  if(lookups===2)return new Response('<html>unavailable</html>',{status:502});
  const m=await readWorkflowFile<any>(f.id,'management-secret.json');return Response.json(await f.service.operation(m.publish_operation_id,m.token));
 });
 await resumeEstimateWorkflow(f.id,f.options);for(let i=0;i<2;i++){expect((await resumeEstimateWorkflow(f.id,f.options)).publication_status).toBe('PUBLICATION_UNCONFIRMED');expect((await readWorkflowFile<any>(f.id,'state.json')).publish_inflight).toBe(true);}
 const old=await readWorkflowFile<any>(f.id,'state.json');old.publication_status='FAILED';await writeWorkflowFile(f.id,'state.json',old);
 expect((await resumeEstimateWorkflow(f.id,f.options)).publication_status).toBe('PUBLISHED');expect(posts).toBe(1);expect(lookups).toBe(3);
 }finally{await f.cleanup();}
});
it('looks up before retrying a not-found operation with the same request',async()=>{
 const f=await setup();try{const order:string[]=[],bodies:string[]=[];vi.stubGlobal('fetch',async(_url:any,o:any)=>{
  order.push(o.method);if(o.method==='GET')return Response.json({error:{code:'RESULT_NOT_FOUND'}},{status:404});
  bodies.push(o.body);if(bodies.length===1)return new Response('broken');return Response.json((await f.service.register(JSON.parse(o.body))).response);
 });await resumeEstimateWorkflow(f.id,f.options);expect((await resumeEstimateWorkflow(f.id,f.options)).publication_status).toBe('PUBLISHED');expect(order).toEqual(['POST','GET','POST']);expect(new Set(bodies).size).toBe(1);
 }finally{await f.cleanup();}
});
it('keeps a structured deterministic rejection separate from an unknown result',async()=>{
 const f=await setup();try{let sends=0;vi.stubGlobal('fetch',async()=>{sends++;return Response.json({error:{code:'INVALID_PUBLICATION_INPUT'}},{status:400});});
 expect((await resumeEstimateWorkflow(f.id,f.options)).publication_status).toBe('FAILED');await resumeEstimateWorkflow(f.id,f.options);expect(sends).toBe(1);expect((await readWorkflowFile<any>(f.id,'state.json')).publish_inflight).toBe(false);
 }finally{await f.cleanup();}
});
