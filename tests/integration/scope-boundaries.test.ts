import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {withQuality} from '../fixtures/quality.js';
import {recordState} from '../../src/core/records.js';
import {validateQuality} from '../../src/core/quality.js';
import {resultCoverage} from '../../src/local/result-coverage.js';
import {createEvaluation} from '../../src/core/evaluation.js';
import {getLocalProfile} from '../../src/profiles/local-profile.js';
import {projectPublicResult} from '../../src/core/public-result.js';
import {documentPresentation} from '../../src/document/presentation.js';
import {resultFromDocument} from '../../src/contracts/estimate-result.js';
import {renderEstimateMarkdown} from '../../src/document/estimate-view.js';
import {publicResultHtml} from '../../src/web/public-result-view.js';
import {planAcquisition,LIMITS} from '../../src/collector/acquisition-plan.js';
import {publicationFixture} from '../fixtures/estimate-publication.js';

it('never reports whole effort for acquired but unread measurement sources across local and portable views',async()=>{
 const a=withQuality();a.input.acquisition!.scope_coverage='COMPLETE';
 const f={...a.input.manifest.files[0],path:'unread-feature.ts',disposition:'unread' as const};a.input.manifest.files.push(f);a.scope_record!.files.push({path:f.path,membership:'included',reason:'Application function',confirmation_ref:'scope-confirmed',evidence_refs:[]});
 expect(recordState(a).partial).toBe(true);const evaluated=createEvaluation(a,getLocalProfile()),view=resultCoverage(a,evaluated.report.effort.person_hours);expect(view.scope_coverage).toBe('COMPLETE');expect(view.project_effort).toBeNull();expect(view.acquired_portion_effort?.median).toBe('18');
 const vector=JSON.parse(await fs.readFile('tests/fixtures/document-vector.json','utf8'));
 const result=projectPublicResult(a,{measurement:evaluated.report.measurement,calculation:{environment:'TEST',basis:evaluated.basis,effort:evaluated.report.effort,reference_usd:evaluated.report.reference_usd,limitation_codes:evaluated.report.limitation_codes}});
 const document={...vector.request.document,scope_coverage:'COMPLETE',result},portable=resultFromDocument(document);
 expect(documentPresentation(document)).toMatchObject({median:null,portion_median:'18'});expect(renderEstimateMarkdown(portable)).toContain('全体工数：未算出');
 const rendering=await publicationFixture();try{const publication=(await rendering.service.register(rendering.publish)).response;const html=publicResultHtml(portable,rendering.proof,publication);expect(html).toContain('全体工数：未算出');expect(html).not.toContain('総工数の目安');}finally{rendering.db.sqlite.close();}
});
it('keeps scope coverage independent from provisional interpretation and supporting unread files',()=>{
 const a=withQuality();a.input.acquisition!.scope_coverage='COMPLETE';for(const f of a.input.manifest.files)f.disposition='analyzed';
 a.judgments![0].status='provisional';a.judgments![0].unresolved_points=['Interpretation needs confirmation'];
 expect(recordState(a).partial).toBe(true);expect(resultCoverage(a,{median:'18'}).project_effort).toEqual({median:'18'});
 const f={...a.input.manifest.files[0],path:'support.md',disposition:'unread' as const};a.input.manifest.files.push(f);a.scope_record!.files.push({path:f.path,membership:'supporting',reason:'Reference',confirmation_ref:'scope-confirmed',evidence_refs:[]});
 expect(resultCoverage(a,{median:'18'}).project_effort).toEqual({median:'18'});a.scope_record!.files.at(-1)!.membership='unresolved';expect(resultCoverage(a,{median:'18'}).project_effort).toBeNull();
});
it('identifies each limitation by path and cause and still rejects a duplicate pair',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oes-issue-pair-'));try{
  await fs.mkdir(path.join(root,'node_modules'));await fs.writeFile(path.join(root,'app.ts'),'export const x=1;');
  const plan=await planAcquisition(root,[{path:'.',role:'measurement'}]),issues=plan.summary.issues.filter(i=>i.path==='node_modules');expect(issues.map(i=>i.cause).sort()).toEqual(['SAFETY_EXCLUSION','SCOPE_EXCLUSION_CONFLICT']);
  const a=withQuality();a.input.acquisition!.issues=issues;a.quality!.limitations=issues.map(i=>({...i,impact:'unknown',rule_id:null,reason:'Protected directory',missing:'Dependency source'}));
  expect(validateQuality(a)).toEqual([]);a.quality!.limitations.push({...a.quality!.limitations[0]});expect(validateQuality(a).map(e=>e.code)).toContain('DUPLICATE_ID');a.quality!.limitations=a.quality!.limitations.slice(0,1);expect(validateQuality(a).map(e=>e.code)).toContain('LIMITATION_REQUIRED');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
it('prunes ten thousand excluded files without spending source discovery capacity and honors nested inclusions',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'oes-pruned-'));try{
  await fs.mkdir(path.join(root,'release'));await fs.mkdir(path.join(root,'src'));await fs.writeFile(path.join(root,'src/app.ts'),'export const x=1;');
  for(let start=0;start<=LIMITS.files;start+=200)await Promise.all(Array.from({length:Math.min(200,LIMITS.files+1-start)},(_,i)=>fs.writeFile(path.join(root,'release',`${start+i}.txt`),'')));
  const stat=vi.spyOn(fs,'lstat');try{
   const plan=await planAcquisition(root,[{path:'release',role:'excluded'},{path:'src',role:'measurement'}]);expect(plan.summary.ready).toBe(true);expect(plan.files.map(f=>f.path)).toEqual(['src/app.ts']);expect(plan.summary.excluded_metadata_not_enumerated).toContain('release');expect(plan.summary.excluded_totals_complete).toBe(false);expect(stat.mock.calls.some(c=>String(c[0]).endsWith('.txt'))).toBe(false);
  }finally{stat.mockRestore();}
  await fs.writeFile(path.join(root,'release/zz-feature.ts'),'export const y=2;');
  const nested=await planAcquisition(root,[{path:'release',role:'excluded'},{path:'release/zz-feature.ts',role:'measurement'},{path:'src',role:'measurement'}]);expect(nested.summary.ready).toBe(true);expect(nested.files.map(f=>f.path)).toContain('release/zz-feature.ts');expect(nested.summary.issues.some(i=>i.cause==='FILE_COUNT_LIMIT')).toBe(false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
},60000);
