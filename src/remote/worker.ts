import {previewUiUri,previewUiHtml} from "./preview-ui.js";
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
  async fetch(request: Request, registry: SkillRegistry | { OES_ENFORCEMENT_AT?: string; OES_RULES_ENFORCEMENT_AT?: string } = defaultRegistry, rules: RulesRegistry = defaultRulesRegistry): Promise<Response> {
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
      const server = new Server({ name: "open-estimate-remote", title: "オープン工数見積：数値モデル再計算専用", version: pkg.version }, { capabilities: { tools: {}, resources: {} } });
      server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[{uri:previewUiUri,name:"Open Estimate confirmation",mimeType:"text/html;profile=mcp-app"}]}));
      server.setRequestHandler(ReadResourceRequestSchema,async req=>{if(req.params.uri!==previewUiUri)throw new Error("NOT_FOUND");return {contents:[{uri:previewUiUri,mimeType:"text/html;profile=mcp-app",text:previewUiHtml,_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}}}]};});
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{name:"show_preview_confirmation",title:"送信内容を確認する",description:"ローカルCLIが返したtransfer_idから公式Webの送信確認ボタンを表示します。ソースや数値モデルは渡さないでください。表示だけでは同意・送信になりません。",inputSchema:{type:"object",properties:{transfer_id:{type:"string",pattern:"^pt_[a-f0-9]{32}$"}},required:["transfer_id"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false},_meta:{ui:{resourceUri:previewUiUri}}},{ name: "get_skill_policy", description: "対象ソースを送らず、スキルの整合性申告ポリシーを取得します。実ファイルから計算し、正規値を転記しないでください。", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }, { name: "get_measurement_rules", description: "実計算したスキル情報を照合し、互換な測定ルールの全文と版を返します。対象ソース・対象パスは送らないでください。取得した本文をbind-rulesで解析セッションへ固定してください。", inputSchema: measurementRulesArgsSchema as any, annotations: { readOnlyHint: true, destructiveHint: false } }, { name: "evaluate_model",
        title: "数値モデル再計算専用（フォルダー走査・ソース解析なし）",
        description: "数値モデル・表示通貨・配布スキルのID/版/整合性確認用ハッシュ・固定した測定ルールのruleset_refを送信します。対象ソース、対象パス、Assessment、判断台帳、ルール本文、ローカルcontextは送信しません。対象ソースコード、名称、説明、ファイルパス、根拠本文、対象ソースのハッシュは送信しません。正規配布版との申告ハッシュ一致を確認してから再計算します。PC上のフォルダーの走査やソース解析は行いません。フォルダーパス・ソースを渡さないでください。ソースからの見積りには対象を読取・補助CLIを実行できるWork／Codexとソース解析用プラグインが必要です。Recalculates a client-reported numeric model using server TEST rules and display-time FRB rates. No evaluation ID, storage, HTML report, source audit, certificate or publication.",
        inputSchema: remoteArgsSchema as any,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }] }));
      server.setRequestHandler(CallToolRequestSchema, async req => {
        try {
          if(req.params.name==="show_preview_confirmation"){const a=req.params.arguments;if(!a || Object.keys(a).length!==1 || typeof a.transfer_id!=="string" || !/^pt_[a-f0-9]{32}$/.test(a.transfer_id))throw new Error("INVALID_INPUT");return {structuredContent:{transfer_id:a.transfer_id},content:[{type:"text",text:"送信確認: https://open-estimate.ai-orchestration.jp/manage/preview-transfers/"+a.transfer_id}],_meta:{ui:{resourceUri:previewUiUri}}};}
          if (req.params.name === "get_skill_policy") {
            if (!req.params.arguments || Object.keys(req.params.arguments).length) throw new Error("INVALID_SKILL_POLICY_ARGUMENTS");
            const result = getSkillPolicy(policy);
            return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
          }
          if (req.params.name === "get_measurement_rules") {
            const result = resolveMeasurementRules(req.params.arguments, rules, policy);
            return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
          }
          if (req.params.name !== "evaluate_model") throw new Error("UNKNOWN_TOOL");
          const result = await evaluateRemote(req.params.arguments, profile as LocalProfile, undefined, policy, Date.now(), rules);
          return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (e: any) {
          const code = /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "REMOTE_EVALUATION_FAILED";
          const notice = code === "RULESET_UNAVAILABLE" ? "配信側に有効な測定ルールがありません。運用側で配信を復旧してください。"
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
