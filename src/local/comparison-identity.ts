import { jcsSha256 } from "../core/canonical.js";
import type { Assessment } from "../core/types.js";

const ordered = <T>(values: T[]) => values.sort((a,b) => {
  const left=JSON.stringify(a),right=JSON.stringify(b);return left<right?-1:left>right?1:0;
});
export const identity = (key: string, before: unknown, after: unknown) => ({key,
  status:before==null || after==null ? "UNKNOWN" : jcsSha256(before)===jcsSha256(after) ? "SAME" : "DIFFERENT",
  before:before??null,after:after??null});
const content = (a: Assessment) => ordered(a.input.manifest.files.map(f=>({path:f.path,
  sha256:/^[a-f0-9]{64}$/.test(f.sha256) && f.sha256!=="0".repeat(64) ? f.sha256 : null})));
const acquired = (a: Assessment) => ({scan_complete:a.input.analysis_complete,
  discovery_complete:a.input.acquisition?.discovery_complete??null,
  files:ordered(a.input.manifest.files.map(f=>({path:f.path,disposition:f.disposition,exclusion_reason:f.exclusion_reason}))),
  issues:a.input.acquisition ? ordered(a.input.acquisition.issues.map(i=>({...i}))) : null});
const scope = (a: Assessment) => a.scope_record ? ({boundary:a.scope,
  files:ordered(a.scope_record.files.map(f=>({path:f.path,membership:f.membership}))),
  components:ordered(a.components.map(c=>({path_prefixes:[...c.path_prefixes].sort(),status:c.status,scope_impact:c.scope_impact}))),
  rules:a.quality ? ordered(a.quality.scope_rules.map(r=>({path_prefix:r.path_prefix,membership:r.membership}))) : null}) : null;

/** Compare declared facts separately. Never use coverage-bearing manifest hashes as code identity. */
export function assessmentIdentity(before: Assessment, after: Assessment) {
  const left=content(before),right=content(after),leftMap=new Map(left.map(f=>[f.path,f.sha256])),rightMap=new Map(right.map(f=>[f.path,f.sha256]));
  const common=left.filter(f=>rightMap.has(f.path));
  const changed=common.filter(f=>f.sha256!==null && rightMap.get(f.path)!==null && f.sha256!==rightMap.get(f.path)).map(f=>f.path);
  const onlyBefore=left.filter(f=>!rightMap.has(f.path)).map(f=>f.path),onlyAfter=right.filter(f=>!leftMap.has(f.path)).map(f=>f.path);
  const unknownBefore=left.filter(f=>f.sha256===null).map(f=>f.path),unknownAfter=right.filter(f=>f.sha256===null).map(f=>f.path);
  const discoveryKnown=before.input.acquisition?.discovery_complete===true && after.input.acquisition?.discovery_complete===true;
  const pathsDiffer=onlyBefore.length+onlyAfter.length>0;
  const verifiedPathDifference=pathsDiffer && discoveryKnown && (onlyBefore.some(p=>leftMap.get(p)!==null) || onlyAfter.some(p=>rightMap.get(p)!==null));
  const uncertainDiscovery=!discoveryKnown;
  const sourceStatus=changed.length || verifiedPathDifference ? "DIFFERENT"
    : unknownBefore.length || unknownAfter.length || uncertainDiscovery ? "UNKNOWN" : "SAME";
  const scopeResult=identity("scope",scope(before),scope(after));
  if (!before.quality || !after.quality || (scopeResult.status==="SAME" && (before.scope_record?.files.some(f=>f.membership==="unresolved")
    || after.scope_record?.files.some(f=>f.membership==="unresolved")))) scopeResult.status="UNKNOWN";
  return [
    {key:"source_content",status:sourceStatus,before:left,after:right,changed_paths:changed,
      only_before:onlyBefore,only_after:onlyAfter,unknown_content_before:unknownBefore,unknown_content_after:unknownAfter,
      discovery_status:discoveryKnown?"COMPLETE":"UNKNOWN",
      notice:"Nonzero acquired hashes compare file contents; zero hashes and undiscovered regions never establish content equality."},
    identity("acquisition",acquired(before),acquired(after)),scopeResult,
    identity("evidence",ordered(before.evidence.map(e=>({...e}))),ordered(after.evidence.map(e=>({...e}))))
  ];
}

export function executionRecord(a: Assessment) {
  return {assessment_id:a.assessment_id,started_at:a.assessor.started_at,finished_at:a.assessor.finished_at,
    manifest_hash:a.input.manifest_hash,scope_record:a.scope_record??null,
    scope_rules:a.quality?.scope_rules??null,
    notice:"Original scope IDs, revision, confirmations, timestamps and annotations are execution history, not code-change evidence."};
}
