/** Explicit local-only acceptance harness. Synthetic source and identity, never Auth0 or production. */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {previewFixture} from "./owner-preview.js";
import {generatedRules} from "./measurement.js";
import {saveRun} from "../../src/local/runs.js";
import {prepareEstimate,readEstimateSubmission} from "../../src/local/estimate-submissions.js";
import {previewEstimate} from "../../src/local/preview-transfer.js";
import {experienceUiHtml} from "../../src/remote/experience-ui.js";
const root=path.resolve(".cache/experience-browser",randomUUID());
process.env.OES_RUNS_ROOT=path.join(root,"runs");
await fs.mkdir(root,{recursive:true});
let fixture:ReturnType<typeof previewFixture>,started=false;
let state:any={stage:"scope"},code="",submission_id="";
const events:any[]=[];
const capabilities={web:{available:true,reason:"AVAILABLE"},save:{available:true},certificate:{available:false}};
async function start(){
 if(started)return;started=true;state={stage:"analyzing"};
 try{
  const run=await saveRun(fixture.a,fixture.a,{ruleset_ref:generatedRules.ruleset_ref,bundle:generatedRules.bundle},path.join(root,"synthetic-project"));
  const prepared=await prepareEstimate({run_id:run.run_id,display_currency:"JPY"});submission_id=prepared.submission_id;
  const submission=await readEstimateSubmission(submission_id),integrity=submission.estimate_input.evaluation.skill_integrity;
  fixture.config.catalog.skills.releases[0]={...fixture.config.catalog.skills.releases[0],skill_version:integrity.skill_version,package_sha256:integrity.package_sha256};
  const result=await previewEstimate({submission_id},{origin:fixture.config.origin,environment:"test",emit(e){if(e.status==="PENDING"){code=e.user_code!;state={stage:"confirmation",transfer_id:e.transfer_id};}events.push({event:e.status});}});
  state=result.web_complete?{stage:"result",preview_url:result.preview_url,expires_at:result.expires_at}:{stage:"error",error_code:result.status};
  await fs.writeFile(path.join(root,"cli-result.json"),JSON.stringify(result,null,2));
 }catch(e){state={stage:"error",error_code:e instanceof Error?e.message:"STATUS_UNAVAILABLE"};}
}
const server=http.createServer(async(req,res)=>{
 try{
  const origin=fixture.config.origin,url=new URL(req.url!,origin);
  if(url.pathname==="/fixture/state"){res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","no-store");res.end(JSON.stringify({state:{...state,capabilities},code}));return;}
  if(url.pathname==="/fixture/start" && req.method==="POST"){
    if(req.headers.origin!==origin){res.writeHead(403);res.end();return;}void start();res.end("{}");return;
  }
  if(url.pathname==="/fixture/login"){
   res.writeHead(303,{"Set-Cookie":"owner=a; HttpOnly; SameSite=Strict; Path=/",Location:"/fixture"});res.end();return;
  }
  if(url.pathname==="/fixture/ui"){
   res.setHeader("Content-Type","text/html; charset=utf-8");
   res.end(experienceUiHtml.replace("const destinationOrigin='https://open-estimate.ai-orchestration.jp'","const destinationOrigin="+JSON.stringify(origin)));return;
  }
  if(url.pathname==="/fixture"){
   res.setHeader("Content-Type","text/html; charset=utf-8");res.setHeader("Cache-Control","no-store");
   res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>全工程のローカル受入 — Open Estimate</title><style>body{font:16px/1.6 system-ui;margin:20px auto;max-width:1000px;padding:12px}iframe{width:100%;height:900px;border:1px solid #b4ccc9;border-radius:14px}</style><h1>全工程のローカル受入</h1><p>合成データ・合成本人確認を使った試験です。本番Auth0や実ChatGPTの受入ではありません。</p><p>対象：合成アプリ1機能。除外：依存関係・秘密ファイル。実プロジェクトのソースは読みません。</p><p><a href="/fixture/login">合成本人としてログイン</a></p><p id="code" role="status"></p><iframe id="ui" title="Open Estimateの対話カード" src="/fixture/ui"></iframe><script>
let last='';const frame=document.getElementById('ui');async function refresh(){const v=await fetch('/fixture/state').then(r=>r.json());document.getElementById('code').textContent=v.code?'照合コード：'+v.code:'';const next=JSON.stringify(v.state);if(next!==last){frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:v.state}},location.origin);last=next}}
window.addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin)return;const m=e.data;if(m.method==='ui/initialize'){frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostCapabilities:{},hostInfo:{name:'synthetic-local-host',version:'1'}}},location.origin);last='';await refresh()}if(m.method==='ui/open-link'){const u=new URL(m.params.url);if(u.origin===location.origin&&u.pathname.startsWith('/manage/')){frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{}},location.origin);location.href=u.href}else{frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{isError:true}},location.origin)}}if(m.method==='ui/message'){const text=m.params?.content?.[0]?.text||'';if(text.includes('解析を開始'))await fetch('/fixture/start',{method:'POST'});frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{}},location.origin);await refresh()}});setInterval(refresh,1000);
</script></html>`);return;
  }
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const response=await fixture.controller.fetch(new Request(url,{method:req.method,headers:req.headers as Record<string,string>,...(["GET","HEAD"].includes(req.method!)?{}:{body:Buffer.concat(chunks)})}),Date.now());
  events.push({method:req.method,path:url.pathname,status:response.status});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  await fs.writeFile(path.join(root,"browser-observations.json"),JSON.stringify(events,null,2));
 }catch{res.writeHead(500);res.end("FIXTURE_FAILURE");}
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin="http://127.0.0.1:"+(server.address() as any).port;
fixture=previewFixture(origin,"partial");
// Deterministic FX fixture, clearly separate from a live FRB retrieval.
fixture.config.fx={async get(currency){return {status:"AVAILABLE",snapshot:{currency,source_url:"https://www.federalreserve.gov/releases/h10/current/",source_sha256:"1".repeat(64),observed_on:"2026-10-23",published_on:"2026-10-26",fetched_at:new Date().toISOString(),checked_at:new Date().toISOString(),raw_value:"150",quote_direction:"currency_per_usd",currency_per_usd:"150"},limitation_codes:[]};}};
console.log(JSON.stringify({fixture_url:origin+"/fixture",evidence_directory:root}));
process.on("SIGINT",()=>{server.close();fixture.db.sqlite.close();process.exit(0);});
