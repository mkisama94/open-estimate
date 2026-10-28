import {createDocument} from '../../src/local/create-document.js';
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {documentFixture} from '../fixtures/document.js';
import {renderDocumentMarkdown} from '../../src/document/markdown.js';
import {DocumentIssuerService} from '../../src/issuer/service.js';
import {DocumentIssuerRepository} from '../../src/issuer/repository.js';
import {documentPreview} from '../../src/web/document-preview.js';
import worker from '../../src/web/worker.js';
import remote from '../../src/remote/worker.js';
import {saveRun} from '../../src/local/runs.js';
import {generatedRules} from '../fixtures/measurement.js';
import {showDocument,renderDocumentPdfFile,attachDocumentProof} from '../../src/local/document-result.js';
import {prepareProofRequest,consentDocumentAction,consentedDocumentInput,webPreviewInput,PROOF_DESTINATION} from '../../src/local/document-consent.js';
import {openWebPreview} from '../../src/local/web-handoff.js';
import {jcsSha256} from '../../src/core/canonical.js';
import {documentConsentFile} from '../../src/local/document-consent-record.js';

it('issues anonymously using only new tables; concurrent identical retries return one committed proof and conflicts reject',async()=>{
 const f=await documentFixture();try{const [a,b]=await Promise.all([f.service.issue(f.request,f.now),f.service.issue(f.request,f.now+1)]);expect(a).toEqual(b);expect(await f.service.issue(f.request,f.now+200)).toEqual(a);
 const rows=f.db.sqlite.prepare('SELECT * FROM document_proof_issuances').all();expect(rows).toHaveLength(1);const row=JSON.stringify(rows);expect(row).not.toContain('estimate-document/v1');expect(row).not.toContain('validation_input');expect(row).not.toContain('数値結果');
 const changed=structuredClone(f.request);changed.document.measured_at='2026-10-26T00:00:00.000Z';changed.markdown=renderDocumentMarkdown(changed.document);await expect(f.service.issue(changed,f.now)).rejects.toThrow('DOCUMENT_OPERATION_CONFLICT');
 const tables=f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);expect(tables.sort()).toEqual(['document_proof_guards','document_proof_issuances']);
 }finally{f.db.sqlite.close();}
});
it('refuses arithmetic, quote, rules and template mismatches instead of downgrading to registration',async()=>{
 const f=await documentFixture();try{for(const change of [(r:any)=>r.document.result.calculation.effort.person_hours.median='1',(r:any)=>r.document.display_quote.localized_reference.amount.median='1',(r:any)=>r.markdown=r.markdown.replace('時間','分'),(r:any)=>r.document.ruleset_ref.revision='unknown',(r:any)=>r.validation_input.model='private',(r:any)=>r.owner_id='private']){const r=structuredClone(f.request);change(r);if(r.markdown===f.request.markdown)try{r.markdown=renderDocumentMarkdown(r.document);}catch{}await expect(f.service.issue(r,f.now)).rejects.toThrow();}expect(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM document_proof_issuances').get()!.n).toBe(0);}finally{f.db.sqlite.close();}
});
it('does not return success before durable commit, checks capacity and separates issuance stop from existing proof verification',async()=>{
 const f=await documentFixture();try{const broken=new DocumentIssuerService({get:async()=>null,commit:async()=>{throw Error('storage');}},f.config,f.catalog,f.sign);await expect(broken.issue(f.request,f.now)).rejects.toThrow('DOCUMENT_RECORD_UNAVAILABLE_OR_CAPACITY');
 const capacity=new DocumentIssuerService(new DocumentIssuerRepository(f.db,0),f.config,f.catalog,f.sign);await expect(capacity.issue(f.request,f.now)).rejects.toThrow();
 const stop=new DocumentIssuerService(f.repository,{...f.config,enabled:false},f.catalog,f.sign);await expect(stop.issue(f.request,f.now)).rejects.toThrow('DOCUMENT_ISSUANCE_DISABLED');const proof=await f.service.issue(f.request,f.now);expect(await stop.issue(f.request,f.now)).toEqual(proof);
 }finally{f.db.sqlite.close();}
});
const post=(markdown:string,proof:unknown=null)=>new Request('https://open-estimate.ai-orchestration.jp/preview',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',Origin:'https://local.invalid',Cookie:'ignored'},body:new URLSearchParams({format:'oes/document-display/v1',markdown,proof:proof?JSON.stringify(proof):''})});
it('preserves exact LF bytes across the encoded native form contract and rejects BOM/CRLF instead of silently normalizing',async()=>{
 const f=await documentFixture();try{const proof=await f.service.issue(f.request,f.now);
 const send=(markdown:string)=>documentPreview(new Request('https://x/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({format:'oes/document-display/v1',encoding:'utf8-base64url',markdown:Buffer.from(markdown,'utf8').toString('base64url'),proof:Buffer.from(JSON.stringify(proof)).toString('base64url')})}),[f.key]);
 expect(await(await send(f.request.markdown)).text()).toContain('TEST環境：数値整合の証明を確認');
 expect((await send('\ufeff'+f.request.markdown)).status).toBe(400);expect((await send(f.request.markdown.replace(/\n/g,'\r\n'))).status).toBe(400);
 }finally{f.db.sqlite.close();}
});
it('renders with no OAuth, DB, MCP or signing key; verifies offline and never fetches external resources or logs a body',async()=>{
 const f=await documentFixture(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('OFFLINE')),log=vi.spyOn(console,'log').mockImplementation(()=>{});try{
 const proof=await f.service.issue(f.request,f.now);const r=await documentPreview(post(f.request.markdown,proof),[f.key]);expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(r.headers.get('content-security-policy')).toContain("img-src 'none'");expect(await r.text()).toContain('数値整合の証明を確認');
 const bare=await worker.fetch(post(f.request.markdown),{} as any);expect(bare.status).toBe(200);expect(await bare.text()).toContain('未証明の文書');
 const bad=await documentPreview(post(f.request.markdown+'変更\n',proof),[f.key]);expect(await bad.text()).toContain('証明を確認できません');expect(fetch).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();
 }finally{fetch.mockRestore();log.mockRestore();f.db.sqlite.close();}
});
it('blocks executable HTML, embeds, forged badges, duplicate/unknown inputs, oversized and invalid encodings',async()=>{
 const r=await documentPreview(post('# 証明済み\n<script>fetch("https://evil.example")</script>\n![track](https://evil.example/x)\n<img src=x onerror=alert(1)>\n'));
 const h=await r.text();expect(h).not.toContain('<script>');expect(h).not.toContain('<img');expect(h).toContain('&lt;script&gt;');expect(h).toContain('未証明の文書');
 expect((await documentPreview(post('x'.repeat(262145)+'\n'))).status).toBe(413);
 for(const body of ['markdown=a%0A&markdown=b%0A','markdown=a%0A&model=secret','markdown=%FF%0A'])expect((await documentPreview(new Request('https://x/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body}))).status).toBe(400);
 expect((await documentPreview(new Request('https://x/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}))).status).toBe(400);
 expect((await documentPreview(new Request('https://x/preview',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'x'.repeat(1048577)}))).status).toBe(413);
});
it('keeps rule reads independent of issuer configuration and removes Web capability/progress/save from basic remote tools',async()=>{
 const call=async(method:string,params:unknown)=>{const r=await remote.fetch(new Request('https://x/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));return r.json() as any;};
 const tools=(await call('tools/list',{})).result.tools;expect(tools.map((t:any)=>t.name)).toEqual(['get_skill_policy','get_measurement_rules','issue_document_proof']);expect(tools[2].securitySchemes).toEqual([{type:'noauth'}]);
 expect((await call('tools/call',{name:'get_skill_policy',arguments:{}})).result.isError).not.toBe(true);
 const failed=(await call('tools/call',{name:'issue_document_proof',arguments:{}})).result;expect(failed.structuredContent.error.code).toBe('DOCUMENT_ISSUANCE_DISABLED');
});
it('creates and redisplays portable UI/PDF after source run removal with zero send; exact purpose-bound consent and wrong proof are enforced',async()=>{
 const f=await documentFixture(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'oes-document-'));vi.stubEnv('OES_RUNS_ROOT',path.join(temp,'runs'));const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('OFFLINE'));
 try{const run=await saveRun(f.a,f.a,{...generatedRules,context_hash:'synthetic'},path.join(temp,'source')),view=await createDocument({run_id:run.run_id,display_currency:'USD'});expect(view.status).toBe('DOCUMENT_READY');
 const originalMarkdown=await fs.readFile(path.join(view.dir,'estimate.md'));await fs.writeFile(path.join(view.dir,'estimate.pdf'),'corrupted');expect((await showDocument(view.dir)).status).toBe('PDF_INCOMPLETE');await renderDocumentPdfFile(view.dir);
 await fs.writeFile(path.join(view.dir,'estimate.md'),Buffer.concat([Buffer.from([239,187,191]),originalMarkdown]));await expect(showDocument(view.dir)).rejects.toThrow('DOCUMENT_BYTES_INVALID');await fs.writeFile(path.join(view.dir,'estimate.md'),originalMarkdown);
 const portable=path.join(temp,'portable');await fs.mkdir(portable);for(const file of ['estimate.md','document.json','estimate.pdf'])await fs.copyFile(path.join(view.dir,file),path.join(portable,file));
 const runDir=path.join(temp,'runs',run.run_id);await fs.rename(runDir,runDir+'-detached');expect((await showDocument(portable)).document_sha256).toBe(view.document_sha256);await renderDocumentPdfFile(portable);expect((await fs.readFile(path.join(portable,'estimate.pdf'))).subarray(0,5).toString()).toBe('%PDF-');
 const unsignedWeb=await webPreviewInput(view.dir),unsignedArgs={document_dir:view.dir,action:'web' as const,request_hash:unsignedWeb.request_hash,destination:unsignedWeb.destination,user_confirmed:true,explicit_answer:'証明なしの文書を表示することに同意します'};
 const unsignedConsent=await consentDocumentAction(unsignedArgs);expect(await consentDocumentAction(unsignedArgs)).toEqual(unsignedConsent);const oldConsentPath=path.join(view.dir,documentConsentFile(unsignedConsent.consent)),oldConsentBytes=await fs.readFile(oldConsentPath);await fs.writeFile(path.join(view.dir,'consent-web.json'),oldConsentBytes);expect((await openWebPreview(view.dir)).operation_count).toBe(3);
 await expect(consentedDocumentInput(view.dir,'proof')).rejects.toThrow('DOCUMENT_CONSENT_REQUIRED');
 const req=await prepareProofRequest(view.dir);expect(network).not.toHaveBeenCalled();await expect(consentDocumentAction({document_dir:view.dir,action:'proof',request_hash:req.request_hash,destination:req.destination,user_confirmed:false,explicit_answer:'拒否'})).rejects.toThrow();
 await expect(consentDocumentAction({document_dir:view.dir,action:'proof',request_hash:'0'.repeat(64),destination:req.destination,user_confirmed:true,explicit_answer:'同意'})).rejects.toThrow('DOCUMENT_CONSENT_CHANGED');
 const args={document_dir:view.dir,action:'proof' as const,request_hash:req.request_hash,destination:req.destination,user_confirmed:true,explicit_answer:'この要求を検証送信することに同意します'};
 await expect(consentDocumentAction({...args,destination:'https://evil.example'})).rejects.toThrow('DOCUMENT_CONSENT_CHANGED');
 const c=await consentDocumentAction(args);expect(await consentDocumentAction(args)).toEqual(c);expect(c.request).toEqual(req.request);expect(network).not.toHaveBeenCalled();
 // Fixture-only issuer origin uses the configured destination origin and current package registry.
 const localKey={...f.key,issuer:new URL(PROOF_DESTINATION).origin},localConfig={...f.config,issuer:localKey.issuer,key:localKey};Object.assign(f.catalog.skills.releases[0],{skill_version:req.request.validation_input.skill_integrity.skill_version,package_sha256:req.request.validation_input.skill_integrity.package_sha256});
 const service=new DocumentIssuerService(f.repository,localConfig,f.catalog,f.sign),proof=await service.issue(req.request,Date.now());expect(await service.issue((await consentedDocumentInput(view.dir,'proof')).request,Date.now())).toEqual(proof);
 const wrong=structuredClone(proof);wrong.statement.document_sha256='0'.repeat(64);await expect(attachDocumentProof(view.dir,wrong,[localKey])).rejects.toThrow('DOCUMENT_PROOF_REJECTED');
 const attached=await attachDocumentProof(view.dir,proof,[localKey]);expect(attached.pdf_signed).toBe(false);expect(await fs.readFile(path.join(view.dir,'estimate.md'),'utf8')).toBe(req.request.markdown);
 await expect(openWebPreview(view.dir)).rejects.toThrow('DOCUMENT_CONSENT_CHANGED');const web=await webPreviewInput(view.dir);expect(web.request_hash).not.toBe(unsignedWeb.request_hash);expect(JSON.stringify(web.request)).not.toContain('validation_input');
 await expect(consentDocumentAction(unsignedArgs)).rejects.toThrow('DOCUMENT_CONSENT_CHANGED');await expect(consentDocumentAction({...unsignedArgs,request_hash:web.request_hash,user_confirmed:false})).rejects.toThrow('EXPLICIT_DOCUMENT_CONSENT_REQUIRED');
 const signedArgs={...unsignedArgs,request_hash:web.request_hash,explicit_answer:'証明付き文書の表示送信に改めて同意します'},signedConsent=await consentDocumentAction(signedArgs);expect(await consentDocumentAction(signedArgs)).toEqual(signedConsent);expect(signedConsent.consent.request_hash).toBe(web.request_hash);expect(await fs.readFile(oldConsentPath)).toEqual(oldConsentBytes);expect(await fs.readFile(path.join(view.dir,'consent-web.json'))).toEqual(oldConsentBytes);
 const handoff=await openWebPreview(view.dir);expect(handoff.browser_display).toBe('NOT_CONFIRMED');expect(handoff.url).toMatch(/^https:/);expect(handoff.operation_count).toBe(4);expect(handoff.files.markdown).toBe(path.join(view.dir,'estimate.md'));expect(handoff.files.proof).toBe(path.join(view.dir,'proof.json'));expect((await fs.readdir(view.dir)).some(name=>name.startsWith('web-handoff-'))).toBe(false);expect(network).not.toHaveBeenCalled();
 }finally{network.mockRestore();vi.unstubAllEnvs();f.db.sqlite.close();await fs.rm(temp,{recursive:true,force:true});}
},30000);
