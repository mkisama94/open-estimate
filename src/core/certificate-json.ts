import { parseStrictJson } from "./json-parser.js";

export const CERTIFICATE_BODY_LIMIT = 1024 * 1024;
const malformedUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Reject values that JSON.stringify would silently change, before signing. */
export function assertCertificateJson(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error("INVALID_INPUT");
  if (typeof value === "string") {
    if (malformedUnicode.test(value)) throw new Error("INVALID_INPUT");
  } else if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error("INVALID_INPUT");
  } else if (value !== null && typeof value === "object") {
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error("INVALID_INPUT");
    for (const [key, item] of Object.entries(value)) {
      if (malformedUnicode.test(key)) throw new Error("INVALID_INPUT");
      assertCertificateJson(item, depth + 1);
    }
  } else if (value !== null && typeof value !== "boolean") throw new Error("INVALID_INPUT");
}

/** Raw UTF-8 only. Duplicate keys (including escaped aliases) are checked before parse. */
export function readCertificateJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > CERTIFICATE_BODY_LIMIT) throw new Error("INPUT_TOO_LARGE");
  try {
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const value: unknown = parseStrictJson(raw);
    assertCertificateJson(value);
    return value;
  } catch { throw new Error("INVALID_INPUT"); }
}
