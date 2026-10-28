import {it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {documentFixture} from '../fixtures/document.js';
import {verifyDocumentProof} from '../../src/proof/verify.js';
it('issues and atomically deduplicates in the actual Worker runtime with only new D1 tables and no OAuth/Web bindings',async()=>{
 const f=await documentFixture();const script=`import {issueDocumentProof} from './src/issuer/runtime.ts';const catalog=${JSON.stringify(f.catalog)};export default {async fetch(request,env){try{return Response.json(await issueDocumentProof(await request.json(),{...env,DOCUMENT_ISSUANCE_LIMITER:{limit:async()=>({success:true})}},catalog));}catch(e){return Response.json({error:e.message},{status:400});}}};`;
 const bundle=await build({stdin:{contents:script,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',external:['node:crypto']});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-09-25',compatibilityFlags:['nodejs_compat'],d1Databases:{DOCUMENT_PROOF_DB:'isolated-document-test'},bindings:{DOCUMENT_ISSUANCE_ENABLED:'true',DOCUMENT_ISSUER_ORIGIN:f.key.issuer,DOCUMENT_ENVIRONMENT:f.key.environment,DOCUMENT_SIGNING_KEY_ID:f.key.key_id,DOCUMENT_SIGNING_PUBLIC_KEY:f.key.public_key,DOCUMENT_SIGNING_PRIVATE_KEY:f.privateKey}}));
 try{const db=await mf.getD1Database('DOCUMENT_PROOF_DB');for(const sql of (await fs.readFile('migrations/0008_document_proof_issuances.sql','utf8')).replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()))await db.prepare(sql).run();
 const send=(request:unknown)=>mf.dispatchFetch('https://local.test/',{method:'POST',body:JSON.stringify(request)}).then(async r=>({status:r.status,value:await r.json() as any}));
 const [a,b]=await Promise.all([send(f.request),send(f.request)]);expect(a.status,JSON.stringify(a.value)).toBe(200);expect(b).toEqual(a);expect((await send(f.request)).value).toEqual(a.value);
 expect((await verifyDocumentProof(f.request.markdown,a.value,[f.key])).signature).toBe('VALID');expect((await db.prepare('SELECT COUNT(*) n FROM document_proof_issuances').first<{n:number}>())!.n).toBe(1);
 expect((await db.prepare('SELECT COUNT(*) n FROM document_proof_guards').first<{n:number}>())!.n).toBe(0);
 const changed={...f.request,markdown:f.request.markdown+'変更\n'};expect((await send(changed)).value.error).toBe('DOCUMENT_OPERATION_CONFLICT');
 }finally{f.db.sqlite.close();await mf.dispose();}
},60000);
