import { createRepositorySnapshot } from "../../collector/snapshot.js";
import { mcpState } from "../state.js";
import { randomUUID } from "node:crypto";
import { handleGetAssessorContract } from "./get-assessor-contract.js";
import type { AcquisitionOptions } from "../../collector/acquire.js";
import {getWorkspaceRoot} from '../../collector/safe-paths.js';
import {snapshotSummary} from '../response-pages.js';

export interface PrepareRepositoryArgs extends AcquisitionOptions {
  relative_path?: string;
  response_format?:'summary'|'legacy';
}

export async function handlePrepareRepository(args: PrepareRepositoryArgs): Promise<any> {
  const relPath = args.relative_path || "";
  const snapshot = await createRepositorySnapshot(relPath, args);
  const contract = await handleGetAssessorContract();

  const defaults={assessment_id:randomUUID(),assessor_defaults:{
    model_id:null,model_name:'unknown',model_metadata_source:'unknown',host:'Codex',
    skill_id:contract.skill.skill_id,skill_version:contract.skill.skill_version,skill_sha256:contract.skill.package_sha256,
    started_at:new Date().toISOString(),context_isolation:'not_enforced'
  }};
  mcpState.registerSnapshot(snapshot,getWorkspaceRoot(),defaults);
  return {...(args.response_format==='summary'?snapshotSummary(snapshot.snapshot_id):handleGetRepositorySnapshot(snapshot.snapshot_id)),snapshot_reused:false,acquisition_performed:true};
}

/** Returns acquisition metadata and its read ledger without reading or copying sources. */
export function handleGetRepositorySnapshot(snapshot_id:string){
  const entry=mcpState.getSnapshot(snapshot_id);
  if(!entry?.preparation)throw Error('SNAPSHOT_NOT_FOUND_OR_EXPIRED');
  if(entry.workspace_root!==getWorkspaceRoot())throw Error('SNAPSHOT_WORKSPACE_MISMATCH');
  const {snapshot,preparation}=entry;

  const exclusions = snapshot.manifest.files
    .filter(f => f.disposition === "excluded")
    .map(f => ({
      path: f.path,
      reason: f.exclusion_reason || "Excluded by standard policy"
    }));

  return structuredClone({
    status: snapshot.analysis_ready ? "READY_FOR_ANALYSIS" : "ACQUISITION_INCOMPLETE",
    analysis_ready: snapshot.analysis_ready,
    acquisition_record: snapshot.acquisition_record,
    ...structuredClone(preparation),
    snapshot_reused:true,acquisition_performed:false,read_coverage:entry.tracker.exportReads(),
    assessment_input: {
      ...snapshot.source_identity, manifest_hash: snapshot.manifest_hash, manifest: snapshot.manifest,
      analysis_complete: snapshot.analysis_complete
      , acquisition: snapshot.acquisition
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
    exclusions,
    notice:'取得済みの固定スナップショットです。一覧確認・入力修正では再取得せず、このsnapshot_idとassessment_inputを使ってください。元ソースの変更を取り込む場合だけ明示的に再取得してください。'
  });
}
