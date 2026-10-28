import {proofRequestSchema} from '../contracts/document.js';
import {issueDocumentProof,type DocumentIssuerEnvironment} from '../issuer/runtime.js';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListResourcesRequestSchema, ReadResourceRequestSchema, ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { parseStrictJson } from "../core/json-parser.js";
import type { LocalProfile } from "../core/evaluation.js";
import profile from "../../profiles/local-test.json" with { type: "json" };
import { defaultRegistry, getSkillPolicy, type SkillRegistry } from "./skill-integrity.js";
import pkg from "../../package.json" with { type: "json" };
import { defaultRulesRegistry, measurementRulesArgsSchema, resolveMeasurementRules } from "./measurement-rules.js";
import type { RulesRegistry } from "../rules/measurement-contract.js";

export default {
  async fetch(request: Request, registry: SkillRegistry | { OES_ENFORCEMENT_AT?: string; OES_RULES_ENFORCEMENT_AT?: string } & DocumentIssuerEnvironment = defaultRegistry, rules: RulesRegistry = defaultRulesRegistry): Promise<Response> {
    const environment:DocumentIssuerEnvironment = "releases" in registry ? {} : registry;
    // Cloudflare supplies ExecutionContext as argument three; tests may inject a registry.
    if (!Array.isArray(rules?.revisions)) rules = defaultRulesRegistry;
    // Cloudflare passes Env here; only tests pass an explicit registry.
    if (!("releases" in registry)) {
      const date = registry.OES_ENFORCEMENT_AT;
      const rulesDate = registry.OES_RULES_ENFORCEMENT_AT;
      rules = { ...rules, rules_enforcement_at: rules.rules_enforcement_at ?? (rulesDate && Number.isFinite(Date.parse(rulesDate)) ? rulesDate : null) };
      registry = { ...defaultRegistry, enforcement_at: defaultRegistry.enforcement_at ?? (date && Number.isFinite(Date.parse(date)) ? date : null) };
    }
    const policy = registry as SkillRegistry;
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return new Response("Forbidden origin", { status: 403 });
    if (!request.headers.get("content-type")?.includes("application/json")) return new Response("JSON required", { status: 415 });
    // Read with a hard cap regardless of Content-Length. Never log or persist bodies.
    const reader = request.body?.getReader();
    if (!reader) return new Response("Invalid request", { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 1024 * 1024) { await reader.cancel(); return new Response("Request too large", { status: 413 }); }
        chunks.push(value);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      const parsed = parseStrictJson(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Response("Invalid request", { status: 400 });
      const server = new Server({ name: "open-estimate-remote", title: "オープン工数見積：測定ルール・文書証明", version: pkg.version }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
        {name:"get_skill_policy",description:"Read skill policy without target sources.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true},securitySchemes:[{type:"noauth"}]},
        {name:"get_measurement_rules",description:"Get and bind the official measurement rules before reading source.",inputSchema:measurementRulesArgsSchema as any,annotations:{readOnlyHint:true},securitySchemes:[{type:"noauth"}]},
        {name:'issue_document_proof',title:'この文書の数値検証・証明を取得',description:'Only after explicit consent to this exact request and destination: verify the frozen numeric model, rules and standard Markdown, sign the document hash and return a portable proof. Anonymous; no owner identity, Web URL or document/model storage. Retry the identical operation after a lost response.',inputSchema:proofRequestSchema as any,annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true},securitySchemes:[{type:'noauth'}]}
      ]}));
      server.setRequestHandler(CallToolRequestSchema, async req => {
        try {
          if(req.params.name==='issue_document_proof'){
            const result=await issueDocumentProof(req.params.arguments,environment,{skills:policy,rules,now:Date.now()});
            return {structuredContent:result,content:[{type:"text",text:JSON.stringify(result)}]};
          }
          if (req.params.name === "get_skill_policy") {
            if (!req.params.arguments || Object.keys(req.params.arguments).length) throw new Error("INVALID_SKILL_POLICY_ARGUMENTS");
            const result = getSkillPolicy(policy);
            return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
          }
          if (req.params.name === "get_measurement_rules") {
            const result = resolveMeasurementRules(req.params.arguments, rules, policy);
            return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
          }
          throw new Error("UNKNOWN_TOOL");
        } catch (e: any) {
          const code = /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "REMOTE_EVALUATION_FAILED";
          const notice = req.params.name==='issue_document_proof' ? '文書証明は未取得です。元文書とPDFを保持してください。同じ内容は同じ操作IDで再送できます。内容・数値の不一致は差し替えず新しい文書版として確認してください。'
            : code === "RULESET_UNAVAILABLE" ? "配信側に有効な測定ルールがありません。運用側で配信を復旧してください。"
            : code === "RULESET_INCOMPATIBLE" ? "対応するプラグインへ更新してください。古いルールへの自動切替は行いません。"
            : code.startsWith("RULE") || code.includes("RULESET") || code.includes("MEASUREMENT_RULES") ? "正規ルールを取得して固定してください。未知・停止・変更された版は別版に差し替えず、新しい解析セッションで再解析してください。"
            : "正規最新版の実ファイルをCLIで検査し、変更・不一致時は新しい解析セッションを開始してください。";
          const result = { error: { code, notice } };
          return { isError: true, structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
        }
      });
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await server.connect(transport);
      try { return await transport.handleRequest(request, { parsedBody: parsed }); }
      finally { await server.close(); }
    } catch { return new Response("Invalid request", { status: 400 }); }
  }
};
