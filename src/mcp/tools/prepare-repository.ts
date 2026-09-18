import { createRepositorySnapshot } from "../../collector/snapshot.js";
import { mcpState } from "../state.js";

export interface PrepareRepositoryArgs {
  relative_path?: string;
}

export async function handlePrepareRepository(args: PrepareRepositoryArgs): Promise<any> {
  const relPath = args.relative_path || "";
  const snapshot = await createRepositorySnapshot(relPath);

  // Register in local MCP state
  mcpState.registerSnapshot(snapshot);

  const exclusions = snapshot.manifest.files
    .filter(f => f.disposition === "excluded")
    .map(f => ({
      path: f.path,
      reason: f.exclusion_reason || "Excluded by standard policy"
    }));

  return {
    snapshot_id: snapshot.snapshot_id,
    manifest: snapshot.manifest,
    manifest_hash: snapshot.manifest_hash,
    summary: {
      total_files: snapshot.total_files,
      analyzed_candidates: snapshot.analyzed_candidates,
      excluded_files: snapshot.excluded_files,
      total_bytes: snapshot.total_bytes,
      analysis_complete: snapshot.analysis_complete
    },
    exclusions
  };
}
