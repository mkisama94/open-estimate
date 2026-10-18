#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { scanStructure } from "../mcp/workspace-session.js";
import { workspaceContext } from "../collector/workspace-context.js";
import { privateDirectory } from "../local-files.js";
import { resolveSafePath } from "../collector/safe-paths.js";
import { handlePrepareRepository } from "../mcp/tools/prepare-repository.js";
import { handleReadRepositoryFile } from "../mcp/tools/read-repository-file.js";
import { handleGetAssessorContract } from "../mcp/tools/get-assessor-contract.js";
import { validateSnapshotAssessment } from "../mcp/tools/evaluate-assessment.js";
import { mcpState } from "../mcp/state.js";
import { projectModel } from "../remote/model.js";
import { parseStrictJson } from "../core/json-parser.js";
import { classifyFile } from "../collector/classification.js";
import { sha256Hex } from "../core/canonical.js";
import { validateAssessment, SemanticValidationError } from "../core/validate.js";
import { normalizeAssessment } from "../core/normalize.js";
import { comparisonSummary, recordState } from "../core/records.js";
import { createEvaluation } from "../core/evaluation.js";
import { getLocalProfile } from "../profiles/local-profile.js";

const base = path.resolve(process.env.OES_HELPER_STATE ?? path.join(os.tmpdir(), "open-estimate-helper"));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TTL = 24 * 60 * 60 * 1000;
async function input() {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new Error("INPUT_TOO_LARGE");
    chunks.push(chunk);
  }
  return parseStrictJson(Buffer.concat(chunks).toString("utf8")) as any;
}
async function main() {
  const command = process.argv[2], args = await input();
  if (command === "contract") return { ...await handleGetAssessorContract(), contract_version: "0.5.0-desktop",
    workspace_root: null, execution: "one_shot_cli", capabilities: { local_evidence_validation: true,
      assessment_drafts: true, local_assessment_artifacts: true, recorded_assessment_v2: true,
      remote_recalculation_required: true, persistent_evaluations: false, html_report: false, web_management: false, certificates: false, publishing: false } };
  await privateDirectory(base);
  if (command === "scan") {
    if (typeof args.root !== "string" || !path.isAbsolute(args.root)) throw new Error("ABSOLUTE_PROJECT_PATH_REQUIRED");
    const root = await resolveSafePath("", path.resolve(args.root));
    if (classifyFile(path.basename(root) + "/dummy").isExcluded) throw new Error("EXCLUDED_TARGET_DIRECTORY");
    const summary = await scanStructure(root), session_id = randomUUID();
    const state = { root, created: Date.now(), confirmed: false, snapshots: {} };
    await fs.writeFile(path.join(base, `${session_id}.json`), JSON.stringify(state), { mode: 0o600, flag: "wx" });
    return { session_id, workspace_root: root, summary, status: "AWAITING_USER_CONFIRMATION", cache_root: base, retention_hours: 24 };
  }
  if (!uuid.test(args.session_id)) throw new Error("INVALID_SESSION_ID");
  const stateFile = await resolveSafePath(`${args.session_id}.json`, base);
  const lock = await fs.open(path.join(base, `${args.session_id}.lock`), "wx", 0o600);
  try {
    if ((await fs.stat(stateFile)).size > 16 * 1024 * 1024) throw new Error("STATE_TOO_LARGE");
    const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    const sessionCache = path.join(base, args.session_id);
    if (command === "purge") {
      // Exact UUID child of a checked private directory; no caller-supplied deletion path.
      try { await resolveSafePath(args.session_id, base); await fs.rm(sessionCache, { recursive: true, force: true }); }
      catch (e: any) { if (e.code !== "ENOENT") throw e; }
      await fs.unlink(stateFile); return { status: "PURGED" };
    }
    if (Date.now() - state.created > TTL) throw new Error("SESSION_EXPIRED_PURGE_REQUIRED");
    if (args.root !== state.root) throw new Error("PROJECT_CHANGED_RECONFIRM_REQUIRED");
    await resolveSafePath("", state.root);
    if (command === "confirm") {
      if (args.user_confirmed !== true) throw new Error("WORKSPACE_CONFIRMATION_REQUIRED");
      state.confirmed = true;
    } else if (!state.confirmed) throw new Error("WORKSPACE_CONFIRMATION_REQUIRED");
    process.env.OES_CACHE_ROOT = sessionCache;
    let result: unknown;
    await workspaceContext.run(state.root, async () => {
      if (command === "confirm") result = { status: "CONFIRMED", confirmation: "assistant_reports_user_confirmation" };
      else if (command === "prepare") {
        result = await handlePrepareRepository({ relative_path: "." });
        const id = (result as any).snapshot_id;
        state.snapshots[id] = { snapshot: mcpState.getSnapshot(id)!.snapshot, reads: [] };
      } else {
        const entry = state.snapshots[args.snapshot_id];
        if (!entry || !uuid.test(args.snapshot_id)) throw new Error("SNAPSHOT_NOT_FOUND");
        // Restore only a cache path derived from this session and snapshot ID.
        entry.snapshot.cache_dir = await resolveSafePath(`${args.session_id}/${args.snapshot_id}`, base);
        mcpState.registerSnapshot(entry.snapshot);
        const tracker = mcpState.getSnapshot(args.snapshot_id)!.tracker;
        tracker.restoreReads(entry.reads);
        if (command === "draft") {
          const raw = typeof args.assessment === "string" ? parseStrictJson(args.assessment) : args.assessment;
          if (!raw || typeof raw !== "object") throw new Error("ASSESSMENT_INPUT_REQUIRED");
          const draftPath = path.join(sessionCache, `draft-${randomUUID()}.json`);
          await fs.writeFile(draftPath, JSON.stringify(raw,null,2) + "\n", { mode: 0o600, flag: "wx" });
          let errors: unknown[] = [];
          try { validateAssessment(raw); } catch (e) { if (e instanceof SemanticValidationError) errors=e.errors; else throw e; }
          result = { status: "DRAFT_SAVED", local_path: draftPath, validation_errors: errors, exported: false };
        }
        else if (command === "read") result = await handleReadRepositoryFile(args);
        else if (command === "export") {
          for (const file of entry.snapshot.manifest.files) if (file.disposition !== "excluded") {
            const full = await resolveSafePath(file.path, path.join(entry.snapshot.cache_dir, "files"));
            if (sha256Hex(await fs.readFile(full)) !== file.sha256) throw new Error("SNAPSHOT_CONTENT_CHANGED");
          }
          const { validated, wasReconciled } = await validateSnapshotAssessment(args);
          const model = projectModel(validated);
          const { normalized, assessment_hash } = normalizeAssessment(validated);
          const localPath = path.join(sessionCache, `assessment-${assessment_hash}.json`);
          // Content-addressed immutable local artifact; preserve the submitted input too.
          const artifact = { assessment: normalized, assessment_hash, submitted_assessment: typeof args.assessment === "string" ? parseStrictJson(args.assessment) : args.assessment };
          try { await fs.writeFile(localPath, JSON.stringify(artifact,null,2) + "\n", { mode: 0o600, flag: "wx" }); }
          catch (e: any) { if (e.code !== "EEXIST") throw e; }
          result = { model, input_reconciled: wasReconciled, transmission: "PREVIEW_ONLY_NOT_SENT",
            local: { assessment_path: localPath, assessment_hash, scope: validated.scope, scope_record: validated.scope_record ?? null,
              records: recordState(validated), comparison: comparisonSummary(validated), report: createEvaluation(validated,getLocalProfile()).report,
              ledger_pointer: "/assessment/judgments", candidates_pointer: "/assessment/function_candidates" },
            notice: "連番ID・分類・状態のみ。ソース、名称、説明、パス、根拠、ハッシュは送信対象外。送信前にこのモデルの送信同意を確認してください。" };
        } else throw new Error("UNKNOWN_COMMAND");
        entry.reads = tracker.exportReads();
      }
    });
    const temp = path.join(base, `${args.session_id}.${randomUUID()}.tmp`);
    await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    await fs.rename(temp, stateFile);
    return result;
  } finally { await lock.close(); await fs.unlink(path.join(base, `${args.session_id}.lock`)); }
}
try { process.stdout.write(JSON.stringify(await main()) + "\n"); }
catch (e: any) {
  const code = /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "HELPER_EXECUTION_FAILED";
  process.stdout.write(JSON.stringify({ error: { code, ...(e instanceof SemanticValidationError ? { code: "ASSESSMENT_VALIDATION_FAILED", details: e.errors } : {}) } }) + "\n"); process.exitCode = 1;
}
