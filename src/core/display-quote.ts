import { Decimal } from "decimal.js";
import type { FixedEvaluation } from "./evaluation.js";
import type { QuartileValues } from "./types.js";
import { CURRENCIES, type Currency, type FxProvider } from "../profiles/frb.js";

export function resolveCurrency(locale = "ja-JP", explicit?: string): Currency {
  if (explicit !== undefined) {
    if (!CURRENCIES.includes(explicit as Currency)) throw new Error("UNSUPPORTED_CURRENCY");
    return explicit as Currency;
  }
  const byRegion: Record<string, Currency> = { JP: "JPY", US: "USD", GB: "GBP", DE: "EUR", FR: "EUR", AU: "AUD", NZ: "NZD", CA: "CAD", CH: "CHF", CN: "CNY", HK: "HKD", IN: "INR", KR: "KRW", SG: "SGD" };
  try { return byRegion[new Intl.Locale(locale).region ?? ""] ?? "USD"; } catch { return "USD"; }
}

export interface DisplayQuoteInput {
  report: Pick<FixedEvaluation["report"], "measurement"|"effort"|"reference_usd"|"limitation_codes">;
  basis: Pick<FixedEvaluation["basis"], "benchmark"|"wage">;
  report_hash: string;
}

export async function createDisplayQuote(evaluation: DisplayQuoteInput, provider: FxProvider, locale = "ja-JP", explicit?: string, now = () => new Date()) {
  const currency = resolveCurrency(locale, explicit);
  const { report, basis } = evaluation;
  const upstream = report.effort.status !== "AVAILABLE" || report.reference_usd.status !== "AVAILABLE";
  const fx = currency === "USD" || upstream ? null : await provider.get(currency);
  const status = upstream ? "UPSTREAM_UNAVAILABLE" : currency === "USD" ? "AVAILABLE" : fx!.status;
  const rate = status === "AVAILABLE" ? currency === "USD" ? "1" : fx!.snapshot!.currency_per_usd : null;
  let amount: QuartileValues | null = null;
  let days: QuartileValues | null = null;
  if (report.effort.status === "AVAILABLE") {
    days = { p25: null, median: null, p75: null };
    for (const q of ["p25", "median", "p75"] as const) {
      const hours = new Decimal(report.measurement.cfp!).mul(basis.benchmark.hours_per_cfp[q]);
      days[q] = hours.div(8).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed();
    }
  }
  if (rate !== null) {
    amount = { p25: null, median: null, p75: null };
    for (const q of ["p25", "median", "p75"] as const) {
      amount[q] = new Decimal(report.measurement.cfp!).mul(basis.benchmark.hours_per_cfp[q])
        .mul(basis.wage.hourly_wage_usd).mul(rate)
        .toDecimalPlaces(currency === "JPY" || currency === "KRW" ? 0 : 2, Decimal.ROUND_HALF_UP).toFixed();
    }
  }
  return {
    domain: "open-estimate/display-quote/v1" as const,
    source_report_hash: evaluation.report_hash,
    conversion_policy_version: "frb-display-time-v1",
    displayed_at: now().toISOString(), locale, display_currency: currency,
    fx_snapshot: fx?.snapshot ?? null,
    localized_reference: { status, currency, currency_per_usd: rate, amount },
    person_days: days,
    limitation_codes: [...new Set([...report.limitation_codes, ...(fx?.limitation_codes ?? [])])].sort()
  };
}
export type DisplayQuote = Awaited<ReturnType<typeof createDisplayQuote>>;
