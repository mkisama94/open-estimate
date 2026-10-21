import crypto from "node:crypto";
import { jcsCanonicalize } from "./canonical-json.js";
export { jcsCanonicalize } from "./canonical-json.js";

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex").toLowerCase();
}

export function jcsSha256(obj: any): string {
  const canon = jcsCanonicalize(obj);
  return sha256Hex(Buffer.from(canon, "utf8"));
}
