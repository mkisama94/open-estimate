export class JsonParseError extends Error {
  public code: string;
  constructor(message: string, code: string = "INVALID_JSON") {
    super(message);
    this.name = "JsonParseError";
    this.code = code;
  }
}

/**
 * Checks for duplicate keys in raw JSON text without altering string semantics.
 * Throws JsonParseError with code "INVALID_JSON" if duplicate keys are detected or JSON is malformed.
 */
export function validateNoDuplicateKeys(rawJson: string): void {
  let pos = 0;
  const len = rawJson.length;

  function skipWhitespace(): void {
    while (pos < len) {
      const ch = rawJson.charCodeAt(pos);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
        pos++;
      } else {
        break;
      }
    }
  }

  function parseString(): string {
    if (rawJson[pos] !== '"') {
      throw new JsonParseError(`Expected '"' at position ${pos}`);
    }
    pos++; // skip initial quote
    let str = "";
    while (pos < len) {
      const ch = rawJson[pos];
      if (ch === '"') {
        pos++;
        return str;
      }
      if (ch === "\\") {
        pos++;
        if (pos >= len) {
          throw new JsonParseError("Unterminated escape sequence in string");
        }
        const esc = rawJson[pos];
        if (esc === '"' || esc === "\\" || esc === "/" || esc === "b" || esc === "f" || esc === "n" || esc === "r" || esc === "t") {
          str += "\\" + esc;
          pos++;
        } else if (esc === "u") {
          pos++;
          if (pos + 4 > len) {
            throw new JsonParseError("Invalid unicode escape in string");
          }
          const hex = rawJson.slice(pos, pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new JsonParseError("Invalid unicode hex in string");
          }
          str += "\\u" + hex;
          pos += 4;
        } else {
          throw new JsonParseError(`Invalid escape character '\\${esc}'`);
        }
      } else {
        if (ch.charCodeAt(0) < 0x20) {
          throw new JsonParseError(`Unescaped control character in string at position ${pos}`);
        }
        str += ch;
        pos++;
      }
    }
    throw new JsonParseError("Unterminated string");
  }

  function parseValue(): void {
    skipWhitespace();
    if (pos >= len) {
      throw new JsonParseError("Unexpected end of JSON");
    }
    const ch = rawJson[pos];
    if (ch === "{") {
      parseObject();
    } else if (ch === "[") {
      parseArray();
    } else if (ch === '"') {
      parseString();
    } else if (ch === "t") {
      if (rawJson.startsWith("true", pos)) {
        pos += 4;
      } else {
        throw new JsonParseError(`Unexpected token at position ${pos}`);
      }
    } else if (ch === "f") {
      if (rawJson.startsWith("false", pos)) {
        pos += 5;
      } else {
        throw new JsonParseError(`Unexpected token at position ${pos}`);
      }
    } else if (ch === "n") {
      if (rawJson.startsWith("null", pos)) {
        pos += 4;
      } else {
        throw new JsonParseError(`Unexpected token at position ${pos}`);
      }
    } else if (ch === "-" || (ch >= "0" && ch <= "9")) {
      parseNumber();
    } else {
      throw new JsonParseError(`Unexpected character '${ch}' at position ${pos}`);
    }
  }

  function parseNumber(): void {
    const start = pos;
    if (rawJson[pos] === "-") {
      pos++;
    }
    if (pos >= len) {
      throw new JsonParseError(`Invalid number at position ${start}`);
    }
    if (rawJson[pos] === "0") {
      pos++;
    } else if (rawJson[pos] >= "1" && rawJson[pos] <= "9") {
      while (pos < len && rawJson[pos] >= "0" && rawJson[pos] <= "9") {
        pos++;
      }
    } else {
      throw new JsonParseError(`Invalid number at position ${start}`);
    }

    if (pos < len && rawJson[pos] === ".") {
      pos++;
      if (pos >= len || rawJson[pos] < "0" || rawJson[pos] > "9") {
        throw new JsonParseError(`Invalid fractional part in number at position ${start}`);
      }
      while (pos < len && rawJson[pos] >= "0" && rawJson[pos] <= "9") {
        pos++;
      }
    }

    if (pos < len && (rawJson[pos] === "e" || rawJson[pos] === "E")) {
      pos++;
      if (pos < len && (rawJson[pos] === "+" || rawJson[pos] === "-")) {
        pos++;
      }
      if (pos >= len || rawJson[pos] < "0" || rawJson[pos] > "9") {
        throw new JsonParseError(`Invalid exponent in number at position ${start}`);
      }
      while (pos < len && rawJson[pos] >= "0" && rawJson[pos] <= "9") {
        pos++;
      }
    }
  }

  function parseArray(): void {
    pos++; // skip '['
    skipWhitespace();
    if (pos < len && rawJson[pos] === "]") {
      pos++;
      return;
    }
    while (pos < len) {
      parseValue();
      skipWhitespace();
      if (pos < len && rawJson[pos] === ",") {
        pos++;
        skipWhitespace();
      } else if (pos < len && rawJson[pos] === "]") {
        pos++;
        return;
      } else {
        throw new JsonParseError(`Expected ',' or ']' in array at position ${pos}`);
      }
    }
    throw new JsonParseError("Unterminated array");
  }

  function parseObject(): void {
    pos++; // skip '{'
    skipWhitespace();
    if (pos < len && rawJson[pos] === "}") {
      pos++;
      return;
    }
    const seenKeys = new Set<string>();
    while (pos < len) {
      skipWhitespace();
      if (rawJson[pos] !== '"') {
        throw new JsonParseError(`Expected key string in object at position ${pos}`);
      }
      const key = parseString();
      if (seenKeys.has(key)) {
        throw new JsonParseError(`Duplicate key "${key}" detected in JSON object`, "INVALID_JSON");
      }
      seenKeys.add(key);

      skipWhitespace();
      if (pos >= len || rawJson[pos] !== ":") {
        throw new JsonParseError(`Expected ':' after key in object at position ${pos}`);
      }
      pos++; // skip ':'

      parseValue();
      skipWhitespace();
      if (pos < len && rawJson[pos] === ",") {
        pos++;
        skipWhitespace();
      } else if (pos < len && rawJson[pos] === "}") {
        pos++;
        return;
      } else {
        throw new JsonParseError(`Expected ',' or '}' in object at position ${pos}`);
      }
    }
    throw new JsonParseError("Unterminated object");
  }

  parseValue();
  skipWhitespace();
  if (pos !== len) {
    throw new JsonParseError(`Trailing characters after JSON at position ${pos}`);
  }
}

/**
 * Parses raw JSON text strictly, rejecting duplicate object keys.
 */
export function parseStrictJson<T = any>(rawJson: string): T {
  validateNoDuplicateKeys(rawJson);
  return JSON.parse(rawJson);
}
