import { createRepositorySnapshot } from "../../collector/snapshot.js";
import { mcpState } from "../state.js";
import { randomUUID } from "node:crypto";
import { handleGetAssessorContract } from "./get-assessor-contract.js";

export interface PrepareRepositoryArgs {
  relative_path?: string;
}

export async function handlePrepareRepository(args: PrepareRepositoryArgs): Promise<any> {
  const relPath = args.relative_path || "";
  const snapshot = await createRepositorySnapshot(relPath);
  const contract = await handleGetAssessorContract();

  // Register in local MCP state
  mcpState.registerSnapshot(snapshot);

  const exclusions = snapshot.manifest.files
    .filter(f => f.disposition === "excluded")
    .map(f => ({
      path: f.path,
      reason: f.exclusion_reason || "Excluded by standard policy"
    }));

  return {
    assessment_id: randomUUID(),
    assessor_defaults: {
      model_id: null, model_name: "unknown", model_metadata_source: "unknown", host: "Codex",
      skill_id: contract.skill.skill_id, skill_version: contract.skill.skill_version,
      skill_sha256: contract.skill.package_sha256,
      started_at: new Date().toISOString(), context_isolation: "not_enforced"
    },
    assessment_input: {
      ...snapshot.source_identity, manifest_hash: snapshot.manifest_hash, manifest: snapshot.manifest,
      analysis_complete: snapshot.analysis_complete
    },
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
