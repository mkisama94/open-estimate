import { it,expect,vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { withQuality } from "../fixtures/quality.js";
import { validateAssessment } from "../../src/core/validate.js";
import { saveRun,readRun } from "../../src/local/runs.js";
import { preparePublicResult,readPublicResultCandidate,publicCandidatesRoot } from "../../src/local/public-result.js";
import { publicCandidateHash,validatePublicResult,publicResultCandidateSchema } from "../../src/core/public-result.js";
import { jcsSha256,sha256Hex } from "../../src/core/canonical.js";
import * as profileModule from "../../src/profiles/local-profile.js";
import { Ajv2020 } from "ajv/dist/2020.js";

vi.mock("node:crypto",async()=>{const actual=await vi.importActual<typeof import("node:crypto")>("node:crypto");return {...actual,randomUUID:vi.fn(actual.randomUUID)};});
const canary="PRIVATE_CANARY_713c9";
function privateAssessment() {
  const a=withQuality(),privateValues=new Set([a.assessment_id,a.scope_record!.scope_id,...a.scope_record!.confirmations.map(c=>c.confirmation_id),
    ...a.components.map(c=>c.component_id),...a.functional_users.map(u=>u.user_id),...a.persistent_stores.map(s=>s.store_id),...a.objects_of_interest.map(o=>o.object_of_interest_id),
    ...a.data_groups.map(g=>g.data_group_id),...a.evidence.map(e=>e.evidence_id),...a.functional_processes.flatMap(p=>[p.process_id,...p.movements.map(m=>m.movement_id)]),
    ...a.function_candidates!.map(c=>c.candidate_id),...a.judgments!.map(j=>j.judgment_id)]);
  const paths=new Set(a.input.manifest.files.map(f=>f.path));
  const visit=(v:any,key=""):any=>{
    if(Array.isArray(v))return v.map(x=>visit(x,key));
    if(v && typeof v==="object")return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x,k)]));
    if(typeof v!=="string")return v;
    if(privateValues.has(v))return canary+"-"+v;
    if(paths.has(v))return path.posix.dirname(v)+"/"+canary+"-"+path.posix.basename(v);
    if(["name","description","symbol","statement","reason","application_reason","interpretation","attribute_mapping","unresolved_points"].includes(key))return canary;
    return v;
  };
  const result=visit(a);result.judgments[0].status="provisional";result.judgments[0].unresolved_points=[canary];
  return validateAssessment(result);
}
async function inventory(dir:string):Promise<unknown> {
  const rows=[];
  for(const name of (await fs.readdir(dir)).sort()){
    const file=path.join(dir,name),stat=await fs.lstat(file);
    rows.push({name,content:stat.isDirectory()?await inventory(file):sha256Hex(await fs.readFile(file))});
  }
  return rows;
}
async function editSummary(dir:string,edit:(s:any)=>void,repair=true) {
  const file=path.join(dir,"summary.json"),summary=JSON.parse(await fs.readFile(file,"utf8"));edit(summary);await fs.writeFile(file,JSON.stringify(summary));
  if(repair){
    const sums=JSON.parse(await fs.readFile(path.join(dir,"checksums.json"),"utf8"));
    sums.find((x:any)=>x.path==="summary.json").sha256=sha256Hex(await fs.readFile(file));await fs.writeFile(path.join(dir,"checksums.json"),JSON.stringify(sums));
    const marker=JSON.parse(await fs.readFile(path.join(dir,"COMPLETE.json"),"utf8"));marker.checksums_sha256=jcsSha256(sums);await fs.writeFile(path.join(dir,"COMPLETE.json"),JSON.stringify(marker));
  }
}

it("P01/P05/P09/P10/P11 real CLI saves and reopens deterministic candidates, with private receipts, no source mutation or network",async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-public-cli-"));vi.stubEnv("OES_RUNS_ROOT",path.join(temp,"runs"));
  try {
    const a=privateAssessment(),run=await saveRun(a,a,{},path.join(temp,"sample-project")),original=await inventory(run.run_directory);
    const counter=path.join(temp,"network.jsonl"),guard=path.join(temp,"guard.mjs");
    await fs.writeFile(guard,`import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import net from 'node:net';import {syncBuiltinESMExports} from 'node:module';
let count=0;const deny=()=>{count++;throw Error('NETWORK_DISABLED');};globalThis.fetch=deny;http.request=deny;http.get=deny;https.request=deny;https.get=deny;net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;syncBuiltinESMExports();process.on('exit',()=>fs.appendFileSync(${JSON.stringify(counter)},JSON.stringify({count})+'\\n'));`);
    const cli=(input:unknown,ok=true)=>{
      const child=spawnSync(process.execPath,["--import",pathToFileURL(guard).href,"dist/local/cli.js","prepare-public-result"],{input:JSON.stringify(input),encoding:"utf8",windowsHide:true,env:{...process.env,OES_RUNS_ROOT:path.join(temp,"runs")}});
      expect(child.status,child.stdout+child.stderr).toBe(ok?0:1);return {out:JSON.parse(child.stdout),text:child.stdout+child.stderr};
    };
    const one=cli({run_id:run.run_id}).out,two=cli({run_id:run.run_id}).out;
    expect(one).toMatchObject({status:"LOCAL_CANDIDATE_READY",transmitted:false,published:false});expect(one.candidate_hash).toBe(two.candidate_hash);
    expect(one.candidate_path).not.toBe(two.candidate_path);
    const c1=JSON.parse(await fs.readFile(one.candidate_path,"utf8")),c2=JSON.parse(await fs.readFile(two.candidate_path,"utf8"));
    expect(c1).toEqual(c2);expect(new Ajv2020({strict:true}).compile(publicResultCandidateSchema)(c1)).toBe(true);
    expect(validatePublicResult(c1).measurement).toEqual(run.summary.measurement);expect(publicCandidateHash(c1)).toBe(one.candidate_hash);
    expect(JSON.stringify(c1)).not.toContain(canary);expect(JSON.stringify(c1)).not.toContain(run.run_id);
    const receipt1=JSON.parse(await fs.readFile(one.receipt_path,"utf8")),receipt2=JSON.parse(await fs.readFile(two.receipt_path,"utf8"));
    expect(receipt1.run_id).toBe(run.run_id);expect(receipt1.generated_at).not.toBe(receipt2.generated_at);expect(receipt1.candidate_hash).toBe(one.candidate_hash);
    const reopened=await readPublicResultCandidate(path.basename(path.dirname(one.candidate_path)));expect(reopened.candidate).toEqual(c1);
    expect(await inventory(run.run_directory)).toEqual(original);
    const bad=cli({run_id:run.run_id,arbitrary:canary},false);expect(bad.out.error.code).toBe("PUBLIC_SOURCE_UNSUPPORTED");expect(bad.text).not.toContain(canary);
    const invalid=cli({run_id:"../"+canary},false);expect(invalid.out.error.code).toBe("INVALID_RUN_ID");expect(invalid.text).not.toContain(canary);
    const calls=(await fs.readFile(counter,"utf8")).trim().split("\n").map(line=>JSON.parse(line));expect(calls).toHaveLength(4);expect(calls.every(c=>c.count===0)).toBe(true);
    expect(JSON.parse(await fs.readFile("contracts/public-result-candidate.schema.json","utf8"))).toEqual(publicResultCandidateSchema);
  } finally {vi.unstubAllEnvs();await fs.rm(temp,{recursive:true,force:true});}
},30000);

it("P06/P07 rejects checksum corruption, recomputation mismatch, unsupported basis, legacy gaps and unknown limitations with fixed errors",async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-public-errors-"));vi.stubEnv("OES_RUNS_ROOT",path.join(temp,"runs"));
  const cli=(run_id:string)=>{
    const child=spawnSync(process.execPath,["dist/local/cli.js","prepare-public-result"],{input:JSON.stringify({run_id}),encoding:"utf8",windowsHide:true,env:{...process.env,OES_RUNS_ROOT:path.join(temp,"runs")}});
    expect(child.status).toBe(1);expect(child.stdout+child.stderr).not.toContain(canary);const out=JSON.parse(child.stdout);expect(Object.keys(out.error)).toEqual(["code"]);return out.error.code;
  };
  try {
    const a=withQuality(),run=await saveRun(a,a,{},path.join(temp,"sample-project"));
    await editSummary(run.run_directory,s=>{s.measurement.cfp=999;},false);expect(cli(run.run_id)).toBe("RUN_CHECKSUM_MISMATCH");
    await editSummary(run.run_directory,()=>{});expect(cli(run.run_id)).toBe("PUBLIC_RESULT_MISMATCH");
    await editSummary(run.run_directory,s=>{s.measurement=run.summary.measurement;s.calculation.basis.engine_version="0.8.0-quality";});expect(cli(run.run_id)).toBe("PUBLIC_BASIS_UNSUPPORTED");
    await editSummary(run.run_directory,s=>{s.calculation.basis.engine_version="0.8.1-quality";s.calculation.basis.wage.id=canary;});expect(cli(run.run_id)).toBe("PUBLIC_BASIS_UNSUPPORTED");
    await editSummary(run.run_directory,s=>{s.calculation.basis=run.summary.calculation.basis;s.calculation.limitation_codes=[canary];});expect(cli(run.run_id)).toBe("PUBLIC_LIMITATION_UNSUPPORTED");
    const old=withQuality();delete old.quality;const legacy=await saveRun(old,old,{},path.join(temp,"sample-project"));expect(cli(legacy.run_id)).toBe("PUBLIC_SOURCE_UNSUPPORTED");
    await expect(fs.access(publicCandidatesRoot())).rejects.toThrow();
    // Actual CLI write failure: an existing file blocks creation of the sibling output directory.
    await editSummary(run.run_directory,s=>{s.calculation.limitation_codes=run.summary.calculation.limitation_codes;});
    await fs.writeFile(publicCandidatesRoot(),canary);
    expect(cli(run.run_id)).toBe("PUBLIC_CANDIDATE_WRITE_FAILED");expect(await fs.readFile(publicCandidatesRoot(),"utf8")).toBe(canary);
  } finally {vi.unstubAllEnvs();await fs.rm(temp,{recursive:true,force:true});}
},30000);

it("P08 uses only saved basis even if latest defaults cannot be loaded",async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-public-basis-"));vi.stubEnv("OES_RUNS_ROOT",path.join(temp,"runs"));
  try {
    const a=withQuality(),run=await saveRun(a,a,{},path.join(temp,"sample-project")),first=await preparePublicResult({run_id:run.run_id});
    const spy=vi.spyOn(profileModule,"getLocalProfile").mockImplementation(()=>{throw new Error(canary);});
    const second=await preparePublicResult({run_id:run.run_id});expect(second.candidate_hash).toBe(first.candidate_hash);expect(spy).not.toHaveBeenCalled();spy.mockRestore();
  } finally {vi.restoreAllMocks();vi.unstubAllEnvs();await fs.rm(temp,{recursive:true,force:true});}
},30000);

it("P11 collisions and write failures preserve prior outputs and never leave a completed new artifact",async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-public-write-"));vi.stubEnv("OES_RUNS_ROOT",path.join(temp,"runs"));
  try {
    const a=withQuality(),run=await saveRun(a,a,{},path.join(temp,"sample-project")),original=await inventory(run.run_directory);
    const first=await preparePublicResult({run_id:run.run_id}),firstDir=path.dirname(first.candidate_path),before=await inventory(firstDir);
    vi.mocked(randomUUID).mockReturnValueOnce(path.basename(firstDir) as ReturnType<typeof randomUUID>);
    await expect(preparePublicResult({run_id:run.run_id})).rejects.toThrow("PUBLIC_CANDIDATE_WRITE_FAILED");expect(await inventory(firstDir)).toEqual(before);
    for(const target of ["local-receipt.json","COMPLETE.json"]){
      const realWrite=fs.writeFile.bind(fs),spy=vi.spyOn(fs,"writeFile").mockImplementation(async(...args:Parameters<typeof fs.writeFile>)=>{
        if(String(args[0]).endsWith(target)){await realWrite(...args);throw new Error(canary);}return realWrite(...args);
      });
      await expect(preparePublicResult({run_id:run.run_id})).rejects.toThrow("PUBLIC_CANDIDATE_WRITE_FAILED");spy.mockRestore();
    }
    const ids=(await fs.readdir(publicCandidatesRoot())).filter(id=>id!==path.basename(firstDir));expect(ids).toHaveLength(2);
    for(const id of ids){await expect(fs.access(path.join(publicCandidatesRoot(),id,"COMPLETE.json"))).rejects.toThrow();await expect(readPublicResultCandidate(id)).rejects.toThrow("PUBLIC_CANDIDATE_INVALID");}
    expect(await inventory(firstDir)).toEqual(before);expect(await inventory(run.run_directory)).toEqual(original);
    await fs.writeFile(first.candidate_path,"{}");await expect(readPublicResultCandidate(path.basename(firstDir))).rejects.toThrow("PUBLIC_CANDIDATE_INVALID");
  } finally {vi.restoreAllMocks();vi.unstubAllEnvs();await fs.rm(temp,{recursive:true,force:true});}
},30000);
