import {it,expect} from 'vitest';
import {consentWorkflow,authorizeRequest} from '../../src/local/workflow-consent.js';
import {jcsSha256} from '../../src/core/canonical.js';
import {publicationFixture} from '../fixtures/estimate-publication.js';
import type {WorkflowTerms} from '../../src/local/workflow-consent.js';
it('supports exactly the three read/verify/publish selections and binds later numbers to approved conditions',async()=>{const f=await publicationFixture();try{
 const t:WorkflowTerms={contract_version:'oes/workflow-consent/v1',workflow_id:crypto.randomUUID(),target_hash:'a'.repeat(64),plan_hash:'b'.repeat(64),ruleset_ref:f.result.ruleset_ref,services:f.services,display_currency:'USD',calculation_policy:'oes-fixed-test-calculation/v1',publication_days:365,quality_policy:'DECLARED_PARTIAL_ALLOWED_PROJECT_TOTAL_UNCALCULATED',transmission_policy:'oes/estimate-transmission/v1'};
 const ctx={target_hash:t.target_hash,plan_hash:t.plan_hash};
 for(const s of [{read:true,verify:false,publish:false},{read:true,verify:true,publish:false},{read:true,verify:true,publish:true}]){const c=consentWorkflow(t,s,'明示回答',jcsSha256(t));if(s.verify)expect(authorizeRequest(c,f.request,'proof',ctx).additional_consent).toBe(false);else expect(()=>authorizeRequest(c,f.request,'proof',ctx)).toThrow('NOT_SELECTED');if(s.publish)expect(authorizeRequest(c,f.publish,'publish',ctx).destination).toBe(f.services.publication_destination);}
 for(const s of [{read:false,verify:false,publish:false},{read:true,verify:false,publish:true}])expect(()=>consentWorkflow(t,s,'回答',jcsSha256(t))).toThrow();
 const c=consentWorkflow(t,{read:true,verify:true,publish:true},'回答',jcsSha256(t));expect(()=>authorizeRequest(c,f.request,'proof',{...ctx,target_hash:'c'.repeat(64)})).toThrow('SCOPE_CHANGE');
 expect(()=>authorizeRequest({...c,cancelled_at:new Date().toISOString()},f.request,'proof',ctx)).toThrow('CANCELLED');
 expect(()=>authorizeRequest(c,{...f.request,result:{...f.result,display_quote:{...f.result.display_quote,display_currency:'JPY'}}},'proof',ctx)).toThrow('CONDITIONS_CHANGED');
 expect(()=>consentWorkflow(t,{read:true,verify:true,publish:true},'',jcsSha256(t))).toThrow('EXPLICIT');
 }finally{f.db.sqlite.close();}});
