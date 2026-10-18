import { Decimal } from "decimal.js";
import { sha256Hex } from "../core/canonical.js";

export const FRB_URL = "https://www.federalreserve.gov/releases/h10/current/";
export const CURRENCIES = ["USD", "JPY", "EUR", "GBP", "AUD", "NZD", "CAD", "CHF", "CNY", "HKD", "INR", "KRW", "SGD"] as const;
export type Currency = typeof CURRENCIES[number];
const series: Record<string, [string, string, boolean]> = {
  JPY: ["JAPAN", "YEN", false], EUR: ["EMU MEMBERS", "EURO", true],
  GBP: ["UNITED KINGDOM", "POUND", true], AUD: ["AUSTRALIA", "DOLLAR", true],
  NZD: ["NEW ZEALAND", "DOLLAR", true], CAD: ["CANADA", "DOLLAR", false],
  CHF: ["SWITZERLAND", "FRANC", false], CNY: ["CHINA, P.R.", "YUAN", false],
  HKD: ["HONG KONG", "DOLLAR", false], INR: ["INDIA", "RUPEE", false],
  KRW: ["SOUTH KOREA", "WON", false], SGD: ["SINGAPORE", "DOLLAR", false]
};
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY = 86400000;
const clean = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
class FrbRetrievalError extends Error {
  constructor(public readonly code: string) { super(code); }
}
const invalid = () => new FrbRetrievalError("FRB_RESPONSE_INVALID");
function isoDate(year: number, month: string, day: number): string {
  const m = months.indexOf(month.slice(0, 3).toLowerCase());
  const d = new Date(Date.UTC(year, m, day));
  if (m < 0 || d.getUTCMonth() !== m || d.getUTCDate() !== day) throw invalid();
  return d.toISOString().slice(0, 10);
}
export interface FxSnapshot {
  currency: Currency;
  source_url: string;
  source_sha256: string;
  observed_on: string;
  published_on: string;
  fetched_at: string;
  checked_at: string;
  raw_value: string;
  quote_direction: "currency_per_usd" | "usd_per_currency";
  currency_per_usd: string;
}
export interface FxResult {
  status: "AVAILABLE" | "FX_UNAVAILABLE" | "FX_STALE";
  snapshot: FxSnapshot | null;
  limitation_codes: string[];
}
export interface FxProvider { get(currency: Currency): Promise<FxResult>; }

/** Deliberately accepts only the known H.10 weekly table layout. */
export function parseFrbRelease(html: string, now: Date): Map<Currency, FxSnapshot> {
  const release = clean(html).match(/Release Date:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!release || !html.includes("Rates in currency units per U.S. dollar except as noted by an asterisk")
    || !clean(html).includes("U.S. dollars per currency unit.")) throw invalid();
  const year = Number(release[3]);
  const published = isoDate(year, release[1], Number(release[2]));
  if (published > now.toISOString().slice(0, 10)) throw invalid();
  const tables = [...html.matchAll(/<table\b[^>]*class=["']statistics["'][^>]*>([\s\S]*?)<\/table>/gi)];
  if (tables.length !== 1) throw invalid();
  const rows = [...tables[0][1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m =>
    [...m[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(c => clean(c[1])));
  const header = rows[0];
  if (!header || header[0] !== "COUNTRY" || header[1] !== "CURRENCY" || header.length !== 7) throw invalid();
  const dates = header.slice(2).map(label => {
    const parts = label.match(/^([A-Za-z]+)\.?\s+(\d{1,2})$/);
    if (!parts) throw invalid();
    let date = isoDate(year, parts[1], Number(parts[2]));
    // A January release may contain December observations from the prior year.
    if (months.indexOf(release[1].slice(0, 3).toLowerCase()) === 0 && parts[1].slice(0, 3).toLowerCase() === "dec")
      date = isoDate(year - 1, parts[1], Number(parts[2]));
    if (date > published || (Date.parse(published) - Date.parse(date)) / DAY > 31) throw invalid();
    return date;
  });
  if (dates.some((d, i) => i > 0 && d <= dates[i - 1])) throw invalid();
  const out = new Map<Currency, FxSnapshot>();
  for (const [currency, [country, unit, inverse]] of Object.entries(series)) {
    const matching = rows.slice(1).filter(r => r[0]?.replace(/^\*\s*/, "") === country);
    if (matching.length !== 1) throw invalid();
    const row = matching[0];
    if (row.length !== header.length || row[1] !== unit || row[0].startsWith("*") !== inverse) throw invalid();
    let latest: FxSnapshot | undefined;
    row.slice(2).forEach((raw, i) => {
      if (raw === "ND") return;
      if (!/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$/.test(raw) || new Decimal(raw).lte(0)) throw invalid();
      latest = {
        currency: currency as Currency, source_url: FRB_URL, source_sha256: sha256Hex(html),
        observed_on: dates[i], published_on: published, fetched_at: now.toISOString(), checked_at: now.toISOString(),
        raw_value: raw, quote_direction: inverse ? "usd_per_currency" : "currency_per_usd",
        currency_per_usd: inverse ? new Decimal(1).div(raw).toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toFixed() : new Decimal(raw).toFixed()
      };
    });
    if (latest) out.set(currency as Currency, latest);
  }
  return out;
}

export class FrbProvider implements FxProvider {
  private cached = new Map<Currency, FxSnapshot>();
  private pending: Promise<Map<Currency, FxSnapshot>> | undefined;
  constructor(private readonly request: typeof fetch = (input, init) => fetch(input, init), private readonly clock = () => new Date()) {}

  private async refresh(): Promise<Map<Currency, FxSnapshot>> {
    // Invoke injected functions without binding the provider as their receiver.
    // Workers' native fetch requires its original calling context.
    const request = this.request;
    const response = await request(FRB_URL, {
      signal: AbortSignal.timeout(5000), redirect: "manual", headers: { Accept: "text/html" }
    });
    // Workers does not implement redirect:error. Reject redirects explicitly;
    // never follow a response to another URL or host.
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html") || !response.body) {
      const code = response.status >= 300 && response.status < 400 ? "FRB_REDIRECT_REJECTED"
        : !response.ok ? "FRB_HTTP_ERROR"
        : !response.headers.get("content-type")?.includes("text/html") ? "FRB_CONTENT_TYPE_INVALID" : "FRB_BODY_MISSING";
      await response.body?.cancel();
      throw new FrbRetrievalError(code);
    }
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 5 * 1024 * 1024) throw new FrbRetrievalError("FRB_RESPONSE_TOO_LARGE");
        parts.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(parts);
    let html: string;
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new FrbRetrievalError("FRB_UTF8_INVALID"); }
    const parsed = parseFrbRelease(html, this.clock());
    this.cached = parsed;
    return parsed;
  }

  async get(currency: Currency): Promise<FxResult> {
    let failureCode: string | null = null;
    // Collapse only concurrent requests. Every later display rechecks the source.
    this.pending ??= this.refresh().finally(() => { this.pending = undefined; });
    try { await this.pending; }
    catch (e) {
      // Expose only controlled codes, never upstream bodies, URLs or raw errors.
      failureCode = e instanceof FrbRetrievalError ? e.code
        : e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name) ? "FRB_TIMEOUT" : "FRB_FETCH_FAILED";
    }
    const snapshot = this.cached.get(currency) ?? null;
    const flags = failureCode ? ["FX_CACHE_AFTER_FAILURE", failureCode] : [];
    if (!snapshot) return { status: "FX_UNAVAILABLE", snapshot: null, limitation_codes: ["FX_UNAVAILABLE", failureCode ?? "FRB_CURRENCY_UNAVAILABLE"] };
    const age = (Date.parse(this.clock().toISOString().slice(0, 10)) - Date.parse(snapshot.observed_on)) / DAY;
    if (age < 0 || age > 14) return { status: "FX_STALE", snapshot, limitation_codes: [...flags, "FX_STALE"] };
    return { status: "AVAILABLE", snapshot, limitation_codes: flags };
  }
}
export const frbProvider = new FrbProvider();
