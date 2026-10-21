import { it,expect,vi } from "vitest";
import { certificateReadiness } from "../../src/web/certificate-readiness.js";
import worker from "../../src/web/worker.js";
function db(n:number) {const bind=vi.fn();const statement={bind(...args:unknown[]){bind(...args);return statement;},first:async()=>({n})};const prepare=vi.fn((sql:string)=>statement);return {database:{prepare},prepare,bind};}
it("reports only allowlisted readiness and keeps issuance disabled",async()=>{
  const f=db(11);const response=await certificateReadiness(f.database as any);
  expect(response.status).toBe(200);expect(await response.json()).toEqual({schema_version:"oes/certificate-readiness/v1",database:"READY",authentication:"NOT_CONNECTED",issuance:"DISABLED",publication:"DISABLED"});
  expect(response.headers.get("Cache-Control")).toBe("no-store");expect(f.prepare.mock.calls[0][0]).toContain("sqlite_master");expect(f.bind.mock.calls[0]).toHaveLength(11);
});
it("fails closed for absent, incomplete or failed databases without leaking diagnostics",async()=>{
  expect((await certificateReadiness()).status).toBe(503);
  expect((await (await certificateReadiness(db(10).database as any)).json()).database).toBe("SCHEMA_INCOMPLETE");
  const result=await certificateReadiness({prepare(){throw Error("PRIVATE_DB_CANARY");}});
  const body=await result.text();expect(result.status).toBe(503);expect(body).toContain("UNAVAILABLE");expect(body).not.toContain("CANARY");
});
it("uses a primary read when D1 sessions are available",async()=>{
  const f=db(11),withSession=vi.fn(()=>f.database);
  expect((await certificateReadiness({...f.database,withSession} as any)).status).toBe(200);expect(withSession).toHaveBeenCalledWith("first-primary");
});
it("default deployment exposes read-only readiness and still refuses publication writes",async()=>{
  const f=db(11),env={ASSETS:{fetch:async()=>new Response("static")},CERTIFICATES_DB:f.database as any};
  const health=await worker.fetch(new Request("https://open-estimate.ai-orchestration.jp/api/v1/certificate-readiness"),env);expect(health.status).toBe(200);
  const write=await worker.fetch(new Request("https://open-estimate.ai-orchestration.jp/api/v1/publications",{method:"POST"}),env);expect(write.status).toBe(403);
});
