import fs from 'node:fs';
import path from 'node:path';
const origin='https://open-estimate.ai-orchestration.jp';
const issuer='https://auth.ai-orchestration.jp/';
const checks=[];
async function probe(name,url,options,verify) {
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),...options});
  const text=await response.text();
  checks.push({name,status:response.status,result:verify(response,text)?'PASS':'FAIL'});
  return response;
}
await probe('LOGIN_PAGE',origin+'/manage',{},(r,b)=>r.status===200 && b.includes('ログインする') && r.headers.get('cache-control')==='no-store');
const login=await probe('PKCE_LOGIN_START',origin+'/manage/auth/login',{},r=>{
  if(r.status!==303)return false;
  const url=new URL(r.headers.get('location'));
  return url.origin===new URL(issuer).origin && url.pathname==='/authorize' && url.searchParams.get('scope')==='openid'
    && url.searchParams.get('redirect_uri')===origin+'/manage/auth/callback' && url.searchParams.get('code_challenge_method')==='S256'
    && !!url.searchParams.get('nonce') && !!url.searchParams.get('state') && r.headers.get('set-cookie')?.includes('Secure; HttpOnly; SameSite=Lax');
});
// Keep the opaque cookie in memory; never print or write cookies, state or callback codes.
const loginCookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
await probe('WRONG_STATE_REFUSED',origin+'/manage/auth/callback?state=synthetic-wrong-state&code=synthetic-code',{headers:{Cookie:loginCookie}},(r,b)=>r.status===401 && !b.includes('synthetic-code') && r.headers.get('cache-control')==='no-store');
await probe('LOGOUT_WITHOUT_SESSION_REFUSED',origin+'/manage/auth/logout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'csrf=synthetic'},r=>r.status===401);
await probe('CERTIFICATE_PUBLICATION_STILL_REFUSED',origin+'/api/v1/publications',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},r=>r.status===403);
const report={schema_version:'oes/browser-login-production-check/v1',checked_at:new Date().toISOString(),scope:'PRE_AUTHENTICATION_ONLY',real_user_login_verified:false,certificate_issued:false,result:checks.every(c=>c.result==='PASS')?'PASS':'FAIL',checks};
const directory=path.resolve('docs/implementation/production-checks');fs.mkdirSync(directory,{recursive:true});
const filename=path.join(directory,'browser-login-'+report.checked_at.replace(/[:.]/g,'-')+'.json');
fs.writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,report_path:filename},null,2));if(report.result!=='PASS')process.exitCode=1;
