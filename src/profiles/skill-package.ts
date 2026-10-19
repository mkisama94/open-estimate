import fs from "node:fs";
import path from "node:path";
import { jcsSha256, sha256Hex } from "../core/canonical.js";

export function hashSkillPackage(root: string) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error("UNSAFE_SKILL_PACKAGE");
  for (const required of ["SKILL.md", "scripts/oes.mjs"]) {
    if (!fs.lstatSync(path.join(root, required)).isFile()) throw new Error("INVALID_SKILL_PACKAGE");
  }
  const files: { path: string; sha256: string }[] = [];
  function walk(dir: string, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("UNSAFE_SKILL_PACKAGE");
      const rel = prefix + entry.name;
      if (rel === "skill.manifest.json") {
        if (!entry.isFile()) throw new Error("UNSAFE_SKILL_PACKAGE");
        continue;
      }
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + "/");
      else if (entry.isFile()) files.push({ path: rel, sha256: sha256Hex(fs.readFileSync(path.join(dir, entry.name))) });
      else throw new Error("UNSAFE_SKILL_PACKAGE");
    }
  }
  walk(root);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, package_sha256: jcsSha256({ domain: "oes/skill-package/v1", files }) };
}

export function inspectSkillPackage(root: string) {
  const actual = hashSkillPackage(root);
  const manifestPath = path.join(root, "skill.manifest.json");
  if (!fs.lstatSync(manifestPath).isFile()) throw new Error("INVALID_SKILL_INTEGRITY");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.domain !== "oes/skill-manifest/v1" || manifest.skill_id !== "open-estimate-assessor"
    || typeof manifest.skill_version !== "string"
    || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.skill_version)
    || manifest.skill_version.length > 64
    || manifest.hash_rule !== "SHA256(JCS({domain:oes/skill-package/v1,files:[{path,sha256},...]}))"
    || manifest.package_sha256 !== actual.package_sha256
    || JSON.stringify(manifest.files) !== JSON.stringify(actual.files)) throw new Error("INVALID_SKILL_INTEGRITY");
  return { format: "oes/skill-integrity/v1" as const, skill_id: "open-estimate-assessor" as const,
    skill_version: manifest.skill_version as string, hash_rule: "oes/skill-package/v1" as const,
    package_sha256: actual.package_sha256 };
}
