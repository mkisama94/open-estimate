import {experienceUiUri,experienceUiHtml} from "./experience-ui.js";
import {getExperienceCapabilities,experienceStepSchema,experienceStep,experienceResponse} from "./experience.js";
import {publicationRequestSchema} from "../core/estimate-publication.js";
import {publishAuthenticatedEstimate,publicationResourceMetadata,publicationAuthChallenge,protectedResourcePath,type EstimatePublicationEnvironment} from "./estimate-publishing.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListResourcesRequestSchema, ReadResourceRequestSchema, ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { evaluateRemote, remoteArgsSchema } from "./model.js";
import { parseStrictJson } from "../core/json-parser.js";
import type { LocalProfile } from "../core/evaluation.js";
import profile from "../../profiles/local-test.json" with { type: "json" };
import { defaultRegistry, getSkillPolicy, type SkillRegistry } from "./skill-integrity.js";
import pkg from "../../package.json" with { type: "json" };
import { defaultRulesRegistry, measurementRulesArgsSchema, resolveMeasurementRules } from "./measurement-rules.js";
import type { RulesRegistry } from "../rules/measurement-contract.js";

export default {
  async fetch(request: Request, registry: SkillRegistry | { OES_ENFORCEMENT_AT?: string; OES_RULES_ENFORCEMENT_AT?: string } & EstimatePublicationEnvironment = defaultRegistry, rules: RulesRegistry = defaultRulesRegistry): Promise<Response> {
    const environment:EstimatePublicationEnvironment = "releases" in registry ? {} : registry;
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
    if(url.pathname===protectedResourcePath && request.method==="GET"){try{return Response.json(publicationResourceMetadata(environment),{headers:{"Cache-Control":"no-store"}});}catch{return Response.json({error:"AUTH_CONFIGURATION_REQUIRED"},{status:503});}}
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
      const server = new Server({ name: "open-estimate-remote", title: "オープン工数見積：数値モデル再計算専用", version: pkg.version }, { capabilities: { tools: {}, resources: {} } });
      server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[{uri:experienceUiUri,name:"Open Estimate journey",mimeType:"text/html;profile=mcp-app"}]}));
      server.setRequestHandler(ReadResourceRequestSchema,async req=>{if(req.params.uri!==experienceUiUri)throw new Error("NOT_FOUND");return {contents:[{uri:experienceUiUri,mimeType:"text/html;profile=mcp-app",text:experienceUiHtml,_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}}}]};});
      server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
        {name:"get_estimate_experience",description:"Get general service availability without sending estimate data. Result preview and PDF are generated locally before consent.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true},securitySchemes:[{type:"noauth"}],_meta:{ui:{resourceUri:experienceUiUri}}},
        {name:"show_estimate_step",description:"Display a generic step, or the saved result URL after publication. Never send estimate data before consent.",inputSchema:experienceStepSchema as any,annotations:{readOnlyHint:true},securitySchemes:[{type:"noauth"}],_meta:{ui:{resourceUri:experienceUiUri}}},
        {name:"get_skill_policy",description:"Read skill policy without target sources.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true},securitySchemes:[{type:"noauth"}]},
        {name:"get_measurement_rules",description:"Get and bind the official measurement rules before reading source.",inputSchema:measurementRulesArgsSchema as any,annotations:{readOnlyHint:true},securitySchemes:[{type:"noauth"}]},
        {name:"publish_estimate",title:"この結果をWebに掲載する",description:"After the user explicitly consents in chat to the exact local preview and PDF, validate and save that immutable numeric result to their authenticated account for 30 days. Returns the saved URL directly; no browser confirmation, preview transfer or polling. Reuse the identical operation and consent for retries. No source, paths, ledger, public sharing or certificates.",inputSchema:publicationRequestSchema as any,annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true},securitySchemes:[{type:"oauth2",scopes:["estimates:write"]}]}
      ]}));
      server.setRequestHandler(CallToolRequestSchema, async req => {
        try {
          if(req.params.name==="get_estimate_experience"){if(!req.params.arguments || Object.keys(req.params.arguments).length)throw new Error("INVALID_INPUT");return experienceResponse({stage:"start",capabilities:await getExperienceCapabilities()});}
          if(req.params.name==="show_estimate_step")return experienceResponse(experienceStep(req.params.arguments));
          if(req.params.name==="publish_estimate"){
            const result=await publishAuthenticatedEstimate(request,req.params.arguments,environment,policy,rules);
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
          const notice = req.params.name==="publish_estimate" ? (["RESULT_MISMATCH","BASIS_MISMATCH"].includes(code)?"確認した数値または計算条件と一致しません。結果を差し替えず、差分を確認して新しいプレビューへ戻ってください。":code.startsWith("CONSENT")?"確認した掲載条件を再確認してください。元の結果とPDFは保持されています。":"掲載は未完了です。元の結果とPDFを保持し、接続設定や認証を確認して同じ掲載操作から再開してください。")
            : code === "RULESET_UNAVAILABLE" ? "配信側に有効な測定ルールがありません。運用側で配信を復旧してください。"
            : code === "RULESET_INCOMPATIBLE" ? "対応するプラグインへ更新してください。古いルールへの自動切替は行いません。"
            : code.startsWith("RULE") || code.includes("RULESET") || code.includes("MEASUREMENT_RULES") ? "正規ルールを取得して固定してください。未知・停止・変更された版は別版に差し替えず、新しい解析セッションで再解析してください。"
            : "正規最新版の実ファイルをCLIで検査し、変更・不一致時は新しい解析セッションを開始してください。";
          const result = { error: { code, notice } };
          if(code==="AUTH_REQUIRED")return {isError:true,content:[{type:"text",text:"ログインが必要です。同じ掲載操作を認証後に再実行してください。"}],_meta:{"mcp/www_authenticate":[publicationAuthChallenge]}};
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
