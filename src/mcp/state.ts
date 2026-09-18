import type { SnapshotResult } from "../collector/snapshot.js";
import { SnapshotCoverageTracker } from "../collector/coverage.js";
import type { Assessment, CalculationContext, Report } from "../core/types.js";

export interface EvaluatedState {
  assessment_id: string;
  normalizedAssessment: Assessment;
  report: Report;
  report_hash: string;
  context: CalculationContext;
}

export class McpLocalState {
  private snapshots: Map<string, { snapshot: SnapshotResult; tracker: SnapshotCoverageTracker }> = new Map();
  private evaluations: Map<string, EvaluatedState> = new Map();

  public registerSnapshot(snapshot: SnapshotResult): void {
    const tracker = new SnapshotCoverageTracker(snapshot.manifest);
    this.snapshots.set(snapshot.snapshot_id, { snapshot, tracker });
  }

  public getSnapshot(snapshot_id: string): { snapshot: SnapshotResult; tracker: SnapshotCoverageTracker } | undefined {
    return this.snapshots.get(snapshot_id);
  }

  public saveEvaluation(evaluation: EvaluatedState): void {
    this.evaluations.set(evaluation.assessment_id, evaluation);
  }

  public getEvaluation(assessment_id: string): EvaluatedState | undefined {
    return this.evaluations.get(assessment_id);
  }
}

export const mcpState = new McpLocalState();
