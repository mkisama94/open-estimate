import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { evaluateRemote, remoteArgsSchema } from "./model.js";
import { parseStrictJson } from "../core/json-parser.js";
import type { LocalProfile } from "../core/evaluation.js";
import profile from "../../profiles/local-test.json" with { type: "json" };

export default {
  async fetch(request: Request): Promise<Response> {
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
      const server = new Server({ name: "open-estimate-remote", title: "オープン工数見積：数値モデル再計算専用", version: "0.4.1" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "evaluate_model",
        title: "数値モデル再計算専用（フォルダー走査・ソース解析なし）",
        description: "作成済みの数値モデルを再計算します。PC上のフォルダーの走査やソース解析は行いません。フォルダーパス・ソースを渡さないでください。ソースからの見積りには対象を読取・補助CLIを実行できるWork／Codexとソース解析用プラグインが必要です。Recalculates a client-reported numeric model using server TEST rules and display-time FRB rates. No evaluation ID, storage, HTML report, source audit, certificate or publication.",
        inputSchema: remoteArgsSchema as any,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }] }));
      server.setRequestHandler(CallToolRequestSchema, async req => {
        try {
          if (req.params.name !== "evaluate_model") throw new Error("UNKNOWN_TOOL");
          const result = await evaluateRemote(req.params.arguments, profile as LocalProfile);
          return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (e: any) {
          const code = /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : "REMOTE_EVALUATION_FAILED";
          return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code } }) }] };
        }
      });
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      await server.connect(transport);
      try { return await transport.handleRequest(request, { parsedBody: parsed }); }
      finally { await server.close(); }
    } catch { return new Response("Invalid request", { status: 400 }); }
  }
};
