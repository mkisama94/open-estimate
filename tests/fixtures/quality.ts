import { recorded } from "./recorded.js";
import type { Assessment } from "../../src/core/types.js";
export function withQuality(a: Assessment = recorded()): Assessment {
  a.input.acquisition={discovery_complete:true,issues:[]};
  a.quality={version:"oes/quality-records/v1",scope_rules:[{rule_id:"application",path_prefix:".",membership:"included",reason:"Declared application implementation"}],limitations:[],
    boundaries:a.functional_processes.map(p=>({process_id:p.process_id,rerun:"no",rerun_basis:"Request finishes at HTTP response",continuation:"no",continuation_reason:"Independent user request",queues:[]})),
    attributes:a.data_groups.map(g=>({data_group_id:g.data_group_id,mappings:g.attributes.map(attribute=>({attribute,implementation:`notes.${attribute}`,evidence_refs:["ev-1"]}))})),
    findings:a.findings.map(f=>({finding_id:f.finding_id,subject:"implementation"}))};
  return a;
}
