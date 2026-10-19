import type { SkillRegistry } from "../../src/remote/skill-integrity.js";
import { evaluateRemote as evaluate } from "../../src/remote/model.js";
import { measurementRegistry } from "./measurement.js";
export const legacyIntegrity = { format: "oes/skill-integrity/v1", skill_id: "open-estimate-assessor", skill_version: "0.1.0", hash_rule: "oes/skill-package/v1", package_sha256: "e".repeat(64) };
export const legacyRegistry: SkillRegistry = { policy_version: "oes/skill-integrity-policy/v1", enforcement_at: "2100-01-01T00:00:00.000Z", releases: [{ skill_id: legacyIntegrity.skill_id, skill_version: legacyIntegrity.skill_version, hash_rule: legacyIntegrity.hash_rule, package_sha256: legacyIntegrity.package_sha256, publication: "published", acceptance: "accepted" }] };
// Explicit migration fixture for pre-integrity regression cases, never production defaults.
export const evaluateRemote: typeof evaluate = (args, profile, provider) => evaluate({ skill_integrity: legacyIntegrity, ...(args as object) }, profile, provider, legacyRegistry, Date.now(), measurementRegistry());
