import { jcsSha256 } from "./canonical.js";
import type { Assessment } from "./types.js";

function cmpUnicode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeAssessment(assessment: Assessment): { normalized: Assessment; assessment_hash: string } {
  const norm: Assessment = JSON.parse(JSON.stringify(assessment));

  // Sort components
  norm.components.sort((a, b) => cmpUnicode(a.component_id, b.component_id));
  for (const c of norm.components) {
    c.path_prefixes.sort(cmpUnicode);
  }

  // Sort functional_users
  norm.functional_users.sort((a, b) => cmpUnicode(a.user_id, b.user_id));

  // Sort persistent_stores
  norm.persistent_stores.sort((a, b) => cmpUnicode(a.store_id, b.store_id));

  // Sort objects_of_interest
  norm.objects_of_interest.sort((a, b) => cmpUnicode(a.object_of_interest_id, b.object_of_interest_id));

  // Sort data_groups
  norm.data_groups.sort((a, b) => cmpUnicode(a.data_group_id, b.data_group_id));
  for (const dg of norm.data_groups) {
    dg.attributes.sort(cmpUnicode);
  }

  // Sort evidence
  norm.evidence.sort((a, b) => cmpUnicode(a.evidence_id, b.evidence_id));

  // Sort functional_processes and movements
  norm.functional_processes.sort((a, b) => cmpUnicode(a.process_id, b.process_id));
  for (const proc of norm.functional_processes) {
    proc.movements.sort((a, b) => cmpUnicode(a.movement_id, b.movement_id));
    for (const mov of proc.movements) {
      mov.evidence_refs.sort(cmpUnicode);
    }
  }

  // Sort findings
  norm.findings.sort((a, b) => cmpUnicode(a.finding_id, b.finding_id));
  for (const f of norm.findings) {
    f.evidence_refs.sort(cmpUnicode);
  }

  // Sort human_amendments
  norm.human_amendments.sort((a, b) => cmpUnicode(a.amendment_id, b.amendment_id));

  // Sort files in manifest
  norm.input.manifest.files.sort((a, b) => cmpUnicode(a.path, b.path));

  const assessment_hash = jcsSha256(norm);

  return {
    normalized: norm,
    assessment_hash
  };
}
