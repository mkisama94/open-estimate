import {it,expect} from 'vitest';
import {verify} from 'node:crypto';
import {documentFixture} from '../fixtures/document.js';
import {renderDocumentMarkdown,parseDocumentMarkdown,assertDocumentMarkdown,assertMarkdownBytes} from '../../src/document/markdown.js';
import {documentPresentation} from '../../src/document/presentation.js';
import {verifyDocumentProof} from '../../src/proof/verify.js';
import {proofBytes} from '../../src/proof/crypto.js';
import vector from '../fixtures/document-vector.json';
import type {TrustedDocumentKey} from '../../src/contracts/document.js';
it('reads the frozen v1 independent signature vector without any current rule lookup',async()=>{
 expect(parseDocumentMarkdown(vector.request.markdown)).toEqual(vector.request.document);
 expect(await verifyDocumentProof(vector.request.markdown,vector.proof,[vector.key as TrustedDocumentKey])).toEqual({schema:'VALID',signature:'VALID',document:'MATCH',issuer:'TRUSTED',current_status:'NOT_CHECKED'});
});
it('fixes portable document bytes and rejects normalization, duplicate regions, unknown template/schema and fields',async()=>{
 const f=await documentFixture();try{const m=f.request.markdown;expect(renderDocumentMarkdown(f.document)).toBe(m);expect(renderDocumentMarkdown(Object.fromEntries(Object.entries(f.document).reverse()) as any)).toBe(m);expect(parseDocumentMarkdown(m)).toEqual(f.document);
  for(const bad of ['\ufeff'+m,m.replace(/\n/g,'\r\n'),m+'\n',m.slice(0,-1),m+'## 総工数\n777時間\n',m.replace('## 固定した結果','## 偽の結果')])expect(()=>assertDocumentMarkdown(f.document,bad)).toThrow();
  for(const change of [(d:any)=>d.schema_version='unknown',(d:any)=>d.template_version='v2',(d:any)=>d.run_id='private']){const d=structuredClone(f.document);change(d);expect(()=>renderDocumentMarkdown(d)).toThrow();}
  expect(()=>assertMarkdownBytes('bad\ud800\n')).toThrow();
 }finally{f.db.sqlite.close();}
});
it('separates whole scope coverage from counting certainty and never displays missing as a project total',async()=>{
 const f=await documentFixture();try{for(const coverage of ['COMPLETE','MISSING','UNKNOWN'] as const){f.document.scope_coverage=coverage;const p=documentPresentation(f.document);if(coverage==='COMPLETE')expect(p.median).not.toBeNull();else{expect(p.median).toBeNull();expect(p.portion_median).not.toBeNull();expect(renderDocumentMarkdown(f.document)).toContain('全体工数：未算出');}}}finally{f.db.sqlite.close();}
});
it('verifies with independent Node Ed25519 and separates document, trust, environment, signature and current state',async()=>{
 const f=await documentFixture();try{const proof=await f.service.issue(f.request,f.now),m=f.request.markdown;
  // Independent canonicalization and Node verification avoid reusing signer's byte function.
  const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
  const independentBytes=Buffer.from(JSON.stringify(sort(proof.statement)),'utf8');expect(independentBytes).toEqual(Buffer.from(proofBytes(proof.statement)));
  expect(verify(null,independentBytes,f.pair.publicKey,Buffer.from(proof.signature,'base64url'))).toBe(true);
  expect(await verifyDocumentProof(m,proof,[f.key])).toEqual({schema:'VALID',signature:'VALID',document:'MATCH',issuer:'TRUSTED',current_status:'NOT_CHECKED'});
  expect((await verifyDocumentProof(m.replace('参考','変更'),proof,[f.key])).document).toBe('MISMATCH');
  expect((await verifyDocumentProof(m,proof,[])).signature).toBe('UNKNOWN_KEY');
  expect((await verifyDocumentProof(m,proof,[{...f.key,environment:'production'}])).issuer).toBe('UNTRUSTED');
  const bad=structuredClone(proof);bad.statement.issued_at='2026-10-28T00:00:01.000Z';expect((await verifyDocumentProof(m,bad,[f.key])).signature).toBe('INVALID');
  const old={...proof,statement:{...proof.statement,domain:'oes/server-recomputed-certificate/v1'}};expect((await verifyDocumentProof(m,old,[f.key])).schema).toBe('INVALID');
 }finally{f.db.sqlite.close();}
});
