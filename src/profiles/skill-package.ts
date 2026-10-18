import fs from "node:fs";
import path from "node:path";
import { jcsSha256, sha256Hex } from "../core/canonical.js";

export function hashSkillPackage(root: string) {
  const files: { path: string; sha256: string }[] = [];
  function walk(dir: string, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("UNSAFE_SKILL_PACKAGE");
      const rel = prefix + entry.name;
      if (rel === "skill.manifest.json") continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + "/");
      else if (entry.isFile()) files.push({ path: rel, sha256: sha256Hex(fs.readFileSync(path.join(dir, entry.name))) });
    }
  }
  walk(root);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files, package_sha256: jcsSha256({ domain: "oes/skill-package/v1", files }) };
}
