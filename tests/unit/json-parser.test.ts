import { describe, it, expect } from "vitest";
import { parseStrictJson, validateNoDuplicateKeys, JsonParseError } from "../../src/core/json-parser.js";

describe("Strict JSON Parser (T01 / A05)", () => {
  it("parses valid JSON without duplicate keys", () => {
    const json = '{"a": 1, "b": "hello", "c": [1, 2, 3], "d": {"nested": true}}';
    const parsed = parseStrictJson(json);
    expect(parsed).toEqual({ a: 1, b: "hello", c: [1, 2, 3], d: { nested: true } });
  });

  it("rejects JSON with duplicate keys at top level", () => {
    const json = '{"a": 1, "b": 2, "a": 3}';
    expect(() => validateNoDuplicateKeys(json)).toThrow(JsonParseError);
    expect(() => parseStrictJson(json)).toThrowError(/Duplicate key "a"/);
  });

  it("rejects JSON with duplicate keys in nested objects", () => {
    const json = '{"parent": {"child": 1, "other": 2, "child": 3}}';
    expect(() => parseStrictJson(json)).toThrowError(/Duplicate key "child"/);
  });

  it("handles strings with escaped characters safely", () => {
    const json = '{"msg\\\"": "val1", "normal": "val2"}';
    const parsed = parseStrictJson(json);
    expect(parsed['msg"']).toBe("val1");
  });
});
