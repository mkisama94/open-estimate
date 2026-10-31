import fs from 'node:fs/promises';import path from 'node:path';
import {workspaceContext} from '../../dist/collector/workspace-context.js';
import {restoreWorkflowSnapshot} from '../../dist/mcp/workflow-snapshot.js';
import {evaluateWorkflowDraft} from '../../dist/local/workflow-evaluation.js';
import {readWorkflowData} from '../../dist/local/workflow-data.js';
process.once('message',async({workflow_id,draft_id,root,rules,mode})=>{
 const timer=setInterval(()=>{},1000);try{await workspaceContext.run(root,async()=>{
  await restoreWorkflowSnapshot(workflow_id,root);
  const options=mode==='incomplete'?{save:async(_a,_submitted,_context,_target,_record,{run_id})=>{await fs.mkdir(path.join(process.env.OES_RUNS_ROOT,run_id),{recursive:true});await fs.writeFile(path.join(process.env.OES_RUNS_ROOT,run_id,'assessment.json'),'{}');process.send({phase:'RUN_INCOMPLETE',run_id});await new Promise(()=>{});}}:{afterSave:async()=>{const j=await readWorkflowData(workflow_id,draft_id+'-progress.json');process.send({phase:'RUN_COMPLETE',run_id:j.run_id});await new Promise(()=>{});}};
  await evaluateWorkflowDraft({workflow_id,draft_id},rules,options);
 });}catch(e){process.send({error:e.message});}finally{clearInterval(timer);}
});
