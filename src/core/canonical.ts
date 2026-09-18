import crypto from "node:crypto";
import canonicalizePkg from "canonicalize";

const canonicalize: (input: unknown) => string | undefined =
  typeof canonicalizePkg === "function" ? canonicalizePkg : (canonicalizePkg as any).default;

export function jcsCanonicalize(obj: any): string {
  const result = canonicalize(obj);
  if (result === undefined) {
    throw new Error("Cannot canonicalize undefined value");
  }
  return result;
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex").toLowerCase();
}

export function jcsSha256(obj: any): string {
  const canon = jcsCanonicalize(obj);
  return sha256Hex(Buffer.from(canon, "utf8"));
}
