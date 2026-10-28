import PDFDocument from "pdfkit";
import {fileURLToPath} from "node:url";
import {estimatePresentation,type ResultSnapshot} from "../core/estimate-publication.js";

/** No source text, paths, ledger or arbitrary assessment prose enters this PDF. */
export async function renderEstimatePdf(snapshot:ResultSnapshot,resultUrl?:string):Promise<Buffer>{
  if(resultUrl&&!/^https:\/\/open-estimate\.ai-orchestration\.jp\/manage\/estimates\/se_[a-f0-9]{32}$/.test(resultUrl))throw new Error("INVALID_RESULT_URL");
  const v=estimatePresentation(snapshot),r=snapshot.result;
  const doc=new PDFDocument({size:"A4",margin:48,bufferPages:true,info:{Title:"Open Estimate - TEST参考見積",Author:"Open Estimate",Subject:resultUrl?"本人限定の保存結果":"掲載前の確認用"}});
  const chunks:Buffer[]=[];
  const completed=new Promise<Buffer>((resolve,reject)=>{doc.on("data",chunk=>chunks.push(chunk));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
  doc.font(fileURLToPath(new URL("../../profiles/report-font.ttf",import.meta.url)));
  const text=(s:string,size=11)=>{doc.fontSize(size).fillColor("#213a43").text(s,{lineGap:5});doc.moveDown(.5);};
  const heading=(s:string)=>{doc.moveDown(.5);text(s,16);};
  const range=(q:{p25:string|null;median:string|null;p75:string|null}|null|undefined)=>q?`${q.p25??"未算出"} / ${q.median??"未算出"} / ${q.p75??"未算出"}`:"未算出";
  text("OPEN ESTIMATE",13);text(resultUrl?"本人限定・保存済み":"掲載前・ローカル確認用",10);
  doc.moveDown();text(v.headline,17);text(v.median===null?"未算出":`${v.median} 時間`,38);
  if(v.portion_median!==null)text(`取得済み部分のみの参考工数：${v.portion_median} 時間（中央値）`,17);
  text(v.notice,11);text(`参考工数の幅：${v.hours?.p25??"未算出"} - ${v.hours?.p75??"未算出"} 時間`);
  text(`${v.scope_coverage==="COMPLETE"?"対象全体の参考見積":"取得済み部分のみの試算"} / TEST参考値 / ${r.measurement.status}`);
  text(`${v.scope_coverage==="COMPLETE"?"人日":"部分試算の人日"}（1日8時間）：${v.person_days?.median??"未算出"}`);
  heading("対象範囲と測定日");text("対象：合意した実装の機能規模。設計・実装・テストの参考工数。企画・日々の運用は含みません。");text(`測定日時：${v.measured_at}`);text(`取得充足：${v.scope_coverage} / 機能規模：${r.measurement.cfp??"未算出"} CFP`);
  heading("工数と参考金額");text("各値は p25 / 中央値 / p75");
  text(`${v.effort_label}（時間）：${range(v.hours)}`);text(`人日：${range(v.person_days)}`);text(`参考金額（${v.currency}）：${range(v.amount)}`);text(`基準金額（USD）：${range(r.calculation.reference_usd.amount_usd)}`);
  if(resultUrl){text(`本人用結果URL：${resultUrl}`,10);}else text("Web掲載はまだ行っていません。このPDFは掲載の完了を示しません。",10);
  doc.addPage();heading("品質状態・暫定判断・未確認事項");
  const q=r.quality;
  text(`計数状態：${r.measurement.status} / 暫定 ${q.provisional_process_count} 機能 / ${q.provisional_cfp_subtotal} CFP（合計の内数）`);
  text(`未解決 ${q.unresolved_process_count} 機能 / 未採用の未解決候補 ${q.candidate_counts.unresolved} 件`);
  text(`未読：範囲内 ${q.unread_counts.in_scope} / 範囲外 ${q.unread_counts.outside} / 補助 ${q.unread_counts.supporting} / 所属不明 ${q.unread_counts.scope_unknown}`);
  text(`機能の移動内訳：Entry ${r.measurement.counts.entry} / Exit ${r.measurement.counts.exit} / Read ${r.measurement.counts.read} / Write ${r.measurement.counts.write}`);
  text(`未確認理由：${q.partial_reason_codes.join(", ")||"なし"}`);text(`記録不足：${q.record_gap_codes.join(", ")||"なし"}`);
  heading("計算条件と為替条件");
  const b=r.calculation.basis;
  text(`TEST係数（時間/CFP）：${range(b.benchmark.hours_per_cfp)}`);text(`TEST時給：${b.wage.hourly_wage_usd} USD`);
  text(`計算基準：${b.profile_set_id} / ${b.engine_version}`);text(`測定ルール版：${snapshot.input.evaluation.ruleset_ref.revision}`,9);
  text(`換算状態：${v.quote.localized_reference.status} / 確認日時：${v.quote.displayed_at}`);
  if(v.quote.fx_snapshot){text(`1 USD = ${v.quote.fx_snapshot.currency_per_usd} ${v.currency} / 観測日：${v.quote.fx_snapshot.observed_on}`);text("為替出典：FRB H.10。確認した条件を固定し、掲載時に現在レートへ差し替えません。");}
  text(`制約：${v.limitations.join(", ")}`);
  heading("掲載範囲と取扱い");
  text("掲載対象：数値モデル・数値結果・品質集計・取得充足状態・測定日・計算条件・固定した為替条件・配布スキルと測定ルールの参照版。");
  text("ソースコード・対象パス・根拠本文・判断台帳は掲載しません。一般公開・証明書発行は含みません。本人限定で30日保存し、延長・削除できます。");
  text("入力と品質は利用者側の申告です。AIの意味解釈は独立監査されていません。実工数・納期・市場価格を保証しません。");
  const pages=doc.bufferedPageRange();
  for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.fontSize(9).fillColor("#536970").text(`Open Estimate / TEST / ${i+1} of ${pages.count}`,48,805,{lineBreak:false});}
  doc.end();return completed;
}
