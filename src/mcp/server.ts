import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { handleGetAssessorContract } from "./tools/get-assessor-contract.js";
import { handlePrepareRepository } from "./tools/prepare-repository.js";
import { handleReadRepositoryFile } from "./tools/read-repository-file.js";
import { handleEvaluateAssessment } from "./tools/evaluate-assessment.js";
import { OES_RESOURCES, handleReadResource } from "./resources.js";

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "open-estimate-mcp-server",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );

  // 1. List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_assessor_contract",
          description: "Returns the assessment schema, assessor instructions (SKILL.md), measurement rules, and test profiles required for the AI Assessor.",
          annotations: {
            title: "Get Assessor Contract",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          },
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false
          },
          outputSchema: {
            type: "object",
            required: ["schema", "assessor_instructions", "methodology_ref"],
            properties: {
              schema: { type: "object" },
              assessor_instructions: { type: "string" },
              methodology_ref: { type: "string" }
            }
          }
        },
        {
          name: "prepare_repository",
          description: "Validates repository path, creates a safe immutable local snapshot copy, computes manifest with hashes and line counts, and reports exclusions.",
          annotations: {
            title: "Prepare Repository Snapshot",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          },
          inputSchema: {
            type: "object",
            properties: {
              relative_path: {
                type: "string",
                description: "Relative path within OES_WORKSPACE_ROOT to analyze. Empty or '.' for root."
              }
            },
            additionalProperties: false
          },
          outputSchema: {
            type: "object",
            required: ["snapshot_id", "manifest", "manifest_hash", "summary"],
            properties: {
              snapshot_id: { type: "string" },
              manifest: { type: "object" },
              manifest_hash: { type: "string" },
              summary: { type: "object" },
              exclusions: { type: "array" }
            }
          }
        },
        {
          name: "read_repository_file",
          description: "Reads a chunk of up to 400 lines (max 64 KiB) from the immutable snapshot with 1-based line numbers and tracks read coverage.",
          annotations: {
            title: "Read Repository File Chunk",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          },
          inputSchema: {
            type: "object",
            required: ["snapshot_id", "file_id"],
            properties: {
              snapshot_id: {
                type: "string",
                description: "The snapshot ID returned by prepare_repository"
              },
              file_id: {
                type: "string",
                description: "Relative file path as registered in snapshot manifest"
              },
              start_line: {
                type: "integer",
                minimum: 1,
                default: 1,
                description: "1-based starting line number"
              },
              max_lines: {
                type: "integer",
                minimum: 1,
                maximum: 400,
                default: 400,
                description: "Maximum number of lines to read (capped at 400 lines and 64 KiB)"
              }
            },
            additionalProperties: false
          },
          outputSchema: {
            type: "object",
            required: ["file_id", "content", "sha256", "start_line", "end_line", "total_lines", "has_more"],
            properties: {
              file_id: { type: "string" },
              content: { type: "string" },
              sha256: { type: "string" },
              start_line: { type: "integer" },
              end_line: { type: "integer" },
              total_lines: { type: "integer" },
              has_more: { type: "boolean" },
              next_start_line: { type: ["integer", "null"] }
            }
          }
        },
        {
          name: "evaluate_assessment",
          description: "Validates canonical COSMIC assessment, counts functional size (CFP), checks integrity, reconciles read coverage, and produces a deterministic evaluation report.",
          annotations: {
            title: "Evaluate Assessment and Calculate CFP",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          },
          inputSchema: {
            type: "object",
            required: ["snapshot_id", "assessment"],
            properties: {
              snapshot_id: {
                type: "string",
                description: "The snapshot ID returned by prepare_repository"
              },
              assessment: {
                description: "The Assessment JSON object or raw JSON string created by AI",
                oneOf: [{ type: "object" }, { type: "string" }]
              },
              locale: {
                type: "string",
                default: "ja-JP",
                description: "Target locale for localized amounts, e.g. 'ja-JP'"
              },
              display_currency: {
                type: "string",
                description: "Display currency, e.g. 'JPY', 'USD'"
              }
            },
            additionalProperties: false
          },
          outputSchema: {
            type: "object",
            required: ["assessment_id", "report", "report_hash"],
            properties: {
              assessment_id: { type: "string" },
              report: { type: "object" },
              report_hash: { type: "string" },
              profile_set_id: { type: ["string", "null"] },
              input_reconciled: { type: "boolean" },
              issues: { type: "array" }
            }
          }
        }
      ]
    };
  });

  // 2. Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args = {} } = request.params;

    try {
      let result: any;
      if (name === "get_assessor_contract") {
        result = await handleGetAssessorContract();
      } else if (name === "prepare_repository") {
        result = await handlePrepareRepository(args as any);
      } else if (name === "read_repository_file") {
        result = await handleReadRepositoryFile(args as any);
      } else if (name === "evaluate_assessment") {
        result = await handleEvaluateAssessment(args as any);
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (err: any) {
      console.error(`Error in MCP tool ${name}:`, err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: err.code || "TOOL_EXECUTION_ERROR",
                message: err.message,
                details: err.errors || undefined
              }
            }, null, 2)
          }
        ]
      };
    }
  });

  // 3. Resources handlers
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: OES_RESOURCES.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType
      }))
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const { uri } = request.params;
    const resource = await handleReadResource(uri);
    return {
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: resource.text
        }
      ]
    };
  });

  // 4. Prompts handlers
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: "cosmic-assessment",
          description: "Workflow prompt to guide the AI Assessor through repository inspection and COSMIC assessment construction",
          arguments: [
            {
              name: "relative_path",
              description: "Relative path of repository to analyze (optional)",
              required: false
            }
          ]
        }
      ]
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async request => {
    const { name } = request.params;
    if (name === "cosmic-assessment") {
      return {
        description: "COSMIC Assessment Workflow Guide",
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Please perform a functional size assessment of this repository using Open Estimate (COSMIC v5.0):\n" +
                    "1. Call `get_assessor_contract` to retrieve schema and instructions.\n" +
                    "2. Call `prepare_repository` to create an immutable snapshot.\n" +
                    "3. Read files with `read_repository_file` to identify functional processes, users, stores, and data movements (Entry, Exit, Read, Write).\n" +
                    "4. Submit the Assessment JSON to `evaluate_assessment` to obtain deterministic CFP count and effort estimate."
            }
          }
        ]
      };
    }
    throw new Error(`Unknown prompt: ${name}`);
  });

  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Open Estimate MCP Server started on stdio transport.");
}