import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {documentConsentFile,readDocumentConsentRecord,saveDocumentConsentRecord,type DocumentConsentRecord} from '../../src/local/document-consent-record.js';
import {validateDocumentServices} from '../../src/local/document-services.js';
it('uses reviewed package destinations and rejects unsafe or production-mismatched configuration',()=>{
 expect(validateDocumentServices({environment:'test',proof_destination:'https://issuer.account.workers.dev/mcp',web_destination:'https://preview.account.workers.dev/preview'}).environment).toBe('test');
 for(const proof_destination of ['http://issuer.account.workers.dev/mcp','https://issuer.account.workers.dev/mcp?secret=x','https://user@issuer.account.workers.dev/mcp','https://evil.example/mcp'])expect(()=>validateDocumentServices({environment:'test',proof_destination,web_destination:'https://preview.account.workers.dev/preview'})).toThrow();
 expect(()=>validateDocumentServices({environment:'production',proof_destination:'https://issuer.account.workers.dev/mcp',web_destination:'https://open-estimate.ai-orchestration.jp/preview'})).toThrow();
});
const record=(hash='1'.repeat(64)):DocumentConsentRecord=>({action:'web',document_sha256:'0'.repeat(64),destination:'https://open-estimate.ai-orchestration.jp/preview',purpose:'STATELESS_WEB_DISPLAY',request_hash:hash,confirmed_at:'2026-10-28T00:00:00.000Z',explicit_answer:'この要求の表示送信に同意します',evidence:'HOST_REPORTED_EXPLICIT_USER_ANSWER_NOT_IDENTITY_PROOF'});
it('retains the first exact consent across repeated and concurrent writes without partial visible records',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oes-consent-'));try{const first=record(),later={...first,confirmed_at:'2026-10-28T00:00:01.000Z',explicit_answer:'もう一度同意'};
 const values=await Promise.all([saveDocumentConsentRecord(dir,first),saveDocumentConsentRecord(dir,later)]);expect(values[0]).toEqual(values[1]);expect(await saveDocumentConsentRecord(dir,later)).toEqual(values[0]);expect(await fs.readdir(dir)).toEqual([documentConsentFile(first)]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
it('separates changed requests, preserves legacy history and refuses a mismatched record at the exact hash',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oes-consent-'));try{const old=record(),changed=record('2'.repeat(64));await fs.writeFile(path.join(dir,'consent-web.json'),JSON.stringify(old));
 expect(await readDocumentConsentRecord(dir,old)).toEqual(old);await expect(readDocumentConsentRecord(dir,changed)).rejects.toThrow('DOCUMENT_CONSENT_CHANGED');
 await saveDocumentConsentRecord(dir,changed);expect(await readDocumentConsentRecord(dir,changed)).toEqual(changed);expect(JSON.parse(await fs.readFile(path.join(dir,'consent-web.json'),'utf8'))).toEqual(old);
 const moved={...changed,destination:'https://preview.account.workers.dev/preview'};await expect(readDocumentConsentRecord(dir,moved)).rejects.toThrow();await saveDocumentConsentRecord(dir,moved);expect(documentConsentFile(moved)).not.toBe(documentConsentFile(changed));expect(await readDocumentConsentRecord(dir,moved)).toEqual(moved);
 const bad={...changed,destination:'https://evil.example'};await fs.writeFile(path.join(dir,documentConsentFile(changed)),JSON.stringify(bad));await expect(saveDocumentConsentRecord(dir,changed)).rejects.toThrow('DOCUMENT_CONSENT_CHANGED');expect(JSON.parse(await fs.readFile(path.join(dir,documentConsentFile(changed)),'utf8'))).toEqual(bad);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
