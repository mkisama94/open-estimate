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
    expect(fallback.limitation_codes).toEqual(["FX_CACHE_AFTER_FAILURE", "FRB_FETCH_FAILED"]);
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

  it("calls default and injected fetch without binding the provider as this", async () => {
    const request = vi.fn(async function(this: unknown, _input: RequestInfo | URL, init?: RequestInit) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      if (init?.redirect !== "manual") throw new TypeError("Invalid redirect mode");
      return htmlResponse(frbHtml());
    });
    vi.stubGlobal("fetch", request);
    try {
      expect((await new FrbProvider(undefined, () => fxNow).get("JPY")).status).toBe("AVAILABLE");
      expect((await new FrbProvider(request, () => fxNow).get("JPY")).status).toBe("AVAILABLE");
    } finally { vi.unstubAllGlobals(); }
  });

  it("rejects redirects without requesting the redirect destination", async () => {
    const request = vi.fn(async () => new Response("redirect body", { status: 302, headers: { location: "https://other.example/" } }));
    const result = await new FrbProvider(request, () => fxNow).get("JPY");
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "FX_UNAVAILABLE", snapshot: null, limitation_codes: ["FX_UNAVAILABLE", "FRB_REDIRECT_REJECTED"] });
  });

  it.each([
    [() => new Response("private HTTP body", { status: 503 }), "FRB_HTTP_ERROR"],
    [() => new Response("{}", { headers: { "content-type": "application/json" } }), "FRB_CONTENT_TYPE_INVALID"],
    [() => new Response(null, { headers: { "content-type": "text/html" } }), "FRB_BODY_MISSING"],
    [() => htmlResponse("x".repeat(5 * 1024 * 1024 + 1)), "FRB_RESPONSE_TOO_LARGE"],
    [() => new Response(new Uint8Array([255]), { headers: { "content-type": "text/html" } }), "FRB_UTF8_INVALID"],
    [() => htmlResponse("unexpected private HTML"), "FRB_RESPONSE_INVALID"]
  ] as const)("reports a safe failure code %s", async (response, code) => {
    const result = await new FrbProvider(async () => response(), () => fxNow).get("JPY");
    expect(result.status).toBe("FX_UNAVAILABLE");
    expect(result.limitation_codes).toEqual(["FX_UNAVAILABLE", code]);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each(["TimeoutError", "AbortError"])("reports %s without exposing exception messages", async name => {
    const result = await new FrbProvider(async () => { throw new DOMException("private diagnostic", name); }).get("JPY");
    expect(result.limitation_codes).toEqual(["FX_UNAVAILABLE", "FRB_TIMEOUT"]);
  });
});
