#!/usr/bin/env node
import { runStdioServer } from "./mcp/server.js";

async function main() {
  await runStdioServer();
}

main().catch(err => {
  console.error("Fatal error in Open Estimate MCP Server:", err);
  process.exit(1);
});
