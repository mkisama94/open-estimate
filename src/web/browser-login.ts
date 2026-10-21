import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { oidcOwnerId } from "./oidc-auth.js";
import type { BrowserApprovalSessions, BrowserSession } from "./web-publication-approval.js";
import type { CertificateDatabase } from "./certificate-repository.js";

const SESSION="__Host-oes-session", TRANSACTION="__Host-oes-login";
const opaque=()=>randomBytes(32).toString("base64url");
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const cookie=(name:string,value:string,age:number)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const safeHeaders={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex","Content-Security-Policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
function readCookie(request:Request,name:string):string|null {
  const text=request.headers.get("Cookie")??"";
  if(text.length>8192)return null;
  const values=text.split(";").map(s=>s.trim()).filter(s=>s.startsWith(name+"=")).map(s=>s.slice(name.length+1));
  return values.length===1?values[0]:null;
}
function equal(a:string,b:string) {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
export interface BrowserLoginDatabase extends CertificateDatabase {withSession?(constraint:string):BrowserLoginDatabase}
export async function purgeBrowserSessions(database:BrowserLoginDatabase,now:number) {
  const db=database.withSession?.("first-primary")??database;
  await db.batch([db.prepare("DELETE FROM browser_login_transactions WHERE expires_at<=?").bind(now),db.prepare("DELETE FROM browser_sessions WHERE expires_at<=?").bind(now)]);
}
export interface BrowserLoginConfig {origin:string;issuer:string;client_id:string;client_secret:string;session_secret:string}
interface LoginTransaction {state:string;nonce:string;verifier:string;expires_at:number}
/** Identity-only login trial. These sessions deliberately have NO certificate-management scope. */
export function createBrowserLogin(config:BrowserLoginConfig,database:BrowserLoginDatabase,testing?:{keys:JWTVerifyGetKey;fetch:typeof fetch;now:()=>number}) {
  const origin=new URL(config.origin),issuer=new URL(config.issuer);
  if(origin.origin!==config.origin || origin.protocol!=="https:" || issuer.href!==config.issuer || issuer.protocol!=="https:" || issuer.pathname!=="/" || issuer.search || issuer.hash || issuer.username || issuer.password
    || !/^[A-Za-z0-9_-]{1,256}$/.test(config.client_id) || !config.client_secret || !/^[A-Za-z0-9_-]{43}$/.test(config.session_secret)
    || Buffer.from(config.session_secret,"base64url").toString("base64url")!==config.session_secret)throw new Error("INVALID_AUTH_CONFIGURATION");
  const db=database.withSession?.("first-primary")??database;
  const key=Buffer.from(config.session_secret,"base64url");
  // Bind encrypted transactions to this deployment and client; use a separate CSRF purpose.
  const context=JSON.stringify([config.origin,config.issuer,config.client_id]);
  const encryptionKey=createHmac("sha256",key).update("oes/login-encryption/v1"+context).digest();
  const csrfKey=createHmac("sha256",key).update("oes/browser-csrf/v1"+context).digest();
  const keys=testing?.keys??createRemoteJWKSet(new URL(".well-known/jwks.json",issuer),{timeoutDuration:5000});
  const clock=testing?.now??Date.now,send=testing?.fetch??fetch;
  const callback=config.origin+"/manage/auth/callback";
  const stmt=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
  function seal(value:LoginTransaction) {
    const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey,iv);
    cipher.setAAD(Buffer.from(context));
    const bytes=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString("base64url");
  }
  function open(text:string):LoginTransaction {
    if(!/^[A-Za-z0-9_-]{40,2048}$/.test(text))throw new Error("AUTH_REQUIRED");
    const bytes=Buffer.from(text,"base64url"),decipher=createDecipheriv("aes-256-gcm",encryptionKey,bytes.subarray(0,12));
    decipher.setAAD(Buffer.from(context));decipher.setAuthTag(bytes.subarray(12,28));
    const value=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString("utf8")) as LoginTransaction;
    if(![value.state,value.nonce,value.verifier].every(s=>typeof s==="string" && /^[A-Za-z0-9_-]{43}$/.test(s)) || !Number.isSafeInteger(value.expires_at) || value.expires_at<=clock() || value.expires_at>clock()+600000)throw new Error("AUTH_REQUIRED");
    return value;
  }
  const csrf=(session:BrowserSession,target:unknown)=>createHmac("sha256",csrfKey).update(JSON.stringify([session.session_id,target])).digest("base64url");
  const sessions:BrowserApprovalSessions={
    mode:testing?"test":"production",
    async read(request) {
      if(new URL(request.url).origin!==config.origin || request.headers.has("Authorization"))return null;
      const raw=readCookie(request,SESSION);if(!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
      const row=await stmt("SELECT owner_id,expires_at FROM browser_sessions WHERE session_hash=? AND expires_at>?",hash(raw),clock()).first<{owner_id:string;expires_at:number}>();
      if(!row)return null;
      return {session_id:hash(raw),expires_at:row.expires_at,principal:{subject:row.owner_id,expires_at:row.expires_at,scopes:[],authentication_strength:"OIDC_ID_TOKEN_VERIFIED"}};
    },
    async csrfToken(session,target){return csrf(session,target);},
    async verifyCsrf(session,target,token){return session.expires_at>clock() && /^[A-Za-z0-9_-]{43}$/.test(token) && equal(csrf(session,target),token);}
  };
  function redirect(location:string,cookies:string[]=[]) {const h=new Headers({...safeHeaders,Location:location});for(const c of cookies)h.append("Set-Cookie",c);return new Response(null,{status:303,headers:h});}
  // Form POSTs need same-origin Origin; callback redirects retain no-referrer.
  function page(html:string,status=200,cookies:string[]=[]) {const h=new Headers({...safeHeaders,"Referrer-Policy":"same-origin","Content-Security-Policy":`default-src 'none'; form-action 'self' ${issuer.origin}; frame-ancestors 'none'; base-uri 'none'`,"Content-Type":"text/html; charset=utf-8"});for(const c of cookies)h.append("Set-Cookie",c);return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Estimate ログイン確認</title><body>${html}</body></html>`,{status,headers:h});}
  async function handle(request:Request):Promise<Response> {
    const url=new URL(request.url),now=clock();
    if(url.origin!==config.origin)return page("<h1>接続先を確認してください</h1>",400);
    try {
      if(request.headers.has("Authorization"))return page("<h1>ブラウザーから操作してください</h1>",401);
      if(request.method==="GET" && url.pathname==="/manage/auth/login") {
        if(url.search)return page("<h1>無効なリクエストです</h1>",400);
        const value:LoginTransaction={state:opaque(),nonce:opaque(),verifier:opaque(),expires_at:now+600000};
        await db.batch([stmt("DELETE FROM browser_login_transactions WHERE expires_at<=?",now),stmt("DELETE FROM browser_sessions WHERE expires_at<=?",now),stmt("INSERT INTO browser_login_transactions VALUES (?,?)",hash(value.state),value.expires_at)]);
        const authorize=new URL("authorize",issuer);
        authorize.search=new URLSearchParams({response_type:"code",response_mode:"query",client_id:config.client_id,redirect_uri:callback,scope:"openid",state:value.state,nonce:value.nonce,code_challenge:createHash("sha256").update(value.verifier).digest("base64url"),code_challenge_method:"S256"}).toString();
        return redirect(authorize.href,[cookie(TRANSACTION,seal(value),600)]);
      }
      if(request.method==="GET" && url.pathname==="/manage/auth/callback") {
        const tx=open(readCookie(request,TRANSACTION)??"");
        const state=url.searchParams.get("state"),code=url.searchParams.get("code");
        if(url.search.length>8192 || url.searchParams.getAll("state").length!==1 || !state || !equal(state,tx.state))throw new Error("AUTH_REQUIRED");
        // DELETE RETURNING consumes state atomically before contacting the token endpoint.
        const consumed=await stmt("DELETE FROM browser_login_transactions WHERE state_hash=? AND expires_at>? RETURNING state_hash",hash(state),now).first<{state_hash:string}>();
        if(!consumed || url.searchParams.has("error") || url.searchParams.getAll("code").length!==1 || !code || code.length>4096)throw new Error("AUTH_REQUIRED");
        // Workers rejects redirect:"error" before sending. Never follow a token-endpoint
        // redirect with the client secret/code; the non-2xx check below rejects it.
        const response=await send(new URL("oauth/token",issuer),{method:"POST",redirect:"manual",signal:AbortSignal.timeout(10000),headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",client_id:config.client_id,client_secret:config.client_secret,code,code_verifier:tx.verifier,redirect_uri:callback})});
        // Never log provider bodies or persist any returned tokens.
        if(!response.ok)throw new Error("AUTH_REQUIRED");
        const bytes=await response.text();if(bytes.length>65536)throw new Error("AUTH_REQUIRED");
        const tokens=JSON.parse(bytes) as {id_token?:unknown};
        if(typeof tokens.id_token!=="string" || tokens.id_token.length>16384)throw new Error("AUTH_REQUIRED");
        const {payload,protectedHeader}=await jwtVerify(tokens.id_token,keys,{algorithms:["RS256"],issuer:config.issuer,audience:config.client_id,requiredClaims:["iss","sub","aud","iat","exp","nonce"],maxTokenAge:600,clockTolerance:30,currentDate:new Date(now)});
        if(typeof protectedHeader.kid!=="string" || !protectedHeader.kid || protectedHeader.jku!==undefined || protectedHeader.x5u!==undefined || protectedHeader.jwk!==undefined
          || typeof payload.sub!=="string" || !payload.sub || payload.sub.length>512 || payload.sub.endsWith("@clients") || payload.nonce!==tx.nonce
          || (payload.azp!==undefined && payload.azp!==config.client_id) || (Array.isArray(payload.aud) && payload.aud.length>1 && payload.azp!==config.client_id)
          || typeof payload.exp!=="number" || payload.exp*1000<=now)throw new Error("AUTH_REQUIRED");
        const raw=opaque(),expires=Math.min(now+1800000,payload.exp*1000);
        // Reauthentication rotates the local session and invalidates the previous one.
        const previous=readCookie(request,SESSION);
        await db.batch([...(previous?[stmt("DELETE FROM browser_sessions WHERE session_hash=?",hash(previous))]:[]),stmt("INSERT INTO browser_sessions VALUES (?,?,?)",hash(raw),oidcOwnerId(config.issuer,payload.sub),expires)]);
        return redirect(config.origin+"/manage",[cookie(TRANSACTION,"",0),cookie(SESSION,raw,Math.floor((expires-now)/1000))]);
      }
      if(request.method==="GET" && url.pathname==="/manage") {
        if(url.search)return redirect(config.origin+"/manage");
        const session=await sessions.read(request);
        if(!session)return page('<h1>Open Estimate ログイン確認</h1><p>ログイン接続の試験画面です。</p><a href="/manage/auth/login">ログインする</a>');
        return page(`<h1>ログインできました</h1><p>証明書の発行・公開機能は準備中です。</p><form method="post" action="/manage/auth/logout"><input type="hidden" name="csrf" value="${csrf(session,"logout")}"><button type="submit">ログアウトする</button></form>`);
      }
      if(request.method==="POST" && url.pathname==="/manage/auth/logout") {
        if(url.search || request.headers.get("Origin")!==config.origin || !/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(request.headers.get("Content-Type")??""))throw new Error("AUTH_REQUIRED");
        const session=await sessions.read(request);if(!session)throw new Error("AUTH_REQUIRED");
        // Bounded streaming read; Content-Length alone cannot protect this route.
        const reader=request.body?.getReader();if(!reader)throw new Error("AUTH_REQUIRED");
        let body="",size=0;const decoder=new TextDecoder("utf8",{fatal:true});
        try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256){await reader.cancel();throw new Error("AUTH_REQUIRED");}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();}finally{reader.releaseLock();}
        const form=new URLSearchParams(body),token=form.get("csrf");
        if([...form.keys()].length!==1 || !token || !equal(csrf(session,"logout"),token))throw new Error("AUTH_REQUIRED");
        await db.batch([stmt("DELETE FROM browser_sessions WHERE session_hash=?",session.session_id)]);
        const logout=new URL("v2/logout",issuer);logout.search=new URLSearchParams({client_id:config.client_id,returnTo:config.origin+"/manage"}).toString();
        return redirect(logout.href,[cookie(SESSION,"",0),cookie(TRANSACTION,"",0)]);
      }
      return page("<h1>ページが見つかりません</h1>",404);
    } catch {
      // Fail closed; do not echo state, codes, identity claims or provider errors.
      return page('<h1>ログイン操作を完了できませんでした</h1><p>時間を置いて、最初からやり直してください。</p><a href="/manage">ログイン確認へ戻る</a>',401,[cookie(TRANSACTION,"",0)]);
    }
  }
  return {sessions,handle};
}
