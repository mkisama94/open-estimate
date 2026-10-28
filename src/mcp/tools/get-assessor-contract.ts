import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashSkillPackage } from "../../profiles/skill-package.js";
import { getLocalProfile } from "../../profiles/local-profile.js";
import { getWorkspaceRoot } from "../../collector/safe-paths.js";
import { CLIENT_PROTOCOL } from "../../rules/measurement-contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function handleGetAssessorContract(): Promise<any> {
  const schemaPath = path.resolve(__dirname, "../../../contracts/oes-ph1.schema.json");
  const schemaJson = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  const skillPath = path.resolve(__dirname, "../../../skills/open-estimate-assessor/SKILL.md");
  const skillInstructions = fs.readFileSync(skillPath, "utf8");

  const manifestPath = path.resolve(__dirname, "../../../skills/open-estimate-assessor/skill.manifest.json");
  const skillManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const actual = hashSkillPackage(path.dirname(skillPath));
  if (skillManifest.package_sha256 !== actual.package_sha256 || JSON.stringify(skillManifest.files) !== JSON.stringify(actual.files))
    throw new Error("BUNDLED_SKILL_INTEGRITY_ERROR");

  return {
    contract_version: `${skillManifest.skill_version}-local-preview`, environment: "TEST", workspace_root: getWorkspaceRoot(),
    measurement_client_protocol: CLIENT_PROTOCOL,
    assessment_formats: { recommended: "oes/assessment/v2", quality_extension: "oes/quality-records/v1", remote_model_formats:["oes/remote-model/v1","oes/remote-model/v2"], legacy: ["unversioned", "oes/assessment/v1"],
      legacy_notice: "旧形式・判断記録不足。過去の数値とhashは維持し、新要件への適合は主張しません。",
      analysis_complete: "v2 input.analysis_completeは収集器が確認した走査・取得完了。範囲内の読取・候補・判断の完了はlocal.recordsから導出し、remote-modelのanalysis_completeへ投影。v1の意味は変更しない。" },
    capabilities: { local_evaluation: true, persistent_evaluations: true, display_time_frb: true, html_report: true,portable_document:true,document_proof:true,stateless_web_preview:true,standard_completion:'DOCUMENT_READY', web_management: false, certificates: false, publishing: false },
    profile: getLocalProfile(),
    privacy_notice: "ソースコードはOpen Estimateのサーバーへアップロードされず、一般公開もされません。CodexはAI解析のためにコードをモデル提供元へ送信する場合があります。",
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
        profile_set_id: getLocalProfile().profile_set_id,
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
