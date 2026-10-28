import {it,expect} from 'vitest';
import {verify,createPublicKey,createHash} from 'node:crypto';
import fs from 'node:fs';
import {publicationFixture} from '../fixtures/estimate-publication.js';
import {verifyEstimateProof,estimateResultHash} from '../../src/proof/estimate-proof.js';
it('signs structured data without files and independently verifies the new domain; key order does not affect the result hash',async()=>{
 const f=await publicationFixture();try{expect(await verifyEstimateProof(f.result,f.proof,[f.key],'test')).toMatchObject({signature:'VALID',result:'MATCH'});
 const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
 const vector=JSON.parse(fs.readFileSync('tests/fixtures/estimate-result-vector.json','utf8'));
 const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(vector.key.public_key,'base64url')]),type:'spki',format:'der'});
 expect(verify(null,Buffer.from(JSON.stringify(sort(vector.proof.statement))),publicKey,Buffer.from(vector.proof.signature,'base64url'))).toBe(true);
 expect(createHash('sha256').update(JSON.stringify(sort({domain:'oes/estimate-result-hash/v1',result:vector.result}))).digest('hex')).toBe(vector.result_hash);
 expect(await estimateResultHash(vector.result)).toBe(vector.result_hash);
 expect(verify(null,Buffer.from(JSON.stringify(sort(f.proof.statement))),createPublicKey(f.pair.privateKey),Buffer.from(f.proof.signature,'base64url'))).toBe(true);
 const reordered=Object.fromEntries(Object.entries(f.result).reverse()) as any;expect(await estimateResultHash(reordered)).toBe(await estimateResultHash(f.result));
 expect(await f.issuer.issue(f.request,f.now)).toEqual(f.proof);
 await expect(f.issuer.issue({...f.request,result:{...f.result,scope_coverage:'MISSING'}},f.now)).rejects.toThrow('OPERATION_CONFLICT');
 await expect(verifyEstimateProof(f.result,f.proof,[f.key],'production')).rejects.toThrow('UNTRUSTED');
 await expect(verifyEstimateProof(f.result,{...f.proof,signature:'A'.repeat(86)},[f.key])).rejects.toThrow();
 await expect(verifyEstimateProof({...f.result,scope_coverage:'MISSING'},f.proof,[f.key])).rejects.toThrow('MISMATCH');
 await expect(verifyEstimateProof(f.result,f.legacyProof,[f.key])).rejects.toThrow('INVALID_ESTIMATE_PROOF');
 }finally{f.db.sqlite.close();}
});
it('rejects unknown fields, prose, noncanonical decimals and numeric mismatches instead of silently correcting',async()=>{const f=await publicationFixture();try{
 for(const result of [{...f.result,project_name:'secret'}, {...f.result,display_quote:{...f.result.display_quote,locale:'secret'}},{...f.result,result:{...f.result.result,quality:{...f.result.result.quality,partial_reason_codes:['secret']}}}])await expect(f.issuer.issue({...f.request,operation_id:crypto.randomUUID(),result},f.now)).rejects.toThrow('INVALID_ESTIMATE');
 const r=structuredClone(f.result);r.result.calculation.effort.person_hours!.median='18.0';await expect(f.issuer.issue({...f.request,operation_id:crypto.randomUUID(),result:r},f.now)).rejects.toThrow('INVALID_ESTIMATE');
 const bad=structuredClone(f.result);bad.result.calculation.effort.person_hours!.median='19';await expect(f.issuer.issue({...f.request,operation_id:crypto.randomUUID(),result:bad},f.now)).rejects.toThrow();
 expect(f.db.sqlite.prepare('SELECT COUNT(*) n FROM estimate_proof_issuances').get()!.n).toBe(1);
 }finally{f.db.sqlite.close();}});
