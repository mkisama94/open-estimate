import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function handleGetAssessorContract(): Promise<any> {
  const schemaPath = path.resolve(__dirname, "../../../contracts/oes-ph1.schema.json");
  const schemaJson = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  const skillPath = path.resolve(__dirname, "../../../skills/open-estimate-assessor/SKILL.md");
  const skillInstructions = fs.readFileSync(skillPath, "utf8");

  const manifestPath = path.resolve(__dirname, "../../../skills/open-estimate-assessor/skill.manifest.json");
  const skillManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  return {
    schema: schemaJson.definitions.Assessment,
    assessor_instructions: skillInstructions,
    methodology_ref: "oes-cosmic-ph1-v1",
    skill: {
      skill_id: skillManifest.skill_id,
      skill_version: skillManifest.skill_version,
      package_sha256: skillManifest.package_sha256
    },
    supported_languages: ["typescript", "javascript", "python"],
    profile_sets: [
      {
        profile_set_id: "oes-test-profile-set-2026-v1",
        is_test: true,
        description: "Standard TEST profile for local validation and testing"
      }
    ],
    limits: {
      max_files: 10000,
      max_total_bytes: 104857600, // 100 MiB
      max_single_file_bytes: 2097152, // 2 MiB
      max_read_lines_per_call: 400,
      max_read_bytes_per_call: 65536 // 64 KiB
    }
  };
}
