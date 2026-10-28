import {documentFromResult,type EstimateResult,type EstimateProof,type PublishedEstimate} from '../contracts/estimate-result.js';
import {documentPresentation} from './presentation.js';
export function estimateView(r:EstimateResult,proof?:EstimateProof,publication?:PublishedEstimate){
 const v=documentPresentation(documentFromResult(r)),q=r.result.quality,b=r.result.calculation.basis;
 const range=(x:{p25:string|null;median:string|null;p75:string|null}|null)=>x?`${x.p25??'未算出'} / ${x.median??'未算出'} / ${x.p75??'未算出'}`:'未算出';
 const sections=[
  {title:'工数・金額・機能規模',lines:[`人日（1日8時間）：${range(v.person_days)}`,`参考幅（時間）：${range(v.hours)}`,`参考金額（${v.currency}）：${range(v.amount)}`,`機能規模：${r.result.measurement.cfp??'未算出'} CFP`,`測定日時：${r.measured_at}`,`取得充足：${r.scope_coverage} / 計数状態：${r.result.measurement.status}`]},
  {title:'品質と未確認事項',lines:[`暫定：${q.provisional_process_count} 機能 / ${q.provisional_cfp_subtotal} CFP（内数）`,`未解決：${q.unresolved_process_count} 機能 / 候補 ${q.candidate_counts.unresolved} 件`,`未読：範囲内 ${q.unread_counts.in_scope} / 補助 ${q.unread_counts.supporting} / 所属不明 ${q.unread_counts.scope_unknown}`,`未確認理由：${q.partial_reason_codes.join(', ')||'なし'}`,`記録不足：${q.record_gap_codes.join(', ')||'なし'}`]},
  {title:'固定した計算・為替条件',lines:[`計算基準：${b.profile_set_id} / ${b.engine_version}`,`TEST係数（時間/CFP）：${range(b.benchmark.hours_per_cfp)}`,`TEST時給：${b.wage.hourly_wage_usd} USD`,`測定ルール版：${r.ruleset_ref.revision}`,`換算状態：${v.quote.localized_reference.status} / 固定日時：${v.quote.displayed_at}`,...(v.quote.fx_snapshot?[`1 USD = ${v.quote.fx_snapshot.currency_per_usd} ${v.currency} / 観測日 ${v.quote.fx_snapshot.observed_on}`]:[])]},
  {title:'証明と保証範囲',lines:[proof?`数値整合の証明：${proof.statement.proof_id}`:'数値整合の証明：未取得',...(proof?[`発行元：${proof.statement.issuer} / ${proof.statement.environment}`,`発行日時：${proof.statement.issued_at}`,`構造化結果 SHA-256：${proof.statement.result_hash}`]:[]),'署名対象は構造化結果です。PDF全体の電子署名ではありません。','ソース網羅性・AI意味判断・為替の真正性・実工数・納期・市場価格・提出者本人性は保証しません。','証明の現在の失効状態：未確認。Web公開の終了・停止とは別です。']},
  ...(publication?[{title:'Web公開',lines:[`公開URL：${publication.canonical_url}`,`公開終了：${publication.expires_at}（最初の公開から365日）`,'ログインなしでURLを知る人が閲覧できます。検索除外はアクセス制御ではありません。','ダウンロード済みPDFは公開終了後も利用できます。']}]:[])
 ];
 return {...v,sections,test:true};
}
export function renderEstimateMarkdown(r:EstimateResult,proof?:EstimateProof,publication?:PublishedEstimate){const v=estimateView(r,proof,publication);return ['# Open Estimate — TEST参考見積',`## ${v.headline}`,v.median===null?'未算出':`${v.median} 時間`,...(v.portion_median!==null?[`取得済み部分のみの参考工数：${v.portion_median} 時間（中央値）`]:[]),v.notice,...v.sections.flatMap(s=>['## '+s.title,...s.lines])].join('\n\n')+'\n';}
