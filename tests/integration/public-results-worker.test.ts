import {it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {publicationFixture} from '../fixtures/estimate-publication.js';
import {PUBLICATION_MS} from '../../src/contracts/estimate-result.js';
it('uses actual Worker/D1 transactions for concurrent registration, Japanese PDF, no OAuth and expiry/withdrawal',async()=>{
 const f=await publicationFixture();
 const script=`import {PublicResultsService} from './src/web/public-results.ts';import {PublicResultsRepository} from './src/web/public-results-repository.ts';import {createPublicResultsController} from './src/web/public-results-worker.ts';export default {async fetch(request,env){const service=new PublicResultsService(new PublicResultsRepository(env.PUBLIC_RESULTS_DB),${JSON.stringify(f.service.config)},()=>Number(request.headers.get('X-Test-Time')??${f.now}));return createPublicResultsController(service,{limit:async()=>({success:true})}).fetch(request);}};`;
 const bundle=await build({stdin:{contents:script,resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'esm'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-25',d1Databases:{PUBLIC_RESULTS_DB:'isolated-public-results'}}));
 try{const db=await mf.getD1Database('PUBLIC_RESULTS_DB');for(const sql of (await fs.readFile('migrations/0010_public_estimate_results.sql','utf8')).split(';').filter(x=>x.trim()))await db.prepare(sql).run();
  const send=(value:any)=>mf.dispatchFetch(f.services.publication_destination,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  const [a,b]=await Promise.all([send(f.publish),send(f.publish)]);expect([a.status,b.status].sort()).toEqual([200,201]);const data=await a.json() as any;expect(await b.json()).toEqual(data);
  expect((await db.prepare('SELECT COUNT(*) n FROM public_estimate_results').first<{n:number}>())!.n).toBe(1);
  const page=await mf.dispatchFetch(data.canonical_url);expect(page.status).toBe(200);expect(await page.text()).toContain('18 時間');
  const pdf=await mf.dispatchFetch(data.canonical_url+'/pdf');expect(pdf.status).toBe(200);const bytes=await pdf.arrayBuffer();expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  for(const suffix of ['', '/pdf'])expect((await mf.dispatchFetch(data.canonical_url+suffix,{headers:{'X-Test-Time':String(f.now+PUBLICATION_MS)}})).status).toBe(410);
  const stop=f.services.result_origin+'/api/results/'+data.public_result_id+'/withdraw';expect((await mf.dispatchFetch(stop,{method:'POST'})).status).toBe(404);expect((await mf.dispatchFetch(stop,{method:'POST',headers:{Authorization:'Bearer '+f.token}})).status).toBe(200);expect((await send(f.publish)).status).toBe(410);
 }finally{await mf.dispose();f.db.sqlite.close();}
},60000);
it('issues the new proof in an independent Worker with only its own issuance tables',async()=>{
 const f=await publicationFixture(),script=`import {issueEstimateProof} from './src/issuer/estimate-service.ts';export default {async fetch(request,env){try{return Response.json(await issueEstimateProof(await request.json(),{...env,DOCUMENT_ISSUANCE_LIMITER:{limit:async()=>({success:true})}},${JSON.stringify(f.catalog)}));}catch(e){return Response.json({error:e.message},{status:400});}}};`;
 const r=await build({stdin:{contents:script,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',external:['node:crypto']});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:r.outputFiles[0].text,compatibilityDate:'2026-09-25',compatibilityFlags:['nodejs_compat'],d1Databases:{ESTIMATE_PROOF_DB:'isolated-estimate-issuer'},bindings:{ESTIMATE_ISSUANCE_ENABLED:'true',DOCUMENT_ISSUER_ORIGIN:f.key.issuer,DOCUMENT_ENVIRONMENT:'test',DOCUMENT_SIGNING_KEY_ID:f.key.key_id,DOCUMENT_SIGNING_PUBLIC_KEY:f.key.public_key,DOCUMENT_SIGNING_PRIVATE_KEY:f.privateKey}}));
 try{const db=await mf.getD1Database('ESTIMATE_PROOF_DB');for(const sql of (await fs.readFile('migrations/0009_estimate_proof_issuances.sql','utf8')).split(';').filter(x=>x.trim()))await db.prepare(sql).run();
 const send=()=>mf.dispatchFetch('https://local.test/',{method:'POST',body:JSON.stringify(f.request)});const [a,b]=await Promise.all([send(),send()]);expect(a.status).toBe(200);expect(b.status).toBe(200);expect(await a.json()).toEqual(await b.json());expect((await db.prepare('SELECT COUNT(*) n FROM estimate_proof_issuances').first<{n:number}>())!.n).toBe(1);
 }finally{await mf.dispose();f.db.sqlite.close();}
},60000);
