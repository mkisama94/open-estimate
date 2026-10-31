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

  constructor(manifest: SourceManifest, private readonly snapshotComplete = true) {
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
    if(endLine<startLine)return;
    const merged:Array<{start:number;end:number}>=[];
    for(const range of [...record.readRanges,{start:startLine,end:endLine}].sort((a,b)=>a.start-b.start)){
      const last=merged.at(-1);if(last&&range.start<=last.end+1)last.end=Math.max(last.end,range.end);else merged.push({...range});
    }
    record.readRanges=merged;
  }

  public exportReads(): FileCoverageRecord[] {
    return structuredClone([...this.files.values()]);
  }

  public restoreReads(records: FileCoverageRecord[]): void {
    for (const record of records) {
      const file = this.files.get(record.path);
      if (!file || file.totalLines !== record.totalLines) throw new Error("INVALID_READ_LEDGER");
      for (const range of record.readRanges) {
        if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 1
          || range.end > file.totalLines || range.end < range.start - 1) throw new Error("INVALID_READ_LEDGER");
        this.recordRead(record.path, range.start, range.end);
      }
    }
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
  public reconcileInput(submittedInput: AssessmentInput, scoped = false): { reconciledInput: AssessmentInput; wasReconciled: boolean } {
    let changed = false;
    const submitted = new Map(submittedInput.manifest.files.map(f => [f.path, f]));
    if (submitted.size !== this.originalManifest.files.length || submitted.size !== submittedInput.manifest.files.length)
      throw new Error("SNAPSHOT_MANIFEST_MISMATCH");
    const reconciledFiles: ManifestFileEntry[] = this.originalManifest.files.map(file => {
      const claim = submitted.get(file.path);
      if (!claim || claim.sha256 !== file.sha256 || claim.bytes !== file.bytes || claim.line_count !== file.line_count)
        throw new Error("SNAPSHOT_MANIFEST_MISMATCH");
      if (file.disposition === "excluded") return file;
      const actualDisp = this.getDisposition(file.path);
      if (actualDisp !== claim.disposition || claim.exclusion_reason !== file.exclusion_reason) {
        changed = true;
        return {
          ...file,
          disposition: actualDisp
        };
      }
      return { ...file, disposition: actualDisp };
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
    // v2 records acquisition here; declared-scope completion is derived by recordState.
    const analysisComplete = scoped ? this.snapshotComplete : this.snapshotComplete && submittedInput.analysis_complete && !hasUnread;
    if (analysisComplete !== submittedInput.analysis_complete) changed = true;

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
