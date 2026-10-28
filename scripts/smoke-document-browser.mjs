import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {OES_BROWSER_PACKAGE,OES_BROWSER_EXECUTABLE,OES_DOCUMENT_QA_ROOT:root,OES_DOCUMENT_QA_ORIGIN:origin}=process.env;
if(!OES_BROWSER_PACKAGE||!OES_BROWSER_EXECUTABLE||!root||!origin?.startsWith('http://127.0.0.1:'))throw Error('QA_CONFIGURATION_REQUIRED');
const {chromium}=await import(pathToFileURL(OES_BROWSER_PACKAGE).href),browser=await chromium.launch({headless:true,executablePath:OES_BROWSER_EXECUTABLE});
const checks=[],external=[];
try{const page=await browser.newPage({viewport:{width:1100,height:1000},acceptDownloads:true});page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('file:')&&!r.url().startsWith('blob:'))external.push({method:r.method(),url:r.url()});});
 for(const name of ['complete','partial']){
  await page.goto(origin+'/preview');await page.locator('#md').setInputFiles(path.join(root,name+'.md'));await page.locator('#proof').setInputFiles(path.join(root,name+'-proof.json'));await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Webで表示（文書を送信）'}).click()]);
  assert.match(await page.locator('aside').innerText(),/TEST環境：数値整合の証明を確認/);assert.equal(page.url(),origin+'/preview');if(name==='partial')assert.match(await page.locator('article').innerText(),/全体工数：未算出/);
  await page.screenshot({path:path.join(root,name+'-browser.png')});checks.push(name+'_native_file_post');
  await page.goto(origin+'/preview');assert.equal(await page.locator('article').count(),0);
  await page.goto(origin+'/widget?sample='+name);await page.locator('details summary').first().click();assert.equal(await page.locator('details[open]').count(),1);
  for(const kind of ['pdf','md','proof-file']){const download=page.waitForEvent('download');await page.locator('#'+kind).click();const d=await download;await d.saveAs(path.join(root,name+'-download.'+kind));const bytes=await fs.readFile(path.join(root,name+'-download.'+kind));assert.ok(kind==='pdf'?bytes.subarray(0,5).toString()==='%PDF-':kind==='proof-file'?JSON.parse(bytes.toString()).statement.schema_version==='oes/document-proof/v1':bytes.toString().startsWith('# Open Estimate'));}
  await page.locator('#proof').click();assert.match(await page.evaluate(()=>window.lastChoice.prompt),/実際の検証依頼/);
  await page.setViewportSize({width:430,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(root,name+'-widget.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1100,height:1000});checks.push(name+'_synthetic_widget_download_and_choice');
 }
 await page.goto(origin+'/preview');const tampered=(await fs.readFile(path.join(root,'complete.md'),'utf8')).replace('18 時間','19 時間');await page.locator('#md').setInputFiles({name:'changed.md',mimeType:'text/markdown',buffer:Buffer.from(tampered)});await page.locator('#proof').setInputFiles(path.join(root,'complete-proof.json'));await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Webで表示（文書を送信）'}).click()]);assert.match(await page.locator('aside').innerText(),/証明を確認できません/);checks.push('tamper_badge_rejected');
 assert.equal(external.length,0);
 const handoff=JSON.parse(await fs.readFile(path.join(root,'handoff.json'),'utf8'));assert.equal(handoff.status,'WEB_PREVIEW_FILES_READY');assert.ok(handoff.url.startsWith('https://'));assert.equal(handoff.operation_count,4);assert.equal(path.basename(handoff.files.markdown),'estimate.md');assert.equal(path.basename(handoff.files.proof),'proof.json');checks.push('https_file_selection_handoff');
 const report={status:'PASS',checks,external_requests:0,production_requests_sent:0,actual_chatgpt:false,synthetic_widget_host:true,handoff_route:'HTTPS_FILE_SELECTION',platform_logs_verified:false};await fs.writeFile(path.join(root,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
