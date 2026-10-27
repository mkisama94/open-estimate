import type { Assessment } from "../core/types.js";
export function resultCoverage(a: Assessment, hours: unknown) {
  const coverage=a.input.acquisition?.scope_coverage??"UNKNOWN";
  const whole=coverage === "COMPLETE";
  return {scope_coverage:coverage,interpretation_status:!a.judgments?"UNKNOWN":a.judgments.some(j=>j.status!=="recorded")?"PROVISIONAL":"RECORDED",
    project_effort:whole?hours:null,acquired_portion_effort:whole?null:hours,
    headline:whole?"対象全体の参考工数":"プロジェクト全体の工数：未算出",
    effort_label:whole?"対象全体の参考工数":"取得済み部分のみの参考工数",
    notice:whole?"TEST参考値。計数判断の確かさは別途確認してください。":"対象範囲の充足を確認できないため、全体工数としては利用できません。"};
}
