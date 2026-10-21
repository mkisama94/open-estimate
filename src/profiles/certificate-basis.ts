import type { LocalProfile } from "../core/evaluation.js";
import type { PublicResultCandidate } from "../core/public-result.js";
import { jcsSha256 } from "../core/canonical.js";

/** Immutable snapshot: changes require a new entry, never a mutable default-profile lookup. */
const initial = {
  schema_version:"oes/calculation-basis/v1" as const,environment:"TEST" as const,
  effort_scope_id:"oes-design-implementation-test-v1" as const,hours_per_day:8 as const,
  basis:{profile_set_id:"oes-local-test-2026-10-v1" as const,engine_version:"0.8.1-quality" as const,mapping_version:"oes-cosmic-ph1-v1" as const,
    benchmark:{id:"oes-test-benchmark-design-implementation-test-v1" as const,is_test:true as const,sample_size:0,min_cfp:1,max_cfp:10000,hours_per_cfp:{p25:"2",median:"3",p75:"5"}},
    wage:{id:"oes-test-wage-50usd-v1" as const,is_test:true as const,hourly_wage_usd:"50"}}
};
export const INITIAL_CERTIFICATE_BASIS_HASH = jcsSha256(initial);
export function getCertificateBasis(hash = INITIAL_CERTIFICATE_BASIS_HASH) {
  if (hash!==INITIAL_CERTIFICATE_BASIS_HASH) throw new Error("BASIS_UNSUPPORTED");
  return structuredClone(initial);
}
export function matchCertificateBasis(c: PublicResultCandidate["calculation"]) {
  const value={schema_version:"oes/calculation-basis/v1",environment:c.environment,effort_scope_id:c.effort_scope_id,hours_per_day:c.hours_per_day,basis:c.basis};
  if (jcsSha256(value)!==INITIAL_CERTIFICATE_BASIS_HASH) throw new Error("BASIS_MISMATCH");
  return getCertificateBasis();
}
export function certificateCalculationProfile(): LocalProfile {
  const b=getCertificateBasis();
  return {profile_set_id:b.basis.profile_set_id,environment:b.environment,effort_scope_id:b.effort_scope_id,
    effort_scope_name:"設計・実装・テスト（企画・運用を含まない）",notice:"架空のTEST係数です。実績ベンチマーク・実際の賃金統計ではありません。",
    benchmark:b.basis.benchmark,wage:b.basis.wage};
}
