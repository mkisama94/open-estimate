import path from "node:path";
import os from "node:os";
import type { AssessmentInput, SourceManifest } from "../core/types.js";

export interface SnapshotResult {
  acquisition?: NonNullable<AssessmentInput["acquisition"]>;
  acquisition_record?: unknown;
  analysis_ready?: boolean;
  snapshot_id: string;
  manifest: SourceManifest;
  manifest_hash: string;
  analysis_complete: boolean;
  total_files: number;
  analyzed_candidates: number;
  excluded_files: number;
  total_bytes: number;
  cache_dir: string;
  source_identity: Pick<AssessmentInput, "repository_label" | "snapshot_type" | "commit" | "dirty" | "source_binding">;
}

/**
 * Calculates line count strictly according to OES Ph1 spec:
 * "UTF-8 decode, count LF. If not ending in LF and not empty, add 1. Empty file is 0."
 */
export function calculateLineCount(content: Buffer): number {
  if (content.length === 0) {
    return 0;
  }
  const text = content.toString("utf8");
  if (text.length === 0) {
    return 0;
  }

  let lfs = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      lfs++;
    }
  }

  if (text.charCodeAt(text.length - 1) !== 0x0a) {
    lfs++;
  }
  return lfs;
}

export function getCacheRoot(): string {
  const envCache = process.env.OES_CACHE_ROOT;
  if (envCache && envCache.trim() !== "") {
    return path.resolve(envCache);
  }
  return path.join(os.tmpdir(), "open-estimate-snapshots");
}

export { acquireRepository as createRepositorySnapshot } from "./acquire.js";
