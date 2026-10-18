import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import { createEvaluation } from "../../src/core/evaluation.js";
import { createDisplayQuote, resolveCurrency } from "../../src/core/display-quote.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { parseFrbRelease } from "../../src/profiles/frb.js";
import { frbHtml, fxNow } from "../fixtures/frb.js";
const assessment = JSON.parse(fs.readFileSync(new URL("../../examples/basic-assessment.json", import.meta.url), "utf8"));
const provider = (rate = "150") => ({ get: vi.fn(async () => ({ status: "AVAILABLE" as const, snapshot: parseFrbRelease(frbHtml(rate), fxNow).get("JPY")!, limitation_codes: [] })) });

describe("Fixed evaluation / display-time conversion", () => {
  it("revalues without changing CFP, hours, USD, basis or report hash", async () => {
    const fixed = createEvaluation(assessment, getLocalProfile());
    const before = JSON.stringify(fixed);
    const a = await createDisplayQuote(fixed, provider("150"), "ja-JP");
    const b = await createDisplayQuote(fixed, provider("160"), "ja-JP");
    expect(fixed.report.measurement.cfp).toBe(6);
    expect(fixed.report.effort.person_hours?.median).toBe("18");
    expect(fixed.report.reference_usd.amount_usd?.median).toBe("900");
    expect(a.localized_reference.amount?.median).toBe("135000");
    expect(b.localized_reference.amount?.median).toBe("144000");
    expect(a.source_report_hash).toBe(b.source_report_hash);
    expect(JSON.stringify(fixed)).toBe(before);
    expect(JSON.stringify(fixed.report)).not.toMatch(/displayed_at|generated_at|fx_snapshot|localized_reference/);
    expect(fixed.basis.effort_scope_id).toBe("oes-design-implementation-test-v1");
    expect(a.limitation_codes).toContain("TEST_DATA_ONLY");
  });
  it("uses unrounded USD internally and rounds JPY once", async () => {
    const profile = getLocalProfile();
    profile.benchmark.hours_per_cfp.median = "0.111111";
    profile.wage.hourly_wage_usd = "1";
    const fixed = createEvaluation(assessment, profile);
    const q = await createDisplayQuote(fixed, provider("1500"));
    expect(fixed.report.reference_usd.amount_usd?.median).toBe("0.67");
    expect(q.localized_reference.amount?.median).toBe("1000"); // not 0.67 * 1500 = 1005
  });
  it("does not fetch for USD, or unavailable upstream effort", async () => {
    const fx = provider();
    const fixed = createEvaluation(assessment, getLocalProfile());
    expect((await createDisplayQuote(fixed, fx, "en-US")).localized_reference.currency_per_usd).toBe("1");
    const unavailable = structuredClone(fixed);
    unavailable.report.effort.status = "INSUFFICIENT_BENCHMARK";
    expect((await createDisplayQuote(unavailable, fx)).localized_reference.status).toBe("UPSTREAM_UNAVAILABLE");
    expect(fx.get).not.toHaveBeenCalled();
  });
  it("shows unavailable FX as null, not zero or a fabricated TEST rate", async () => {
    const fixed = createEvaluation(assessment, getLocalProfile());
    const q = await createDisplayQuote(fixed, { get: async () => ({ status: "FX_UNAVAILABLE", snapshot: null, limitation_codes: ["FX_UNAVAILABLE"] }) });
    expect(q.localized_reference.amount).toBeNull();
    expect(q.localized_reference.status).toBe("FX_UNAVAILABLE");
    expect(fixed.report.reference_usd.amount_usd?.median).toBe("900");
  });
  it("maps locale regions conservatively and validates explicit currencies", () => {
    expect(resolveCurrency("en-GB")).toBe("GBP");
    expect(resolveCurrency("ja")).toBe("USD");
    expect(resolveCurrency("bad_locale")).toBe("USD");
    expect(resolveCurrency("ja-JP", "EUR")).toBe("EUR");
    expect(() => resolveCurrency("ja-JP", "ZZZ")).toThrow("UNSUPPORTED_CURRENCY");
  });
});
