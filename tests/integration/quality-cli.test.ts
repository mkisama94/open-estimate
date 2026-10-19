import { it,expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { withQuality } from "../fixtures/quality.js";
import { bindRules,setRuleReferences } from "../fixtures/measurement.js";

it("reconciles collector limits to scope rules and reopens immutable runs after session expiry and purge",async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-quality-cli-")),root=path.join(temp,"sample-project"),state=path.join(temp,"state"),runs=path.join(temp,"runs");
  const run=(command:string,input:unknown,ok=true)=>{
    const child=spawnSync(process.execPath,["dist/local/cli.js",command],{input:JSON.stringify(input),encoding:"utf8",windowsHide:true,
      env:{...process.env,OES_HELPER_STATE:state,OES_RUNS_ROOT:runs}});
    expect(child.status,child.stdout+child.stderr).toBe(ok?0:1);return JSON.parse(child.stdout);
  };
  try {
    await fs.mkdir(path.join(root,"generated"),{recursive:true});
    await fs.copyFile("examples/quality-check/notes.js",path.join(root,"notes.js"));
    await fs.writeFile(path.join(root,"generated/big.js"),"x".repeat(2*1024*1024+1));
    await fs.writeFile(path.join(root,".env"),"CANARY=secret-do-not-read");
    const scan=run("scan",{root}),common={root,session_id:scan.session_id};bindRules(run,common);run("confirm",{...common,user_confirmed:true});
    const prep=run("prepare",common),a=withQuality();a.assessment_id=prep.assessment_id;a.input=prep.assessment_input;
    a.assessor={...prep.assessor_defaults,finished_at:new Date().toISOString()};setRuleReferences(a);
    a.components[0].path_prefixes=["notes.js"];
    a.scope_record!.files=a.input.manifest.files.map(f=>({path:f.path,membership:f.path==="notes.js"?"included":"outside",reason:"Explicit application/build boundary",confirmation_ref:"scope-confirmed",evidence_refs:[]}));
    a.evidence[0]={...a.evidence[0],file_path:"notes.js",line_start:5,line_end:14};a.evidence[1]={...a.evidence[1],file_path:"notes.js",line_start:16,line_end:21};
    a.quality!.scope_rules.push({rule_id:"generated",path_prefix:"generated",membership:"outside",reason:"Generated build output"},{rule_id:"secrets",path_prefix:".env",membership:"outside",reason:"Secret configuration excluded from reading"});
    const args={...common,snapshot_id:prep.snapshot_id,assessment:a};run("read",{...common,snapshot_id:prep.snapshot_id,file_id:"notes.js"});
    expect(run("export",args,false).error.details.some((e:any)=>e.code==="LIMITATION_REQUIRED")).toBe(true);
    a.quality!.limitations=a.input.acquisition!.issues.map(i=>({...i,impact:"outside",rule_id:i.path===".env"?"secrets":"generated",reason:"Acquisition restriction outside explicit declared scope",missing:null}));
    const first=run("export",args),second=run("export",args);
    expect(first.local.records).toMatchObject({scan_complete:false,analysis_complete:true});expect(first.local.report.measurement.status).toBe("COMPLETE");
    expect(first.local.run_id).not.toBe(second.local.run_id);
    const stateFile=path.join(state,scan.session_id+".json"),saved=JSON.parse(await fs.readFile(stateFile,"utf8"));saved.created=0;await fs.writeFile(stateFile,JSON.stringify(saved));
    expect(run("show-run",{run_id:first.local.run_id}).metadata.run_id).toBe(first.local.run_id);
    run("purge",{session_id:scan.session_id});expect(await fs.readdir(state)).toEqual([]);
    expect(run("show-run",{run_id:first.local.run_id}).summary.measurement.cfp).toBe(6);
    expect(JSON.stringify(first.model)).not.toContain("notes.js");expect(JSON.stringify(first.model)).not.toContain("secret-do-not-read");
  } finally {await fs.rm(temp,{recursive:true,force:true});}
},30000);
