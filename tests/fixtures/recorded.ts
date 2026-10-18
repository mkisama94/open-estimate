import fs from "node:fs";
import type { Assessment, TargetRef } from "../../src/core/types.js";
export const target = (kind: TargetRef["kind"], id: string, process_id: string | null = null): TargetRef => ({ kind,id,process_id });
export function recorded(): Assessment {
  const a: Assessment = JSON.parse(fs.readFileSync("examples/basic-assessment.json","utf8"));
  a.format_version="oes/assessment/v2";
  a.scope_record={ scope_id:"notes", revision:1, confirmations:[{ confirmation_id:"scope-confirmed",actor:"user",statement:"Measure notes service",confirmed_at:"2026-10-18T00:00:00Z" }],
    files:a.input.manifest.files.map(f=>({ path:f.path,membership:"included",reason:"Notes implementation",confirmation_ref:"scope-confirmed",evidence_refs:[] })) };
  a.function_candidates=a.functional_processes.map(p=>({candidate_id:`candidate-${p.process_id}`,name:p.name,role:p.description,component_id:p.component_id,
    disposition:"counted",process_id:p.process_id,merged_into:null,reason:p.decision_reason,evidence_refs:p.movements[0].evidence_refs}));
  a.judgments=a.functional_processes.map(p=>({judgment_id:`judge-${p.process_id}`,targets:[target("candidate",`candidate-${p.process_id}`),target("process",p.process_id),
    ...p.movements.map(m=>target("movement",m.movement_id,p.process_id))],kind:"adopt",interpretation:p.description,
    rule:{source:"project_policy",id:"notes-as-built",version:"1"},application_reason:p.decision_reason,evidence_refs:p.movements[0].evidence_refs,
    status:"recorded",evidence_status:"sufficient",unresolved_points:[],alternatives:[]}));
  for(const p of a.functional_processes)p.boundary={start:p.description,functional_user_id:p.trigger_user_id,goal:p.description,completion:"Response returned after database operation",
    execution_relationship:"Manual API request; no independent async event",grouping_reason:p.decision_reason,evidence_refs:p.movements[0].evidence_refs,judgment_refs:[`judge-${p.process_id}`]};
  for(const g of a.data_groups)g.definition={business_meaning:g.description,identifiers:["id"],no_identifier_reason:null,attribute_mapping:g.attributes.join(", "),grouping_reason:g.description,evidence_refs:["ev-1"],unconfirmed:[]};
  return a;
}
