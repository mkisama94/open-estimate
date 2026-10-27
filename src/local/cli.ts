#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { scanStructure } from "../mcp/workspace-session.js";
import { normalizeScope, planAcquisition } from "../collector/acquisition-plan.js";
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
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { inspectSkillPackage } from "../profiles/skill-package.js";
import { requireBoundRules, validateBoundRules, validateRuleReferences, saveMeasurementContext, writeContentAddressed } from "./measurement-context.js";
import { CLIENT_PROTOCOL } from "../rules/measurement-contract.js";
import { saveRun, showRun, saveRemoteOperation } from "./runs.js";
import { compareRuns } from "./compare.js";
import { preparePublicResult } from "./public-result.js";
import { prepareCertificate, verifyCertificateFile } from "./certificate-submissions.js";
import { previewCertificate,previewEstimate } from "./preview-transfer.js";
import { prepareEstimate } from "./estimate-submissions.js";
import {getExperienceCapabilities} from "../remote/experience.js";

function currentSkill() {
  const internal = fileURLToPath(new URL("../../skills/open-estimate-assessor/", import.meta.url));
  const index = process.argv.indexOf("--skill-root");
  if (index < 0 && existsSync(new URL("../../../.codex-plugin/plugin.json", import.meta.url))) throw new Error("SKILL_ROOT_REQUIRED");
  if (index >= 0 && process.argv.lastIndexOf("--skill-root") !== index) throw new Error("SKILL_ROOT_REQUIRED");
  const root = index < 0 ? internal : process.argv[index + 1];
  if (!root || !path.isAbsolute(root)) throw new Error("SKILL_ROOT_REQUIRED");
  const actual = inspectSkillPackage(root);
  const bundled = inspectSkillPackage(internal);
  if (JSON.stringify(actual) !== JSON.stringify(bundled)) throw new Error("SKILL_INTEGRITY_MISMATCH");
  return actual;
}

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
  if(command==="experience"){if(Object.keys(args).length)throw new Error("INVALID_INPUT");return getExperienceCapabilities();}
  if(command==="prepare-estimate")return prepareEstimate(args);
  if(["preview-estimate","resume-estimate"].includes(command)){
    const abort=new AbortController(),interrupt=()=>abort.abort();process.once("SIGINT",interrupt);
    try{return await previewEstimate(args,{signal:abort.signal,emit:value=>process.stdout.write(JSON.stringify(value)+"\n")});}catch(e){const code=e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:"STATUS_UNAVAILABLE";return {status:"WEB_INCOMPLETE",web_complete:false,submission_id:args.submission_id,error_code:code,next_action:"resume-estimate",notice:"Web表示は未完了です。同じsubmission_idでresume-estimateを実行して再開してください。期限切れは新しい確認が必要です。ローカル結果は保持されています。"};}finally{process.removeListener("SIGINT",interrupt);}
  }
  if (command === "prepare-certificate") return prepareCertificate(args);
  if (command === "verify-certificate") return verifyCertificateFile(args);
  if (["preview-certificate","resume-preview"].includes(command)) {
    const abort=new AbortController(),interrupt=()=>abort.abort();process.once("SIGINT",interrupt);
    try{return await previewCertificate(args,{signal:abort.signal,emit:value=>process.stdout.write(JSON.stringify(value)+"\n")});}finally{process.removeListener("SIGINT",interrupt);}
  }
  if (["publish-certificate","resume-certificate"].includes(command)) throw new Error("AUTH_CONSENT_NOT_READY");
  if (command === "prepare-public-result") return preparePublicResult(args);
  if (command === "skill-integrity") return currentSkill();
  // Saved runs are independent of source access, snapshot lifetime, and session purge.
  if (command === "show-run") return showRun(args.run_id);
  if (command === "record-remote") return saveRemoteOperation(args.run_id,args);
  if (command === "compare-runs") return compareRuns(args);
  if (command === "contract") return { ...await handleGetAssessorContract(), contract_version: `${currentSkill().skill_version}-desktop`,
    measurement_client_protocol: CLIENT_PROTOCOL,
    workspace_root: null, execution: "one_shot_cli", capabilities: { local_evidence_validation: true,
      assessment_drafts: true, local_assessment_artifacts: true, recorded_assessment_v2: true,
      quality_records: "oes/quality-records/v1", immutable_local_runs: true, offline_run_comparison: true, run_comparison_format: "oes/run-comparison/v2",
      local_public_result_candidate: true,
      local_certificate_preparation: true, offline_certificate_verification: true,
      owner_preview_transfer: true,
      numeric_owner_preview:true,standard_completion:"WEB_READY",owner_preview_minutes:15,saved_estimate_days:30,
      remote_recalculation_required: true, persistent_evaluations: true, html_report: true, web_management: true, remote_availability_command: "experience", certificates: false, publishing: false } };
  await privateDirectory(base);
  if (command === "scan") {
    if (typeof args.root !== "string" || !path.isAbsolute(args.root)) throw new Error("ABSOLUTE_PROJECT_PATH_REQUIRED");
    const root = await resolveSafePath("", path.resolve(args.root));
    if (classifyFile(path.basename(root) + "/dummy").isExcluded) throw new Error("EXCLUDED_TARGET_DIRECTORY");
    const scope = normalizeScope(args.scope);
    const summary = await scanStructure(root, scope), session_id = randomUUID();
    const state = { root, scope, preflight: summary.plan, created: Date.now(), confirmed: false, snapshots: {}, skill_integrity: currentSkill() };
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
    let integrity: ReturnType<typeof currentSkill> | undefined;
    if (command === "prepare" || command === "export") {
      try { integrity = currentSkill(); }
      catch { throw new Error("SKILL_CHANGED_DURING_ANALYSIS"); }
      if (JSON.stringify(integrity) !== JSON.stringify(state.skill_integrity)) throw new Error("SKILL_CHANGED_DURING_ANALYSIS");
    }
    if (args.root !== state.root) throw new Error("PROJECT_CHANGED_RECONFIRM_REQUIRED");
    await resolveSafePath("", state.root);
    if (command === "bind-rules") {
      const actual = currentSkill();
      if (JSON.stringify(actual) !== JSON.stringify(state.skill_integrity)) throw new Error("SKILL_CHANGED_DURING_ANALYSIS");
      const response = validateBoundRules(args.rules_response, actual);
      if (state.measurement_rules) {
        const old = requireBoundRules(state);
        if (old.ruleset_ref.revision !== response.ruleset_ref.revision) throw new Error("RULESET_CHANGED");
      }
      state.measurement_rules = response;
      const temp = path.join(base, `${args.session_id}.${randomUUID()}.tmp`);
      await fs.writeFile(temp, JSON.stringify(state), { flag: "wx", mode: 0o600 }); await fs.rename(temp, stateFile);
      return { status: "RULESET_BOUND", ruleset_ref: response.ruleset_ref, rule_ids: response.bundle.rule_ids };
    }
    if (command === "draft") {
      const raw = typeof args.assessment === "string" ? parseStrictJson(args.assessment) : args.assessment;
      if (!raw || typeof raw !== "object") throw new Error("ASSESSMENT_INPUT_REQUIRED");
      await privateDirectory(sessionCache);
      const draftPath = path.join(sessionCache, `draft-${randomUUID()}.json`);
      await fs.writeFile(draftPath, JSON.stringify(raw, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      let errors: unknown[] = [];
      try { validateAssessment(raw); } catch (e) { if (e instanceof SemanticValidationError) errors = e.errors; else throw e; }
      return { status: "DRAFT_SAVED", local_path: draftPath, validation_errors: errors, exported: false };
    }
    if (command === "confirm") {
      if (args.user_confirmed !== true) throw new Error("WORKSPACE_CONFIRMATION_REQUIRED");
      state.confirmed = true;
    } else if (!state.confirmed) throw new Error("WORKSPACE_CONFIRMATION_REQUIRED");
    const rules = ["prepare", "read", "export"].includes(command) ? requireBoundRules(state) : null;
    if (command === "export" && Object.hasOwn(args, "ruleset_ref")) throw new Error("INVALID_RULESET_REF");
    process.env.OES_CACHE_ROOT = sessionCache;
    let result: unknown;
    await workspaceContext.run(state.root, async () => {
      if (command === "confirm") result = { status: "CONFIRMED", confirmation: "assistant_reports_user_confirmation" };
      else if (command === "prepare") {
        if (Object.hasOwn(args,"scope")) throw new Error("SCOPE_CHANGE_REQUIRES_NEW_SCAN");
        if (args.refresh_preflight === true) state.preflight = await planAcquisition(state.root,state.scope);
        result = await handlePrepareRepository({ relative_path: ".", scope:state.scope, preflight:state.preflight,
          previous_snapshot_id:state.latest_snapshot_id, partial_authorized:args.user_requested_partial === true, split_acquisition:args.split_acquisition === true });
        Object.assign(result as object, { ruleset_ref: rules!.ruleset_ref, rule_ids: rules!.bundle.rule_ids });
        const id = (result as any).snapshot_id;
        state.snapshots[id] = { snapshot: mcpState.getSnapshot(id)!.snapshot, reads: [] };
        state.latest_snapshot_id=id;
      } else {
        const entry = state.snapshots[args.snapshot_id];
        if (!entry || !uuid.test(args.snapshot_id)) throw new Error("SNAPSHOT_NOT_FOUND");
        // Restore only a cache path derived from this session and snapshot ID.
        entry.snapshot.cache_dir = await resolveSafePath(`${args.session_id}/${args.snapshot_id}`, base);
        mcpState.registerSnapshot(entry.snapshot);
        const tracker = mcpState.getSnapshot(args.snapshot_id)!.tracker;
        tracker.restoreReads(entry.reads);
        if (command === "authorize-partial") {
          if (args.user_requested_partial !== true) throw new Error("EXPLICIT_PARTIAL_REQUEST_REQUIRED");
          entry.snapshot.analysis_ready=true;
          entry.snapshot.acquisition.partial_authorized=true;
          result={status:"PARTIAL_AUTHORIZED",scope_coverage:entry.snapshot.acquisition.scope_coverage,
            notice:"プロジェクト全体の工数は未算出。取得済み部分のみを試算します。",manifest:entry.snapshot.manifest};
        }
        else if (command === "read") result = await handleReadRepositoryFile(args);
        else if (command === "export") {
          for (const file of entry.snapshot.manifest.files) if (file.disposition !== "excluded") {
            const full = await resolveSafePath(file.path, path.join(entry.snapshot.cache_dir, "files"));
            if (sha256Hex(await fs.readFile(full)) !== file.sha256) throw new Error("SNAPSHOT_CONTENT_CHANGED");
          }
          const { validated, wasReconciled } = await validateSnapshotAssessment(args);
          validateRuleReferences(validated, rules!);
          try {
            integrity = currentSkill();
            if (JSON.stringify(integrity) !== JSON.stringify(state.skill_integrity)) throw new Error("SKILL_CHANGED_DURING_ANALYSIS");
          } catch { throw new Error("SKILL_CHANGED_DURING_ANALYSIS"); }
          const model = projectModel(validated);
          const { normalized, assessment_hash } = normalizeAssessment(validated);
          const localPath = path.join(sessionCache, `assessment-${assessment_hash}.json`);
          // Content-addressed immutable local artifact; preserve the submitted input too.
          const artifact = { assessment: normalized, assessment_hash, submitted_assessment: typeof args.assessment === "string" ? parseStrictJson(args.assessment) : args.assessment };
          await writeContentAddressed(localPath,artifact);
          const context = await saveMeasurementContext(sessionCache, assessment_hash, requireBoundRules(state));
          const savedContext = JSON.parse(await fs.readFile(context.context_path,"utf8"));
          const run = await saveRun(validated,artifact.submitted_assessment,savedContext,state.root,entry.snapshot.acquisition_record);
          result = { model, skill_integrity: integrity, ruleset_ref: rules!.ruleset_ref, input_reconciled: wasReconciled, transmission: "PREVIEW_ONLY_NOT_SENT",
            local: { ...run, session_assessment_path: localPath, session_context_path: context.context_path, ...context, context_path: path.join(run.run_directory,"context.json"), scope: validated.scope, scope_record: validated.scope_record ?? null,
              records: recordState(validated), comparison: comparisonSummary(validated), report: createEvaluation(validated,getLocalProfile()).report,
              ledger_pointer: "/assessment/judgments", candidates_pointer: "/assessment/function_candidates" },
            notice: "数値モデル・表示通貨・配布スキルのID/版/整合性確認用ハッシュ・測定ルールの参照版を送信します。対象ソース、名称、説明、パス、根拠本文、対象ソースhash、Assessment、判断台帳、ルール本文、ローカルcontextは送信しません。送信同意を確認し、長期保管が必要なAssessmentとcontextは一緒に保持してください。" };
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
