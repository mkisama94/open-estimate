import fs from "node:fs/promises";
import path from "node:path";
import { classifyFile } from "./classification.js";
import { resolveSafePath } from "./safe-paths.js";
import { jcsSha256 } from "../core/canonical.js";

export const LIMITS = { files: 10000, bytes: 100 * 1024 * 1024, single: 2 * 1024 * 1024 };
export type ScopeRole = "measurement" | "supporting" | "excluded";
export interface ScopeRule { path: string; role: ScopeRole }
export interface PlannedFile { path: string; bytes: number; mtime_ms: number; role: ScopeRole; cause: string | null }
export function normalizeScope(value: unknown = []): ScopeRule[] {
  if (!Array.isArray(value)) throw new Error("INVALID_ACQUISITION_SCOPE");
  const seen = new Set<string>();
  return value.map(r => {
    if (!r || typeof r.path !== "string" || !["measurement", "supporting", "excluded"].includes(r.role)
      || (r.path !== "." && (!r.path || r.path.includes(":") || r.path.includes("\\") || r.path.split("/").some((s: string) => !s || s === "." || s === "..")))
      || seen.has(r.path.toLowerCase())) throw new Error("INVALID_ACQUISITION_SCOPE");
    seen.add(r.path.toLowerCase()); return { path: r.path, role: r.role };
  }).sort((a,b) => a.path < b.path ? -1 : 1);
}
export const within = (p: string, prefix: string) => prefix === "." || p === prefix || p.startsWith(prefix + "/");
export async function planAcquisition(root: string, scope: ScopeRule[] = []) {
  await resolveSafePath("",root);
  if (!(await fs.lstat(root)).isDirectory()) throw new Error("TARGET_MUST_BE_DIRECTORY");
  scope = normalizeScope(scope);
  const files: PlannedFile[] = [], issues: Array<{path:string;cause:string}> = [];
  let visited = 0, complete = true;
  const roleFor = (p: string): ScopeRole => scope.filter(r => within(p,r.path)).sort((a,b) => b.path.length-a.path.length)[0]?.role
    ?? (classifyFile(p).category === "source" ? "measurement" : "supporting");
  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > 40) { complete = false; issues.push({path:prefix,cause:"DEPTH_LIMIT"}); return; }
    let items;
    try { items = await fs.readdir(dir,{withFileTypes:true}); }
    catch (e: any) { if (!["EACCES","EPERM"].includes(e.code)) throw e; complete=false; issues.push({path:prefix || ".",cause:"DIRECTORY_PERMISSION"}); return; }
    for (const item of items.sort((a,b)=>a.name < b.name ? -1 : 1)) {
      if (++visited > LIMITS.files) { complete=false; issues.push({path:prefix || ".",cause:"FILE_COUNT_LIMIT"}); return; }
      const p = prefix ? `${prefix}/${item.name}` : item.name;
      const c = classifyFile(p + (item.isDirectory() ? "/dummy" : ""));
      // Protected directories are never traversed, including for metadata totals.
      if (item.isSymbolicLink() || (item.isDirectory() && c.isExcluded)) {
        issues.push({path:p,cause:item.isSymbolicLink() ? "SAFETY_SYMLINK" : /^(\.git|\.codex|\.aws|\.ssh|node_modules|vendor|\.?venv)$/i.test(item.name) ? "SAFETY_EXCLUSION" : "POLICY_EXCLUSION"});
        if (scope.some(r => r.role === "measurement" && (within(r.path,p) || within(p,r.path))
          && roleFor(within(r.path,p) ? r.path : p) === "measurement")) issues.push({path:p,cause:"SCOPE_EXCLUSION_CONFLICT"});
        continue;
      }
      try {
        const full = await resolveSafePath(p,root);
        if (item.isDirectory()) { await walk(full,p,depth+1); if (visited > LIMITS.files) return; }
        else if (item.isFile()) {
          const stat = await fs.lstat(full), declaredRole = roleFor(p);
          const rootRelease = within(p,"release") && !scope.some(r=>r.role !== "excluded" && within(p,r.path));
          const role = rootRelease ? "excluded" : declaredRole;
          const cause = rootRelease && declaredRole !== "excluded" ? "POLICY_EXCLUSION" : role === "excluded" ? "AGREED_EXCLUSION" : c.category === "secret" ? "SAFETY_EXCLUSION" : c.isExcluded ? "POLICY_EXCLUSION" : null;
          files.push({path:p,bytes:stat.size,mtime_ms:stat.mtimeMs,role,cause});
          if (c.isExcluded && role === "measurement") issues.push({path:p,cause:"SCOPE_EXCLUSION_CONFLICT"});
        }
      } catch (e: any) { if (!["EACCES","EPERM"].includes(e.code)) throw e; complete=false; issues.push({path:p,cause:"FILE_PERMISSION"}); }
    }
  }
  await walk(root,"",0);
  for (const rule of scope.filter(r=>r.role === "measurement")) if (!files.some(f=>within(f.path,rule.path))) {
    complete=false; issues.push({path:rule.path,cause:"REQUIRED_PATH_NOT_DISCOVERED"});
  }
  const totals = Object.fromEntries((["measurement","supporting","excluded"] as const).map(role => {
    const selected=files.filter(f=>(f.cause ? "excluded" : f.role) === role);
    return [role,{files:selected.length,bytes:selected.reduce((s,f)=>s+f.bytes,0)}];
  })) as Record<ScopeRole,{files:number;bytes:number}>;
  const oversized=files.filter(f=>!f.cause && f.bytes > LIMITS.single).map(f=>f.path);
  const folders: Record<string,number> = {};
  for (const f of files.filter(f=>!f.cause)) { const folder=f.path.includes("/") ? f.path.split("/")[0] : "(root)"; folders[folder]=(folders[folder]??0)+f.bytes; }
  const summary={totals,oversized,folders,issues,discovery_complete:complete,limits:LIMITS,
    splittable:complete && !issues.some(i=>i.cause === "SCOPE_EXCLUSION_CONFLICT") && !files.some(f=>f.role === "measurement" && !f.cause && f.bytes > LIMITS.single),
    ready:complete && !issues.some(i=>i.cause === "SCOPE_EXCLUSION_CONFLICT") && !files.some(f=>f.role === "measurement" && !f.cause && f.bytes > LIMITS.single)
      && totals.measurement.bytes <= LIMITS.bytes,
    all_selected_fit:totals.measurement.bytes+totals.supporting.bytes <= LIMITS.bytes && oversized.length===0,
    protected_metadata_not_enumerated:issues.filter(i=>["POLICY_EXCLUSION","SAFETY_EXCLUSION","SAFETY_SYMLINK"].includes(i.cause)).map(i=>i.path),
    selected_bytes:totals.measurement.bytes+totals.supporting.bytes, source_content_read:false};
  return {scope,files,summary,fingerprint:jcsSha256({scope,files,issues,complete})};
}
export type AcquisitionPlan = Awaited<ReturnType<typeof planAcquisition>>;
