import { ESTIMATE_POLICY } from "../core/estimate-preview.js";
import { estimateResultHtml } from "./estimate-view.js";
import {isSavedEstimatePath,savedEstimatePage} from "./saved-estimates.js";
import { randomUUID } from "node:crypto";
import { readCertificateJson } from "../core/certificate-json.js";
import { checkContract } from "../core/certificate-contract.js";
import { emptyTransferSchema } from "../core/preview-transfer-contract.js";
import type { BrowserApprovalSessions } from "./web-publication-approval.js";
import { PreviewTransferService } from "./preview-transfer.js";
const escape=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export const ownerHeaders={"Cache-Control":"no-store","X-Robots-Tag":"noindex","Referrer-Policy":"same-origin","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
const labels:Record<string,string>={COMPLETE:"宣言範囲の測定完了",PARTIAL:"部分測定",UNSUPPORTED:"適用困難・算出不可",INCOMPLETE:"測定未完了",AVAILABLE:"算出済み",OUTSIDE_REFERENCE_RANGE:"TEST基準の対象範囲外",WAGE_UNAVAILABLE:"金額換算未提供",BENCHMARK_UNAVAILABLE:"工数換算基準なし",TEST_DATA_ONLY:"架空のTEST基準",AI_SEMANTICS_UNVERIFIED:"AIの意味解釈は独立監査なし",COMMUNITY_CLAIMS_UNATTESTED:"入力・品質情報は利用者側の申告",REFERENCE_NOT_MARKET_VALUE:"市場価格の評価ではありません",PARTIAL_MEASUREMENT:"未確定事項を含む部分測定",BENCHMARK_OUT_OF_RANGE:"TEST係数の適用範囲外",SCAN_SCOPE_IMPACT_UNKNOWN:"走査不足の測定範囲への影響が不明",ACQUISITION_IN_SCOPE:"範囲内に取得できていない対象あり",ACQUISITION_SCOPE_UNKNOWN:"取得制限の範囲影響が不明",BOUNDARY_RERUN_UNKNOWN:"独立再実行の境界が未確認",BOUNDARY_CONTINUATION_UNKNOWN:"要求の継続関係が未確認",IN_SCOPE_UNCONFIRMED:"範囲内の未確認ファイルあり",FILE_SCOPE_UNRESOLVED:"ファイルの範囲所属が未確認",CANDIDATE_UNRESOLVED:"未採用の未解決候補あり",PROCESS_CANDIDATE_MISSING:"機能候補の記録不足",JUDGMENT_PENDING:"暫定・未解決の判断あり",DATA_GROUP_UNCONFIRMED:"データ群に未確認あり",PROCESS_UNRESOLVED:"未解決の機能あり",COMPONENT_SCOPE_IMPACT:"対象領域に測定不足あり",FINDING_OPEN:"未解決の所見あり",EVIDENCE_INSUFFICIENT:"判断根拠に不足あり"};
const label=(code:string)=>escape(labels[code]??code);
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...ownerHeaders,"Content-Type":"application/json; charset=utf-8"}});
const page=(content:string,status=200)=>new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本人用Web表示 — Open Estimate</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 18px;color:#15343d;overflow-wrap:anywhere}section,form{padding:18px;margin:18px 0;border:1px solid #b4ccd0;border-radius:12px}h1{font-size:1.8rem}strong{font-size:1.1rem}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #cedadd;padding:8px}input,button{font:inherit;max-width:100%;padding:10px}label{display:block;margin:12px 0}small{display:block}</style><body>${content}</body></html>`,{status,headers:{...ownerHeaders,"Content-Type":"text/html; charset=utf-8"}});
export async function boundedPreviewBody(request:Request,max:number,form=false){
  if(request.headers.has("Content-Encoding") || Number(request.headers.get("Content-Length"))>max)throw new Error("INPUT_TOO_LARGE");
  if(!(form?/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i:/^application\/json(?:\s*;\s*charset=utf-8)?$/i).test(request.headers.get("Content-Type")??""))throw new Error("INVALID_INPUT");
  const reader=request.body?.getReader();if(!reader)throw new Error("INVALID_INPUT");const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error("INPUT_TOO_LARGE");}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return form?new URLSearchParams(new TextDecoder("utf-8",{fatal:true}).decode(bytes)):readCertificateJson(bytes);
}
const statusCodes:Record<string,number>={ESTIMATE_FLOW_RETIRED:409,AUTH_REQUIRED:401,APPROVAL_REQUIRED:403,NOT_FOUND:404,INVALID_INPUT:400,INPUT_TOO_LARGE:413,IDEMPOTENCY_CONFLICT:409,DRAFT_CHANGED:409,RESULT_MISMATCH:409,BASIS_MISMATCH:409,PREVIEW_EXPIRED:410,RATE_LIMITED:429,OWNER_PREVIEW_DISABLED:503,STATUS_UNAVAILABLE:503,MODEL_UNSUPPORTED:422,BASIS_UNSUPPORTED:422,RULESET_NOT_ISSUABLE:422,SKILL_NOT_ISSUABLE:422};
export function isOwnerPreviewPath(path:string){return isSavedEstimatePath(path) || path==="/api/v1/preview-transfers" || /^\/api\/v1\/preview-transfers\/pt_[a-f0-9]{32}\/(status|preview|result)$/.test(path)
  || /^\/manage\/preview-transfers\/pt_[a-f0-9]{32}(\/approve)?$/.test(path) || /^\/api\/v1\/owner-certificate-previews\/pv_[a-f0-9]{32}$/.test(path)
  || /^\/manage\/(?:certificate|estimate)-previews\/pv_[a-f0-9]{32}$/.test(path);}
export function createOwnerPreviewController(service:PreviewTransferService,sessions:BrowserApprovalSessions,limiter:{limit(options:{key:string}):Promise<{success:boolean}>}){
  if(service.config.environment==="production" && sessions.mode!=="production")throw new Error("AUTH_CONSENT_NOT_READY");
  const session=async(req:Request,now:number)=>{if(req.headers.has("Authorization"))throw new Error("AUTH_REQUIRED");const s=await sessions.read(req);if(!s || s.expires_at<=now || s.principal.expires_at<=now)throw new Error("AUTH_REQUIRED");return s;};
  const secret=(req:Request)=>{if(req.headers.has("Cookie") || req.headers.has("Origin"))throw new Error("AUTH_REQUIRED");const match=req.headers.get("Authorization")?.match(/^PreviewTransfer ([A-Za-z0-9_-]{43})$/);if(!match)throw new Error("AUTH_REQUIRED");return match[1];};
  return {async fetch(request:Request,now=Date.now()):Promise<Response>{
    const url=new URL(request.url),path=url.pathname,html=path.startsWith("/manage/");
    try{
      service.gate();if(url.origin!==service.config.origin || url.search)throw new Error("INVALID_INPUT");
      if(isSavedEstimatePath(path))return await savedEstimatePage(request,service,sessions,now);
      if(path==="/api/v1/preview-transfers" && request.method==="POST"){
        if(!(await limiter.limit({key:"oes:preview-transfer-create:v1"})).success)throw new Error("RATE_LIMITED");
        const proof=request.headers.has("Authorization")?secret(request):null;
        if(request.headers.has("Cookie") || request.headers.has("Origin"))throw new Error("AUTH_REQUIRED");
        return json(await service.create(await boundedPreviewBody(request,4096),request.headers.get("Idempotency-Key")??"",proof,now));
      }
      const machine=path.match(/^\/api\/v1\/preview-transfers\/(pt_[a-f0-9]{32})\/(status|preview|result)$/);
      if(machine && request.method==="POST"){
        const proof=secret(request);
        if(machine[2]==="result"){checkContract(emptyTransferSchema,await boundedPreviewBody(request,64));return json(await service.result(machine[1],proof,now));}
        if(machine[2]==="status"){checkContract(emptyTransferSchema,await boundedPreviewBody(request,64));const state=await service.status(machine[1],proof,now);return json(state,state.state==="EXPIRED"?410:200);}
        return json(await service.submit(machine[1],proof,await boundedPreviewBody(request,1024*1024),now));
      }
      const transfer=path.match(/^\/manage\/preview-transfers\/(pt_[a-f0-9]{32})(\/approve)?$/);
      if(transfer){
        let s;try{s=await session(request,now);}catch(e){if(request.method!=="GET")throw e;return new Response(null,{status:303,headers:{...ownerHeaders,Location:service.config.origin+"/manage/auth/login?preview_transfer_id="+transfer[1]}});}
        const row=await service.browserContext(transfer[1],s.principal.subject,now),target={preview_id:row.transfer_id,draft_hash:row.binding_hash};
        if(request.method==="GET" && !transfer[2]){
          if(row.state==="READY" && row.preview_id)return new Response(null,{status:303,headers:{...ownerHeaders,Location:service.config.origin+(row.policy_version===ESTIMATE_POLICY?"/manage/estimate-previews/":"/manage/certificate-previews/")+row.preview_id}});
          if(row.policy_version===ESTIMATE_POLICY)return page("<h1>見積の掲載方法が変更されました</h1><p>この旧受付からは送信しません。元のチャットで保存済み結果から新しいプレビューとPDFを作り、掲載内容を確認してください。</p>");
          if(row.state==="APPROVED"){
            const response=page('<h1>試算結果を準備しています</h1><p>送信を許可しました。ローカル処理が送信・再計算を進めています。この画面でお待ちください。</p><p>5秒ごとに状態を確認し、完成した本人限定の結果ページへ移動します。</p><p>処理を中断した場合は、元のチャットで再開してください。同じ内容への同意を繰り返す必要はありません。</p>');
            response.headers.set("Refresh","5");return response;
          }
          if(row.state!=="PENDING")return page("<h1>この送信確認は終了しました</h1><p>送信は開始できません。元のチャットで状態を確認してください。</p>");
          return page(`<h1>${row.policy_version===ESTIMATE_POLICY?"数値データの送信とWeb表示を確認":"ローカル結果の送信を確認"}</h1><p>ログインした本人だけの結果ページを作成します。<strong>証明書の発行・一般公開の承認ではありません。</strong></p><p>${row.policy_version===ESTIMATE_POLICY?"送信するのは数値モデル・品質の数値集計と理由コード・表示通貨・スキルと測定規則の版です。対象名・パス・根拠本文・公開用説明は送りません。":"送信するのは数値モデル・公開候補・公開用の説明・基準の参照です。"}ソースや元run情報は送りません。結果と説明は15分間の本人限定表示とし、期限後1時間以内に削除します。</p><form method="post" action="/manage/preview-transfers/${row.transfer_id}/approve"><input type="hidden" name="csrf" value="${escape(await sessions.csrfToken(s,target))}"><label>チャットまたは補助CLIに表示された8桁の照合コード<input name="code" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" required autocomplete="off"></label><label><input type="checkbox" name="consent" value="yes" required>このローカル結果を送信し、本人限定のプレビューを作成する</label><button type="submit">${row.policy_version===ESTIMATE_POLICY?"数値データを送信してWebで結果を見る":"この結果の送信を許可する"}</button></form><p>承認期限：${escape(new Date(row.expires_at).toISOString())}</p>`);
        }
        if(request.method==="POST" && transfer[2]){
          if(request.headers.get("Origin")!==service.config.origin)throw new Error("AUTH_REQUIRED");
          const form=await boundedPreviewBody(request,1024,true) as URLSearchParams;
          if([...form.keys()].length!==3 || ["csrf","code","consent"].some(k=>form.getAll(k).length!==1) || form.get("consent")!=="yes"
            || !await sessions.verifyCsrf(s,target,form.get("csrf")??""))throw new Error("APPROVAL_REQUIRED");
          await service.approve(row.transfer_id,s.principal.subject,form.get("code")!,now);
          const response=page('<h1>送信を許可しました</h1><p>本人限定の結果ページを準備しています。準備ができると自動で表示します。まだ未発行・未公開です。</p>');
          response.headers.set("Refresh","0; url="+service.config.origin+"/manage/preview-transfers/"+row.transfer_id);return response;
        }
      }
      const view=path.match(/^\/(?:manage\/(?:certificate|estimate)-previews|api\/v1\/owner-certificate-previews)\/(pv_[a-f0-9]{32})$/);
      if(view && request.method==="GET"){
        const s=await session(request,now),dto=await service.ownerPreview(view[1],s.principal.subject,now);
        if(!html)return json(dto);
        if(dto.display_quote)return page(estimateResultHtml(dto));
        const r=dto.result,m=r.measurement,q=r.quality,quartile=(v:{p25:string|null;median:string|null;p75:string|null}|null)=>v?`${escape(v.p25)} / ${escape(v.median)} / ${escape(v.p75)}`:"未算出";
        return page(`<h1>公開前プレビュー</h1><p><strong>本人限定・未発行・未公開・未署名</strong></p><h2>${escape(dto.metadata.title)}</h2><p>${escape(dto.metadata.description??"説明なし")}</p><section><h2>${escape(m.cfp??"未算出")} ${m.cfp===null?"":"CFP"}</h2><p>計算状態：${label(m.status)} ／ 計上した機能：${m.counts.accepted_processes}</p><table><tr><th>Entry</th><th>Exit</th><th>Read</th><th>Write</th></tr><tr><td>${m.counts.entry}</td><td>${m.counts.exit}</td><td>${m.counts.read}</td><td>${m.counts.write}</td></tr></table><p>参考工数（時間）：${quartile(r.calculation.effort.person_hours)}</p><p>基準USD額：${quartile(r.calculation.reference_usd.amount_usd)}</p><small>各値はp25 / 中央値 / p75。架空のTEST係数・TEST時給による参考試算で、実績の分布・信頼区間・納期・市場価格の証明ではありません。為替換算は行っていません。</small></section><section><h2>品質と未確定事項</h2><p>暫定：${q.provisional_process_count}機能／${q.provisional_cfp_subtotal} CFP（合計の内数）。未解決：${q.unresolved_process_count}機能、未採用の未解決候補：${q.candidate_counts.unresolved}件（規模は未確定）。</p><p>候補：識別${q.candidate_counts.identified}、採用${q.candidate_counts.counted}、範囲外${q.candidate_counts.outside}、統合${q.candidate_counts.merged}、未解決${q.candidate_counts.unresolved}。</p><p>記録不足：${q.record_gap_codes.map(label).join("、")||"なし"}</p><p>範囲内の未確認ファイル：${q.unread_counts.in_scope}、範囲外未読：${q.unread_counts.outside}、補助未読：${q.unread_counts.supporting}、範囲所属不明：${q.unread_counts.scope_unknown}。</p><p>境界未確認：独立再実行${q.unknown_boundary_counts.rerun}、継続関係${q.unknown_boundary_counts.continuation}。</p><p>測定完了：${q.analysis_complete?"はい":"いいえ"} ／ 走査完了：${q.scan_complete?"はい":"いいえ"}</p><p>理由：${q.partial_reason_codes.map(label).join("、")||"なし"}</p><p>未算出・制約：${r.limitation_codes.map(label).join("、")} ／ ${label(r.calculation.effort.status)} ／ ${label(r.calculation.reference_usd.status)}</p></section><section><h2>対象と基準</h2><p>設計・実装・テストが対象。企画・日々の運用作業は含みません。運用に使うプログラムの開発は測定範囲によります。</p><p>${escape(dto.metadata.scope_note??"対象として計上した機能のみ")}</p><p>ソースの真正性・網羅性とAIの意味解釈は独立監査していません。</p><p>基準：${escape(r.calculation.basis.profile_set_id)} ／ ${escape(r.calculation.basis.engine_version)} ／ ${escape(r.calculation.basis.mapping_version)}</p><p>TEST係数（時間/CFP）：${quartile(r.calculation.basis.benchmark.hours_per_cfp)} ／ TEST時給：${escape(r.calculation.basis.wage.hourly_wage_usd)} USD</p><p>測定規則版：${escape(dto.ruleset_ref.revision)}</p><p>期限：${escape(dto.expires_at)}</p><p>説明の修正は新しいsubmissionで行ってください。</p></section><a href="/manage/estimates/save/${dto.preview_id}">この試算を30日間保存する</a>　<a href="/manage/estimates">保存した試算</a>　<a href="/manage">ログイン管理へ</a>`);
      }
      throw new Error("NOT_FOUND");
    }catch(e){const code=e instanceof Error && Object.hasOwn(statusCodes,e.message)?e.message:"STATUS_UNAVAILABLE",status=statusCodes[code];
      const response=html?page(`<h1>${status===410?"プレビューまたは送信許可の期限が切れました":status===404?"ページが見つかりません":"操作を完了できませんでした"}</h1><p>${escape(code)}</p>`,status):json({error:{code,request_id:randomUUID(),retryable:status===429 || status===503}},status);
      if(status===429)response.headers.set("Retry-After","5");return response;
    }
  }};
}
