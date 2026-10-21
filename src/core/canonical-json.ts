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

export function jcsBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(jcsCanonicalize(value));
}
