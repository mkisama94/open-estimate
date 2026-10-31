import { describe,it,expect,vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planAcquisition, LIMITS, normalizeScope } from "../../src/collector/acquisition-plan.js";
import { createRepositorySnapshot } from "../../src/collector/snapshot.js";
import { workspaceContext } from "../../src/collector/workspace-context.js";
import { mcpState } from "../../src/mcp/state.js";
import { handleReadRepositoryFile } from "../../src/mcp/tools/read-repository-file.js";
import { resultCoverage } from "../../src/local/result-coverage.js";

async function fixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"oes-scope-"));
  const put=async(p:string,text="export const value=1;\n")=>{const full=path.join(root,p);await fs.mkdir(path.dirname(full),{recursive:true});await fs.writeFile(full,text);};
  await put("packages/application/src/release/main.ts");await put("packages/common/core.ts");await put("packages/companies/power.ts");await put("tests/release/main.test.ts");
  return {root,put,run:<T>(fn:()=>Promise<T>)=>workspaceContext.run(root,fn)};
}
describe("scope-bound acquisition",()=>{
  it("never reads or copies 85 MiB agreed-out data; retains definitions and all release/common/company sources",async()=>{
    const f=await fixture();await f.put("base-data/definitions/schema.json","{}");await f.put("release/artifact.js");
    await f.put("base-data/raw/data.json","");const handle=await fs.open(path.join(f.root,"base-data/raw/data.json"),"r+");await handle.truncate(85*1024*1024);await handle.close();
    const scope=normalizeScope([{path:"base-data/raw",role:"excluded"},{path:"base-data/definitions",role:"supporting"}]);
    const read=vi.spyOn(fs,"readFile"),open=vi.spyOn(fs,"open");
    try {
      const preflight=await planAcquisition(f.root,scope);
      expect(preflight.files.filter(f=>f.cause === "AGREED_EXCLUSION").reduce((sum,f)=>sum+f.bytes,0)).toBe(85*1024*1024);
      expect(preflight.summary.ready).toBe(true);expect(read).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
      const snapshot=await f.run(()=>createRepositorySnapshot(".",{scope,preflight}));
      expect(snapshot.acquisition?.scope_coverage).toBe("COMPLETE");expect(snapshot.total_bytes).toBeLessThan(1024);
      expect(snapshot.manifest.files.find(x=>x.path==="release/artifact.js")?.exclusion_reason).toBe("POLICY_EXCLUSION");
      expect(snapshot.manifest.files.find(x=>x.path==="tests/release/main.test.ts")?.disposition).toBe("unread");
      for(const p of ["packages/application/src/release/main.ts","packages/common/core.ts","packages/companies/power.ts"]) expect(snapshot.manifest.files.find(x=>x.path===p)?.disposition).toBe("unread");
      expect(open.mock.calls.some(c=>String(c[0]).includes("data.json"))).toBe(false);
      await expect(fs.stat(path.join(snapshot.cache_dir,"files/base-data/raw/data.json"))).rejects.toHaveProperty("code","ENOENT");
      expect(snapshot.acquisition_record).toMatchObject({scope_complete:true,preflight:{scope}});
    } finally {read.mockRestore();open.mockRestore();}
  });
  it("blocks reading incomplete snapshots, permits explicitly requested partial capture, and keeps project total null",async()=>{
    const f=await fixture();await f.put("packages/common/huge.ts","");const h=await fs.open(path.join(f.root,"packages/common/huge.ts"),"r+");await h.truncate(LIMITS.single+1);await h.close();
    const normal=await f.run(()=>createRepositorySnapshot("."));mcpState.registerSnapshot(normal);
    expect(normal.analysis_ready).toBe(false);expect(normal.total_bytes).toBe(0);
    await expect(handleReadRepositoryFile({snapshot_id:normal.snapshot_id,file_id:"packages/common/core.ts"})).rejects.toThrow("ACQUISITION_INCOMPLETE");
    const partial=await f.run(()=>createRepositorySnapshot(".",{partial_authorized:true,previous_snapshot_id:normal.snapshot_id}));
    expect(partial.analysis_ready).toBe(true);expect(partial.total_bytes).toBeGreaterThan(0);
    expect(partial.acquisition_record).toMatchObject({previous_snapshot_id:normal.snapshot_id,scope_complete:false});
    const view=resultCoverage({input:{acquisition:partial.acquisition},judgments:[]} as any,{median:"108"});
    expect(view.project_effort).toBeNull();expect(view.acquired_portion_effort).toEqual({median:"108"});expect(view.effort_label).not.toContain("総工数");
  });
  it("detects stale preflight, missing required paths, and protected-source conflicts",async()=>{
    const f=await fixture(),before=await planAcquisition(f.root);await f.put("packages/common/added.ts");
    const snapshot=await f.run(()=>createRepositorySnapshot(".",{preflight:before}));expect(snapshot.analysis_ready).toBe(false);expect(snapshot.total_bytes).toBe(0);
    expect(snapshot.acquisition?.issues).toContainEqual({path:".",cause:"PREFLIGHT_CHANGED"});
    expect((await planAcquisition(f.root,[{path:"missing",role:"measurement"}])).summary.ready).toBe(false);
    await f.put("node_modules/required.ts");
    const conflict=await planAcquisition(f.root,[{path:"node_modules/required.ts",role:"measurement"}]);
    expect(conflict.summary.issues).toContainEqual({path:"node_modules",cause:"SCOPE_EXCLUSION_CONFLICT"});
    const overridden=await planAcquisition(f.root,[{path:".",role:"measurement"},{path:"node_modules",role:"excluded"}]);
    expect(overridden.summary.issues.some(i=>i.cause === "SCOPE_EXCLUSION_CONFLICT")).toBe(false);
    expect(()=>normalizeScope([{path:"../outside",role:"excluded"}])).toThrow("INVALID_ACQUISITION_SCOPE");
  });
  it("prioritizes measurement sources over supporting data when the combined capacity exceeds the cap",async()=>{
    const f=await fixture();
    // Preserve the capacity boundary while keeping every line readable.
    for(let i=0;i<51;i++) await f.put(`aaa-support/${i}.txt`,("x".repeat(1023)+"\n").repeat(LIMITS.single/1024));
    const scope=normalizeScope([{path:"aaa-support",role:"supporting"}]);
    const snapshot=await f.run(()=>createRepositorySnapshot(".",{scope}));
    expect(snapshot.acquisition?.scope_coverage).toBe("COMPLETE");expect(snapshot.total_bytes).toBeLessThanOrEqual(LIMITS.bytes);
    expect(snapshot.acquisition?.issues.some(i=>i.cause === "CAPACITY_LIMIT")).toBe(true);
    expect(snapshot.manifest.files.find(x=>x.path==="packages/common/core.ts")?.disposition).toBe("unread");
  });
  it("captures a project larger than 100 MiB in bounded batches with one unique merged manifest",async()=>{
    const f=await fixture();
    for(let i=0;i<51;i++) await f.put(`packages/companies/company-${i}.ts`,("x".repeat(1023)+"\n").repeat(LIMITS.single/1024));
    const preflight=await planAcquisition(f.root);expect(preflight.summary.ready).toBe(false);expect(preflight.summary.splittable).toBe(true);
    const snapshot=await f.run(()=>createRepositorySnapshot(".",{preflight,split_acquisition:true}));
    expect(snapshot.analysis_ready).toBe(true);expect(snapshot.acquisition?.scope_coverage).toBe("COMPLETE");
    const record=snapshot.acquisition_record as any;
    expect(record.batches.length).toBe(2);expect(record.batches.every((b:any)=>b.bytes<=LIMITS.bytes)).toBe(true);
    const paths=record.batches.flatMap((b:any)=>b.paths);
    expect(new Set(paths).size).toBe(paths.length);expect(paths.length).toBe(snapshot.analyzed_candidates);
    expect(paths.filter((p:string)=>p==="packages/common/core.ts")).toHaveLength(1);
    expect(record.manifest_hash).toBe(snapshot.manifest_hash);
  });
  it("detects source changes across batches, even when the final size and modification time match",async()=>{
    const f=await fixture();const source=path.join(f.root,"packages/common/core.ts"),stat=await fs.stat(source);
    const original=fs.writeFile.bind(fs);let mutated=false;
    const spy=vi.spyOn(fs,"writeFile").mockImplementation(async(...args:any[])=>{
      const result=await (original as any)(...args);
      if(!mutated&&String(args[0]).includes("files")&&String(args[0]).endsWith("core.ts")){
        mutated=true;await original(source,"z".repeat(stat.size));await fs.utimes(source,stat.atime,stat.mtime);
      }
      return result;
    });
    try {const snapshot=await f.run(()=>createRepositorySnapshot(".",{split_acquisition:true}));expect(snapshot.analysis_ready).toBe(false);expect(snapshot.acquisition?.scope_coverage).toBe("MISSING");expect(snapshot.acquisition?.issues.some(i=>i.cause.includes("SOURCE_CHANGED"))).toBe(true);}
    finally{spy.mockRestore();}
  });
});
