import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {documentFixture} from './document.js';
import {renderDocumentMarkdown} from '../../src/document/markdown.js';
import {renderDocumentPdf} from '../../src/local/estimate-pdf.js';
import {documentPreview} from '../../src/web/document-preview.js';
import {documentWidgetHtml} from '../../src/local/document-widget.js';
import {documentPresentation} from '../../src/document/presentation.js';
import {webPreviewInput,consentDocumentAction} from '../../src/local/document-consent.js';
import {openWebPreview} from '../../src/local/web-handoff.js';
const output=process.env.OES_DOCUMENT_QA_ROOT;if(!output||!path.isAbsolute(output))throw Error('QA_ROOT_REQUIRED');await fs.mkdir(output,{recursive:true});
const f=await documentFixture();const samples:Record<string,any>={};
for(const coverage of ['COMPLETE','MISSING'] as const){const document=structuredClone(f.document);document.scope_coverage=coverage;const markdown=renderDocumentMarkdown(document),request={...f.request,operation_id:coverage==='COMPLETE'?f.request.operation_id:'22222222-2222-4222-8222-222222222222',document,markdown},proof=await f.service.issue(request,f.now);const name=coverage==='COMPLETE'?'complete':'partial';
 await fs.writeFile(path.join(output,name+'.md'),markdown);await fs.writeFile(path.join(output,name+'-proof.json'),JSON.stringify(proof,null,2));await fs.writeFile(path.join(output,name+'.pdf'),await renderDocumentPdf(document,proof));
 const response=await documentPreview(new Request('http://127.0.0.1/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({format:'oes/document-display/v1',markdown,proof:JSON.stringify(proof)})}),[f.key]);await fs.writeFile(path.join(output,name+'.html'),await response.text());
 samples[name]={markdown,proof,document,presentation:documentPresentation(document),dir:'SYNTHETIC_LOCAL_DOCUMENT',local_details:{scope:'合成対象・ローカルだけの説明'},verification:{signature:'VALID',document:'MATCH',issuer:'TRUSTED',current_status:'NOT_CHECKED'}};
 if(coverage==='COMPLETE'&&process.env.OES_QA_WRITE_VECTOR==='true')await fs.writeFile('tests/fixtures/document-vector.json',JSON.stringify({request,proof,key:f.key},null,2)+'\n');
}
await fs.writeFile(path.join(output,'trusted-test-key.json'),JSON.stringify(f.key,null,2));f.db.sqlite.close();
const handoffDir=path.join(output,'handoff-'+randomUUID());await fs.mkdir(handoffDir,{recursive:true});
for(const [file,value] of Object.entries({'estimate.md':samples.complete.markdown,'document.json':JSON.stringify(samples.complete.document),'proof.json':JSON.stringify(samples.complete.proof)}))await fs.writeFile(path.join(handoffDir,file),value);
const pending=await webPreviewInput(handoffDir);await consentDocumentAction({document_dir:handoffDir,action:'web',request_hash:pending.request_hash,destination:pending.destination,user_confirmed:true,explicit_answer:'合成文書の隔離したブラウザー試験への送信に同意'});
const handoff=await openWebPreview(handoffDir);await fs.writeFile(path.join(output,'handoff.json'),JSON.stringify(handoff,null,2));
const counters={requests:[] as {method:string;path:string}[]};
const server=http.createServer(async(req,res)=>{const url=new URL(req.url!,'http://127.0.0.1');counters.requests.push({method:req.method!,path:url.pathname});
 if(url.pathname==='/stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(counters));return;}
 if(url.pathname==='/widget'){const sample=samples[url.searchParams.get('sample')??'complete'],pdf=(await fs.readFile(path.join(output,(url.searchParams.get('sample')??'complete')+'.pdf'))).toString('base64'),md=Buffer.from(sample.markdown).toString('base64'),proof=Buffer.from(JSON.stringify(sample.proof)).toString('base64');const host=`<script>const sample=${JSON.stringify(sample).replace(/</g,'\\u003c')};window.openai={toolOutput:sample,callTool:async(name)=>({_meta:{file_base64:name==='get_document_markdown'?${JSON.stringify(md)}:name==='get_document_proof'?${JSON.stringify(proof)}:${JSON.stringify(pdf)}}}),sendFollowUpMessage:async v=>{window.lastChoice=v;}};</script>`;res.end(documentWidgetHtml.replace('<main id="view">',host+'<main id="view">'));return;}
 if(url.pathname==='/preview'){
 const chunks:Buffer[]=[];for await(const b of req)chunks.push(b);const response=await documentPreview(new Request('http://127.0.0.1'+url.pathname,{method:req.method,headers:req.headers as Record<string,string>,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}),[f.key]);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
 res.writeHead(404);res.end();
});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:(server.address() as any).port,output,synthetic_host:true,actual_chatgpt:false,production_issuer:false})));
