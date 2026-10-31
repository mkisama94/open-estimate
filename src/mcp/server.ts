import {prepareEstimateStart,showEstimateStart,startEstimateWorkflow,extendEstimateWorkflow,approveWorkflowAcquisition,approvedWorkflow,showEstimateWorkflow,resumeEstimateWorkflow,cancelEstimateWorkflow,withdrawEstimateWorkflow} from '../local/estimate-workflow.js';
import {completeEstimateWorkflow,WorkflowCompletionError} from '../local/complete-workflow.js';
import {readWorkflowFile,workflowDirectory} from '../local/workflow-store.js';
import {readWorkflowData,writeWorkflowData} from '../local/workflow-data.js';
import {estimateStartWidgetUri,estimateStartWidgetHtml,estimateWorkflowWidgetUri,estimateWorkflowWidgetHtml} from '../local/workflow-widget.js';
import {validateBoundRules,validateRuleReferences,type BoundRules} from '../local/measurement-context.js';
import {inspectSkillPackage} from '../profiles/skill-package.js';
import {fileURLToPath} from 'node:url';
import {jcsSha256} from '../core/canonical.js';
import {validateSnapshotAssessment} from './tools/evaluate-assessment.js';
import {saveRun} from '../local/runs.js';
import type {WorkflowEvaluationView} from './presentation.js';
import path from 'node:path';
import { WorkspaceSession,type WorkspaceBinding } from "./workspace-session.js";
import {saveWorkflowSnapshot,restoreWorkflowSnapshot} from './workflow-snapshot.js';
import {bounded,snapshotSummary,snapshotPage,publicDiscovery,publicAcquisition,pageRows} from './response-pages.js';
import {saveWorkflowDraft,evaluateWorkflowDraft,getWorkflowEvaluation,workflowDraftPage,recoverSavedWorkflowRun} from '../local/workflow-evaluation.js';
import { workspaceContext } from "../collector/workspace-context.js";
import { mcpState } from "./state.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { handleGetAssessorContract,summarizeAssessorContract,assessorContractPage } from "./tools/get-assessor-contract.js";
import { handlePrepareRepository,handleGetRepositorySnapshot } from "./tools/prepare-repository.js";
import { handleReadRepositoryFile } from "./tools/read-repository-file.js";
import { handleEvaluateAssessment } from "./tools/evaluate-assessment.js";
import { handleGetEvaluation } from "./tools/get-evaluation.js";
import { handleRenderReport } from "./tools/render-report.js";
import { OES_RESOURCES, handleReadResource } from "./resources.js";
import { CURRENCIES } from "../profiles/frb.js";
import fs from "node:fs";
import {showResultPreview,readResultPreview} from "../local/estimate-result.js";
import {resultWidgetUri,resultWidgetHtml} from "../local/result-widget.js";
import {resolveSafePath} from "../collector/safe-paths.js";
import {promises as files} from "node:fs";
import {showDocument,readDocumentFile} from '../local/document-result.js';
import {documentWidgetUri,documentWidgetHtml} from '../local/document-widget.js';

const contract = JSON.parse(fs.readFileSync(new URL("../../contracts/local-preview.schema.json", import.meta.url), "utf8"));
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false });
const str = { type: "string", minLength: 1, maxLength: 1024 };
const scopeSchema = {type:"array",items:object({path:str,role:{enum:["measurement","supporting","excluded"]}},["path","role"])};
const display = { locale: { type: "string", maxLength: 64 }, display_currency: { type: "string", enum: [...CURRENCIES] } };
const output = (properties: Record<string, unknown>, required: string[]) => object(properties, required);
const definition = (key: string) => ({ ...contract.$defs[key], $defs: contract.$defs });
const workflowTools=[
 {name:'show_estimate_start',description:'Show the single start confirmation card after metadata discovery and rule binding, then wait for its choice. Do not also ask a chat question/form. Use confirmation_mode=chat only if cards are unavailable. Repeating this call reuses the same start.',inputSchema:object({rules_response:{type:'object',additionalProperties:true},display_currency:{enum:[...CURRENCIES]},confirmation_mode:{enum:['card','chat']}},['rules_response']),outputSchema:{type:'object' as const},handler:async(_:any)=>({}),readOnly:false,network:false,_meta:{ui:{resourceUri:estimateStartWidgetUri}}},
 {name:'start_estimate_workflow',description:'Record the explicit start-screen choice or the actual user reply once. Read is mandatory; publish requires verify. This approval covers later fixed numbers and declared partial estimates, not scope/destination changes.',inputSchema:object({workflow_id:str,terms_hash:str,selection:object({read:{type:'boolean'},verify:{type:'boolean'},publish:{type:'boolean'}},['read','verify','publish']),explicit_answer:{type:'string',minLength:1,maxLength:2000}},['workflow_id','terms_hash','selection','explicit_answer']),outputSchema:{type:'object' as const},handler:async(_:any)=>({}),readOnly:false,network:false},
 {name:'extend_estimate_workflow',description:'Only after the user explicitly requests an unselected operation, approve that difference without reanalysis. Existing permissions cannot be silently removed; cancellation is separate.',inputSchema:object({workflow_id:str,terms_hash:str,selection:object({read:{type:'boolean'},verify:{type:'boolean'},publish:{type:'boolean'}},['read','verify','publish']),explicit_answer:{type:'string',minLength:1,maxLength:2000}},['workflow_id','terms_hash','selection','explicit_answer']),outputSchema:{type:'object' as const},handler:extendEstimateWorkflow,readOnly:false,network:false},
 {name:'complete_estimate_workflow',description:'Freeze the locally validated run from the approved acquisition, generate outputs, then continue selected proof and Web publication without new product consent. Persist operation IDs before sending.',inputSchema:object({workflow_id:str,run_id:str},['workflow_id','run_id']),outputSchema:{type:'object' as const},handler:completeEstimateWorkflow,readOnly:false,network:true,_meta:{ui:{resourceUri:estimateWorkflowWidgetUri}}},
 ...(['show','resume','cancel','withdraw'] as const).map(action=>({name:action+'_estimate_workflow',description:action==='withdraw'?'Explicit owner action to stop this published result; management secret stays local.':action==='cancel'?'Cancel unsent stages. Already completed or uncertain publication is reported separately.':action==='resume'?'Retry only unfinished selected stages with the same fixed data, IDs and consent.':'Show fixed workflow result, PDF and verified publication URL. Does not refresh rates or recalculate.',inputSchema:object({workflow_id:str},['workflow_id']),outputSchema:{type:'object' as const},handler:async(a:any)=>({show:showEstimateWorkflow,resume:resumeEstimateWorkflow,cancel:cancelEstimateWorkflow,withdraw:withdrawEstimateWorkflow}[action])(a.workflow_id),readOnly:action==='show',network:['resume','withdraw'].includes(action),_meta:{ui:{resourceUri:estimateWorkflowWidgetUri}}})),
 {name:'get_estimate_workflow_pdf',description:'Download fixed local PDF; no remote request or rate refresh.',inputSchema:object({workflow_id:str},['workflow_id']),outputSchema:{type:'object' as const},handler:async(a:any)=>{const dir=await workflowDirectory(a.workflow_id);return {file_base64:(await readDocumentFile(dir,'estimate.pdf',8*1024*1024)).toString('base64')};},readOnly:true,network:false}
];
const tools = [
 ...workflowTools,
  {name:'show_document',description:'Display a portable fixed document independently of its original run or current rules. No external send. Buttons request distinct proof or stateless display actions; rendering is never consent.',inputSchema:object({document_dir:str},['document_dir']),outputSchema:{type:'object' as const},handler:async(args:any)=>showDocument(args.document_dir),readOnly:true,network:false,_meta:{ui:{resourceUri:documentWidgetUri}}},
  ...(['pdf','markdown','proof'] as const).map(kind=>({name:'get_document_'+kind,description:'Download the fixed local document '+kind+' without external send. Attached proof data does not imply a currently valid certificate.',inputSchema:object({document_dir:str},['document_dir']),outputSchema:{type:'object' as const},handler:async(args:any)=>{const view=await showDocument(args.document_dir);if(kind==='pdf'&&!view.pdf)throw new Error('DOCUMENT_PDF_NOT_READY');if(kind==='proof'&&!view.proof)throw new Error('DOCUMENT_PROOF_REQUIRED');return {file_base64:(await readDocumentFile(args.document_dir,kind==='pdf'?'estimate.pdf':kind==='proof'?'proof.json':'estimate.md',8*1024*1024)).toString('base64')};},readOnly:true,network:false})),
  {name:"preview_saved_estimate",description:"Display an already prepared local result and PDF without sending estimate data to Open Estimate. The publication button sends a user-authored chat choice; rendering does not publish.",inputSchema:object({preview_id:str},["preview_id"]),outputSchema:{type:"object" as const},handler:async(args:any)=>showResultPreview(args.preview_id),readOnly:true,network:false,_meta:{ui:{resourceUri:resultWidgetUri}}},
  {name:"get_result_pdf",description:"Read the verified local PDF for the displayed result. Does not send or publish.",inputSchema:object({preview_id:str},["preview_id"]),outputSchema:{type:"object" as const},handler:async(args:any)=>{const view=await showResultPreview(args.preview_id);if(!view.pdf)throw new Error("PDF_REQUIRED");return {preview_id:args.preview_id,pdf_base64:(await files.readFile(view.pdf.path)).toString("base64")};},readOnly:true,network:false},
  { name: "discover_workspace", description: "Scan metadata only, then show_estimate_start. Do NOT request a separate path confirmation or call confirm_workspace in the standard flow. Start-card selection authorizes source reading.", inputSchema: object({ context_path: str, relative_path: str, scope:scopeSchema }), outputSchema: { type: "object" as const }, handler: async (_: any) => ({}), readOnly: true, network: false },
  { name: "confirm_workspace", description: "Deprecated compatibility operation only. Not part of normal start: use discover_workspace then show_estimate_start. A prior legacy confirmation does not replace the start card.", inputSchema: object({ candidate_id: str, user_confirmed: { type: "boolean" } }, ["candidate_id", "user_confirmed"]), outputSchema: { type: "object" as const }, handler: async (_: any) => ({}), readOnly: false, network: false },
  { name: "get_assessor_contract", description: "Get the schema, trusted assessor workflow, configured workspace, TEST coefficients, scope and capabilities. Call before reading source.", inputSchema: object({}),
    outputSchema: { type: "object" as const, required: ["schema", "skill", "profile", "capabilities"] }, handler: handleGetAssessorContract, readOnly: true, network: false },
  {name:'get_assessor_contract_page',description:'Read bounded schema/instruction pages. section=assessment or draft; optional RFC6901 pointer selects e.g. /properties/quality. No source access or consent required.',inputSchema:object({section:{enum:['assessment','draft','instructions']},pointer:str,cursor:str,limit:{type:'integer',minimum:1,maximum:100}},['section']),outputSchema:{type:'object' as const},handler:assessorContractPage,readOnly:true,network:false},
  { name: "prepare_repository", description: "Acquire once, then reuse the existing snapshot, input defaults and read ledger. Do not reacquire to inspect files or repair Assessment. Use get_repository_snapshot for inspection. Only explicit refresh_snapshot/refresh_preflight or a changed split setting copies again; source code is never executed or uploaded.",
    inputSchema: object({ relative_path: { type: "string", maxLength: 1024 }, response_format:{enum:['summary','legacy']}, refresh_snapshot:{type:'boolean'},refresh_preflight:{type:"boolean"}, split_acquisition:{type:"boolean"} }), outputSchema: { type: "object" as const, required: ["snapshot_id", "summary"] }, handler: handlePrepareRepository, readOnly: false, network: false },
  {name:'get_repository_snapshot',description:'Get a compact saved snapshot summary. For files, read ranges or issues use get_repository_snapshot_page. Never reacquires sources. legacy format is limited to small responses; use pages for large projects.',inputSchema:object({snapshot_id:str,response_format:{enum:['summary','legacy']}}),outputSchema:{type:'object' as const},handler:async(a:any)=>snapshotSummary(a.snapshot_id),readOnly:true,network:false},
  {name:'get_workspace_page',description:'Page metadata-only files, scope or issues before the start card. No source bodies or extra consent.',inputSchema:object({section:{enum:['files','scope','issues']},cursor:str,limit:{type:'integer',minimum:1,maximum:100}},['section']),outputSchema:{type:'object' as const},handler:async(_:any)=>({}),readOnly:true,network:false},
  {name:'get_repository_snapshot_page',description:'Page saved manifest, issues, read ranges, exclusions, scope or full acquisition JSON fragments. Each MCP response stays under 64 KiB; follow next_cursor. No copying or source reading.',inputSchema:object({snapshot_id:str,section:{enum:['manifest','issues','reads','exclusions','scope','acquisition_record']},cursor:str,limit:{type:'integer',minimum:1,maximum:100}},['snapshot_id','section']),outputSchema:{type:'object' as const},handler:async(a:any)=>snapshotPage(a),readOnly:true,network:false},
  {name:'save_assessment_draft',description:'Save unvalidated AI-owned Assessment fields for a workflow/snapshot. Default collector mode: omit input; collector facts are injected locally. Drafts never imply validation, proof or publication. Same input/read revision reuses the draft.',inputSchema:object({workflow_id:str,snapshot_id:str,assessment:{type:'string',maxLength:8388608},input_mode:{enum:['collector','legacy']},...display},['workflow_id','snapshot_id','assessment']),outputSchema:{type:'object' as const},handler:async(a:any)=>saveWorkflowDraft(a),readOnly:false,network:false},
  {name:'evaluate_assessment_draft',description:'Validate a saved draft and durably save/link a run before optional display. Retry the same draft after response loss; get_workflow_evaluation recovers its validated run. Never reconstruct collector facts or reacquire for input repair.',inputSchema:object({workflow_id:str,draft_id:str},['workflow_id','draft_id']),outputSchema:{type:'object' as const},handler:async(_:any)=>({}),readOnly:false,network:true},
  {name:'get_workflow_evaluation',description:'Recover latest saved draft/validation/run identifiers without reading sources or refreshing FX. A verified COMPLETE run is recoverable after response loss; never select a run by modification time.',inputSchema:object({workflow_id:str,draft_id:str},['workflow_id']),outputSchema:{type:'object' as const},handler:async(a:any)=>getWorkflowEvaluation(a.workflow_id,a.draft_id),readOnly:false,network:false},
  {name:'recover_saved_workflow_run',description:'Explicitly associate an existing COMPLETE, checksum-verified run with its original approved workflow and snapshot. Rejects target, acquisition or rules mismatches. Does not publish or rewrite the run.',inputSchema:object({workflow_id:str,run_id:str},['workflow_id','run_id']),outputSchema:{type:'object' as const},handler:async(a:any)=>recoverSavedWorkflowRun(a),readOnly:false,network:false},
  {name:'get_assessment_draft_page',description:'Page draft fields, original submission fragments, validation errors, save attempts or revision history. Follow next_cursor; never reacquires sources.',inputSchema:object({workflow_id:str,draft_id:str,section:str,cursor:str,limit:{type:'integer',minimum:1,maximum:100}},['workflow_id','section']),outputSchema:{type:'object' as const},handler:async(a:any)=>workflowDraftPage(a),readOnly:true,network:false},
  {name:"authorize_partial",description:"Only after the user explicitly requests an acquired-portion estimate, allow analysis of this incomplete snapshot. Project total remains uncalculated.",
    inputSchema:object({snapshot_id:str,user_requested_partial:{const:true}},["snapshot_id","user_requested_partial"]),outputSchema:{type:"object" as const},
    handler:async (args:any)=>{const entry=mcpState.getSnapshot(args.snapshot_id);if(!entry)throw new Error("SNAPSHOT_NOT_FOUND");entry.snapshot.analysis_ready=true;if(entry.snapshot.acquisition)entry.snapshot.acquisition.partial_authorized=true;return {status:"PARTIAL_AUTHORIZED",notice:"プロジェクト全体の工数は未算出"};},readOnly:false,network:false},
  { name: "read_repository_file", description: "Read a snapshot file with numbered lines and track coverage. Follow has_more/next_start_line; unread files cannot support accepted evidence.",
    inputSchema: object({ snapshot_id: str, file_id: str, start_line: { type: "integer", minimum: 1 }, max_lines: { type: "integer", minimum: 1, maximum: 400 } }, ["snapshot_id", "file_id"]),
    outputSchema: { type: "object" as const, required: ["file_id", "content", "sha256", "has_more"] }, handler: handleReadRepositoryFile, readOnly: false, network: false },
  { name: "evaluate_assessment", description: "Validate a raw Assessment JSON string against snapshot evidence; calculate CFP and TEST design/implementation/test effort, save locally, and fetch FRB for this display. Planning/operations excluded. Does not issue or publish.",
    inputSchema: object({ snapshot_id: str, assessment: { type: "string", minLength: 2, maxLength: 8388608 },response_format:{enum:['summary','legacy']}, ...display }, ["snapshot_id", "assessment"]),
    outputSchema: definition("AnyEvaluationView"), handler: handleEvaluateAssessment, readOnly: false, network: true },
  { name: "get_evaluation", description: "Load a local evaluation ID and recalculate the displayed currency using the latest FRB release. Fixed CFP/hours/USD/hash remain unchanged; works after restart in the same configured workspace.",
    inputSchema: object({ evaluation_id: str, ...display }, ["evaluation_id"]), outputSchema: definition("EvaluationView"), handler: handleGetEvaluation, readOnly: true, network: true },
  { name: "render_report", description: "Generate a private local HTML review report with process counts, evidence, exclusions, TEST label, and a newly calculated FRB display quote. The exported HTML records generation time; rerun to refresh.",
    inputSchema: object({ evaluation_id: str, ...display }, ["evaluation_id"]), outputSchema: output({ evaluation_id: str, path: str, format: { const: "html" }, signed: { const: false }, published: { const: false }, report_hash: str, display_quote: definition("DisplayQuote"), notices: { type: "array", items: { type: "string" } } }, ["evaluation_id", "path", "format", "signed", "published", "report_hash", "display_quote", "notices"]),
    handler: handleRenderReport, readOnly: false, network: true }
];
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
const validators = new Map(tools.map(t => [t.name, ajv.compile(t.inputSchema)]));

export function createMcpServer(): Server {
  let previousSnapshot: string | undefined;
  let pendingWorkflow:{workflow_id:string;candidate_id:string;rules:BoundRules}|undefined;
  let activeWorkflow:string|undefined;let activeRules:BoundRules|undefined;
  let restoreFailed=false;
  let preparing:Promise<any>|undefined;
  let startQueue=Promise.resolve();
  const serializeStart=<T>(fn:()=>Promise<T>)=>{const op=startQueue.then(fn);startQueue=op.then(()=>{},()=>{});return op;};
  const server = new Server({ name: "open-estimate", version: "0.3.0" }, { capabilities: { tools: {}, resources: {}, prompts: {}, extensions:{'io.modelcontextprotocol/ui':{}} } });
  const workspace = new WorkspaceSession(server, () => {mcpState.clearSnapshots();previousSnapshot=undefined;activeWorkflow=undefined;activeRules=undefined;pendingWorkflow=undefined;restoreFailed=false;});
  const activateExisting=async(id:string)=>{
    const saved=await readWorkflowFile<any>(id,'state.json');if(!saved.consent)throw Error('WORKFLOW_START_REQUIRED');
    if(activeWorkflow&&activeWorkflow!==id)throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
    const context=await readWorkflowData<{binding:WorkspaceBinding;rules:BoundRules}>(id,'mcp-context.json').catch((e:any)=>{if(e.code==='ENOENT')return null;throw e;});
    if(!context)return false;
    if(context.binding.root!==saved.target_ref||jcsSha256(context.rules.ruleset_ref)!==jcsSha256(saved.terms.ruleset_ref))throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
    await approvedWorkflow(id,{target_hash:jcsSha256(context.binding.root),plan_hash:context.binding.plan.fingerprint});await workspace.restore(context.binding);activeWorkflow=id;activeRules=context.rules;
    if(!previousSnapshot){try{const restored=await restoreWorkflowSnapshot(id,context.binding.root);previousSnapshot=restored?.snapshot_id;restoreFailed=false;}catch(e){restoreFailed=true;throw e;}}
    return true;
  };
  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => workspace.reset());
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema,_meta:"_meta" in t?t._meta:undefined,
      annotations: { readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.name === "get_assessor_contract" || t.name === "read_repository_file", openWorldHint: t.network } }))
  }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const tool = tools.find(t => t.name === request.params.name);
      if (!tool) throw new Error("UNKNOWN_TOOL");
      const args = request.params.arguments ?? {};
      const validate = validators.get(tool.name)!;
      if (!validate(args)) return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "INVALID_TOOL_ARGUMENTS", details: validate.errors?.map(e => ({ pointer: e.instancePath, message: e.message })) } }) }] };
      let result: any;
      if(workflowTools.some(t=>t.name===tool.name)){
        if(tool.name==='show_estimate_start'){
          result=await serializeStart(async()=>{
          const rules=validateBoundRules(args.rules_response,inspectSkillPackage(fileURLToPath(new URL('../../skills/open-estimate-assessor/',import.meta.url))));
          if(activeWorkflow){await workspace.requireRoot();const saved=await readWorkflowFile<any>(activeWorkflow,'state.json');if(args.display_currency&&args.display_currency!==saved.terms.display_currency||jcsSha256(rules.ruleset_ref)!==jcsSha256(saved.terms.ruleset_ref))throw Error('WORKFLOW_START_TERMS_CHANGED');return showEstimateWorkflow(activeWorkflow);}
          const c=await workspace.candidate(),currency=(args.display_currency as string)??'JPY';
          let view:any;
          if(pendingWorkflow&&pendingWorkflow.candidate_id===c.candidate_id&&jcsSha256(pendingWorkflow.rules)===jcsSha256(rules)){
            view=await showEstimateStart(pendingWorkflow.workflow_id);
            if(view.terms.display_currency!==currency)throw Error('WORKFLOW_START_TERMS_CHANGED');
          }else{
            view=await prepareEstimateStart({target_ref:c.root,target_hash:jcsSha256(c.root),plan_ref:c.candidate_id,plan_hash:c.plan.fingerprint,ruleset_ref:rules.ruleset_ref,display_currency:currency});
            await writeWorkflowData(view.workflow_id,'mcp-context.json',{binding:await workspace.binding(),rules});
            pendingWorkflow={workflow_id:view.workflow_id,candidate_id:c.candidate_id,rules};
          }
          return bounded({...view,acquisition:publicAcquisition(c.plan.summary),scope:c.plan.scope.slice(0,10),scope_rule_count:c.plan.scope.length,scope_details_tool:'get_workspace_page',confirmation_mode:args.confirmation_mode??'card',chat_confirmation_required:args.confirmation_mode==='chat',next_action:args.confirmation_mode==='chat'?'ASK_ONE_CHAT_SELECTION':'WAIT_FOR_START_CARD_SELECTION',notice:view.notice+(c.plan.scope.length>10?' 範囲規則は先頭10件を表示しています。残りはget_workspace_pageで確認できます。':'')+(args.confirmation_mode==='chat'?' カード非対応のため同じ条件をチャットで一度だけ選択してください。':' このカードで一度だけ選択してください。別の質問フォームで同じ確認を重ねないでください。')});
          });
        }else if(tool.name==='start_estimate_workflow'){
          result=await serializeStart(async()=>{
          const saved=await readWorkflowFile<any>(args.workflow_id as string,'state.json');
          if(saved.consent){
            const view=await startEstimateWorkflow(args as any);
            if(activeWorkflow&&activeWorkflow!==args.workflow_id)throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
            const available=await activateExisting(args.workflow_id as string);
            return {...view,start_reused:true,snapshot_id:previousSnapshot??null,acquisition_context_available:available,next_action:'CONTINUE_EXISTING_WORKFLOW_DO_NOT_RESTART_DISCOVERY'};
          }
          const c=await workspace.candidate();if(!pendingWorkflow||pendingWorkflow.workflow_id!==args.workflow_id||pendingWorkflow.candidate_id!==c.candidate_id)throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
          const view=await startEstimateWorkflow(args as any);await workspace.confirm({candidate_id:c.candidate_id,user_confirmed:true});activeWorkflow=args.workflow_id as string;activeRules=pendingWorkflow.rules;pendingWorkflow=undefined;return {...view,start_reused:false,next_action:'ACQUIRE_ONCE_THEN_ANALYZE'};
          });
        }else {result=await tool.handler(args as any);if(tool.name==='show_estimate_workflow'&&!activeWorkflow&&result.selection?.read&&result.status!=='CANCELLED'){try{result.analysis_context_restored=await activateExisting(args.workflow_id as string);result.snapshot_id=previousSnapshot??null;}catch(e:any){result.analysis_resume_error=/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'WORKFLOW_RESTORE_FAILED';}}}
        if(tool.name==='get_estimate_workflow_pdf')return {structuredContent:{status:'FILE_READY'},content:[{type:'text' as const,text:'固定したPDFを取得しました。'}],_meta:{file_base64:result.file_base64}};
        const uri=tool.name==='show_estimate_start'&&result.status==='AWAITING_START_SELECTION'?estimateStartWidgetUri:estimateWorkflowWidgetUri;
        return {structuredContent:result,content:[{type:'text' as const,text:JSON.stringify(result)}],_meta:{ui:{resourceUri:uri}}};
      }
      if(['show_document','get_document_pdf','get_document_markdown','get_document_proof'].includes(tool.name)){
        result=await tool.handler(args as any);
        if(tool.name!=='show_document')return {structuredContent:{status:'FILE_READY'},content:[{type:'text' as const,text:'ローカル文書を取得しました。'}],_meta:{file_base64:result.file_base64}};
        return {structuredContent:result,content:[{type:'text' as const,text:JSON.stringify(result)}],_meta:{ui:{resourceUri:documentWidgetUri}}};
      }
      if(tool.name==="get_result_pdf"||tool.name==="preview_saved_estimate") {
        result=await tool.handler(args as any);
        if(tool.name==="get_result_pdf")return {structuredContent:{preview_id:result.preview_id,status:"PDF_READY"},content:[{type:"text" as const,text:"ローカルPDFを取得しました。"}],_meta:{pdf_base64:result.pdf_base64}};
        return {structuredContent:result,content:[{type:"text" as const,text:JSON.stringify(result)}],_meta:{ui:{resourceUri:resultWidgetUri}}};
      }
      if (tool.name === "discover_workspace") {result = await workspace.discover(args);if(result.summary)result={...result,summary:publicDiscovery(result.summary)};}
      else if (tool.name === "confirm_workspace") result = await workspace.confirm(args as any);
      else if(tool.name==='get_workspace_page'){const b=await workspace.binding();const section=args.section as string;result=pageRows(section==='files'?b.plan.files:section==='scope'?b.plan.scope:b.plan.summary.issues,section,args.cursor as string|undefined,args.limit as number|undefined,b.plan.fingerprint);}
      else if(['get_workflow_evaluation','get_assessment_draft_page','recover_saved_workflow_run'].includes(tool.name))result=await tool.handler(args as any);
      else if (tool.name === "get_assessor_contract") result = { ...summarizeAssessorContract(await handleGetAssessorContract()), workspace_root: workspace.current(), workspace_selection: "discover_then_start_card", requires_workspace_confirmation: false };
      else if(tool.name==='get_assessor_contract_page')result=await assessorContractPage(args as any);
      else {
        const root = await workspace.requireRoot();
        if(activeWorkflow){const options=await workspace.acquisitionOptions(false);await approvedWorkflow(activeWorkflow,{target_hash:jcsSha256(root),plan_hash:options.preflight.fingerprint});}
        if (tool.name === "prepare_repository") {
          if(restoreFailed&&args.refresh_snapshot!==true)throw Error('SNAPSHOT_RESTORE_FAILED_EXPLICIT_REFRESH_REQUIRED');
          if (args.relative_path && args.relative_path !== ".") throw new Error("TARGET_CHANGE_REQUIRES_DISCOVERY");
          const prior=previousSnapshot?mcpState.getSnapshot(previousSnapshot):undefined;
          const splitChanged=typeof args.split_acquisition==='boolean'&&prior&&args.split_acquisition!==(prior.snapshot.acquisition_record as any)?.split_acquisition;
          const refresh=args.refresh_snapshot===true||args.refresh_preflight===true||splitChanged;
          if(preparing){if(refresh)throw Error('ACQUISITION_IN_PROGRESS');await preparing;result=await workspaceContext.run(root,()=>snapshotSummary(previousSnapshot!));}
          else if(previousSnapshot&&!refresh)result=await workspaceContext.run(root,()=>snapshotSummary(previousSnapshot!));
          else{
          const acquisitionRevision=workspace.revision();
          preparing=(async()=>{
          const before=await workspace.acquisitionOptions(false);
          const options = await workspace.acquisitionOptions(args.refresh_preflight === true);
          if(activeWorkflow&&before.preflight.fingerprint!==options.preflight.fingerprint)await approveWorkflowAcquisition(activeWorkflow,jcsSha256(root),before.preflight,options.preflight);
          const prepared = await workspaceContext.run(root,()=>handlePrepareRepository({...options,response_format:'summary',relative_path:".",previous_snapshot_id:previousSnapshot,split_acquisition:args.split_acquisition === true,partial_authorized:!!activeWorkflow}));
          if(workspace.revision()!==acquisitionRevision){mcpState.removeSnapshot(prepared.snapshot_id);throw Error('PROJECT_CHANGED_RECONFIRM_REQUIRED');}
          if(activeWorkflow){await saveWorkflowSnapshot(activeWorkflow,prepared.snapshot_id);await writeWorkflowData(activeWorkflow,'mcp-context.json',{binding:await workspace.binding(),rules:activeRules});}
          previousSnapshot=prepared.snapshot_id;
          restoreFailed=false;
          return prepared;
          })();try{result=await preparing;}finally{preparing=undefined;}
          }
        }else if(tool.name==='get_repository_snapshot'){
          result=await workspaceContext.run(root,()=>snapshotSummary((args.snapshot_id as string|undefined)??previousSnapshot??''));
        }else if(tool.name==='evaluate_assessment_draft'){
          if(!activeWorkflow||!activeRules||activeWorkflow!==args.workflow_id)throw Error('WORKFLOW_ANALYSIS_CONTEXT_REQUIRED');
          result=await workspaceContext.run(root,()=>evaluateWorkflowDraft(args as any,activeRules!));
        }else if(tool.name==='save_assessment_draft'){
          if(activeWorkflow!==args.workflow_id)throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');result=await workspaceContext.run(root,()=>tool.handler(args as any));
        } else if(tool.name==='evaluate_assessment'&&activeWorkflow&&activeRules){
          result=await workspaceContext.run(root,async()=>{
            const draft=await saveWorkflowDraft({...args as any,workflow_id:activeWorkflow!,input_mode:'legacy'});
            return evaluateWorkflowDraft({workflow_id:activeWorkflow!,draft_id:draft.draft_id!,legacy_view:args.response_format==='legacy'},activeRules!);
          });
        } else {
          result = await workspaceContext.run(root, () => tool.handler(args as any));
          if(tool.name==='read_repository_file'&&activeWorkflow&&previousSnapshot===args.snapshot_id)await saveWorkflowSnapshot(activeWorkflow,previousSnapshot);
        }
        if(['prepare_repository','get_repository_snapshot'].includes(tool.name)&&args.response_format==='legacy')result=await workspaceContext.run(root,()=>bounded({...handleGetRepositorySnapshot(result.snapshot_id),snapshot_reused:result.snapshot_reused,acquisition_performed:result.acquisition_performed}));
      }
      return { structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      // Never log source, raw assessment, network body or absolute OS error paths.
      const code = /^[A-Z][A-Z0-9_]+$/.test(err.message) ? err.message : err.errors ? "ASSESSMENT_VALIDATION_FAILED" : "TOOL_EXECUTION_ERROR";
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message: code, ...(Array.isArray(err.errors)?{total_errors:err.errors.length,details:err.errors.slice(0,10).map((e:any)=>({code:e.code,pointer:String(e.pointer??'').slice(0,300),message:String(e.message??'').slice(0,300)}))}:{}),...(err instanceof WorkflowCompletionError?{stage:err.stage,recovery_action:err.recovery_action}:{}) } }) }] };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{uri:estimateStartWidgetUri,name:"Estimate workflow start",mimeType:"text/html;profile=mcp-app"},{uri:estimateWorkflowWidgetUri,name:"Estimate workflow result",mimeType:"text/html;profile=mcp-app"},...OES_RESOURCES,{uri:documentWidgetUri,name:'Portable estimate document',mimeType:'text/html;profile=mcp-app'},{uri:resultWidgetUri,name:"Legacy local estimate result",mimeType:"text/html;profile=mcp-app"}] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => ({ contents: [request.params.uri===estimateStartWidgetUri||request.params.uri===estimateWorkflowWidgetUri?{uri:request.params.uri,mimeType:'text/html;profile=mcp-app',text:request.params.uri===estimateStartWidgetUri?estimateStartWidgetHtml:estimateWorkflowWidgetHtml,_meta:{ui:{permissions:{clipboardWrite:{}},csp:{connectDomains:[],resourceDomains:[]}}}}:request.params.uri===documentWidgetUri?{uri:documentWidgetUri,mimeType:'text/html;profile=mcp-app',text:documentWidgetHtml,_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}}}:request.params.uri===resultWidgetUri?{uri:resultWidgetUri,mimeType:"text/html;profile=mcp-app",text:resultWidgetHtml,_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}}}:await handleReadResource(request.params.uri)] }));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "cosmic-assessment", description: "Assess implemented source with evidence, TEST effort and current FRB conversion", arguments: [{ name: "relative_path", required: false }] }] }));
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    if (request.params.name !== "cosmic-assessment") throw new Error("UNKNOWN_PROMPT");
    return { messages: [{ role: "user" as const, content: { type: "text" as const, text: "Open Estimateで対象を評価してください。最初にget_assessor_contractを取得し、workspace_rootとデータ取扱いを説明してください。対象相対パス: " + JSON.stringify(request.params.arguments?.relative_path ?? ".") + "。契約のSkillに沿ってsnapshotの実装根拠からAssessmentを作り、TEST係数、設計・実装・テストの範囲、未読・未解決点を明示してください。" } }] };
  });
  return server;
}
export async function runStdioServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
