import fs from 'node:fs/promises';
import path from 'node:path';
import {renderStructuredEstimatePdf} from '../../src/document/estimate-pdf.js';
const root=process.env.OES_PUBLICATION_QA_ROOT,input=process.env.OES_PUBLICATION_QA_INPUT;
if(!root||!input||!path.isAbsolute(root)||!path.isAbsolute(input))throw Error('QA_CONFIGURATION_REQUIRED');
await fs.mkdir(root,{recursive:true});
for(const name of ['complete','partial']){const v=JSON.parse(await fs.readFile(path.join(input,name+'.json'),'utf8'));await fs.writeFile(path.join(root,name+'.pdf'),await renderStructuredEstimatePdf(v.result,v.proof,v.publication));}
console.log(JSON.stringify({status:'PDF_SAMPLES_CREATED',root,production_requests:0,rendering_review:'PENDING'}));
