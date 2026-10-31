import type {EstimateDocument} from '../contracts/document.js';
import {wholeMeasuredScope} from '../core/measured-scope.js';
export function documentPresentation(d:EstimateDocument){
 const r=d.result,h=r.calculation.effort.person_hours,q=d.display_quote,whole=wholeMeasuredScope(d.scope_coverage,r.quality.unread_counts);
 return {headline:whole?'総工数の目安（中央値）':'全体工数：未算出',median:whole?h?.median??null:null,portion_median:whole?null:h?.median??null,
 effort_label:whole?'総工数の目安':'取得済み部分のみの参考工数',person_days:q.person_days,hours:h,amount:q.localized_reference.amount,currency:q.display_currency,
 measurement:r.measurement,quality:r.quality,scope_coverage:d.scope_coverage,measured_at:d.measured_at,conditions:r.calculation.basis,quote:q,limitations:r.limitation_codes,
 notice:whole?'TEST係数による参考値。人日は総作業量であり納期ではありません。':'取得・読取を含む計測対象の充足を確認できないため、全体工数としては利用できません。'};
}
