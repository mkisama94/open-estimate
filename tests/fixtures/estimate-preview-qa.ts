import fs from "node:fs/promises";
import path from "node:path";
import {directFixture} from "./direct-estimate.js";
import {renderEstimatePdf} from "../../src/local/estimate-pdf.js";
import {localPreviewDocument} from "../../src/local/estimate-ui.js";
import {resultWidgetHtml} from "../../src/local/result-widget.js";
import {estimatePresentation} from "../../src/core/estimate-publication.js";
const out=process.env.OES_QA_OUTPUT;if(!out||!path.isAbsolute(out))throw Error("ABSOLUTE_OUTPUT_REQUIRED");
await fs.mkdir(out,{recursive:true});const f=await directFixture();
try{for(const kind of ["complete","partial"]){f.snapshot.scope_coverage=kind==="complete"?"COMPLETE":"MISSING";
 const pdf=await renderEstimatePdf(f.snapshot);await fs.writeFile(path.join(out,kind+".pdf"),pdf);
 await fs.writeFile(path.join(out,kind+".html"),localPreviewDocument(f.snapshot,{preview_id:f.request.operation_id,pdf_uri:"data:application/pdf;base64,"+pdf.toString("base64")}));
 const view={preview_id:f.request.operation_id,snapshot:f.snapshot,presentation:estimatePresentation(f.snapshot),local_details:{scope:{description:"ローカルだけの対象説明 CANARY_LOCAL_ONLY"}}};
 const host=`window.choices=[];window.addEventListener('message',e=>{const m=e.data;if(!m?.method||!m.id)return;if(m.method==='ui/message')window.choices.push(m.params.content[0].text);parent.postMessage({jsonrpc:'2.0',id:m.id,result:m.method==='tools/call'?{_meta:{pdf_base64:${JSON.stringify(pdf.toString("base64"))}}}:{}},'*');if(m.method==='ui/initialize')parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(view)}}},'*');});`;
 await fs.writeFile(path.join(out,kind+"-widget.html"),resultWidgetHtml.replace("<script>","<script>"+host+"\n"));
 }console.log(JSON.stringify({output:out,files:["complete.pdf","partial.pdf","complete.html","partial.html"],synthetic:true}));}finally{f.db.sqlite.close();}
