/** Local synthetic published records only; no remote deployment or real-user data. */
import http from "node:http";
import fs from "node:fs/promises";
import { publicResultFixture } from "./public-result.js";
import worker from "../../src/web/worker.js";
import { PRODUCTION_ORIGIN } from "../../src/core/certificate.js";
const fixtures=await Promise.all([publicResultFixture(),publicResultFixture("partial"),publicResultFixture("incomplete"),publicResultFixture()]);
fixtures[3].db.sqlite.prepare("UPDATE publications SET state='WITHDRAWN'").run();
fixtures[3].db.sqlite.prepare("DELETE FROM publication_contents").run();
let selected=0;
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url!,PRODUCTION_ORIGIN);
    if(["/public-result.css","/public-result.js"].includes(url.pathname)){
      res.writeHead(200,{"Content-Type":url.pathname.endsWith(".css")?"text/css":"text/javascript"});res.end(await fs.readFile("public"+url.pathname));return;
    }
    if(url.pathname==="/fixture"){
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(`<h1>合成公開結果・ローカル試験</h1>${["complete","partial","incomplete","withdrawn"].map((v,i)=>`<p><a href="/fixture/select/${i}">${v}</a></p>`).join("")}`);return;
    }
    const selection=url.pathname.match(/^\/fixture\/select\/([0-3])$/);
    if(selection){selected=Number(selection[1]);res.writeHead(303,{Location:"/e/"+fixtures[selected].share});res.end();return;}
    const r=await worker.fetch(new Request(url,{method:req.method,headers:req.headers as Record<string,string>}),fixtures[selected].env);
    res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
  }catch{res.writeHead(500);res.end("FIXTURE_FAILURE");}
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
console.log(JSON.stringify({url:`http://127.0.0.1:${(server.address() as any).port}/fixture`}));
process.on("SIGINT",()=>{server.close();for(const f of fixtures)f.db.sqlite.close();process.exit(0);});
