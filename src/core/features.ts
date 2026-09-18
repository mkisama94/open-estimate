import { classifyFile } from "../collector/classification.js";
import type { Assessment, AssessmentFeatures } from "./types.js";

export function extractFeatures(assessment: Assessment): AssessmentFeatures {
  const acceptedProcesses = assessment.functional_processes.filter(p => p.status === "accepted");
  const unresolvedProcesses = assessment.functional_processes.filter(p => p.status === "unresolved");

  let entryCount = 0;
  let exitCount = 0;
  let readCount = 0;
  let writeCount = 0;
  let inferredCount = 0;
  const dataGroupIds = new Set<string>();
  const measuredComponentIds = new Set<string>();

  for (const proc of acceptedProcesses) {
    measuredComponentIds.add(proc.component_id);
    for (const mov of proc.movements) {
      if (mov.type === "Entry") entryCount++;
      else if (mov.type === "Exit") exitCount++;
      else if (mov.type === "Read") readCount++;
      else if (mov.type === "Write") writeCount++;

      if (proc.inferred) inferredCount++;
      dataGroupIds.add(mov.data_group_id);
    }
  }

  const excludedComponentCount = assessment.components.filter(
    c => c.status === "excluded" && c.scope_impact
  ).length;

  let sourceLineCount = 0;
  const languageSet = new Set<string>();

  for (const file of assessment.input.manifest.files) {
    if (file.disposition !== "excluded") {
      const cls = classifyFile(file.path);
      if (cls.category === "source") {
        sourceLineCount += file.line_count;
        if (cls.language) {
          languageSet.add(cls.language.toLowerCase());
        }
      }
    }
  }

  const languages = Array.from(languageSet).sort();

  return {
    entry_count: entryCount,
    exit_count: exitCount,
    read_count: readCount,
    write_count: writeCount,
    process_count: acceptedProcesses.length,
    data_group_count: dataGroupIds.size,
    inferred_movement_count: inferredCount,
    unresolved_process_count: unresolvedProcesses.length,
    measured_component_count: measuredComponentIds.size,
    excluded_component_count: excludedComponentCount,
    source_line_count: sourceLineCount,
    languages
  };
}
