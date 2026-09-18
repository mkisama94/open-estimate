import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { createRepositorySnapshot } from "../../src/collector/snapshot.js";
import { handleReadRepositoryFile } from "../../src/mcp/tools/read-repository-file.js";
import { mcpState } from "../../src/mcp/state.js";

describe("Collector & Read Coverage Integration (T02 / T10)", () => {
  it("creates a repository snapshot and computes manifest correctly", async () => {
    const snapshot = await createRepositorySnapshot("examples");
    expect(snapshot.snapshot_id).toBeDefined();
    expect(snapshot.manifest.files.length).toBeGreaterThan(0);
    expect(snapshot.manifest_hash).toMatch(/^[0-9a-f]{64}$/);

    // Register in state for reading
    mcpState.registerSnapshot(snapshot);

    // Read a file chunk with line numbers
    const basicFile = snapshot.manifest.files.find(f => f.path.includes("basic-assessment.json"));
    expect(basicFile).toBeDefined();

    const readResult = await handleReadRepositoryFile({
      snapshot_id: snapshot.snapshot_id,
      file_id: basicFile!.path,
      start_line: 1,
      max_lines: 10
    });

    expect(readResult.start_line).toBe(1);
    expect(readResult.end_line).toBe(10);
    expect(readResult.content).toContain("1: {");
    expect(readResult.has_more).toBe(true);

    // Verify read coverage updated disposition
    const tracker = mcpState.getSnapshot(snapshot.snapshot_id)!.tracker;
    // Read the entire file
    await handleReadRepositoryFile({
      snapshot_id: snapshot.snapshot_id,
      file_id: basicFile!.path,
      start_line: 11,
      max_lines: 400
    });

    const disp = tracker.getDisposition(basicFile!.path);
    // basic-assessment.json is classified as config/manifest/other, so disposition should be supporting or analyzed
    expect(["analyzed", "supporting"]).toContain(disp);
  });
});
