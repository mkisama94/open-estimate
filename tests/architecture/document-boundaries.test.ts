import {it,expect} from 'vitest';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
it('closes the standalone preview graph without calculation, issuer, OAuth, database, local, remote or PDF',async()=>{
 const r=await build({entryPoints:['src/web/document-worker.ts'],bundle:true,write:false,platform:'browser',format:'esm',metafile:true});
 const graph=Object.keys(r.metafile!.inputs).join('\n');expect(graph).not.toMatch(/src\/(issuer|local|remote)\//);expect(graph).not.toMatch(/numeric-model|pdfkit|browser-login|saved-estimates|certificate-repository|core\/certificate-contract/);
 expect(r.outputFiles![0].text).not.toContain('importKey("pkcs8"');expect(graph).not.toMatch(/document-validators\.ts|document\.schema\.json/);
});
it('keeps document/proof/contracts pure and the remote basic path detached from old publication/experience',async()=>{
 for(const dir of ['contracts','document','proof'])for(const f of await fs.readdir('src/'+dir)){if(!f.endsWith('.ts'))continue;const s=await fs.readFile('src/'+dir+'/'+f,'utf8');expect(s).not.toMatch(/from ['"]\.\.\/(local|web|remote|issuer)\//);expect(s).not.toMatch(/process\.env|fetch\(/);}
 const r=await build({entryPoints:['src/remote/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',metafile:true});const graph=Object.keys(r.metafile!.inputs).join('\n');expect(graph).not.toMatch(/src\/web\/|src\/local\/|estimate-publishing|remote\/experience/);
});
it('redisplays and renders a finished local document without importing the run reader, rules registry or numeric engine',async()=>{
 const r=await build({entryPoints:['src/local/document-result.ts'],bundle:true,write:false,platform:'node',format:'esm',metafile:true,external:['pdfkit']});
 const graph=Object.keys(r.metafile!.inputs).join('\n');expect(graph).not.toMatch(/local\/runs\.ts|numeric-model\.ts|src\/remote\/|profiles\/frb\.ts|certificate-basis\.ts/);
});
