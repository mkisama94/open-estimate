import fs from "node:fs/promises";
import path from "node:path";
import { mcpState } from "../state.js";

const MAX_LINES_LIMIT = 400;
const MAX_BYTES_LIMIT = 64 * 1024; // 64 KiB

export interface ReadRepositoryFileArgs {
  snapshot_id: string;
  file_id: string;
  start_line?: number;
  max_lines?: number;
}

export async function handleReadRepositoryFile(args: ReadRepositoryFileArgs): Promise<any> {
  const { snapshot_id, file_id } = args;
  if (!snapshot_id) {
    throw new Error("snapshot_id is required");
  }
  if (!file_id) {
    throw new Error("file_id is required");
  }

  const snapshotEntry = mcpState.getSnapshot(snapshot_id);
  if (!snapshotEntry) {
    throw new Error(`Snapshot '${snapshot_id}' not found or expired`);
  }

  const { snapshot, tracker } = snapshotEntry;
  const fileManifest = snapshot.manifest.files.find(f => f.path === file_id);
  if (!fileManifest) {
    throw new Error(`File '${file_id}' not found in snapshot manifest`);
  }
  if (fileManifest.disposition === "excluded") {
    throw new Error(`File '${file_id}' is excluded from analysis`);
  }

  const filePath = path.join(snapshot.cache_dir, "files", ...file_id.split("/"));
  const rawBytes = await fs.readFile(filePath);
  const text = rawBytes.toString("utf8");

  // Split lines while preserving LF semantics
  const allLines = text.split("\n");
  if (allLines.length > 0 && allLines[allLines.length - 1] === "" && text.endsWith("\n")) {
    allLines.pop(); // remove trailing empty split if ending with newline
  }

  const totalLines = allLines.length;
  const startLine = Math.max(1, args.start_line || 1);
  const requestedMaxLines = Math.min(MAX_LINES_LIMIT, Math.max(1, args.max_lines || MAX_LINES_LIMIT));

  if (startLine > totalLines && totalLines > 0) {
    throw new Error(`start_line ${startLine} exceeds total lines ${totalLines}`);
  }

  const selectedLines: string[] = [];
  let accumulatedBytes = 0;
  let currentLineNum = startLine;

  while (currentLineNum <= totalLines && selectedLines.length < requestedMaxLines) {
    const lineIndex = currentLineNum - 1;
    const lineContent = allLines[lineIndex];
    const lineBytes = Buffer.byteLength(lineContent, "utf8") + 1; // +1 for LF

    if (lineBytes > MAX_BYTES_LIMIT) {
      throw new Error(`Line ${currentLineNum} size (${lineBytes} bytes) exceeds maximum chunk size ${MAX_BYTES_LIMIT} bytes`);
    }

    if (accumulatedBytes + lineBytes > MAX_BYTES_LIMIT && selectedLines.length > 0) {
      // Chunk byte limit reached
      break;
    }

    accumulatedBytes += lineBytes;
    selectedLines.push(`${currentLineNum}: ${lineContent}`);
    currentLineNum++;
  }

  const endLine = currentLineNum - 1;

  // Record read in coverage tracker
  tracker.recordRead(file_id, startLine, endLine);

  const hasMore = endLine < totalLines;
  const nextStartLine = hasMore ? endLine + 1 : null;

  return {
    file_id,
    content: selectedLines.join("\n"),
    sha256: fileManifest.sha256,
    start_line: startLine,
    end_line: endLine,
    total_lines: totalLines,
    has_more: hasMore,
    next_start_line: nextStartLine
  };
}
