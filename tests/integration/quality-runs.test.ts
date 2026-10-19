import { it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { withQuality } from "../fixtures/quality.js";
import { target } from "../fixtures/recorded.js";
import { saveRun, readRun, showRun, saveRemoteOperation, appendOperation } from "../../src/local/runs.js";
import { compareRuns } from "../../src/local/compare.js";
import { evaluateRemote } from "../fixtures/skill-policy.js";
import { projectModel } from "../../src/remote/model.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { jcsSha256 } from "../../src/core/canonical.js";

vi.mock("node:crypto",async()=>{
  const actual=await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {...actual,randomUUID:vi.fn(actual.randomUUID)};
});

it("preserves distinct runs, verified artifacts, responses and FX history outside session lifetime",async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-run-test-"));vi.stubEnv("OES_RUNS_ROOT",path.join(temp,"runs"));
  try {
    const a=withQuality(),context={ruleset_ref:{revision:"test"},bundle:{instructions_markdown:"fixture"}};
    const first=await saveRun(a,a,context,path.join(temp,"target")),second=await saveRun(a,a,context,path.join(temp,"target"));
    expect(first.run_id).not.toBe(second.run_id);expect(first.assessment_hash).toBe(second.assessment_hash);
    const before=await fs.readFile(first.assessment_path,"utf8");
    vi.mocked(randomUUID).mockReturnValueOnce(first.run_id as ReturnType<typeof randomUUID>);
    await expect(saveRun(a,a,context,path.join(temp,"target"))).rejects.toMatchObject({code:"EEXIST"});
    expect(await fs.readFile(first.assessment_path,"utf8")).toBe(before);
    const remote=await evaluateRemote({model:projectModel(a),display_currency:"USD"},getLocalProfile());
    const submitted=await saveRemoteOperation(first.run_id,{status:"SUCCESS",response:remote});
    const operation=JSON.parse(await fs.readFile(submitted.operation_path,"utf8"));
    expect(operation.payload.reconciliation).toMatchObject({measurement_matches:true,effort_matches:true,reference_usd_matches:true});
    const altered=structuredClone(remote);altered.report.measurement.cfp=999;
    const mismatch=await saveRemoteOperation(first.run_id,{status:"SUCCESS",response:altered,kind:"display"});
    expect(JSON.parse(await fs.readFile(mismatch.operation_path,"utf8")).payload.reconciliation.measurement_matches).toBe(false);
    const failed=await saveRemoteOperation(first.run_id,{status:"FAILED",error:"Network unavailable"});
    expect(submitted.operation_id).not.toBe(failed.operation_id);expect(await fs.readFile(first.assessment_path,"utf8")).toBe(before);
    expect((await readRun(first.run_id)).summary.execution.remote).toBe("NOT_SENT"); // immutable initial observation
    const history=await showRun(first.run_id);expect(history.execution_history).toHaveLength(3);
    expect(history.execution_history.map(x=>x.status).sort()).toEqual(["FAILED","SUCCESS","SUCCESS"]);
    const completeBefore=await fs.readFile(path.join(first.run_directory,"COMPLETE.json"),"utf8");
    // Inject a write failure: no completed artifact may be returned or replace old data.
    const realWrite=fs.writeFile.bind(fs),spy=vi.spyOn(fs,"writeFile").mockImplementation(async(...args:Parameters<typeof fs.writeFile>)=>{
      if(String(args[0]).endsWith("manifest.json")) throw new Error("disk full");return realWrite(...args);
    });
    await expect(saveRun(a,a,context,path.join(temp,"target"))).rejects.toThrow("disk full");spy.mockRestore();
    const dirs=await fs.readdir(path.join(temp,"runs"));expect(dirs.length).toBe(3);
    const incomplete=dirs.find(x=>x!==first.run_id&&x!==second.run_id)!;
    await expect(fs.access(path.join(temp,"runs",incomplete,"COMPLETE.json"))).rejects.toThrow();
    await expect(readRun(incomplete)).rejects.toThrow();
    expect(await fs.readFile(path.join(first.run_directory,"COMPLETE.json"),"utf8")).toBe(completeBefore);
    await expect(saveRun(a,a,context,temp)).rejects.toThrow("RUN_DIRECTORY_INSIDE_TARGET");
    await expect(readRun("../escape")).rejects.toThrow("INVALID_RUN_ID");
    await fs.writeFile(first.assessment_path,"{}");await expect(readRun(first.run_id)).rejects.toThrow("RUN_CHECKSUM_MISMATCH");
  } finally {vi.unstubAllEnvs();await fs.rm(temp,{recursive:true,force:true});}
},30000);

it("checks explicit add/delete/merge/split mappings, offsets, pending transitions and incomplete matches",async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-compare-test-"));vi.stubEnv("OES_RUNS_ROOT",path.join(temp,"runs"));
  try {
    const a=withQuality();a.judgments![0].status="provisional";a.judgments![0].unresolved_points=["Retry boundary"];
    const b=withQuality();
    for (const x of [a,b]) {
      x.input.manifest.files.push({path:"docs/guide.md",sha256:"a".repeat(64),bytes:10,line_count:1,disposition:x===a?"unread":"supporting",exclusion_reason:null});
      x.scope_record!.files.push({path:"docs/guide.md",membership:"supporting",reason:"Supporting guide",confirmation_ref:"scope-confirmed",evidence_refs:[]});
      x.quality!.scope_rules.push({rule_id:"docs",path_prefix:"docs",membership:"supporting",reason:"Supporting documentation"});
      x.input.manifest_hash=jcsSha256(x.input.manifest);
    }
    b.scope_record!.scope_id="second-run-scope";b.scope_record!.confirmations[0].confirmed_at="2026-10-20T01:00:00Z";
    const first=await saveRun(a,a,{},path.join(temp,"target")),second=await saveRun(b,b,{},path.join(temp,"target"));
    const beforeFile=await fs.readFile(first.assessment_path,"utf8"),afterFile=await fs.readFile(second.assessment_path,"utf8");
    const refs=(x: typeof a)=>x.functional_processes.flatMap(p=>p.movements.map(m=>target("movement",m.movement_id,p.process_id)));
    const br=refs(a),ar=refs(b),proc=(x:typeof a)=>x.functional_processes.map(p=>target("process",p.process_id));
    const row=(kind:string,before:unknown[],after:unknown[])=>({kind,before,after,reason:"Explicit review of request and result evidence",causes:["interpretation","evidence"]});
    const args={before_run_id:first.run_id,after_run_id:second.run_id,prior_information_consulted:true,proposal_source:"AI proposal",
      process_changes:proc(a).map((t,i)=>row("retained",[t],[proc(b)[i]])),
      movement_changes:[row("merge",br.slice(0,2),ar.slice(0,1)),row("split",br.slice(2,3),ar.slice(1,3)),row("delete",br.slice(3,4),[]),row("add",[],ar.slice(3,4)),row("retained",br.slice(4,5),ar.slice(4,5))],
      judgment_transitions:[{before:[a.judgments![0].judgment_id],after:[b.judgments![0].judgment_id],state:"resolved",reason:"Additional code evidence resolves retry"}]};
    const result=await compareRuns(args);
    expect(result.summary.format).toBe("oes/run-comparison/v2");
    expect(result.summary.identity.find(x=>x.key==="source_content")!.status).toBe("SAME");
    expect(result.summary.identity.find(x=>x.key==="scope")!.status).toBe("SAME");
    expect(result.summary.identity.find(x=>x.key==="acquisition")!.status).toBe("DIFFERENT");
    expect(result.summary.execution_records.before.scope_record).not.toEqual(result.summary.execution_records.after.scope_record);
    const history=await showRun(second.run_id);
    expect(history.operations.find(x=>x.operation_id===result.operation_id).payload).toEqual(JSON.parse(JSON.stringify(result.summary)));
    expect(result.summary.movement.counts).toMatchObject({add:1,delete:1,merge:1,split:1});
    expect(result.summary.movement.cancelled_cfp).toBe(2);
    expect(result.summary.movement.unmapped_before).toHaveLength(1);expect(result.summary.independence).toBe("NOT_VERIFIABLE");
    expect(result.summary.unmapped_pending_before).toEqual([]);
    await expect(compareRuns({...args,movement_changes:[...args.movement_changes,args.movement_changes[0]]})).rejects.toThrow("DUPLICATE_COMPARISON_MAPPING");
    await expect(compareRuns({...args,judgment_transitions:[{before:[a.judgments![0].judgment_id],after:[],state:"resolved",reason:"No proof"}]})).rejects.toThrow("JUDGMENT_TRANSITION_CONFLICT");
    await expect(compareRuns({...args,process_changes:[row("retained",[target("process","missing")],[proc(b)[0]])]})).rejects.toThrow("INVALID_COMPARISON_REFERENCE");
    expect(await fs.readFile(first.assessment_path,"utf8")).toBe(beforeFile);expect(await fs.readFile(second.assessment_path,"utf8")).toBe(afterFile);
    // Incomplete operations are not successful histories.
    expect((await appendOperation(second.run_id,"display",{fixture:true})).operation_id).toBeTruthy();
  } finally {vi.unstubAllEnvs();await fs.rm(temp,{recursive:true,force:true});}
},30000);
