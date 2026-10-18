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

const contract = JSON.parse(fs.readFileSync(new URL("../../contracts/local-preview.schema.json", import.meta.url), "utf8"));
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false });
const str = { type: "string", minLength: 1, maxLength: 1024 };
const display = { locale: { type: "string", maxLength: 64 }, display_currency: { type: "string", enum: [...CURRENCIES] } };
const output = (properties: Record<string, unknown>, required: string[]) => object(properties, required);
const definition = (key: string) => ({ ...contract.$defs[key], $defs: contract.$defs });
const tools = [
  { name: "discover_workspace", description: "Scan file names and structure only. Prefer MCP roots; if unsupported, supply the current project absolute path from conversation context, never guess. Show the returned candidate and ask user confirmation before confirm_workspace.", inputSchema: object({ context_path: str, relative_path: str }), outputSchema: { type: "object" as const }, handler: async (_: any) => ({}), readOnly: true, network: false },
  { name: "confirm_workspace", description: "Confirm the exact scanned candidate only after the user agrees in chat. user_confirmed is an assistant report, not independent proof of consent. false cancels.", inputSchema: object({ candidate_id: str, user_confirmed: { type: "boolean" } }, ["candidate_id", "user_confirmed"]), outputSchema: { type: "object" as const }, handler: async (_: any) => ({}), readOnly: false, network: false },
  { name: "get_assessor_contract", description: "Get the schema, trusted assessor workflow, configured workspace, TEST coefficients, scope and capabilities. Call before reading source.", inputSchema: object({}),
    outputSchema: { type: "object" as const, required: ["schema", "skill", "profile", "capabilities"] }, handler: handleGetAssessorContract, readOnly: true, network: false },
  { name: "prepare_repository", description: "Snapshot a relative directory inside the configured workspace. Creates local cache; never executes target code or uploads it. Returns manifest and input defaults.",
    inputSchema: object({ relative_path: { type: "string", maxLength: 1024 } }), outputSchema: { type: "object" as const, required: ["snapshot_id", "manifest", "assessment_input"] }, handler: handlePrepareRepository, readOnly: false, network: false },
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
  const server = new Server({ name: "open-estimate", version: "0.3.0" }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
  const workspace = new WorkspaceSession(server, () => mcpState.clearSnapshots());
  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => workspace.reset());
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema,
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
      if (tool.name === "discover_workspace") result = await workspace.discover(args);
      else if (tool.name === "confirm_workspace") result = await workspace.confirm(args as any);
      else if (tool.name === "get_assessor_contract") result = { ...await handleGetAssessorContract(), workspace_root: workspace.current(), workspace_selection: "discover_then_confirm", requires_workspace_confirmation: true };
      else {
        const root = await workspace.requireRoot();
        result = await workspaceContext.run(root, () => tool.handler(args as any));
      }
      return { structuredContent: result, content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: any) {
      // Never log source, raw assessment, network body or absolute OS error paths.
      const code = /^[A-Z][A-Z0-9_]+$/.test(err.message) ? err.message : err.errors ? "ASSESSMENT_VALIDATION_FAILED" : "TOOL_EXECUTION_ERROR";
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message: code, details: err.errors } }) }] };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: OES_RESOURCES }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => ({ contents: [await handleReadResource(request.params.uri)] }));
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
