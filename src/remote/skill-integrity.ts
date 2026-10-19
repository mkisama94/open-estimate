import { Ajv2020 } from "ajv/dist/2020.js";
import { jcsSha256 } from "../core/canonical.js";
import initialRegistry from "../../profiles/skill-releases.json" with { type: "json" };

export interface SkillRegistry {
  policy_version: string;
  enforcement_at: string | null;
  releases: { skill_id: string; skill_version: string; hash_rule: string; package_sha256: string;
    publication: "candidate" | "published"; acceptance: "accepted" | "revoked"; measurement_client_protocol?: string | null }[];
}
export const defaultRegistry = initialRegistry as SkillRegistry;
export const skillIntegritySchema = {
  type: "object", additionalProperties: false,
  required: ["format", "skill_id", "skill_version", "hash_rule", "package_sha256"],
  properties: {
    format: { const: "oes/skill-integrity/v1" }, skill_id: { const: "open-estimate-assessor" },
    skill_version: { type: "string", maxLength: 64, pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$" },
    hash_rule: { const: "oes/skill-package/v1" }, package_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }
  }
};
const validate = new Ajv2020({ strict: false }).compile(skillIntegritySchema);
const notice = "正規配布版との申告ハッシュ一致を確認。解析内容の正確性は独立検証していません";
export function checkSkillIntegrity(value: unknown, registry: SkillRegistry = defaultRegistry, now = Date.now()) {
  if (value === undefined) {
    if (registry.enforcement_at !== null && now < Date.parse(registry.enforcement_at))
      return { status: "LEGACY_UNCHECKED", policy_version: registry.policy_version,
        notice: "スキル未照合。正規最新版で実ファイルを検査し、skill_integrityを送信してください。", enforcement_at: registry.enforcement_at };
    throw new Error("SKILL_INTEGRITY_REQUIRED");
  }
  if (!validate(value)) {
    if (validate.errors?.every(e => e.keyword === "const" && ["/skill_id", "/hash_rule"].includes(e.instancePath))) throw new Error("SKILL_VERSION_UNSUPPORTED");
    throw new Error("INVALID_SKILL_INTEGRITY");
  }
  const v = value as { skill_id: string; skill_version: string; hash_rule: string; package_sha256: string };
  const release = registry.releases.find(r => r.skill_id === v.skill_id && r.skill_version === v.skill_version && r.hash_rule === v.hash_rule);
  if (!release) throw new Error("SKILL_VERSION_UNSUPPORTED");
  if (release.acceptance === "revoked") throw new Error("SKILL_VERSION_REVOKED");
  if (release.package_sha256 !== v.package_sha256) throw new Error("SKILL_INTEGRITY_MISMATCH");
  return { status: "MATCHED_CLIENT_REPORTED", skill_id: v.skill_id, skill_version: v.skill_version,
    hash_rule: v.hash_rule, package_sha256: v.package_sha256, policy_version: registry.policy_version, notice };
}
export function getSkillPolicy(registry: SkillRegistry = defaultRegistry) {
  const accepted = registry.releases.filter(r => r.acceptance === "accepted");
  return { policy_version: registry.policy_version, hash_rule: "oes/skill-package/v1",
    recommended_version: accepted.at(-1)?.skill_version ?? null, accepted_releases: accepted,
    registry_sha256: jcsSha256(registry), enforcement_at: registry.enforcement_at,
    instructions: "今回使用するスキルの実ファイルからskill-integrityで計算してください。manifestや本応答の正規ハッシュを転記しないでください。不一致なら解析を停止し正規版へ更新してください。export時にも再計算しskill_integrityを送信してください。更新後は新しいチャットで開始してください。",
    assurance: "自己申告の照合であり、認証・実行証明・独立監査ではありません。過去モデルの生成履歴も証明しません。" };
}
