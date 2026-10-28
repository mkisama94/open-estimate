import {build} from 'esbuild';
import fs from 'node:fs/promises';
const r=await build({entryPoints:['src/web/document-worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',metafile:true});
const forbidden=/src\/(issuer|local|remote)\/|src\/core\/(numeric-model|estimate|measure|certificate-contract|certificate-verify)\.|src\/web\/(browser-login|saved-estimates|signing|certificate-repository)/;
for(const file of Object.keys(r.metafile.inputs))if(forbidden.test(file))throw new Error('DOCUMENT_WEB_FORBIDDEN_DEPENDENCY:'+file);
await fs.mkdir('.cache/document-web',{recursive:true});await fs.writeFile('.cache/document-web/worker.js',r.outputFiles[0].contents);await fs.writeFile('.cache/document-web/dependencies.json',JSON.stringify(Object.keys(r.metafile.inputs),null,2));
console.log(JSON.stringify({status:'PASS',bytes:r.outputFiles[0].contents.length,dependencies:Object.keys(r.metafile.inputs).length,oauth:false,database:false,numeric_engine:false,issuer:false,network_required:false}));
