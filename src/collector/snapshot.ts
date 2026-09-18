import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resolveSafePath, getWorkspaceRoot } from "./safe-paths.js";
import { classifyFile } from "./classification.js";
import { sha256Hex, jcsSha256 } from "../core/canonical.js";
import type { ManifestFileEntry, SourceManifest } from "../core/types.js";

const MAX_TOTAL_FILES = 10000;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MiB
const MAX_SINGLE_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB

export interface SnapshotResult {
  snapshot_id: string;
  manifest: SourceManifest;
  manifest_hash: string;
  analysis_complete: boolean;
  total_files: number;
  analyzed_candidates: number;
  excluded_files: number;
  total_bytes: number;
  cache_dir: string;
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
  return path.resolve(getWorkspaceRoot(), ".open-estimate-cache");
}

/**
 * Collects a snapshot from the target directory within the workspace root.
 */
export async function createRepositorySnapshot(targetRelativePath: string = ""): Promise<SnapshotResult> {
  const workspaceRoot = getWorkspaceRoot();
  const targetDir = await resolveSafePath(targetRelativePath, workspaceRoot);

  const snapshot_id = crypto.randomUUID();
  const cacheRoot = getCacheRoot();
  const cacheDir = path.join(cacheRoot, snapshot_id);
  const cacheFilesDir = path.join(cacheDir, "files");

  await fs.mkdir(cacheFilesDir, { recursive: true });

  const entries: ManifestFileEntry[] = [];
  let totalBytes = 0;
  let analysisComplete = true;

  // Recursive walk directory
  async function walk(currentDir: string, relativeDir: string): Promise<void> {
    const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const d of dirEntries) {
      if (entries.length >= MAX_TOTAL_FILES) {
        analysisComplete = false;
        break;
      }

      const relativePath = relativeDir ? `${relativeDir}/${d.name}` : d.name;
      const fullPath = path.join(currentDir, d.name);

      if (d.isSymbolicLink()) {
        // Skip symlinks without following
        entries.push({
          path: relativePath,
          sha256: "0".repeat(64),
          bytes: 0,
          line_count: 0,
          disposition: "excluded",
          exclusion_reason: "Symbolic link ignored"
        });
        continue;
      }

      if (d.isDirectory()) {
        const classification = classifyFile(relativePath + "/dummy");
        if (classification.isExcluded) {
          entries.push({
            path: relativePath,
            sha256: "0".repeat(64),
            bytes: 0,
            line_count: 0,
            disposition: "excluded",
            exclusion_reason: classification.exclusionReason
          });
          continue;
        }
        await walk(fullPath, relativePath);
      } else if (d.isFile()) {
        const classification = classifyFile(relativePath);
        if (classification.isExcluded) {
          entries.push({
            path: relativePath,
            sha256: "0".repeat(64),
            bytes: 0,
            line_count: 0,
            disposition: "excluded",
            exclusion_reason: classification.exclusionReason
          });
          continue;
        }

        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_SINGLE_FILE_BYTES) {
          entries.push({
            path: relativePath,
            sha256: "0".repeat(64),
            bytes: stat.size,
            line_count: 0,
            disposition: "excluded",
            exclusion_reason: `File size ${stat.size} exceeds maximum limit ${MAX_SINGLE_FILE_BYTES} bytes`
          });
          analysisComplete = false;
          continue;
        }

        if (totalBytes + stat.size > MAX_TOTAL_BYTES) {
          entries.push({
            path: relativePath,
            sha256: "0".repeat(64),
            bytes: stat.size,
            line_count: 0,
            disposition: "excluded",
            exclusion_reason: "Total repository size limit exceeded"
          });
          analysisComplete = false;
          continue;
        }

        const content = await fs.readFile(fullPath);
        const hash = sha256Hex(content);
        const lineCount = calculateLineCount(content);
        totalBytes += stat.size;

        // Copy file to snapshot cache
        const destPath = path.join(cacheFilesDir, ...relativePath.split("/"));
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, content);

        entries.push({
          path: relativePath,
          sha256: hash,
          bytes: stat.size,
          line_count: lineCount,
          disposition: "unread",
          exclusion_reason: null
        });
      }
    }
  }

  await walk(targetDir, "");

  // Sort files by Unicode code point order strictly
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const manifest: SourceManifest = {
    domain: "oes/source-manifest/v1",
    files: entries
  };

  const manifest_hash = jcsSha256(manifest);

  const analyzedCandidates = entries.filter(e => e.disposition !== "excluded").length;
  const excludedFiles = entries.filter(e => e.disposition === "excluded").length;

  return {
    snapshot_id,
    manifest,
    manifest_hash,
    analysis_complete: analysisComplete,
    total_files: entries.length,
    analyzed_candidates: analyzedCandidates,
    excluded_files: excludedFiles,
    total_bytes: totalBytes,
    cache_dir: cacheDir
  };
}
