// Live read-only bootstrap checks. The POST probes cannot issue: no model, nonce or approval is supplied.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const origin='https://open-estimate.ai-orchestration.jp';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[];
async function probe(name,pathname,options,check) {
  try {
    const response=await fetch(origin+pathname,{redirect:'manual',signal:AbortSignal.timeout(20000),...options});
    const bytes=Buffer.from(await response.arrayBuffer()),raw=bytes.toString('utf8');
    let data;try {data=JSON.parse(raw);}catch {const line=raw.split(/\r?\n/).find(l=>l.startsWith('data: '));if(line)try {data=JSON.parse(line.slice(6));}catch {}}
    const passed=check(response,bytes,data);
    checks.push({name,path:pathname,status:response.status,result:passed?'PASS':'FAIL',body_sha256:hash(bytes),cache_control:response.headers.get('cache-control')});
  } catch {checks.push({name,path:pathname,result:'FAIL',error_code:'PROBE_UNAVAILABLE'});}
}
await probe('LP_UNCHANGED','/',{},(r,bytes)=>r.status===200 && hash(bytes)===hash(fs.readFileSync('public/index.html')));
await probe('D1_READY_AND_ISSUANCE_DISABLED','/api/v1/certificate-readiness',{},(r,_b,data)=>r.status===200 && r.headers.get('cache-control')==='no-store'
  && JSON.stringify(data)===JSON.stringify({schema_version:'oes/certificate-readiness/v1',database:'READY',authentication:'NOT_CONNECTED',issuance:'DISABLED',publication:'DISABLED'}));
for(const [name,pathname,method] of [
  ['ISSUANCE_REFUSED','/api/v1/publications','POST'],
  ['PREVIEW_REFUSED','/api/v1/certificate-previews','POST'],
  ['DETAIL_NOT_SERVED','/e/sh_'+'0'.repeat(32),'GET'],
  ['NO_UNCONFIGURED_KEY_CATALOG','/.well-known/oes-signing-keys.json','GET']
])await probe(name,pathname,{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})},(r,_b,data)=>r.status===403 && r.headers.get('cache-control')==='no-store' && data?.error?.code==='AUTH_CONSENT_NOT_READY');
await probe('EXISTING_MCP_INITIALIZE','/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'certificate-bootstrap-smoke',version:'1.0.0'}}})},(r,_b,data)=>r.status===200 && data?.id===1 && !!data?.result?.serverInfo && !data?.error);
const report={schema_version:'oes/certificate-production-bootstrap-check/v1',checked_at:new Date().toISOString(),origin,scope:'DISABLED_BOOTSTRAP_ONLY',result:checks.every(c=>c.result==='PASS')?'PASS':'FAIL',user_data_sent:false,certificate_issued:false,checks};
const directory=path.resolve('docs/implementation/production-checks');fs.mkdirSync(directory,{recursive:true});
const file=path.join(directory,'certificate-bootstrap-'+report.checked_at.replace(/[:.]/g,'-')+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,report_path:file},null,2));if(report.result!=='PASS')process.exitCode=1;
