import { describe, it, expect, vi } from "vitest";
import { FrbProvider, FRB_URL, parseFrbRelease } from "../../src/profiles/frb.js";
import { frbHtml, fxNow, htmlResponse } from "../fixtures/frb.js";

describe("FRB H.10 direct provider", () => {
  it("parses dates, currency directions and latest available observation", () => {
    const map = parseFrbRelease(frbHtml(), fxNow);
    expect(map.get("JPY")).toMatchObject({ currency_per_usd: "150", observed_on: "2026-10-09", published_on: "2026-10-13", source_url: FRB_URL, quote_direction: "currency_per_usd" });
    expect(map.get("EUR")?.currency_per_usd).toBe("0.8");
    expect(map.get("AUD")?.currency_per_usd).toBe("2");
    expect(map.get("GBP")?.currency_per_usd).toBe("0.666666666667");
    const nd = frbHtml().replace(/<td>150.0000<\/td><\/tr>/, "<td>ND</td></tr>");
    expect(parseFrbRelease(nd, fxNow).get("JPY")?.observed_on).toBe("2026-10-08");
  });
  it.each(["0", "-150", "NaN", "Infinity", "1,000", "1e2"])("rejects invalid value %s", value => {
    expect(() => parseFrbRelease(frbHtml(value), fxNow)).toThrow("FRB_RESPONSE_INVALID");
  });
  it("rejects future dates, unexpected layouts, wrong units and inverted markers", () => {
    for (const html of [frbHtml().replace("October 13, 2026", "October 15, 2026"), frbHtml().replace("Oct. 9", "Oct. 15"), frbHtml().replace("YEN", "DOLLAR"), frbHtml().replace("*EMU MEMBERS", "EMU MEMBERS"), frbHtml().replace('class="statistics"', 'class="changed"')])
      expect(() => parseFrbRelease(html, fxNow)).toThrow("FRB_RESPONSE_INVALID");
  });
  it("handles December observations in a January release", () => {
    const html = frbHtml().replace("October 13, 2026", "January 5, 2027").replaceAll("Oct. 5", "Dec. 28").replaceAll("Oct. 6", "Dec. 29").replaceAll("Oct. 7", "Dec. 30").replaceAll("Oct. 8", "Dec. 31").replaceAll("Oct. 9", "Jan. 1");
    expect(parseFrbRelease(html, new Date("2027-01-06")).get("JPY")?.observed_on).toBe("2027-01-01");
  });
  it("coalesces concurrent calls but refetches every subsequent display", async () => {
    const request = vi.fn(async () => htmlResponse(frbHtml()));
    const provider = new FrbProvider(request, () => fxNow);
    await Promise.all([provider.get("JPY"), provider.get("EUR")]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe(FRB_URL);
    await provider.get("JPY");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("flags fallback only after failure and expires observations after 14 days", async () => {
    let now = fxNow;
    const request = vi.fn(async () => htmlResponse(frbHtml()));
    const provider = new FrbProvider(request, () => now);
    const first = await provider.get("JPY");
    request.mockRejectedValue(new Error("offline"));
    now = new Date("2026-10-23T12:00:00Z");
    const fallback = await provider.get("JPY");
    expect(fallback.status).toBe("AVAILABLE");
    expect(fallback.limitation_codes).toEqual(["FX_CACHE_AFTER_FAILURE"]);
    expect(fallback.snapshot?.checked_at).toBe(first.snapshot?.checked_at);
    now = new Date("2026-10-24T00:00:00Z");
    expect((await provider.get("JPY")).status).toBe("FX_STALE");
    expect((await new FrbProvider(request).get("JPY")).status).toBe("FX_UNAVAILABLE");
  });
  it("rejects oversized or non-HTML responses instead of returning an amount", async () => {
    for (const response of [new Response("x".repeat(5 * 1024 * 1024 + 1), { headers: { "content-type": "text/html" } }), new Response("{}", { headers: { "content-type": "application/json" } }), new Response("", { status: 503 })]) {
      const provider = new FrbProvider(async () => response, () => fxNow);
      expect((await provider.get("JPY")).status).toBe("FX_UNAVAILABLE");
    }
  });
});
