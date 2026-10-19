import { targetExists, targetKey } from "../core/records.js";
import { measureAssessment } from "../core/measure.js";
import type { Assessment, TargetRef } from "../core/types.js";
import { appendOperation, readRun } from "./runs.js";
import { assessmentIdentity, executionRecord, identity } from "./comparison-identity.js";

const causes = ["code","scope","evidence","interpretation","tool_rules","unknown"];
export interface Mapping {
  kind: "add" | "delete" | "merge" | "split" | "retained" | "unmatched";
  before: TargetRef[]; after: TargetRef[]; reason: string; causes: string[];
}
const cardinality = (m: Mapping) => {
  const n=m.before.length,k=m.after.length;
  return m.kind === "add" ? n===0 && k>0 : m.kind === "delete" ? n>0 && k===0
    : m.kind === "merge" ? n>1 && k===1 : m.kind === "split" ? n===1 && k>1
    : m.kind === "retained" ? n===1 && k===1 : m.kind === "unmatched" && n+k>0;
};
function mappings(before: Assessment, after: Assessment, rows: Mapping[], kind: "process" | "movement") {
  if (!Array.isArray(rows)) throw new Error("COMPARISON_MAPPING_REQUIRED");
  const usedBefore=new Set<string>(),usedAfter=new Set<string>();
  const all = (a: Assessment): TargetRef[] => kind === "process" ? a.functional_processes.map(p=>({kind:"process",id:p.process_id,process_id:null}))
    : a.functional_processes.flatMap(p=>p.movements.map(m=>({kind:"movement",id:m.movement_id,process_id:p.process_id})));
  const value = (a: Assessment, items: TargetRef[]) => items.reduce((sum,t) => {
    const p=a.functional_processes.find(p=>p.process_id===(kind === "process" ? t.id : t.process_id))!;
    return sum+(p.status === "accepted" ? kind === "process" ? p.movements.length : 1 : 0);
  },0);
  const changes = rows.map(m=>{
    if (!m || !Array.isArray(m.before) || !Array.isArray(m.after) || !cardinality(m) || !m.reason?.trim()
      || !Array.isArray(m.causes) || !m.causes.length || m.causes.some(c=>!causes.includes(c))) throw new Error("INVALID_COMPARISON_MAPPING");
    for (const [model,items,used] of [[before,m.before,usedBefore],[after,m.after,usedAfter]] as const) for (const t of items) {
      if (!t || t.kind !== kind || !targetExists(model,t)) throw new Error("INVALID_COMPARISON_REFERENCE");
      const key=targetKey(t); if (used.has(key)) throw new Error("DUPLICATE_COMPARISON_MAPPING"); used.add(key);
    }
    const beforeCfp=value(before,m.before),afterCfp=value(after,m.after);
    const decisions = (a: Assessment, refs: TargetRef[]) => (a.judgments??[]).filter(j=>j.targets.some(t=>refs.some(ref=>targetKey(t)===targetKey(ref)
      || (ref.kind === "process" && t.kind === "movement" && t.process_id===ref.id))));
    return {...m,before_cfp:beforeCfp,after_cfp:afterCfp,cfp_delta:m.kind === "unmatched" ? null : afterCfp-beforeCfp,
      before_judgments:decisions(before,m.before),after_judgments:decisions(after,m.after)};
  });
  const unmapped_before=all(before).filter(t=>!usedBefore.has(targetKey(t))),unmapped_after=all(after).filter(t=>!usedAfter.has(targetKey(t)));
  const explained=changes.reduce((sum,m)=>sum+(m.cfp_delta??0),0);
  const positives=changes.reduce((sum,m)=>sum+Math.max(0,m.cfp_delta??0),0),negatives=changes.reduce((sum,m)=>sum+Math.min(0,m.cfp_delta??0),0);
  return {changes,unmapped_before,unmapped_after,explained_cfp_delta:explained,positive_cfp_delta:positives,negative_cfp_delta:negatives,
    cancelled_cfp:Math.min(positives,-negatives),counts:Object.fromEntries(["add","delete","merge","split","retained","unmatched"].map(k=>[k,changes.filter(m=>m.kind===k).length]))};
}
export async function compareRuns(args: any) {
  const before=await readRun(args.before_run_id),after=await readRun(args.after_run_id);
  if (typeof args.prior_information_consulted !== "boolean") throw new Error("COMPARISON_INDEPENDENCE_DISCLOSURE_REQUIRED");
  const process=mappings(before.assessment,after.assessment,args.process_changes,"process"),movement=mappings(before.assessment,after.assessment,args.movement_changes,"movement");
  const b=measureAssessment(before.assessment).cfp,a=measureAssessment(after.assessment).cfp;
  const delta=b===null || a===null ? null : a-b;
  if (delta !== null && !process.unmapped_before.length && !process.unmapped_after.length && !process.changes.some(x=>x.kind==="unmatched") && process.explained_cfp_delta !== delta) throw new Error("COMPARISON_DELTA_MISMATCH");
  if (delta !== null && !movement.unmapped_before.length && !movement.unmapped_after.length && !movement.changes.some(x=>x.kind==="unmatched") && movement.explained_cfp_delta !== delta) throw new Error("COMPARISON_DELTA_MISMATCH");
  const transitions=args.judgment_transitions??[];
  if (!Array.isArray(transitions)) throw new Error("INVALID_JUDGMENT_TRANSITIONS");
  const seen=new Set<string>();
  for (const t of transitions) {
    if (!t || !["resolved","continued","new","merged","not_counted","unmatched"].includes(t.state) || !t.reason?.trim() || !Array.isArray(t.before) || !Array.isArray(t.after)) throw new Error("INVALID_JUDGMENT_TRANSITIONS");
    if (!t.before.length && !t.after.length) throw new Error("INVALID_JUDGMENT_TRANSITIONS");
    for (const [run,ids,side] of [[before,t.before,"before"],[after,t.after,"after"]] as const) for (const id of ids) {
      if (!run.assessment.judgments?.some(j=>j.judgment_id===id)) throw new Error("INVALID_COMPARISON_REFERENCE");
      const k=side+":"+id;if(seen.has(k))throw new Error("DUPLICATE_COMPARISON_MAPPING");seen.add(k);
    }
    const previous=before.assessment.judgments?.filter(j=>t.before.includes(j.judgment_id))??[],current=after.assessment.judgments?.filter(j=>t.after.includes(j.judgment_id))??[];
    if ((t.state==="new" && (previous.length || !current.length)) || (t.state==="resolved" && (!previous.some(j=>j.status!=="recorded") || !current.length || current.some(j=>j.status!=="recorded")))
      || (t.state==="continued" && (!previous.some(j=>j.status!=="recorded") || !current.some(j=>j.status!=="recorded")))
      || (t.state==="merged" && !current.some(j=>j.kind==="merge")) || (t.state==="not_counted" && !current.some(j=>j.kind==="not_counted"))) throw new Error("JUDGMENT_TRANSITION_CONFLICT");
  }
  const pending=(run: typeof before, side: string)=>(run.assessment.judgments??[]).filter(j=>j.status!=="recorded" && !seen.has(side+":"+j.judgment_id)).map(j=>j.judgment_id);
  const summary={format:"oes/run-comparison/v2",before:{run_id:args.before_run_id,assessment_hash:before.metadata.assessment_hash,checksums_hash:before.checksums_hash},
    after:{run_id:args.after_run_id,assessment_hash:after.metadata.assessment_hash,checksums_hash:after.checksums_hash},
    identity:[...assessmentIdentity(before.assessment,after.assessment),identity("commit",before.assessment.input.commit,after.assessment.input.commit),
      identity("skill",before.metadata.skill,after.metadata.skill),identity("helper",before.metadata.helper,after.metadata.helper),
      identity("rules",before.metadata.rules_context?.ruleset_ref,after.metadata.rules_context?.ruleset_ref)],
    execution_records:{before:executionRecord(before.assessment),after:executionRecord(after.assessment)},
    before_cfp:b,after_cfp:a,cfp_delta:delta,process,movement,unexplained_cfp_delta:delta===null?null:delta-movement.explained_cfp_delta,
    judgment_transitions:transitions,unmapped_pending_before:pending(before,"before"),unmapped_pending_after:pending(after,"after"),
    prior_information_consulted:args.prior_information_consulted,independence:"NOT_VERIFIABLE",proposal_source:args.proposal_source??"unknown",
    notice:"Explicit correspondence proposal, not identity inferred from IDs/order. Offset changes and unmapped items remain visible; multiple causes do not establish a single cause."};
  return {...await appendOperation(args.after_run_id,"comparison",summary),summary};
}
