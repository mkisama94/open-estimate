import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  formatPersonDays,
  formatJpy,
  buildShareText,
  validatePublicEstimate,
  type PublicEstimatePayload
} from "../../src/core/public-estimate.js";

const samplePayloadPath = path.resolve(__dirname, "../../examples/sample-public-estimate.json");
const samplePayload: PublicEstimatePayload = JSON.parse(fs.readFileSync(samplePayloadPath, "utf8"));

describe("PublicEstimate Specification (OES-SHARE-0.1.0)", () => {
  it("validates sample-public-estimate.json against public-estimate.schema.json", () => {
    expect(validatePublicEstimate(samplePayload)).toBe(true);
  });

  describe("Person-days calculation and formatting", () => {
    it("formats integer days without trailing .0 (e.g. 360 hours / 8 = 45)", () => {
      expect(formatPersonDays(360)).toBe("45");
      expect(formatPersonDays(240)).toBe("30");
      expect(formatPersonDays(600)).toBe("75");
    });

    it("rounds half up to 1 decimal place", () => {
      expect(formatPersonDays(362)).toBe("45.3"); // 362 / 8 = 45.25 -> 45.3
      expect(formatPersonDays(361)).toBe("45.1"); // 361 / 8 = 45.125 -> 45.1
    });

    it("displays '0.1人日未満' for positive days less than 0.05", () => {
      expect(formatPersonDays(0.3)).toBe("0.1人日未満"); // 0.3 / 8 = 0.0375
      expect(formatPersonDays(0)).toBe("0");
    });
  });

  describe("JPY formatting", () => {
    it("formats 2,700,000 as 約270万円", () => {
      const res = formatJpy(2700000);
      expect(res.label).toBe("約270万円");
      expect(res.prefix).toBe("約");
      expect(res.value).toBe("270");
      expect(res.unit).toBe("万円");
    });

    it("formats amounts under 10,000 JPY with comma", () => {
      const res = formatJpy(9800);
      expect(res.label).toBe("9,800円");
      expect(res.unit).toBe("円");
    });

    it("formats amounts over 1億円 with 約 and 億円", () => {
      const res = formatJpy(150000000);
      expect(res.label).toBe("約1.5億円");
      expect(res.unit).toBe("億円");
    });

    it("handles boundary rollover (e.g. 99,999,999 -> 約1億円)", () => {
      const res = formatJpy(99999999);
      expect(res.label).toBe("約1億円");
      expect(res.value).toBe("1");
      expect(res.unit).toBe("億円");
    });
  });

  describe("Share text generation", () => {
    it("generates correct canonical share text for sample payload", () => {
      const canonicalUrl = "https://open-estimate.ai-orchestration.jp/e/sh_a1b2c3d4e5f60718293a4b5c6d7e8f90";
      const text = buildShareText(samplePayload, canonicalUrl);
      expect(text).toContain("「つくログ」の工数換算レポート。");
      expect(text).toContain("45人日相当（1人日＝8人時、参照実績による換算）。");
      expect(text).toContain("参考労務換算額 約270万円。市場価値ではありません。");
      expect(text).toContain(canonicalUrl);
      expect(text).toContain("#OpenEstimate");
    });

    it("includes 【部分測定】 if status is PARTIAL", () => {
      const partialPayload: PublicEstimatePayload = JSON.parse(JSON.stringify(samplePayload));
      partialPayload.measurement.status = "PARTIAL";
      const text = buildShareText(partialPayload, "https://example.com/e/sh_123");
      expect(text).toContain("【部分測定】45人日相当");
    });
  });
});
