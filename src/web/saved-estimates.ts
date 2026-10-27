import {estimateResultHtml} from "./estimate-view.js";
import {randomBytes} from "node:crypto";
import {jcsSha256} from "../core/canonical.js";
import {checkContract} from "../core/certificate-contract.js";
import {anyOwnerPreviewSchema,type OwnerPreview} from "../core/preview-transfer-contract.js";
import type {PreviewTransferService} from "./preview-transfer.js";
import type {BrowserApprovalSessions} from "./web-publication-approval.js";

const retention=30*86400000;
const esc=(s:unknown)=>String(s??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
// Preserve Origin on same-origin form POSTs; disclose no referrer to other origins.
const headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"same-origin","X-Robots-Tag":"noindex","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
const page=(body:string,status=200)=>new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>保存した試算 — Open Estimate</title><style>body{font:16px/1.7 system-ui;max-width:760px;margin:24px auto;padding:16px;overflow-wrap:anywhere}button{font:inherit;padding:12px}form{margin:24px 0}</style><body>${body}</body></html>`,{status,headers});
interface Row {estimate_id:string;owner_id:string;result_json:string;result_hash:string;saved_at:number;expires_at:number}
export function isSavedEstimatePath(path:string){return path==="/manage/estimates" || /^\/manage\/estimates\/(?:save\/pv_[a-f0-9]{32}|se_[a-f0-9]{32}(?:\/(?:extend|delete))?)$/.test(path);}
export async function savedEstimatePage(request:Request,service:PreviewTransferService,sessions:BrowserApprovalSessions,now:number){
  const db=service.repository.db,url=new URL(request.url),path=url.pathname;
  const s=await sessions.read(request);
  if(request.headers.has("Authorization") || !s || s.expires_at<=now || s.principal.expires_at<=now)return page("<h1>ログインが必要です</h1><a href='/manage'>ログイン管理へ</a>",401);
  const owner=s.principal.subject;
  const stmt=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
  const redirect=(target:string)=>new Response(null,{status:303,headers:{...headers,Location:service.config.origin+target}});
  if(path==="/manage/estimates" && request.method==="GET"){
    const data=await stmt("SELECT json_group_array(json_object('id',estimate_id,'expires_at',expires_at)) AS entries FROM (SELECT estimate_id,expires_at FROM saved_estimates WHERE owner_id=? AND expires_at>? ORDER BY saved_at DESC LIMIT 100)",owner,now).first<{entries:string}>();
    const rows=JSON.parse(data?.entries??"[]") as {id:string;expires_at:number}[];
    return page(`<h1>保存した試算</h1><p>本人限定。保存・延長から30日間閲覧できます。</p><ul>${rows.map(r=>`<li><a href="/manage/estimates/${esc(r.id)}">試算結果</a> — 期限 ${esc(new Date(r.expires_at).toISOString())}</li>`).join("")||"<li>保存した試算はありません</li>"}</ul>`);
  }
  const save=path.match(/^\/manage\/estimates\/save\/(pv_[a-f0-9]{32})$/);
  const existing=path.match(/^\/manage\/estimates\/(se_[a-f0-9]{32})(?:\/(extend|delete))?$/);
  let dto:OwnerPreview|undefined,row:Row|null=null;
  if(save)dto=await service.ownerPreview(save[1],owner,now);
  else if(existing){row=await stmt("SELECT * FROM saved_estimates WHERE estimate_id=? AND owner_id=?",existing[1],owner).first<Row>();if(!row)return page("<h1>結果が見つかりません</h1>",404);if(row.expires_at<=now)return page("<h1>保存期限が切れました</h1>",410);dto=checkContract<OwnerPreview>(anyOwnerPreviewSchema,JSON.parse(row.result_json));if(jcsSha256(dto)!==row.result_hash)throw new Error("STATUS_UNAVAILABLE");}
  else return page("<h1>ページが見つかりません</h1>",404);
  const target={preview_id:path,draft_hash:row?.result_hash??jcsSha256(dto)};
  if(request.method==="POST"){
    if(request.headers.get("Origin")!==service.config.origin || !/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(request.headers.get("Content-Type")??""))return page("<h1>操作を確認できません</h1>",403);
    const reader=request.body?.getReader();if(!reader)return page("<h1>入力がありません</h1>",400);
    const chunks:Uint8Array[]=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2048){await reader.cancel();return page("<h1>入力が大きすぎます</h1>",413);}chunks.push(value);}}finally{reader.releaseLock();}
    const form=new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    if([...form.keys()].length!==2 || form.getAll("csrf").length!==1 || form.getAll("consent").length!==1 || form.get("consent")!=="yes" || !await sessions.verifyCsrf(s,target,form.get("csrf")??""))return page("<h1>確認操作をやり直してください</h1>",403);
    if(save){
      const id="se_"+randomBytes(16).toString("hex"),hash=jcsSha256(dto);
      await db.batch([stmt("INSERT INTO saved_estimates VALUES (?,?,?,?,?,?) ON CONFLICT(owner_id,result_hash) DO NOTHING",id,owner,JSON.stringify(dto),hash,now,now+retention)]);
      const saved=await stmt("SELECT estimate_id FROM saved_estimates WHERE owner_id=? AND result_hash=?",owner,hash).first<{estimate_id:string}>();
      if(!saved)throw new Error("STATUS_UNAVAILABLE");return redirect("/manage/estimates/"+saved.estimate_id);
    }
    if(existing![2]==="delete")await db.batch([stmt("DELETE FROM saved_estimates WHERE estimate_id=? AND owner_id=?",row!.estimate_id,owner)]);
    else if(existing![2]==="extend")await db.batch([stmt("UPDATE saved_estimates SET expires_at=? WHERE estimate_id=? AND owner_id=? AND expires_at>?",now+retention,row!.estimate_id,owner,now)]);
    else return page("<h1>操作が不正です</h1>",400);
    return redirect(existing![2]==="delete"?"/manage/estimates":"/manage/estimates/"+row!.estimate_id);
  }
  if(request.method!=="GET")return page("<h1>操作が不正です</h1>",405);
  const action=save?"この試算を30日間保存する":existing![2]==="delete"?"この保存結果を削除する":existing![2]==="extend"?"今日から30日間に延長する":null;
  if(action)return page(`<h1>${action}</h1><p>本人限定の試算結果と基準情報を保存します。ソースコードは保存しません。一般公開・証明書発行は行いません。</p>${existing?.[2]==="delete"?"<p>削除するとこのURLから閲覧できなくなります。</p>":`<p>保存期限：${esc(new Date(now+retention).toISOString())}</p>`}<form method="post"><input type="hidden" name="csrf" value="${esc(await sessions.csrfToken(s,target))}"><label><input type="checkbox" name="consent" value="yes" required>内容を確認しました</label><p><button>${action}</button></p></form><a href="/manage/estimates">保存した試算へ</a>`);
  if(dto!.display_quote)return page(estimateResultHtml(dto!,new Date(row!.expires_at).toISOString(),true)+`<p><a href="${path}/extend">保存期限を延長</a>　<a href="${path}/delete">保存結果を削除</a></p>`);
  return page(`<h1>保存した試算</h1><p>本人限定・未署名・未公開</p><h2>${esc(dto!.result.measurement.cfp??"未算出")} CFP</h2><p>状態：${esc(dto!.result.measurement.status)} — TEST基準による参考値</p><p>参考工数（時間・中央値）：${esc(dto!.result.calculation.effort.person_hours?.median??"未算出")}</p><p>保存期限：${esc(new Date(row!.expires_at).toISOString())}</p><details><summary>基準と結果の詳細</summary><pre>${esc(JSON.stringify(dto!.result,null,2))}</pre></details><p><a href="${path}/extend">保存期限を延長</a>　<a href="${path}/delete">保存結果を削除</a></p><a href="/manage/estimates">保存した試算へ</a>`);
}
