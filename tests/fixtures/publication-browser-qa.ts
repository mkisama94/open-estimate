import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {publicationFixture} from './estimate-publication.js';
import {prepareEstimateStart,startEstimateWorkflow} from '../../src/local/estimate-workflow.js';
import {estimateStartWidgetHtml,estimateWorkflowWidgetHtml} from '../../src/local/workflow-widget.js';
const root=process.env.OES_PUBLICATION_QA_ROOT,input=process.env.OES_PUBLICATION_QA_INPUT;if(!root||!input||!path.isAbsolute(root)||!path.isAbsolute(input))throw Error('QA_CONFIGURATION_REQUIRED');
process.env.OES_WORKFLOWS_ROOT=path.join(root,'synthetic-ui-state');const f=await publicationFixture();let starts=0;
const draft=await prepareEstimateStart({target_ref:path.join(root,'synthetic-target'),target_hash:'a'.repeat(64),plan_ref:'SYNTHETIC_METADATA_ONLY',plan_hash:'b'.repeat(64),ruleset_ref:f.result.ruleset_ref,display_currency:'USD'},f.services);
const inject=(html:string,view:unknown)=>html.replace('<main id="view">',`<script>window.openai={toolOutput:${JSON.stringify(view).replace(/</g,'\\u003c')},callTool:async(name,args)=>{const r=await fetch('/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});return r.json();},sendFollowUpMessage:async()=>{}};</script><main id="view">`);
const server=http.createServer(async(req,res)=>{const u=new URL(req.url!,'http://127.0.0.1');res.setHeader('Content-Type','text/html; charset=utf-8');
 if(req.method==='GET'&&u.pathname==='/start'){res.end(inject(estimateStartWidgetHtml,{...draft,scope:[{path:'src',role:'measurement'},{path:'base-data',role:'excluded'}],acquisition:{totals:{measurement:{files:5,bytes:10240},supporting:{files:2,bytes:2048},excluded:{files:10,bytes:89128960}},limits:{bytes:104857600,single:2097152}}}));return;}
 if(req.method==='GET'&&u.pathname==='/result'){const sample=u.searchParams.get('sample')==='partial'?'partial':'complete',v=JSON.parse(await fs.readFile(path.join(input,sample+'.json'),'utf8'));res.end(inject(estimateWorkflowWidgetHtml,v));return;}
 if(req.method==='POST'&&u.pathname==='/tool'){const chunks:Buffer[]=[];for await(const b of req)chunks.push(b);const v=JSON.parse(Buffer.concat(chunks).toString());res.setHeader('Content-Type','application/json');if(v.name==='start_estimate_workflow'){starts++;try{const result=await startEstimateWorkflow({...v.args,explicit_answer:'[合成UI試験] '+v.args.explicit_answer});res.end(JSON.stringify({structuredContent:result}));}catch{res.end(JSON.stringify({isError:true}));}return;}res.end(JSON.stringify({isError:true}));return;}
 if(u.pathname==='/stats'){res.end(JSON.stringify({starts,synthetic_host:true,actual_chatgpt:false,external_requests:0}));return;}res.writeHead(404);res.end();
});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({origin:'http://127.0.0.1:'+(server.address() as any).port,synthetic_host:true,actual_chatgpt:false,external_requests:0})));
