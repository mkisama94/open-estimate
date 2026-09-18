import { Decimal } from "decimal.js";
import type {
  CalculationContext,
  EffortEstimate,
  LocalizedReferenceEstimate,
  MeasurementResult,
  ReferenceUsdEstimate
} from "./types.js";

Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

function formatDecimal(d: InstanceType<typeof Decimal>, decimalPlaces: number): string {
  const fixed = d.toFixed(decimalPlaces);
  if (fixed.includes(".")) {
    return fixed.replace(/\.?0+$/, "");
  }
  return fixed;
}

export interface EstimationResult {
  effort: EffortEstimate;
  reference_usd: ReferenceUsdEstimate;
  localized_reference: LocalizedReferenceEstimate;
  limitation_codes: string[];
}

export function estimateAssessment(
  measurement: MeasurementResult,
  context: CalculationContext
): EstimationResult {
  const limitations = new Set<string>([
    "AI_SEMANTICS_UNVERIFIED",
    "COMMUNITY_CLAIMS_UNATTESTED",
    "REFERENCE_NOT_MARKET_VALUE"
  ]);

  if (measurement.status === "PARTIAL") {
    limitations.add("PARTIAL_MEASUREMENT");
  }

  const cfp = measurement.cfp;

  // If measurement is not available (null), effort and amounts are unsupported
  if (cfp === null || cfp <= 0) {
    return {
      effort: { status: "UNSUPPORTED", hours_per_cfp: null, person_hours: null },
      reference_usd: { status: "UNSUPPORTED", hourly_wage_usd: null, amount_usd: null },
      localized_reference: { status: "UNSUPPORTED", currency: context.display_currency || "USD", currency_per_usd: null, amount: null },
      limitation_codes: Array.from(limitations).sort()
    };
  }

  // 1. Effort Estimation
  let effort: EffortEstimate;
  let unroundedHours: { p25: InstanceType<typeof Decimal>; median: InstanceType<typeof Decimal>; p75: InstanceType<typeof Decimal> } | null = null;

  if (!context.benchmarkProfile) {
    limitations.add("BENCHMARK_UNAVAILABLE");
    effort = {
      status: "BENCHMARK_UNAVAILABLE",
      hours_per_cfp: null,
      person_hours: null
    };
  } else {
    const bp = context.benchmarkProfile;
    if (bp.is_test) {
      limitations.add("TEST_DATA_ONLY");
    }

    if (cfp < bp.min_cfp || cfp > bp.max_cfp) {
      limitations.add("BENCHMARK_OUT_OF_RANGE");
      effort = {
        status: "OUTSIDE_REFERENCE_RANGE",
        hours_per_cfp: null,
        person_hours: null
      };
    } else {
      const p25Rate = new Decimal(bp.hours_per_cfp.p25);
      const medRate = new Decimal(bp.hours_per_cfp.median);
      const p75Rate = new Decimal(bp.hours_per_cfp.p75);

      const dCfp = new Decimal(cfp);
      const p25Hours = dCfp.mul(p25Rate);
      const medHours = dCfp.mul(medRate);
      const p75Hours = dCfp.mul(p75Rate);

      unroundedHours = { p25: p25Hours, median: medHours, p75: p75Hours };

      effort = {
        status: "AVAILABLE",
        hours_per_cfp: {
          p25: bp.hours_per_cfp.p25,
          median: bp.hours_per_cfp.median,
          p75: bp.hours_per_cfp.p75
        },
        person_hours: {
          p25: formatDecimal(p25Hours, 6),
          median: formatDecimal(medHours, 6),
          p75: formatDecimal(p75Hours, 6)
        }
      };
    }
  }

  // 2. Reference USD Estimation
  let referenceUsd: ReferenceUsdEstimate;
  let unroundedUsd: { p25: InstanceType<typeof Decimal>; median: InstanceType<typeof Decimal>; p75: InstanceType<typeof Decimal> } | null = null;

  if (!unroundedHours || !context.wageProfile) {
    if (!context.wageProfile && unroundedHours) {
      limitations.add("WAGE_UNAVAILABLE");
    }
    referenceUsd = {
      status: "WAGE_UNAVAILABLE",
      hourly_wage_usd: null,
      amount_usd: null
    };
  } else {
    const wp = context.wageProfile;
    if (wp.is_test) {
      limitations.add("TEST_DATA_ONLY");
    }
    const wage = new Decimal(wp.hourly_wage_usd);
    const p25Usd = unroundedHours.p25.mul(wage);
    const medUsd = unroundedHours.median.mul(wage);
    const p75Usd = unroundedHours.p75.mul(wage);

    unroundedUsd = { p25: p25Usd, median: medUsd, p75: p75Usd };

    referenceUsd = {
      status: "AVAILABLE",
      hourly_wage_usd: wp.hourly_wage_usd,
      amount_usd: {
        p25: formatDecimal(p25Usd, 2),
        median: formatDecimal(medUsd, 2),
        p75: formatDecimal(p75Usd, 2)
      }
    };
  }

  // 3. Localized Reference Estimation
  let localized: LocalizedReferenceEstimate;
  const targetCurrency = context.display_currency || (context.locale.includes("JP") ? "JPY" : "USD");

  if (!unroundedUsd || !context.fxRate) {
    if (!context.fxRate && unroundedUsd && targetCurrency !== "USD") {
      limitations.add("FX_UNAVAILABLE");
    }
    localized = {
      status: targetCurrency === "USD" ? "AVAILABLE" : "FX_UNAVAILABLE",
      currency: targetCurrency,
      currency_per_usd: targetCurrency === "USD" ? "1" : null,
      amount: targetCurrency === "USD" ? referenceUsd.amount_usd : null
    };
  } else {
    const fx = new Decimal(context.fxRate.currency_per_usd);
    const p25Loc = unroundedUsd.p25.mul(fx);
    const medLoc = unroundedUsd.median.mul(fx);
    const p75Loc = unroundedUsd.p75.mul(fx);

    const decimalPlaces = targetCurrency === "JPY" || targetCurrency === "KRW" ? 0 : 2;

    localized = {
      status: "AVAILABLE",
      currency: targetCurrency,
      currency_per_usd: context.fxRate.currency_per_usd,
      amount: {
        p25: formatDecimal(p25Loc, decimalPlaces),
        median: formatDecimal(medLoc, decimalPlaces),
        p75: formatDecimal(p75Loc, decimalPlaces)
      }
    };
  }

  return {
    effort,
    reference_usd: referenceUsd,
    localized_reference: localized,
    limitation_codes: Array.from(limitations).sort()
  };
}
