import {withWorkflowLock} from '../../dist/local/workflow-store.js';
import {resumeEstimateWorkflow} from '../../dist/local/estimate-workflow.js';

process.once('message',async({id,mode,services,keys})=>{
 const keepAlive=setInterval(()=>{},1000);
 try{
  if(mode==='resume'){
   await resumeEstimateWorkflow(id,{services,keys,adapters:{
    issue:async()=>{throw Error('UNEXPECTED_PROOF_REISSUE');},
    publish:async request=>{process.send({phase:'PUBLISH_PENDING',operation_id:request.operation_id});return new Promise(()=>{});},
    lookup:async()=>{throw Error('UNEXPECTED_LOOKUP');},withdraw:async()=>{throw Error('UNEXPECTED_WITHDRAW');}
   }});
  }else await withWorkflowLock(id,async()=>{process.send({phase:'LOCKED'});await new Promise(()=>{});});
 }catch(e){process.send({error:e.message});process.exitCode=1;process.disconnect();}
 finally{clearInterval(keepAlive);}
});
