import { it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { recorded } from "../fixtures/recorded.js";
import { evaluateRemote } from "../fixtures/skill-policy.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { bindRules, setRuleReferences } from "../fixtures/measurement.js";

it("saves invalid drafts and recorded exports across helper processes; only model crosses remote boundary", async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-recorded-test-"));
  const state=path.join(temp,'state');await fs.mkdir(state);
  const root=path.resolve("examples/quality-check");
  const run=(command:string,input:unknown,ok=true)=>{
    const child=spawnSync(process.execPath,["dist/local/cli.js",command],{input:JSON.stringify(input),encoding:"utf8",env:{...process.env,OES_HELPER_STATE:state,OES_RUNS_ROOT:path.join(temp,'runs')},windowsHide:true});
    expect(child.status,child.stdout+child.stderr).toBe(ok?0:1); return JSON.parse(child.stdout);
  };
  try {
    const contract=run("contract",{});expect(contract.assessment_formats.recommended).toBe("oes/assessment/v2");
    const scan=run("scan",{root}), common={root,session_id:scan.session_id};
    bindRules(run,common);
    run("confirm",{...common,user_confirmed:true});const prep=run("prepare",common),a=recorded();
    a.assessment_id=prep.assessment_id; a.input=prep.assessment_input;a.assessor={...prep.assessor_defaults,finished_at:new Date().toISOString()};
    setRuleReferences(a);
    a.components[0].path_prefixes=["notes.js"];
    a.scope_record!.files=a.input.manifest.files.map(f=>({path:f.path,membership:"included",reason:"Notes implementation",confirmation_ref:"scope-confirmed",evidence_refs:[]}));
    a.evidence[0]={...a.evidence[0],file_path:"notes.js",line_start:5,line_end:14};
    a.evidence[1]={...a.evidence[1],file_path:"notes.js",line_start:16,line_end:21};
    const args={...common,snapshot_id:prep.snapshot_id,assessment:JSON.stringify(a)};
    const broken=structuredClone(a);broken.judgments![0].evidence_refs=["missing-evidence"];
    const draft=run("draft",{...args,assessment:JSON.stringify(broken)});
    expect(draft.status).toBe("DRAFT_SAVED");expect(draft.validation_errors.some((e:any)=>e.code==="UNRESOLVED_REFERENCE")).toBe(true);
    expect(JSON.parse(await fs.readFile(draft.local_path,"utf8"))).toEqual(broken);expect(draft).not.toHaveProperty("model");
    expect(run("export",args,false).error.code).toBe("ASSESSMENT_VALIDATION_FAILED");
    run("read",{...common,snapshot_id:prep.snapshot_id,file_id:"notes.js"});
    const exported=run("export",args);
    expect(exported.local.records).toMatchObject({format:"RECORDED_V2",analysis_complete:true});
    const saved=JSON.parse(await fs.readFile(exported.local.assessment_path,"utf8"));
    expect(saved.assessment.judgments).toHaveLength(2);expect(saved.submitted_assessment).toEqual(a);
    expect(saved.assessment_hash).toBe(exported.local.assessment_hash);
    const pending=structuredClone(a);pending.judgments![0].status="provisional";pending.judgments![0].unresolved_points=["Review asynchronous completion"];
    const partial=run("export",{...args,assessment:JSON.stringify(pending)});
    expect(partial.local.report.measurement.status).toBe("PARTIAL");expect(partial.local.records.provisional_cfp_subtotal).toBe(3);
    expect(partial.local.assessment_path).not.toBe(exported.local.assessment_path);
    expect(JSON.parse(await fs.readFile(exported.local.assessment_path,"utf8"))).toEqual(saved);
    const remote=await evaluateRemote({model:partial.model,display_currency:"USD"},getLocalProfile());
    expect(remote.report.measurement).toEqual(partial.local.report.measurement);
    expect(remote.report.effort).toEqual(partial.local.report.effort);
    expect(remote.report.reference_usd).toEqual(partial.local.report.reference_usd);
    expect(JSON.stringify(partial.model)).not.toContain("Review asynchronous completion");
    const invalid=structuredClone(pending);invalid.judgments![0].status="unresolved";
    const failed=run("export",{...args,assessment:JSON.stringify(invalid)},false);
    expect(failed.error.details.some((e:any)=>e.code==="UNADOPTED_OR_UNSUPPORTED_JUDGMENT")).toBe(true);
    expect(failed).not.toHaveProperty("model");run("purge",common);expect(await fs.readdir(state)).toEqual([]);
  } finally {await fs.rm(temp,{recursive:true,force:true});}
},30000);
