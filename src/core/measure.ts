import type { Assessment, MeasurementResult, MeasurementStatus } from "./types.js";

export function measureAssessment(assessment: Assessment): MeasurementResult {
  const acceptedProcesses = assessment.functional_processes.filter(p => p.status === "accepted");

  let entry = 0;
  let exit = 0;
  let read = 0;
  let write = 0;

  for (const proc of acceptedProcesses) {
    for (const mov of proc.movements) {
      if (mov.type === "Entry") entry++;
      else if (mov.type === "Exit") exit++;
      else if (mov.type === "Read") read++;
      else if (mov.type === "Write") write++;
    }
  }

  const totalAccepted = acceptedProcesses.length;
  const totalProcesses = assessment.functional_processes.length;

  let status: MeasurementStatus;
  let cfp: number | null = null;

  if (totalAccepted > 0) {
    cfp = entry + exit + read + write;

    const hasImpactExcludedComponent = assessment.components.some(c => c.status === "excluded" && c.scope_impact);
    const hasUnresolvedComponent = assessment.components.some(c => c.status === "unresolved");
    const hasUnresolvedProcess = assessment.functional_processes.some(p => p.status === "unresolved");
    const hasBlockingFinding = assessment.findings.some(f => f.severity === "blocking");
    const isIncompleteAnalysis = !assessment.input.analysis_complete;

    if (hasImpactExcludedComponent || hasUnresolvedComponent || hasUnresolvedProcess || hasBlockingFinding || isIncompleteAnalysis) {
      status = "PARTIAL";
    } else {
      status = "COMPLETE";
    }
  } else {
    // totalAccepted === 0
    cfp = null;
    entry = 0;
    exit = 0;
    read = 0;
    write = 0;

    const hasApplicabilityExclusion = assessment.components.some(
      c => c.status === "excluded" && c.scope_impact && c.reason.toLowerCase().includes("applicability")
    ) || assessment.findings.some(f => f.category === "applicability_limit");

    if (hasApplicabilityExclusion) {
      status = "UNSUPPORTED";
    } else {
      status = "INCOMPLETE";
    }
  }

  return {
    status,
    cfp,
    counts: {
      entry,
      exit,
      read,
      write,
      total_processes: totalProcesses,
      accepted_processes: totalAccepted
    }
  };
}
