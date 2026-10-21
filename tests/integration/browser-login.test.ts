import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createBrowserLogin } from "../../src/web/browser-login.js";
import type { D1Statement } from "../../src/web/certificate-repository.js";
import worker from "../../src/web/worker.js";

const origin="https://browser-test.example.org",issuer="https://identity-test.example.org/";
const pair=await generateKeyPair("RS256"),jwk=await exportJWK(pair.publicKey);
const keys=createLocalJWKSet({keys:[{...jwk,kid:"test-key",alg:"RS256"}]});
function cookies(response:Response) {return response.headers.getSetCookie().map(c=>c.split(";")[0]).filter(c=>!c.endsWith("=")).join("; ");}
async function setup(changes:Record<string,unknown>={},header:Record<string,unknown>={},exchangeStatus=200) {
  const sql=new DatabaseSync(":memory:");sql.exec(readFileSync("migrations/0003_browser_sessions.sql","utf8"));
  const now={value:Date.now()};let nonce="",exchanges=0,tokenRequest:URLSearchParams|undefined;
  const db={prepare(query:string):D1Statement {let args:unknown[]=[];return {bind(...a){args=a;return this;},async first<T>() {return (sql.prepare(query).get(...args as any[])??null) as T|null;},query,get args(){return args;}} as D1Statement;},async batch(statements:D1Statement[]) {sql.exec("BEGIN IMMEDIATE");try{for(const s of statements as any[])sql.prepare(s.query).run(...s.args);sql.exec("COMMIT");}catch(e){sql.exec("ROLLBACK");throw e;}},withSession(constraint:string){expect(constraint).toBe("first-primary");return this;}};
  const config={origin,issuer,client_id:"web-client",client_secret:"SYNTHETIC_SECRET",session_secret:randomBytes(32).toString("base64url")};
  const fetcher:typeof fetch=async(url,options)=>{
    exchanges++;expect(String(url)).toBe(issuer+"oauth/token");expect(options?.redirect).toBe("manual");
    tokenRequest=options!.body as URLSearchParams;
    const token=await new SignJWT({iss:issuer,aud:config.client_id,sub:"google-oauth2|synthetic",iat:Math.floor(now.value/1000),exp:Math.floor(now.value/1000)+3600,nonce,...changes}).setProtectedHeader({alg:"RS256",kid:"test-key",...header}).sign(pair.privateKey);
    return new Response(JSON.stringify({id_token:token,access_token:"PRIVATE_TOKEN_DO_NOT_STORE"}),{status:exchangeStatus,headers:exchangeStatus>=300 && exchangeStatus<400?{Location:"https://foreign.example.org/token"}:{}});
  };
  const controller=createBrowserLogin(config,db,{keys,fetch:fetcher,now:()=>now.value});
  async function start() {
    const response=await controller.handle(new Request(origin+"/manage/auth/login"));
    const url=new URL(response.headers.get("Location")!);nonce=url.searchParams.get("nonce")!;
    return {response,url,cookie:cookies(response),state:url.searchParams.get("state")!};
  }
  const callback=(state:string,cookie:string,extra="")=>new Request(origin+"/manage/auth/callback?"+new URLSearchParams({code:"synthetic-code",state})+extra,{headers:{Cookie:cookie}});
  return {sql,db,now,config,controller,start,callback,get exchanges(){return exchanges;},get tokenRequest(){return tokenRequest;}};
}
it("runs PKCE callback, keeps tokens out of storage and denies certificate scope",async()=>{
  const f=await setup();try {
    const s=await f.start();expect(s.response.status).toBe(303);expect(s.url.origin).toBe(new URL(issuer).origin);
    expect(s.url.searchParams.get("scope")).toBe("openid");expect(s.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(s.url.searchParams.get("redirect_uri")).toBe(origin+"/manage/auth/callback");
    expect(s.response.headers.get("Set-Cookie")).toContain("Secure; HttpOnly; SameSite=Lax");
    expect(s.response.headers.get("Set-Cookie")).not.toContain(s.state);
    const response=await f.controller.handle(f.callback(s.state,s.cookie));expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(origin+"/manage");
    expect(createHash("sha256").update(f.tokenRequest!.get("code_verifier")!).digest("base64url")).toBe(s.url.searchParams.get("code_challenge"));
    const cookie=cookies(response),request=new Request(origin+"/manage",{headers:{Cookie:cookie}});
    const session=await f.controller.sessions.read(request);expect(session?.principal.scopes).toEqual([]);
    const stored=JSON.stringify(f.sql.prepare("SELECT * FROM browser_sessions").all());
    expect(stored).not.toContain("PRIVATE_TOKEN");expect(stored).not.toContain(cookie.split("=")[1]);expect(stored).not.toContain("google-oauth2");
    expect(await (await f.controller.handle(request)).text()).toContain("ログインできました");
    const token=await f.controller.sessions.csrfToken(session!,{preview_id:"pv-1",draft_hash:"hash-1"});
    expect(await f.controller.sessions.verifyCsrf(session!,{preview_id:"pv-1",draft_hash:"hash-2"},token)).toBe(false);
    expect((await f.controller.handle(f.callback(s.state,s.cookie))).status).toBe(401);expect(f.exchanges).toBe(1);
    f.now.value+=1800001;expect(await f.controller.sessions.read(request)).toBeNull();
  }finally{f.sql.close();}
});
it.each([301,302,303,307,308,400,401,500])("rejects token endpoint status %i without creating a session or retrying the code",async status=>{
  const f=await setup({},{},status);try {
    const s=await f.start();const response=await f.controller.handle(f.callback(s.state,s.cookie));
    expect(response.status).toBe(401);expect(f.exchanges).toBe(1);
    expect(f.sql.prepare("SELECT * FROM browser_sessions").all()).toHaveLength(0);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).not.toContain("PRIVATE_TOKEN");
    expect((await f.controller.handle(f.callback(s.state,s.cookie))).status).toBe(401);expect(f.exchanges).toBe(1);
  }finally{f.sql.close();}
});
it.each([{nonce:"wrong"},{iss:"https://foreign.example.org/"},{aud:"foreign-client"},{azp:"foreign-client"},{sub:"machine@clients"},{exp:1},{iat:1},{sub:""}])("rejects bad identity claims %j",async changes=>{
  const f=await setup(changes);try{const s=await f.start();expect((await f.controller.handle(f.callback(s.state,s.cookie))).status).toBe(401);expect(f.sql.prepare("SELECT * FROM browser_sessions").all()).toHaveLength(0);}finally{f.sql.close();}
});
it.each([{jku:"https://evil.example.org/keys"},{x5u:"https://evil.example.org/cert"},{jwk:{kty:"RSA"}},{kid:"unknown"}])("rejects header-selected trust %j",async header=>{
  const f=await setup({},header);try{const s=await f.start();expect((await f.controller.handle(f.callback(s.state,s.cookie))).status).toBe(401);}finally{f.sql.close();}
});
it("rejects wrong/missing/tampered/browser-mismatched state before token exchange",async()=>{
  const f=await setup();try{const a=await f.start(),b=await f.start();
    for(const req of [f.callback(a.state,""),f.callback(a.state,b.cookie),f.callback("wrong",a.cookie),f.callback(a.state,a.cookie+"; "+a.cookie),f.callback(a.state,a.cookie.slice(0,-4)+"xxxx"),f.callback(a.state,a.cookie,"&state=duplicate")])expect((await f.controller.handle(req)).status).toBe(401);
    expect(f.exchanges).toBe(0);f.now.value+=600001;expect((await f.controller.handle(f.callback(a.state,a.cookie))).status).toBe(401);
  }finally{f.sql.close();}
});
it("logs out only after same-origin CSRF and revokes a captured session cookie",async()=>{
  const f=await setup();try{const s=await f.start(),logged=await f.controller.handle(f.callback(s.state,s.cookie)),cookie=cookies(logged);
    const page=await f.controller.handle(new Request(origin+"/manage",{headers:{Cookie:cookie}}));const html=await page.text();const token=html.match(/name="csrf" value="([^"]+)"/)![1];
    const req=(from:string,value:string)=>new Request(origin+"/manage/auth/logout",{method:"POST",headers:{Cookie:cookie,Origin:from,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrf:value})});
    expect((await f.controller.handle(req("https://evil.example.org",token))).status).toBe(401);expect((await f.controller.handle(req(origin,"wrong"))).status).toBe(401);
    const result=await f.controller.handle(req(origin,token));expect(result.status).toBe(303);expect(new URL(result.headers.get("Location")!).searchParams.get("returnTo")).toBe(origin+"/manage");
    expect(await f.controller.sessions.read(new Request(origin+"/manage",{headers:{Cookie:cookie}}))).toBeNull();
  }finally{f.sql.close();}
});
it("fails closed for missing production configuration and keeps publication disabled",async()=>{
  const env={ASSETS:{fetch:async()=>new Response("asset")},WEB_LOGIN_ENABLED:"true"};
  expect((await worker.fetch(new Request("https://open-estimate.ai-orchestration.jp/manage"),env)).status).toBe(503);
  expect((await worker.fetch(new Request("https://open-estimate.ai-orchestration.jp/api/v1/publications",{method:"POST"}),env)).status).toBe(403);
});
it("throttles before database/authentication work and refuses unavailable throttling",async()=>{
  const f=await setup();try {
    const env={ASSETS:{fetch:async()=>new Response("asset")},CERTIFICATES_DB:f.db,WEB_LOGIN_ENABLED:"true",AUTH0_ISSUER:issuer,AUTH0_WEB_CLIENT_ID:f.config.client_id,AUTH0_WEB_CLIENT_SECRET:f.config.client_secret,BROWSER_SESSION_SECRET:f.config.session_secret,BROWSER_LOGIN_LIMITER:{async limit({key}:{key:string}){expect(key).toBe("oes:web-login-trial:v1");return {success:false};}}};
    const req=new Request("https://open-estimate.ai-orchestration.jp/manage/auth/login");
    const limited=await worker.fetch(req,env);expect(limited.status).toBe(429);expect(limited.headers.get("Retry-After")).toBe("60");
    expect(f.sql.prepare("SELECT * FROM browser_login_transactions").all()).toHaveLength(0);
    expect((await worker.fetch(req,{...env,BROWSER_LOGIN_LIMITER:{async limit(){throw new Error("private-backend-error");}}})).status).toBe(503);
    expect((await worker.fetch(req,{...env,BROWSER_LOGIN_LIMITER:undefined})).status).toBe(503);
  }finally{f.sql.close();}
});
it("serves only identity trial routes and purges expired sessions through the scheduled handler",async()=>{
  const f=await setup();try {
    const future=Date.now()+3600000;
    for(const expiry of [0,future]){f.sql.prepare("INSERT INTO browser_sessions VALUES(?,?,?)").run("session-"+expiry,"owner",expiry);f.sql.prepare("INSERT INTO browser_login_transactions VALUES(?,?)").run("state-"+expiry,expiry);}
    await worker.scheduled({}, {ASSETS:{fetch:async()=>new Response("asset")},CERTIFICATES_DB:f.db});
    expect(f.sql.prepare("SELECT * FROM browser_sessions").all()).toHaveLength(1);expect(f.sql.prepare("SELECT * FROM browser_login_transactions").all()).toHaveLength(1);
    const env={ASSETS:{fetch:async()=>new Response("asset")},CERTIFICATES_DB:f.db,WEB_LOGIN_ENABLED:"true",AUTH0_ISSUER:issuer,AUTH0_WEB_CLIENT_ID:f.config.client_id,AUTH0_WEB_CLIENT_SECRET:f.config.client_secret,BROWSER_SESSION_SECRET:f.config.session_secret,BROWSER_LOGIN_LIMITER:{async limit(){return {success:true};}}};
    const response=await worker.fetch(new Request("https://open-estimate.ai-orchestration.jp/manage"),env);
    expect(response.status).toBe(200);expect(await response.text()).toContain("ログインする");expect(response.headers.get("Content-Security-Policy")).toContain("form-action 'self' https://identity-test.example.org");
    expect((await worker.fetch(new Request("https://open-estimate.ai-orchestration.jp/api/v1/publications",{method:"POST"}),env)).status).toBe(403);
  }finally{f.sql.close();}
});
