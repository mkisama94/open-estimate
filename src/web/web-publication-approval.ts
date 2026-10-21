import { randomBytes } from "node:crypto";
import { approvedDraftSchema, checkContract, type ApprovedDraft } from "../core/certificate-contract.js";
import { draftHash } from "../core/certificate.js";
import type { Principal } from "./auth.js";
import type { CertificateDatabase, CertificateRepository } from "./certificate-repository.js";
import { approvalBindingHash,approvalGrantHash,type WebApprovalGrant } from "./stored-approval.js";

/** Implemented by the server-side OIDC callback/session layer, never by an API bearer token. */
export interface BrowserSession {session_id:string;principal:Principal;expires_at:number}
export interface BrowserApprovalSessions {
  readonly mode:"production"|"test";
  read(request:Request):Promise<BrowserSession|null>;
  csrfToken(session:BrowserSession,target:{preview_id:string;draft_hash:string}):Promise<string>;
  verifyCsrf(session:BrowserSession,target:{preview_id:string;draft_hash:string},token:string):Promise<boolean>;
}
export interface WebApprovalGrantWriter {save(grant:WebApprovalGrant):Promise<void>}
export function d1ApprovalGrantWriter(db:CertificateDatabase):WebApprovalGrantWriter {
  return {async save(g){await db.batch([db.prepare("INSERT INTO web_approval_grants VALUES (?,?,?,?,?,?)").bind(g.grant_hash,g.owner_id,g.operation,g.binding_hash,g.expires_at,g.trusted_channel)]);}};
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
const headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
/** Dedicated browser form only. No general API exists for minting arbitrary approval receipts. */
export class WebPublicationApproval {
  readonly mode:"production"|"test";
  constructor(private readonly origin:string,private readonly sessions:BrowserApprovalSessions,private readonly repository:CertificateRepository,private readonly grants:WebApprovalGrantWriter){
    if(new URL(origin).origin!==origin || !origin.startsWith("https://"))throw new Error("INVALID_AUTH_CONFIGURATION");
    this.mode=sessions.mode;
  }
  private async context(request:Request,previewId:string,now:number) {
    if(!/^pv_[a-f0-9]{32}$/.test(previewId))throw new Error("NOT_FOUND");
    const session=await this.sessions.read(request);
    if(!session || session.expires_at<=now || session.principal.expires_at<=now || !session.principal.scopes.includes("certificates:manage"))throw new Error("AUTH_REQUIRED");
    const preview=await this.repository.preview(previewId,session.principal.subject);
    if(!preview)throw new Error("NOT_FOUND");
    if(preview.expires_at<=now)throw new Error("PREVIEW_EXPIRED");
    if(!preview.draft_json || preview.consumed_receipt)throw new Error("ALREADY_CONSUMED");
    const draft=checkContract<ApprovedDraft>(approvedDraftSchema,JSON.parse(preview.draft_json));
    if(preview.draft_hash!==draftHash(draft))throw new Error("DRAFT_CHANGED");
    return {session,draft,hash:preview.draft_hash};
  }
  async render(request:Request,previewId:string,now:number):Promise<Response> {
    if(request.method!=="GET")throw new Error("INVALID_INPUT");
    const {session,draft,hash}=await this.context(request,previewId,now);
    const csrf=await this.sessions.csrfToken(session,{preview_id:previewId,draft_hash:hash});
    const action=`${this.origin}/manage/certificate-previews/${previewId}/approve`;
    // This page is a preview. It never calls an unsigned object an issued certificate.
    const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>計算証明書の発行・公開の確認</title><body><h1>計算証明書の発行・公開の確認</h1><p>発行前のプレビューです。</p><h2>${escape(draft.metadata.title)}</h2><p><strong>TEST基準による参考値 — 実績に基づく工数・価格の証明ではありません</strong></p><p>受領した数値モデルのサーバー再計算結果にAI Orchestration Inc.が署名します。ソースの内容・網羅性やAIの解釈を独立に検証するものではありません。</p><h2>公開する結果と説明</h2><pre>${escape(JSON.stringify({result:draft.result,metadata:draft.metadata,issuer:draft.issuer,environment:draft.deployment_environment,expires_at:draft.expires_at},null,2))}</pre><p>公開後はURLを知る第三者が閲覧・保存できます。公開停止後も第三者の保存物は消去できません。</p><form method="post" action="${escape(action)}"><input type="hidden" name="csrf" value="${escape(csrf)}"><input type="hidden" name="draft_hash" value="${hash}"><p><label><input type="checkbox" name="approve_issuance" value="yes" required>この固定結果への計算証明書の発行を承認します</label></p><p><label><input type="checkbox" name="approve_publication" value="yes" required>この結果と説明の一般公開を承認します</label></p><button type="submit">発行と公開を承認する</button></form></body></html>`;
    return new Response(html,{headers});
  }
  async confirm(request:Request,previewId:string,now:number) {
    if(request.method!=="POST" || new URL(request.url).origin!==this.origin || request.headers.get("Origin")!==this.origin
      || request.headers.has("Authorization") || !/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(request.headers.get("Content-Type")??""))throw new Error("AUTH_REQUIRED");
    const {session,draft,hash}=await this.context(request,previewId,now);
    const reader=request.body?.getReader();if(!reader)throw new Error("INVALID_INPUT");
    let size=0;const chunks:Uint8Array[]=[];
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw new Error("INPUT_TOO_LARGE");}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    const form=new URLSearchParams(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    const expected=["csrf","draft_hash","approve_issuance","approve_publication"];
    if([...form.keys()].length!==4 || expected.some(k=>form.getAll(k).length!==1) || form.get("approve_issuance")!=="yes" || form.get("approve_publication")!=="yes")throw new Error("APPROVAL_REQUIRED");
    if(form.get("draft_hash")!==hash)throw new Error("DRAFT_CHANGED");
    if(!await this.sessions.verifyCsrf(session,{preview_id:previewId,draft_hash:hash},form.get("csrf")!))throw new Error("APPROVAL_REQUIRED");
    const receipt="wa_"+randomBytes(32).toString("hex"),expires_at=Math.min(Date.parse(draft.expires_at),session.expires_at,session.principal.expires_at,now+300000);
    const binding={principal_id:session.principal.subject,operation:"issue_and_publish",approved_draft_hash:hash,policy_version:draft.policy_version};
    await this.grants.save({grant_hash:approvalGrantHash(receipt),owner_id:session.principal.subject,operation:"issue_and_publish",binding_hash:approvalBindingHash(binding),expires_at,trusted_channel:"WEB_USER_CONFIRMATION_V1"});
    // Return only to the authenticated browser/approved handoff adapter; never log or place in a URL.
    return {approval_receipt_id:receipt,expires_at};
  }
}
