import {prepareEstimateStart,startEstimateWorkflow,extendEstimateWorkflow,approveWorkflowAcquisition,approvedWorkflow,showEstimateWorkflow,resumeEstimateWorkflow,cancelEstimateWorkflow,withdrawEstimateWorkflow} from '../local/estimate-workflow.js';
import {completeEstimateWorkflow} from '../local/complete-workflow.js';
import {readWorkflowFile,workflowDirectory} from '../local/workflow-store.js';
import {estimateStartWidgetUri,estimateStartWidgetHtml,estimateWorkflowWidgetUri,estimateWorkflowWidgetHtml} from '../local/workflow-widget.js';
import {validateBoundRules,validateRuleReferences,type BoundRules} from '../local/measurement-context.js';
import {inspectSkillPackage} from '../profiles/skill-package.js';
import {fileURLToPath} from 'node:url';
import {jcsSha256} from '../core/canonical.js';
import {validateSnapshotAssessment} from './tools/evaluate-assessment.js';
import {saveRun} from '../local/runs.js';
import path from 'node:path';
import { WorkspaceSession } from "./workspace-session.js";
import { workspaceContext } from "../collector/workspace-context.js";
import { mcpState } from "./state.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { handleGetAssessorContract } from "./tools/get-assessor-contract.js";
import { handlePrepareRepository } from "./tools/prepare-repository.js";
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
 {name:'show_estimate_start',description:'After metadata-only discovery and official rule binding, show scope, acquisition limits, data destinations and three unchecked read/verify/publish options. Display is never consent.',inputSchema:object({rules_response:{type:'object',additionalProperties:true},display_currency:{enum:[...CURRENCIES]}},['rules_response']),outputSchema:{type:'object' as const},handler:async(_:any)=>({}),readOnly:false,network:false,_meta:{ui:{resourceUri:estimateStartWidgetUri}}},
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
  { name: "discover_workspace", description: "Scan metadata and capacity only, with measurement/supporting/excluded scope rules. Confirm the returned scope before reading source.", inputSchema: object({ context_path: str, relative_path: str, scope:scopeSchema }), outputSchema: { type: "object" as const }, handler: async (_: any) => ({}), readOnly: true, network: false },
  { name: "confirm_workspace", description: "Confirm the exact scanned candidate only after the user agrees in chat. user_confirmed is an assistant report, not independent proof of consent. false cancels.", inputSchema: object({ candidate_id: str, user_confirmed: { type: "boolean" } }, ["candidate_id", "user_confirmed"]), outputSchema: { type: "object" as const }, handler: async (_: any) => ({}), readOnly: false, network: false },
  { name: "get_assessor_contract", description: "Get the schema, trusted assessor workflow, configured workspace, TEST coefficients, scope and capabilities. Call before reading source.", inputSchema: object({}),
    outputSchema: { type: "object" as const, required: ["schema", "skill", "profile", "capabilities"] }, handler: handleGetAssessorContract, readOnly: true, network: false },
  { name: "prepare_repository", description: "Snapshot a relative directory inside the configured workspace. Creates local cache; never executes target code or uploads it. Returns manifest and input defaults.",
    inputSchema: object({ relative_path: { type: "string", maxLength: 1024 }, refresh_preflight:{type:"boolean"}, split_acquisition:{type:"boolean"} }), outputSchema: { type: "object" as const, required: ["snapshot_id", "manifest", "assessment_input"] }, handler: handlePrepareRepository, readOnly: false, network: false },
  {name:"authorize_partial",description:"Only after the user explicitly requests an acquired-portion estimate, allow analysis of this incomplete snapshot. Project total remains uncalculated.",
    inputSchema:object({snapshot_id:str,user_requested_partial:{const:true}},["snapshot_id","user_requested_partial"]),outputSchema:{type:"object" as const},
    handler:async (args:any)=>{const entry=mcpState.getSnapshot(args.snapshot_id);if(!entry)throw new Error("SNAPSHOT_NOT_FOUND");entry.snapshot.analysis_ready=true;if(entry.snapshot.acquisition)entry.snapshot.acquisition.partial_authorized=true;return {status:"PARTIAL_AUTHORIZED",notice:"プロジェクト全体の工数は未算出"};},readOnly:false,network:false},
  { name: "read_repository_file", description: "Read a snapshot file with numbered lines and track coverage. Follow has_more/next_start_line; unread files cannot support accepted evidence.",
    inputSchema: object({ snapshot_id: str, file_id: str, start_line: { type: "integer", minimum: 1 }, max_lines: { type: "integer", minimum: 1, maximum: 400 } }, ["snapshot_id", "file_id"]),
    outputSchema: { type: "object" as const, required: ["file_id", "content", "sha256", "has_more"] }, handler: handleReadRepositoryFile, readOnly: false, network: false },
  { name: "evaluate_assessment", description: "Validate a raw Assessment JSON string against snapshot evidence; calculate CFP and TEST design/implementation/test effort, save locally, and fetch FRB for this display. Planning/operations excluded. Does not issue or publish.",
    inputSchema: object({ snapshot_id: str, assessment: { type: "string", minLength: 2, maxLength: 8388608 }, ...display }, ["snapshot_id", "assessment"]),
    outputSchema: definition("EvaluationView"), handler: handleEvaluateAssessment, readOnly: false, network: true },
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
  const server = new Server({ name: "open-estimate", version: "0.3.0" }, { capabilities: { tools: {}, resources: {}, prompts: {}, extensions:{'io.modelcontextprotocol/ui':{}} } });
  const workspace = new WorkspaceSession(server, () => {mcpState.clearSnapshots();previousSnapshot=undefined;activeWorkflow=undefined;activeRules=undefined;pendingWorkflow=undefined;});
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
          const c=await workspace.candidate();
          const rules=validateBoundRules(args.rules_response,inspectSkillPackage(fileURLToPath(new URL('../../skills/open-estimate-assessor/',import.meta.url))));
          result=await prepareEstimateStart({target_ref:c.root,target_hash:jcsSha256(c.root),plan_ref:c.candidate_id,plan_hash:c.plan.fingerprint,ruleset_ref:rules.ruleset_ref,display_currency:(args.display_currency as string)??'JPY'});
          result.acquisition=c.plan.summary;result.scope=c.plan.scope;
          pendingWorkflow={workflow_id:result.workflow_id,candidate_id:c.candidate_id,rules};
        }else if(tool.name==='start_estimate_workflow'){
          const c=await workspace.candidate();if(!pendingWorkflow||pendingWorkflow.workflow_id!==args.workflow_id||pendingWorkflow.candidate_id!==c.candidate_id)throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
          result=await startEstimateWorkflow(args as any);await workspace.confirm({candidate_id:c.candidate_id,user_confirmed:true});activeWorkflow=args.workflow_id as string;activeRules=pendingWorkflow.rules;pendingWorkflow=undefined;
        }else result=await tool.handler(args as any);
        if(tool.name==='get_estimate_workflow_pdf')return {structuredContent:{status:'FILE_READY'},content:[{type:'text' as const,text:'固定したPDFを取得しました。'}],_meta:{file_base64:result.file_base64}};
        const uri=tool.name==='show_estimate_start'?estimateStartWidgetUri:estimateWorkflowWidgetUri;
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
      if (tool.name === "discover_workspace") result = await workspace.discover(args);
      else if (tool.name === "confirm_workspace") result = await workspace.confirm(args as any);
      else if (tool.name === "get_assessor_contract") result = { ...await handleGetAssessorContract(), workspace_root: workspace.current(), workspace_selection: "discover_then_confirm", requires_workspace_confirmation: true };
      else {
        const root = await workspace.requireRoot();
        if(activeWorkflow){const options=await workspace.acquisitionOptions(false);await approvedWorkflow(activeWorkflow,{target_hash:jcsSha256(root),plan_hash:options.preflight.fingerprint});}
        if (tool.name === "prepare_repository") {
          if (args.relative_path && args.relative_path !== ".") throw new Error("TARGET_CHANGE_REQUIRES_DISCOVERY");
          const before=await workspace.acquisitionOptions(false);
          const options = await workspace.acquisitionOptions(args.refresh_preflight === true);
          if(activeWorkflow&&before.preflight.fingerprint!==options.preflight.fingerprint)await approveWorkflowAcquisition(activeWorkflow,jcsSha256(root),before.preflight,options.preflight);
          result = await workspaceContext.run(root,()=>handlePrepareRepository({...options,relative_path:".",previous_snapshot_id:previousSnapshot,split_acquisition:args.split_acquisition === true,partial_authorized:!!activeWorkflow}));
          previousSnapshot=result.snapshot_id;
        } else if(tool.name==='evaluate_assessment'&&activeWorkflow&&activeRules){
          result=await workspaceContext.run(root,async()=>{
            const {validated}=await validateSnapshotAssessment(args as any);validateRuleReferences(validated,activeRules!);
            const snapshot=mcpState.getSnapshot(args.snapshot_id as string)!.snapshot;
            const run=await saveRun(validated,validated,{ruleset_ref:activeRules!.ruleset_ref,bundle:activeRules!.bundle},root,snapshot.acquisition_record);
            return {...await tool.handler(args as any),...run,workflow_id:activeWorkflow};
          });
        } else result = await workspaceContext.run(root, () => tool.handler(args as any));
      }
      return { structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      // Never log source, raw assessment, network body or absolute OS error paths.
      const code = /^[A-Z][A-Z0-9_]+$/.test(err.message) ? err.message : err.errors ? "ASSESSMENT_VALIDATION_FAILED" : "TOOL_EXECUTION_ERROR";
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message: code, details: err.errors } }) }] };
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
