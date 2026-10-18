import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { LocalProfile } from "../core/evaluation.js";

export function getLocalProfile(): LocalProfile {
  const profile: LocalProfile = JSON.parse(fs.readFileSync(
    fileURLToPath(new URL("../../profiles/local-test.json", import.meta.url)), "utf8"));
  if (profile.environment !== "TEST" || profile.benchmark.is_test !== true || profile.wage.is_test !== true
    || profile.effort_scope_id !== "oes-design-implementation-test-v1") {
    throw new Error("LOCAL_TEST_PROFILE_INVALID");
  }
  return profile;
}
