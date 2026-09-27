import { Decimal } from "decimal.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsPkg from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DecimalValue = string | number | InstanceType<typeof Decimal>;


const addFormats = (addFormatsPkg as any).default || addFormatsPkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PublicEstimatePayload {
  schema_version: "open-estimate/public-estimate/v1";
  display_version: "oes-ja-result/0.1.0";
  share_id: string;
  certificate_id: string;
  issued_at: string;
  published_at: string;
  metadata: {
    app_name: string;
    description: string;
    publisher_label: string | null;
    app_url: string | null;
    include_model_label: boolean;
    scope_description: string;
    unmeasured_description: string | null;
    result_scope_statement: string;
  };
  presentation: {
    hours_per_day: 8;
    convention_label: string;
    locale: "ja-JP";
    display_currency: "JPY";
  };
  measurement: {
    status: "COMPLETE" | "PARTIAL" | "UNSUPPORTED" | "INCOMPLETE";
    cfp: number | null;
    counts: {
      entry: number;
      exit: number;
      read: number;
      write: number;
      total_processes: number;
      accepted_processes: number;
      unresolved_processes: number;
    };
    inferred_movement_count: number;
    excluded_component_count: number;
    unread_file_count: number;
  };
  effort_scope_id: string;
  effort_scope_name: string;
  rules_and_standards: {
    measurement_standard: string;
    display_rule_version: string;
    schema_version: string;
  };
  assurance: {
    assessment_class: "COMMUNITY";
    context_isolation: "not_enforced";
    context_isolation_note: string;
    semantic_assessment: "NOT_INDEPENDENTLY_VERIFIED";
  };
  model_label: string | null;
  conversion: {
    effort: {
      status: "AVAILABLE" | "BENCHMARK_UNAVAILABLE" | "OUTSIDE_REFERENCE_RANGE" | "UNSUPPORTED";
      hours: { p25: string; median: string; p75: string } | null;
      days: { p25: string; median: string; p75: string } | null;
    };
    usd: {
      status: "AVAILABLE" | "WAGE_UNAVAILABLE" | "UNSUPPORTED";
      amounts: { p25: string; median: string; p75: string } | null;
    };
    local: {
      status: "AVAILABLE" | "FX_UNAVAILABLE" | "FX_STALE" | "UNSUPPORTED";
      currency: "JPY";
      currency_per_usd: string | null;
      amounts: { p25: string; median: string; p75: string } | null;
    };
  };
  basis: {
    benchmark: {
      profile_id: string;
      profile_version: string;
      source: string;
      source_url: string | null;
      period: string;
      domain: string;
      methodology: string;
      sample_size: number;
      hours_per_cfp: { p25: string; median: string; p75: string };
    };
    wage: {
      profile_id: string;
      source: string;
      source_url: string | null;
      occupation: string;
      region: string;
      metric: string;
      hourly_wage_usd: string;
      period: string | null;
    };
    fx: {
      currency: string;
      rate: string | null;
      currency_pair: string;
      observed_at: string | null;
      published_at: string | null;
      source: string;
      source_url: string | null;
    };
  };
  verification_links: {
    certificate_verify_url: string;
    public_envelope_url: string;
  };
  limitation_codes: string[];
}

/**
 * Calculates display person-days from person-hours (1 day = 8 hours).
 * Rules:
 * - ROUND_HALF_UP to 1 decimal place.
 * - Trailing .0 omitted.
 * - Positive value < 0.05 days is formatted as "0.1人日未満"
 */
export function formatPersonDays(hours: DecimalValue): string {
  const h = new Decimal(hours);
  if (h.isZero()) return "0";
  const days = h.dividedBy(8);
  if (days.gt(0) && days.lt(0.05)) {
    return "0.1人日未満";
  }
  const rounded = days.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  const str = rounded.toFixed(1);
  return str.endsWith(".0") ? str.slice(0, -2) : str;
}

/**
 * Formats Japanese Yen (JPY):
 * - Under 10,000 JPY: formatted as integer with comma (e.g. "9,800円")
 * - Under 100,000,000 JPY (1億円): formatted with "万円" and "約" (e.g. "約270万円")
 * - 100,000,000 JPY and above: formatted with "億円" and "約" (e.g. "約1億円", "約1.5億円")
 * - Rollover at boundaries (e.g. 99,999,999 -> 約1億円)
 */
export function formatJpy(amount: DecimalValue): { label: string; prefix: string; value: string; unit: string } {
  const val = new Decimal(amount);
  const abs = val.abs();

  if (abs.lt(10000)) {
    return {
      label: `${val.toNumber().toLocaleString("ja-JP")}円`,
      prefix: "",
      value: val.toNumber().toLocaleString("ja-JP"),
      unit: "円"
    };
  }

  // 1億円 = 100,000,000
  const manThreshold = new Decimal(100000000);
  if (abs.gte(manThreshold)) {
    const oku = val.dividedBy(100000000).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
    const okuStr = oku.toFixed(1);
    const cleanOku = okuStr.endsWith(".0") ? okuStr.slice(0, -2) : okuStr;
    return {
      label: `約${cleanOku}億円`,
      prefix: "約",
      value: cleanOku,
      unit: "億円"
    };
  }

  // Under 1億円 -> 万円
  const man = val.dividedBy(10000).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  if (man.gte(10000)) {
    // Boundary rollover check (e.g. 99,999,999 rounded to 10,000 万円 = 1 億円)
    return {
      label: "約1億円",
      prefix: "約",
      value: "1",
      unit: "億円"
    };
  }

  const manStr = man.toFixed(1);
  const cleanMan = manStr.endsWith(".0") ? manStr.slice(0, -2) : manStr;
  return {
    label: `約${cleanMan}万円`,
    prefix: "約",
    value: cleanMan,
    unit: "万円"
  };
}

/**
 * Builds the canonical share text for social media.
 */
export function buildShareText(payload: PublicEstimatePayload, canonicalUrl: string): string {
  const appName = payload.metadata.app_name;
  const isPartial = payload.measurement.status === "PARTIAL";
  const partialPrefix = isPartial ? "【部分測定】" : "";

  let daysLine = "";
  if (payload.conversion.effort.status === "AVAILABLE" && payload.conversion.effort.days) {
    const days = payload.conversion.effort.days.median;
    daysLine = `${partialPrefix}${days}人日相当（1人日＝8人時、参照実績による換算）。`;
  } else if (payload.measurement.cfp !== null) {
    daysLine = `${partialPrefix}${payload.measurement.cfp} CFP（人日換算未提供）。`;
  } else {
    daysLine = `${partialPrefix}機能規模未確定。`;
  }

  let amountLine = "";
  if (payload.conversion.local.status === "AVAILABLE" && payload.conversion.local.amounts) {
    const jpy = formatJpy(payload.conversion.local.amounts.median);
    amountLine = `参考労務換算額 ${jpy.label}。市場価値ではありません。`;
  } else if (payload.conversion.usd.status === "AVAILABLE" && payload.conversion.usd.amounts) {
    const usd = Number(payload.conversion.usd.amounts.median).toLocaleString("en-US");
    amountLine = `参考労務換算額 USD ${usd}。市場価値ではありません。`;
  }

  const lines = [
    `「${appName}」の工数換算レポート。`,
    daysLine,
    ...(amountLine ? [amountLine] : []),
    canonicalUrl,
    "#OpenEstimate"
  ];

  return lines.join("\n");
}

// Compile schema for testing/validation
const schemaPath = path.resolve(__dirname, "../../contracts/public-estimate.schema.json");
let validateFn: any = null;

export function validatePublicEstimate(data: unknown): boolean {
  if (!validateFn) {
    const schemaContent = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    validateFn = ajv.compile(schemaContent);
  }
  const valid = validateFn(data);
  if (!valid && validateFn.errors) {
    throw new Error(`PublicEstimate validation error: ${JSON.stringify(validateFn.errors, null, 2)}`);
  }
  return true;
}
