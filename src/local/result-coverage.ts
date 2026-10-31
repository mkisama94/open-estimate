import type { Assessment } from "../core/types.js";
import {recordState} from '../core/records.js';
import {wholeMeasuredScope} from '../core/measured-scope.js';
export function resultCoverage(a: Assessment, hours: unknown) {
  const coverage=a.input.acquisition?.scope_coverage??"UNKNOWN";
  const state=a.input.manifest?recordState(a):undefined;
  const whole=wholeMeasuredScope(coverage,state?{in_scope:state.in_scope_unread.length,scope_unknown:state.scope_unknown_files.length}:undefined);
  return {scope_coverage:coverage,interpretation_status:!a.judgments?"UNKNOWN":a.judgments.some(j=>j.status!=="recorded")?"PROVISIONAL":"RECORDED",
    project_effort:whole?hours:null,acquired_portion_effort:whole?null:hours,
    headline:whole?"対象全体の参考工数":"プロジェクト全体の工数：未算出",
    effort_label:whole?"対象全体の参考工数":"取得済み部分のみの参考工数",
    notice:whole?"TEST参考値。計数判断の確かさは別途確認してください。":"取得・読取を含む計測対象の充足を確認できないため、全体工数としては利用できません。"};
}
