import {it,expect} from "vitest";
import fs from "node:fs/promises";
import {resultCoverage} from "../../src/local/result-coverage.js";
import {createEvaluation} from "../../src/core/evaluation.js";
import {getLocalProfile} from "../../src/profiles/local-profile.js";
import {presentEvaluation,renderEvaluationHtml} from "../../src/mcp/presentation.js";
import {FrbProvider} from "../../src/profiles/frb.js";
import {frbHtml,fxNow,htmlResponse} from "../fixtures/frb.js";
import type {Assessment} from "../../src/core/types.js";
import {withQuality} from '../fixtures/quality.js';
it("distinguishes missing source coverage from provisional judgments and preserves the effort value",()=>{
 const a=withQuality();a.input.acquisition!.scope_coverage='COMPLETE';for(const f of a.input.manifest.files)f.disposition='analyzed';a.judgments![0].status='provisional';
 expect(resultCoverage({input:{acquisition:{scope_coverage:'COMPLETE'}},judgments:[]} as unknown as Assessment,{median:'108'}).project_effort).toBeNull();
 const hours={median:"108"};expect(resultCoverage(a,hours)).toMatchObject({scope_coverage:"COMPLETE",interpretation_status:"PROVISIONAL",project_effort:hours,acquired_portion_effort:null});
 a.input.acquisition!.scope_coverage="MISSING";
 expect(resultCoverage(a,hours)).toMatchObject({scope_coverage:"MISSING",project_effort:null,acquired_portion_effort:hours,headline:"プロジェクト全体の工数：未算出"});
 delete a.input.acquisition;expect(resultCoverage(a,hours).project_effort).toBeNull();
});
it("labels partial local HTML explicitly and shows the large total only with complete acquisition",async()=>{
 const a:Assessment=JSON.parse(await fs.readFile("examples/basic-assessment.json","utf8"));
 const provider=new FrbProvider(async()=>htmlResponse(frbHtml()),()=>fxNow);
 for(const coverage of ["MISSING","COMPLETE"] as const){
  a.input.acquisition={discovery_complete:true,issues:[],scope_coverage:coverage,partial_authorized:coverage==="MISSING"};
  const record={...createEvaluation(a,getLocalProfile()),format:"open-estimate/local-evaluation/v3" as const,evaluation_id:"test",evaluated_at:new Date().toISOString(),workspace_hash:"test"};
  const html=renderEvaluationHtml(await presentEvaluation(record,provider));
  if(coverage==="MISSING"){expect(html).toContain("プロジェクト全体の工数：未算出");expect(html).toContain("取得済み部分のみの参考工数");expect(html).toContain("全体工数としては利用できません");}
  else {expect(html).toContain("対象全体の参考工数");expect(html).not.toContain("プロジェクト全体の工数：未算出");}
 }
});
