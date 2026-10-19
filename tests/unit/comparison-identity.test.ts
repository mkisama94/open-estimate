import { it,expect } from "vitest";
import { withQuality } from "../fixtures/quality.js";
import { assessmentIdentity,executionRecord } from "../../src/local/comparison-identity.js";
import { jcsSha256 } from "../../src/core/canonical.js";

function models() {
  const a=withQuality();
  a.input.manifest.files.push({path:"docs/guide.md",sha256:"a".repeat(64),bytes:10,line_count:1,disposition:"unread",exclusion_reason:null});
  a.scope_record!.files.push({path:"docs/guide.md",membership:"supporting",reason:"Supporting guide",confirmation_ref:"scope-confirmed",evidence_refs:[]});
  a.quality!.scope_rules.push({rule_id:"docs",path_prefix:"docs",membership:"supporting",reason:"Supporting documentation"});
  return [a,structuredClone(a)] as const;
}
const result=(a:ReturnType<typeof withQuality>,b:typeof a,key:string)=>assessmentIdentity(a,b).find(x=>x.key===key)!;

it("separates supporting reads from content identity even when the original manifest hash changes",()=>{
  const [a,b]=models();b.input.manifest.files.find(f=>f.path==="docs/guide.md")!.disposition="supporting";
  a.input.manifest_hash=jcsSha256(a.input.manifest);b.input.manifest_hash=jcsSha256(b.input.manifest);
  expect(a.input.manifest_hash).not.toBe(b.input.manifest_hash);
  expect(result(a,b,"source_content").status).toBe("SAME");expect(result(a,b,"acquisition").status).toBe("DIFFERENT");
  expect(result(a,b,"scope").status).toBe("SAME");
});
it("keeps per-run scope IDs, revision, confirmation actor/time/text and record order out of scope identity",()=>{
  const [a,b]=models();b.scope_record!.scope_id="new-run-scope";b.scope_record!.revision=7;
  b.scope_record!.confirmations=[{confirmation_id:"new-confirmation",actor:"ai",confirmed_at:"2026-10-20T01:00:00Z",statement:"Same targets confirmed on this run"}];
  for(const f of b.scope_record!.files){f.confirmation_ref="new-confirmation";f.reason="Equivalent scope restatement";}
  b.scope_record!.files.reverse();b.quality!.scope_rules.reverse();
  b.quality!.scope_rules[0].rule_id="new-rule-id";b.quality!.scope_rules[0].reason="Equivalent scope explanation";
  b.input.manifest.files.reverse();
  expect(result(a,b,"scope").status).toBe("SAME");expect(result(a,b,"source_content").status).toBe("SAME");
  expect(executionRecord(a).scope_record).not.toEqual(executionRecord(b).scope_record);
});
it.each(["membership","boundary","rules","exclusion"])("detects actual %s scope changes without declaring a code change",kind=>{
  const [a,b]=models();
  if(kind==="membership")b.scope_record!.files[0].membership="outside";
  if(kind==="boundary")b.scope.description="A different application boundary";
  if(kind==="rules")b.quality!.scope_rules[0].path_prefix="different-area";
  if(kind==="exclusion")b.components[0].scope_impact=true;
  expect(result(a,b,"scope").status).toBe("DIFFERENT");expect(result(a,b,"source_content").status).toBe("SAME");
});
it.each(["hash","path"])("detects acquired source %s changes separately from acquisition and scope",kind=>{
  const [a,b]=models();if(kind==="hash")b.input.manifest.files[0].sha256="b".repeat(64);else b.input.manifest.files[0].path="renamed.js";
  expect(result(a,b,"source_content").status).toBe("DIFFERENT");
});
it.each(["both_zero","one_zero","missing_discovery"])("never proves content equality using %s",kind=>{
  const [a,b]=models();
  if(kind!=="missing_discovery")b.input.manifest.files[0].sha256="0".repeat(64);
  if(kind==="both_zero")a.input.manifest.files[0].sha256="0".repeat(64);
  if(kind==="missing_discovery")delete b.input.acquisition;
  expect(result(a,b,"source_content").status).toBe("UNKNOWN");
});
it("does not call a missing path a code deletion when discovery was cut short; verified differences remain visible",()=>{
  const [a,b]=models();b.input.acquisition!.discovery_complete=false;b.input.manifest.files.pop();
  expect(result(a,b,"source_content").status).toBe("UNKNOWN");
  b.input.manifest.files[0].sha256="b".repeat(64);expect(result(a,b,"source_content").status).toBe("DIFFERENT");
});
it("does not call a newly listed but unacquired excluded directory a verified content change",()=>{
  const [a,b]=models();b.input.manifest.files.push({path:"node_modules",sha256:"0".repeat(64),bytes:0,line_count:0,disposition:"excluded",exclusion_reason:"Standard directory exclusion"});
  expect(result(a,b,"source_content").status).toBe("UNKNOWN");expect(result(a,b,"acquisition").status).toBe("DIFFERENT");
});
it("compares acquisition limits and evidence additions independently from source and scope",()=>{
  const [a,b]=models();b.input.acquisition!.issues.push({path:"docs/guide.md",cause:"FILE_PERMISSION"});
  b.input.manifest.files.find(f=>f.path==="docs/guide.md")!.exclusion_reason="FILE_PERMISSION";
  b.evidence.push({...b.evidence[0],evidence_id:"additional-evidence",description:"Additional read evidence"});
  expect(result(a,b,"source_content").status).toBe("SAME");expect(result(a,b,"scope").status).toBe("SAME");
  expect(result(a,b,"acquisition").status).toBe("DIFFERENT");expect(result(a,b,"evidence").status).toBe("DIFFERENT");
  delete a.quality;expect(result(a,b,"scope").status).toBe("UNKNOWN");
});
