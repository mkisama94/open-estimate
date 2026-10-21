import type { D1Statement } from "./certificate-repository.js";
export interface ReadinessDatabase {prepare(sql:string):D1Statement;withSession?(constraint:string):ReadinessDatabase}
const requiredTables=["issuance_policy","signing_keys","certificate_previews","approval_receipts","certificates","publications","publication_contents","issuance_receipts","audit_events","operation_guards","web_approval_grants"];
/** Read-only, public operational state. No IDs, owners, contents, keys or exception text. */
export async function certificateReadiness(database?:ReadinessDatabase) {
  let state:"READY"|"NOT_CONFIGURED"|"SCHEMA_INCOMPLETE"|"UNAVAILABLE"="NOT_CONFIGURED";
  if(database)try {
    const primary=database.withSession?.("first-primary")??database;
    const row=await primary.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN (${requiredTables.map(()=>"?").join(",")})`).bind(...requiredTables).first<{n:number}>();
    state=row?.n===requiredTables.length?"READY":"SCHEMA_INCOMPLETE";
  } catch {state="UNAVAILABLE";}
  return new Response(JSON.stringify({schema_version:"oes/certificate-readiness/v1",database:state,authentication:"NOT_CONNECTED",issuance:"DISABLED",publication:"DISABLED"}),{
    status:state==="READY"?200:503,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex"}
  });
}
