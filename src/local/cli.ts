#!/usr/bin/env node
import {getCacheRoot} from '../collector/snapshot.js';
import {prepareStartChoice,decorateStart,startHistoryPage,recalculationInputPage,reuseRecalculationSnapshot,recordWorkflowResume,assertEvaluationEditable} from './workflow-start-methods.js';
import {createDocument} from './create-document.js';
import {beginEstimateWorkflow,approveEstimateTransmission,showEstimateTransmission,cancelEstimateTransmission,prepareEstimateStart,startEstimateWorkflow,extendEstimateWorkflow,approveWorkflowAcquisition,approvedWorkflow,resumeEstimateWorkflow,showEstimateWorkflow,cancelEstimateWorkflow,withdrawEstimateWorkflow} from './estimate-workflow.js';
import {completeEstimateWorkflow} from './complete-workflow.js';
import {readWorkflowFile,workflowDirectory} from './workflow-store.js';
import {jcsSha256} from '../core/canonical.js';
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
import { handleGetAssessorContract,summarizeAssessorContract,assessorContractPage } from "../mcp/tools/get-assessor-contract.js";
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
import {publicDiscovery,snapshotSummary,snapshotPage,publicAcquisition,pageRows} from '../mcp/response-pages.js';
import {saveWorkflowDraft,evaluateWorkflowDraft,getWorkflowEvaluation,workflowDraftPage,recoverSavedWorkflowRun} from './workflow-evaluation.js';
import {saveWorkflowSnapshot,restoreWorkflowSnapshot} from '../mcp/workflow-snapshot.js';
import {readWorkflowData,writeWorkflowData} from './workflow-data.js';
import { saveRun, showRun, saveRemoteOperation } from "./runs.js";
import { compareRuns } from "./compare.js";
import { preparePublicResult } from "./public-result.js";
import { prepareCertificate, verifyCertificateFile } from "./certificate-submissions.js";
import { previewCertificate } from "./preview-transfer.js";
import {showDocument,renderDocumentPdfFile,attachDocumentProof,readDocumentFile} from './document-result.js';
import {prepareProofRequest,consentDocumentAction,consentedDocumentInput,webPreviewInput} from './document-consent.js';
import {openWebPreview} from './web-handoff.js';
import {verifyDocumentProof} from '../proof/verify.js';
import trustedDocumentKeys from '../../profiles/document-signing-keys.json' with {type:'json'};
import type {TrustedDocumentKey} from '../contracts/document.js';

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
const initialSnapshotCache=getCacheRoot();
async function main() {
  const command = process.argv[2], args = await input();
  if(command==='response-page'){if(!uuid.test(args.session_id)||!/^[a-f0-9]{64}$/.test(args.response_id))throw Error('INVALID_RESPONSE_REFERENCE');const file=await resolveSafePath(`${args.session_id}/responses/${args.response_id}.json`,base);if((await fs.stat(file)).size>64*1024*1024)throw Error('RESPONSE_ARCHIVE_TOO_LARGE');const value=JSON.parse(await fs.readFile(file,'utf8'));return pageRows([value],'legacy-response',args.cursor,args.limit,args.response_id);}
  if(command==='show-estimate-transmission')return showEstimateTransmission(args.workflow_id);
  if(command==='approve-estimate-transmission')return approveEstimateTransmission(args);
  if(command==='cancel-estimate-transmission')return cancelEstimateTransmission(args.workflow_id);
  if(command==='extend-estimate-workflow')return extendEstimateWorkflow(args);
  if(command==='complete-estimate-workflow')return completeEstimateWorkflow(args);
  if(command==='resume-estimate-workflow')return resumeEstimateWorkflow(args.workflow_id);
  if(command==='show-estimate-workflow')return showEstimateWorkflow(args.workflow_id);
  if(command==='get-workflow-evaluation')return getWorkflowEvaluation(args.workflow_id,args.draft_id);
  if(command==='recover-saved-workflow-run')return recoverSavedWorkflowRun(args);
  if(command==='draft-page')return workflowDraftPage(args);
  if(command==='recalculation-input-page')return recalculationInputPage(args);
  if(command==='cancel-estimate-workflow')return cancelEstimateWorkflow(args.workflow_id);
  if(command==='withdraw-estimate-workflow')return withdrawEstimateWorkflow(args.workflow_id);
  if(command==='get-estimate-workflow-pdf'){const dir=await workflowDirectory(args.workflow_id);return {path:path.join(dir,'estimate.pdf'),pdf_signed:false};}
  if(command==='create-document')return createDocument(args);
  if(command==='show-document')return showDocument(args.document_dir);
  if(command==='render-document-pdf')return renderDocumentPdfFile(args.document_dir);
  if(command==='prepare-proof-request')return prepareProofRequest(args.document_dir);
  if(command==='prepare-web-preview')return webPreviewInput(args.document_dir);
  if(command==='consent-document-action')return consentDocumentAction(args);
  if(command==='proof-request-input')return consentedDocumentInput(args.document_dir,'proof');
  if(command==='attach-document-proof')return attachDocumentProof(args.document_dir,args.proof);
  if(command==='verify-document')return verifyDocumentProof((await fs.readFile(args.markdown_path)).toString('utf8'),JSON.parse(await fs.readFile(args.proof_path,'utf8')),trustedDocumentKeys as TrustedDocumentKey[]);
  if(command==='open-web-preview')return openWebPreview(args.document_dir);
  if(['experience','prepare-result-preview','show-result-preview','regenerate-pdf','consent-estimate','publication-input','publish-result','migrate-estimate','record-estimate-publication'].includes(command))throw new Error('LEGACY_SAVE_FLOW_RETIRED_USE_CREATE_DOCUMENT');
  if(["prepare-estimate","preview-estimate","resume-estimate"].includes(command))throw new Error("ESTIMATE_FLOW_RETIRED_USE_LOCAL_PREVIEW");
  if (command === "prepare-certificate") return prepareCertificate(args);
  if (command === "verify-certificate") return verifyCertificateFile(args);
  if (["preview-certificate","resume-preview"].includes(command)) {
    const abort=new AbortController(),interrupt=()=>abort.abort();process.once("SIGINT",interrupt);
    try{return await previewCertificate(args,{signal:abort.signal,emit:value=>process.stdout.write(JSON.stringify(value)+"\n")});}finally{process.removeListener("SIGINT",interrupt);}
  }
  if (["publish-certificate","resume-certificate"].includes(command)) throw new Error("AUTH_CONSENT_NOT_READY");
  if (command === "prepare-public-result") return preparePublicResult(args);
  if (command === "skill-integrity") return currentSkill();
  if(command==='contract-page')return assessorContractPage(args);
  // Saved runs are independent of source access, snapshot lifetime, and session purge.
  if (command === "show-run") return showRun(args.run_id);
  if (command === "record-remote") return saveRemoteOperation(args.run_id,args);
  if (command === "compare-runs") return compareRuns(args);
  if (command === "contract") return { ...summarizeAssessorContract(await handleGetAssessorContract()), contract_version: `${currentSkill().skill_version}-desktop`,
    measurement_client_protocol: CLIENT_PROTOCOL,
    workspace_root: null, execution: "one_shot_cli", capabilities: { local_evidence_validation: true,
      assessment_drafts: true, local_assessment_artifacts: true, recorded_assessment_v2: true,
      quality_records: "oes/quality-records/v1", immutable_local_runs: true, offline_run_comparison: true, run_comparison_format: "oes/run-comparison/v2",
      local_public_result_candidate: true,
      local_certificate_preparation: true, offline_certificate_verification: true,
      owner_preview_transfer: true,
      local_result_preview:true,pdf_report:true,portable_document:true,document_proof:true,stateless_web_preview:false,workflow_consent:true,local_work_contract:"oes/local-work/v2",external_approval_contract:"oes/workflow-consent/v2",additional_read_confirmation:false,estimate_proof:true,public_result_365_days:true,standard_completion:"SELECTED_WORKFLOW_STAGES_COMPLETE",
      remote_recalculation_required: false, persistent_evaluations: true, html_report: true, web_management: false, certificates: false, publishing: false } };
  await privateDirectory(base);
  if (command === "scan") {
    if (typeof args.root !== "string" || !path.isAbsolute(args.root)) throw new Error("ABSOLUTE_PROJECT_PATH_REQUIRED");
    const root = await resolveSafePath("", path.resolve(args.root));
    if (classifyFile(path.basename(root) + "/dummy").isExcluded) throw new Error("EXCLUDED_TARGET_DIRECTORY");
    const scope = normalizeScope(args.scope);
    const summary = await scanStructure(root, scope), session_id = randomUUID();
    const state = { root, scope, preflight: summary.plan, created: Date.now(), confirmed: false, snapshots: {}, skill_integrity: currentSkill() };
    await fs.writeFile(path.join(base, `${session_id}.json`), JSON.stringify(state), { mode: 0o600, flag: "wx" });
    return { session_id, workspace_root: root, summary:publicDiscovery(summary), status: "READY_FOR_LOCAL_WORK", next_action:'SHOW_ESTIMATE_START',cache_root: base, retention_hours: 24 };
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
    if(command==='project-estimates')return startHistoryPage({root:state.root,...args});
    if(command==='show-estimate-start'||command==='select-estimate-start'){
      const rules=requireBoundRules(state);if(command==='select-estimate-start'&&!args.start_method)throw Error('START_METHOD_REQUIRED');
      let view:any;
      if(args.start_method){
       const b={candidate_id:args.session_id,root:state.root,roots_key:'host_context',origin:'one_shot_cli',plan:structuredClone(state.preflight)};if(args.start_method==='NEW'&&(state.workflow_id||state.start_workflow_id&&(await readWorkflowFile<any>(state.start_workflow_id,'state.json')).terms.start?.method==='RECALCULATE'))b.plan.scope=[];
       const made=await prepareStartChoice(b,rules,args.display_currency??'JPY',{method:args.start_method,request_id:args.start_request_id,source_workflow_id:args.source_workflow_id,source_run_id:args.source_run_id});
       view=made.view;state.start_workflow_id=view.workflow_id;state.preflight=made.binding.plan;state.scope=made.binding.plan.scope;state.confirmed=false;delete state.workflow_id;delete state.snapshot_cache_root;delete state.snapshot_cache_session;state.snapshots={};delete state.latest_snapshot_id;
       if(made.resume){await recordWorkflowResume(view.workflow_id,args.start_request_id);state.workflow_id=view.workflow_id;state.confirmed=true;state.measurement_rules=made.rules;const old=await readWorkflowData<any>(view.workflow_id,'mcp-context.json');state.snapshot_cache_session=old.binding.origin==='one_shot_cli'?old.binding.candidate_id:undefined;state.snapshot_cache_root=state.snapshot_cache_session?await resolveSafePath(state.snapshot_cache_session,base):initialSnapshotCache;process.env.OES_CACHE_ROOT=state.snapshot_cache_root;const restored=await restoreWorkflowSnapshot(view.workflow_id,state.root);if(restored?.available){state.latest_snapshot_id=restored.snapshot_id;state.snapshots[restored.snapshot_id]={workflow_snapshot:true};}}
      }else if(state.start_workflow_id){const old=await readWorkflowFile<any>(state.start_workflow_id,'state.json');if(args.display_currency&&old.terms.display_currency!==args.display_currency)throw Error('WORKFLOW_START_TERMS_CHANGED');view=old.consent||old.local_work?await showEstimateWorkflow(state.start_workflow_id):await import('./estimate-workflow.js').then(m=>m.showEstimateStart(state.start_workflow_id));}
      else{const made=await prepareStartChoice({candidate_id:state.snapshot_cache_session??args.session_id,root:state.root,roots_key:'host_context',origin:'one_shot_cli',plan:state.preflight},rules,args.display_currency??'JPY',{method:'NEW',request_id:randomUUID()});view=made.view;state.start_workflow_id=view.workflow_id;}
      const tmp=path.join(base,randomUUID()+'.tmp');await fs.writeFile(tmp,JSON.stringify(state),{flag:'wx',mode:0o600});await fs.rename(tmp,stateFile);
      return {...await decorateStart(view,state.root),method_selection_explicit:!!args.start_method,acquisition:publicAcquisition(state.preflight.summary),scope:state.scope.slice(0,10),scope_rule_count:state.scope.length};
    }
    if(command==='start-estimate-workflow'||command==='begin-estimate-workflow'){
      const draft=await readWorkflowFile<any>(args.workflow_id,'state.json');
      if(draft.terms.target_hash!==jcsSha256(state.root)||draft.terms.plan_hash!==state.preflight.fingerprint)throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
      const result=await (command==='begin-estimate-workflow'?beginEstimateWorkflow(args):startEstimateWorkflow(args));state.workflow_id=args.workflow_id;state.confirmed=true;
      const tmp=path.join(base,randomUUID()+'.tmp');await fs.writeFile(tmp,JSON.stringify(state),{flag:'wx',mode:0o600});await fs.rename(tmp,stateFile);return result;
    }
    if(state.workflow_id&&['prepare','prepare-summary','save-draft','export','draft'].includes(command))await assertEvaluationEditable(state.workflow_id);
    if(command==='prepare-summary'&&!state.workflow_id)throw Error('WORKFLOW_START_REQUIRED');
    if(state.workflow_id&&['prepare','prepare-summary','read','export','authorize-partial','snapshot-page','save-draft','evaluate-draft'].includes(command))await approvedWorkflow(state.workflow_id,{target_hash:jcsSha256(state.root),plan_hash:state.preflight.fingerprint});
    if (command === "draft") {
      const raw = typeof args.assessment === "string" ? parseStrictJson(args.assessment) : args.assessment;
      if (!raw || typeof raw !== "object") throw new Error("ASSESSMENT_INPUT_REQUIRED");
      await privateDirectory(sessionCache);
      const draftPath = path.join(sessionCache, `draft-${randomUUID()}.json`);
      await fs.writeFile(draftPath, JSON.stringify(raw, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      let errors: unknown[] = [];
      try { validateAssessment(raw); } catch (e) { if (e instanceof SemanticValidationError) errors = e.errors; else throw e; }
      return { status: "DRAFT_SAVED", local_path: draftPath, total_errors:errors.length, validation_errors: errors.slice(0,10).map((e:any)=>({code:e.code,pointer:String(e.pointer??'').slice(0,300),message:String(e.message??'').slice(0,300)})), exported: false, notice:'互換下書きです。検査結果の全件参照と復旧にはsave-draft／draft-pageを使ってください。' };
    }
    if (command === "confirm") {
      if (args.user_confirmed !== true) throw new Error("WORKSPACE_CONFIRMATION_REQUIRED");
      state.confirmed = true;
    } else if (!state.confirmed) throw new Error("WORKSPACE_CONFIRMATION_REQUIRED");
    const rules = ["prepare",'prepare-summary','save-draft','evaluate-draft', "read", "export"].includes(command) ? requireBoundRules(state) : null;
    if (command === "export" && Object.hasOwn(args, "ruleset_ref")) throw new Error("INVALID_RULESET_REF");
    process.env.OES_CACHE_ROOT = state.snapshot_cache_root??sessionCache;
    if(command==='prepare-summary'&&!state.latest_snapshot_id&&args.refresh_snapshot!==true&&args.refresh_preflight!==true){const id=await workspaceContext.run(state.root,()=>reuseRecalculationSnapshot(state.workflow_id,state.root));if(id){state.latest_snapshot_id=id;state.snapshots[id]={workflow_snapshot:true};}}

    let result: unknown;
    await workspaceContext.run(state.root, async () => {
      if (command === "confirm") result = { status: "CONFIRMED", confirmation: "assistant_reports_user_confirmation" };
      else if (command === "prepare"||command==='prepare-summary'&&!state.latest_snapshot_id||command==='prepare-summary'&&(args.refresh_snapshot===true||args.refresh_preflight===true)) {
        if (Object.hasOwn(args,"scope")) throw new Error("SCOPE_CHANGE_REQUIRES_NEW_SCAN");
        if (args.refresh_preflight === true) {
          const fresh=await planAcquisition(state.root,state.scope);
          if(state.workflow_id&&fresh.fingerprint!==state.preflight.fingerprint)await approveWorkflowAcquisition(state.workflow_id,jcsSha256(state.root),state.preflight,fresh);
          state.preflight=fresh;
        }
        result = await handlePrepareRepository({ relative_path: ".", scope:state.scope, preflight:state.preflight,response_format:command==='prepare-summary'?'summary':'legacy',
          previous_snapshot_id:state.latest_snapshot_id, partial_authorized:!!state.workflow_id || args.user_requested_partial === true, split_acquisition:args.split_acquisition === true });
        Object.assign(result as object, { ruleset_ref: rules!.ruleset_ref, rule_ids: rules!.bundle.rule_ids });
        const id = (result as any).snapshot_id;
        const prepared=mcpState.getSnapshot(id)!;
        if(command==='prepare-summary'){if(!state.workflow_id)throw Error('WORKFLOW_START_REQUIRED');await saveWorkflowSnapshot(state.workflow_id,id);await writeWorkflowData(state.workflow_id,'mcp-context.json',{rules,binding:{candidate_id:args.session_id,root:state.root,roots_key:'host_context',origin:'one_shot_cli',plan:state.preflight}});state.snapshots[id]={workflow_snapshot:true};}
        else state.snapshots[id] = { snapshot: prepared.snapshot, preparation:prepared.preparation, reads: [] };
        state.latest_snapshot_id=id;
      } else {
        args.snapshot_id??=state.latest_snapshot_id;
        const entry = state.snapshots[args.snapshot_id];
        if (!entry || !uuid.test(args.snapshot_id)) throw new Error("SNAPSHOT_NOT_FOUND");
        // Restore only a cache path derived from this session and snapshot ID.
        if(entry.workflow_snapshot){await restoreWorkflowSnapshot(state.workflow_id,state.root,args.snapshot_id);entry.snapshot=mcpState.getSnapshot(args.snapshot_id)!.snapshot;}
        else {entry.snapshot.cache_dir = await resolveSafePath(`${args.session_id}/${args.snapshot_id}`, base);mcpState.registerSnapshot(entry.snapshot,state.root,entry.preparation);}
        const tracker = mcpState.getSnapshot(args.snapshot_id)!.tracker;
        if(!entry.workflow_snapshot)tracker.restoreReads(entry.reads);
        if(command==='prepare-summary')result=snapshotSummary(args.snapshot_id);
        else if(command==='snapshot-page')result=snapshotPage(args);
        else if(command==='save-draft'){if(!state.workflow_id)throw Error('WORKFLOW_START_REQUIRED');result=await saveWorkflowDraft({...args,workflow_id:state.workflow_id});}
        else if(command==='evaluate-draft'){if(!state.workflow_id)throw Error('WORKFLOW_START_REQUIRED');result=await evaluateWorkflowDraft({...args,workflow_id:state.workflow_id},rules!);}
        else if (command === "authorize-partial") {
          if (!state.workflow_id && args.user_requested_partial !== true) throw new Error("EXPLICIT_PARTIAL_REQUEST_REQUIRED");
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
            notice: "新フローでは開始時の承認を適用して選択した工程を継続します。旧互換の送信は別同意です。数値モデル・表示通貨・配布スキルのID/版/整合性確認用ハッシュ・測定ルールの参照版を送信します。対象ソース、名称、説明、パス、根拠本文、対象ソースhash、Assessment、判断台帳、ルール本文、ローカルcontextは送信しません。送信同意を確認し、長期保管が必要なAssessmentとcontextは一緒に保持してください。" };
        } else throw new Error("UNKNOWN_COMMAND");
        if(entry.workflow_snapshot){await saveWorkflowSnapshot(state.workflow_id,args.snapshot_id);delete entry.snapshot;}
        else entry.reads = tracker.exportReads();
      }
    });
    const temp = path.join(base, `${args.session_id}.${randomUUID()}.tmp`);
    await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    await fs.rename(temp, stateFile);
    if(['prepare','export','draft'].includes(command)&&Buffer.byteLength(JSON.stringify(result))>65536){const bytes=JSON.stringify(result),response_id=sha256Hex(bytes),dir=path.join(sessionCache,'responses');await privateDirectory(dir);await fs.writeFile(path.join(dir,response_id+'.json'),bytes,{mode:0o600});const value=result as any;return {response_format:'oes/legacy-summary/v2',status:command==='export'?'RUN_SAVED':'DETAILS_PAGED',snapshot_id:value.snapshot_id??args.snapshot_id,assessment_id:value.assessment_id??null,run_id:value.local?.run_id??null,response_id,total_json_bytes:Buffer.byteLength(bytes),details_command:'response-page',session_id:args.session_id,byte_limit:65536,notice:'旧形式の大きな応答は同じセッションの非公開領域に保存しました。response-pageで全件復元でき、run保存済みならrun_idで続行できます。標準経路はprepare-summary／save-draft／evaluate-draftです。'};}
    return result;
  } finally { await lock.close(); await fs.unlink(path.join(base, `${args.session_id}.lock`)); }
}
try { process.stdout.write(JSON.stringify(await main()) + "\n"); }
catch (e: any) {
  const code = /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "HELPER_EXECUTION_FAILED";
  process.stdout.write(JSON.stringify({ error: { code, ...(code==='WORKFLOW_RECALCULATION_REQUIRED'?{recovery_action:'SELECT_RECALCULATE_TO_CREATE_NEW_WORKFLOW',next_command:'select-estimate-start',start_method:'RECALCULATE'}:{}), ...(e instanceof SemanticValidationError ? { code: "ASSESSMENT_VALIDATION_FAILED", details: e.errors } : {}) } }) + "\n"); process.exitCode = 1;
}
