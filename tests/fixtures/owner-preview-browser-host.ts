/** Isolated manual browser harness. Run explicitly with vite-node; never imported by the Worker. */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { previewFixture } from "./owner-preview.js";
import { generatedRules } from "./measurement.js";
import { saveRun } from "../../src/local/runs.js";
import { prepareCertificate,readCertificateSubmission } from "../../src/local/certificate-submissions.js";
import { previewCertificate } from "../../src/local/preview-transfer.js";
const root=path.resolve(".cache/owner-preview-browser",randomUUID());
process.env.OES_RUNS_ROOT=path.join(root,"runs");
let fixture:ReturnType<typeof previewFixture>;
let pending:any,ready:any;
const observations:any[]=[];
const server=http.createServer(async(req,res)=>{
  try{
    const origin=fixture.config.origin,url=new URL(req.url!,origin);
    if(url.pathname==="/fixture/login"){
      res.writeHead(303,{"Set-Cookie":"owner=a; HttpOnly; SameSite=Strict; Path=/",Location:pending?.verification_url??"/fixture"});res.end();return;
    }
    if(url.pathname==="/fixture/logout"){
      res.writeHead(303,{"Set-Cookie":"owner=; Max-Age=0; Path=/",Location:"/fixture"});res.end();return;
    }
    if(url.pathname==="/fixture"){
      res.setHeader("Content-Type","text/html; charset=utf-8");res.setHeader("Cache-Control","no-store");
      res.end(`<html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><h1>隔離した合成ブラウザー試験</h1><p>Auth0・本番接続ではありません。</p><a href="/fixture/login">合成本人としてログイン</a><p>照合コード：${pending?.user_code??"準備中"}</p>${ready?.preview_url?`<a href="${ready.preview_url}">本人限定プレビューを見る</a>`:""}<p><a href="/fixture/logout">合成セッションを終了</a></p></html>`);return;
    }
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const response=await fixture.controller.fetch(new Request(url,{method:req.method,headers:req.headers as Record<string,string>,...(["GET","HEAD"].includes(req.method!)?{}:{body:Buffer.concat(chunks)})}),Date.now());
    if(req.method==="POST")observations.push({path:url.pathname,method:req.method,origin:req.headers.origin??null,content_type:req.headers["content-type"]??null,status:response.status});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    await fs.writeFile(path.join(root,"browser-observations.json"),JSON.stringify(observations,null,2));
  }catch{res.writeHead(500);res.end("FIXTURE_FAILURE");}
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin="http://127.0.0.1:"+(server.address() as any).port;
fixture=previewFixture(origin,"partial");
const assessment=fixture.a,run=await saveRun(assessment,assessment,{ruleset_ref:generatedRules.ruleset_ref,bundle:generatedRules.bundle},path.join(root,"synthetic-project"));
const prepared=await prepareCertificate({run_id:run.run_id,metadata:{...fixture.body.metadata,title:"合成アプリの公開前確認",description:"ブラウザーの通常送信・本人限定表示を検証する合成データです。"}});
const submission=await readCertificateSubmission(prepared.submission_id);
fixture.config.catalog.skills.releases[0]={...fixture.config.catalog.skills.releases[0],skill_version:submission.frozen_input.skill_integrity.skill_version,package_sha256:submission.frozen_input.skill_integrity.package_sha256};
await fs.mkdir(root,{recursive:true});
console.log(JSON.stringify({fixture_url:origin+"/fixture",evidence_directory:root}));
void previewCertificate({submission_id:prepared.submission_id},{origin,environment:"test",emit(value){if(value.status==="PENDING")pending=value;console.log(JSON.stringify(value));}}).then(async value=>{ready=value;console.log(JSON.stringify(value));await fs.writeFile(path.join(root,"cli-result.json"),JSON.stringify(value,null,2));}).catch(()=>console.error("FIXTURE_CLI_FAILED"));
process.on("SIGINT",()=>{server.close();fixture.db.sqlite.close();process.exit(0);});
