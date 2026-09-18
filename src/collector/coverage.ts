import { classifyFile } from "./classification.js";
import { jcsSha256 } from "../core/canonical.js";
import type { AssessmentInput, Disposition, ManifestFileEntry, SourceManifest } from "../core/types.js";

export interface FileCoverageRecord {
  path: string;
  readRanges: Array<{ start: number; end: number }>;
  totalLines: number;
}

export class SnapshotCoverageTracker {
  private files: Map<string, FileCoverageRecord> = new Map();
  private originalManifest: SourceManifest;

  constructor(manifest: SourceManifest) {
    this.originalManifest = JSON.parse(JSON.stringify(manifest));
    for (const file of manifest.files) {
      if (file.disposition !== "excluded") {
        this.files.set(file.path, {
          path: file.path,
          readRanges: [],
          totalLines: file.line_count
        });
      }
    }
  }

  public recordRead(filePath: string, startLine: number, endLine: number): void {
    const record = this.files.get(filePath);
    if (!record) return;
    record.readRanges.push({ start: startLine, end: endLine });
  }

  public getDisposition(filePath: string): Disposition {
    const record = this.files.get(filePath);
    if (!record) {
      const orig = this.originalManifest.files.find(f => f.path === filePath);
      return orig?.disposition || "excluded";
    }

    if (record.totalLines === 0) {
      // Empty file is considered fully read if requested or accessed
      return "analyzed";
    }

    // Determine if all lines from 1 to totalLines are covered
    const ranges = [...record.readRanges].sort((a, b) => a.start - b.start);
    let coveredUpTo = 0;
    for (const r of ranges) {
      if (r.start <= coveredUpTo + 1) {
        coveredUpTo = Math.max(coveredUpTo, r.end);
      }
    }

    const fullyRead = coveredUpTo >= record.totalLines;
    if (!fullyRead) {
      return "unread";
    }

    const classification = classifyFile(filePath);
    if (classification.category === "source") {
      return "analyzed";
    }
    return "supporting";
  }

  /**
   * Reconciles the input manifest with the actual coverage tracking.
   * If reconciled manifest hash differs from submitted, returns reconciled manifest and hash.
   */
  public reconcileInput(submittedInput: AssessmentInput): { reconciledInput: AssessmentInput; wasReconciled: boolean } {
    let changed = false;
    const reconciledFiles: ManifestFileEntry[] = submittedInput.manifest.files.map(file => {
      if (file.disposition === "excluded") {
        return file;
      }
      const actualDisp = this.getDisposition(file.path);
      if (actualDisp !== file.disposition) {
        changed = true;
        return {
          ...file,
          disposition: actualDisp
        };
      }
      return file;
    });

    // Unicode code point order
    reconciledFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const reconciledManifest: SourceManifest = {
      domain: "oes/source-manifest/v1",
      files: reconciledFiles
    };

    const newHash = jcsSha256(reconciledManifest);
    if (newHash !== submittedInput.manifest_hash) {
      changed = true;
    }

    // Determine analysis_complete: true if all non-excluded files are analyzed/supporting
    const hasUnread = reconciledFiles.some(f => f.disposition === "unread");
    const analysisComplete = submittedInput.analysis_complete && !hasUnread;

    const reconciledInput: AssessmentInput = {
      ...submittedInput,
      manifest: reconciledManifest,
      manifest_hash: newHash,
      analysis_complete: analysisComplete
    };

    return {
      reconciledInput,
      wasReconciled: changed
    };
  }
}
