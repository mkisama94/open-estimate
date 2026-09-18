import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const OES_RESOURCES: McpResourceDefinition[] = [
  {
    uri: "open-estimate://contracts/assessment-schema",
    name: "Assessment JSON Schema",
    description: "JSON Schema 2020-12 definition for Open Estimate Canonical COSMIC Assessment",
    mimeType: "application/json"
  },
  {
    uri: "open-estimate://skills/assessor-instructions",
    name: "Assessor Instructions (SKILL.md)",
    description: "Instructions and rules for AI Assessor to identify COSMIC functional processes and movements",
    mimeType: "text/markdown"
  }
];

export async function handleReadResource(uri: string): Promise<{ uri: string; mimeType: string; text: string }> {
  if (uri === "open-estimate://contracts/assessment-schema") {
    const schemaPath = path.resolve(__dirname, "../../contracts/oes-ph1.schema.json");
    const text = fs.readFileSync(schemaPath, "utf8");
    return { uri, mimeType: "application/json", text };
  }

  if (uri === "open-estimate://skills/assessor-instructions") {
    const skillPath = path.resolve(__dirname, "../../skills/open-estimate-assessor/SKILL.md");
    const text = fs.readFileSync(skillPath, "utf8");
    return { uri, mimeType: "text/markdown", text };
  }

  throw new Error(`Resource not found: ${uri}`);
}