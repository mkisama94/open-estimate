import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { resolveSafePath } from "../collector/safe-paths.js";
import { classifyFile } from "../collector/classification.js";
import { planAcquisition, type ScopeRule, type AcquisitionPlan } from "../collector/acquisition-plan.js";

export async function scanStructure(root: string, scope: ScopeRule[] = []) {
  const plan = await planAcquisition(root, scope);
  const counts: Record<string,number> = {}, top: Record<string,number> = {};
  for (const f of plan.files.filter(f=>!f.cause)) {
    const category=classifyFile(f.path).category; counts[category]=(counts[category]??0)+1;
    const section=f.path.includes("/")?f.path.split("/")[0]:"(root)"; top[section]=(top[section]??0)+1;
  }
  return { files:plan.files.filter(f=>!f.cause).length,categories:counts,top_level:top,
    excluded_sample:[...plan.files.filter(f=>f.cause).map(f=>f.path),...plan.summary.issues.map(i=>i.path)].slice(0,100),
    truncated:!plan.summary.discovery_complete,source_content_read:false,acquisition:plan.summary,scope:plan.scope,fingerprint:plan.fingerprint,plan };
}

export interface WorkspaceBinding {candidate_id:string;root:string;roots_key:string;origin:string;plan:AcquisitionPlan}
export class WorkspaceSession {
  private generation = 0;
  private pending?: WorkspaceBinding;
  private selected?: WorkspaceBinding;
  constructor(private server: Server, private changed: () => void) {}
  private async roots() {
    if (!this.server.getClientCapabilities()?.roots) return { paths: [] as string[], key: "host_context" };
    let result;
    try { result = await this.server.listRoots({}, { timeout: 5000 }); }
    catch { this.reset(); throw new Error("HOST_ROOTS_UNAVAILABLE"); }
    const paths = result.roots.map(r => {
      const uri = new URL(r.uri);
      if (uri.protocol !== "file:" || uri.hostname || uri.search || uri.hash) throw new Error("UNSUPPORTED_HOST_ROOT");
      return path.resolve(fileURLToPath(uri));
    }).sort();
    return { paths, key: JSON.stringify(paths) };
  }
  reset() { this.generation++; this.pending = undefined; this.selected = undefined; this.changed(); }
  async discover(args: { context_path?: string; relative_path?: string; scope?: ScopeRule[] }) {
    this.reset();
    const generation = this.generation;
    const roots = await this.roots();
    let base: string | undefined;
    if (args.context_path) {
      if (!path.isAbsolute(args.context_path)) throw new Error("ABSOLUTE_PROJECT_PATH_REQUIRED");
      base = path.resolve(args.context_path);
      if (roots.key !== "host_context" && !roots.paths.includes(base)) throw new Error("PROJECT_NOT_IN_HOST_ROOTS");
    } else if (roots.paths.length === 1) base = roots.paths[0];
    if (!base) return { status: "PROJECT_SELECTION_REQUIRED", host_roots: roots.paths, source_content_read: false };
    const root = await resolveSafePath(args.relative_path ?? ".", base);
    if (classifyFile(path.relative(base, root).replaceAll("\\", "/") + "/dummy").isExcluded) throw new Error("EXCLUDED_TARGET_DIRECTORY");
    const summary = await scanStructure(root,args.scope);
    if (generation !== this.generation) throw new Error("PROJECT_CHANGED_RECONFIRM_REQUIRED");
    const candidate = { candidate_id: randomUUID(), root, roots_key: roots.key, plan:summary.plan, origin: roots.key === "host_context" ? "conversation_context_unverified" : "mcp_roots" };
    this.pending = candidate;
    return { status: "AWAITING_USER_CONFIRMATION", candidate_id: candidate.candidate_id, workspace_root: root, origin: candidate.origin, summary,
      notice: "ファイル構成のみを走査しました。この範囲でコード本文を読み、評価してよいか利用者へ確認してください。" };
  }
  async confirm(args: { candidate_id: string; user_confirmed: boolean }) {
    const candidate = this.pending;
    if (!candidate || candidate.candidate_id !== args.candidate_id) throw new Error("CANDIDATE_NOT_FOUND");
    if (!args.user_confirmed) { this.reset(); return { status: "CANCELLED" }; }
    if ((await this.roots()).key !== candidate.roots_key) { this.reset(); throw new Error("PROJECT_CHANGED_RECONFIRM_REQUIRED"); }
    await resolveSafePath("", candidate.root);
    if (this.pending !== candidate) throw new Error("PROJECT_CHANGED_RECONFIRM_REQUIRED");
    this.selected = candidate; this.pending = undefined;
    return { status: "CONFIRMED", workspace_root: candidate.root, origin: candidate.origin, confirmation: "assistant_reports_user_confirmation" };
  }
  async requireRoot() {
    const selected = this.selected;
    if (!selected) throw new Error("WORKSPACE_CONFIRMATION_REQUIRED");
    if ((await this.roots()).key !== selected.roots_key) { this.reset(); throw new Error("PROJECT_CHANGED_RECONFIRM_REQUIRED"); }
    if (this.selected !== selected) throw new Error("PROJECT_CHANGED_RECONFIRM_REQUIRED");
    return selected.root;
  }
  current() { return this.selected?.root ?? null; }
  revision(){return this.generation;}
  async binding():Promise<WorkspaceBinding>{
    const b=this.pending??this.selected;if(!b)throw Error('CANDIDATE_NOT_FOUND');
    if((await this.roots()).key!==b.roots_key){this.reset();throw Error('PROJECT_CHANGED_RECONFIRM_REQUIRED');}
    return structuredClone(b);
  }
  /** Restore only the private binding of an already-consented workflow. */
  async restore(b:WorkspaceBinding){
    const current=this.pending??this.selected;
    if(current&&(current.root!==b.root||current.plan.fingerprint!==b.plan.fingerprint))throw Error('WORKFLOW_SCOPE_CHANGE_REQUIRES_CONFIRMATION');
    if((await this.roots()).key!==b.roots_key){this.reset();throw Error('PROJECT_CHANGED_RECONFIRM_REQUIRED');}
    await resolveSafePath('',b.root);this.selected=structuredClone(b);this.pending=undefined;
  }
  async candidate() {
    const c=this.pending;if(!c)throw Error('CANDIDATE_NOT_FOUND');
    if((await this.roots()).key!==c.roots_key)throw Error('PROJECT_CHANGED_RECONFIRM_REQUIRED');
    return {candidate_id:c.candidate_id,root:c.root,plan:c.plan};
  }
  async acquisitionOptions(refresh = false) {
    const root = await this.requireRoot();
    if (refresh) this.selected!.plan = await planAcquisition(root,this.selected!.plan.scope);
    return {scope:this.selected!.plan.scope,preflight:this.selected!.plan};
  }
}
