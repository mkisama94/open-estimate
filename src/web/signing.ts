import { signedObjectBytes } from "../core/certificate.js";
import { jcsSha256 } from "../core/canonical.js";
import type { CertificateEnvelope, SignedObject } from "../core/certificate-contract.js";

export function base64url(bytes: Uint8Array): string {
  let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
export function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("INVALID_INPUT");
  const binary=atob(value.replace(/-/g,"+").replace(/_/g,"/"));
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if (base64url(bytes)!==value) throw new Error("INVALID_INPUT");
  return bytes;
}
/** Standard Web Crypto Ed25519. Private key stays in this adapter's closure. */
export async function createCertificateSigner(pkcs8: string) {
  try {
    const key=await crypto.subtle.importKey("pkcs8",decodeBase64url(pkcs8),{name:"Ed25519"},false,["sign"]);
    return async (object: SignedObject): Promise<CertificateEnvelope> => {
      const bytes=signedObjectBytes(object);
      const signature=await crypto.subtle.sign("Ed25519",key,bytes);
      return {signed_object:structuredClone(object),signed_object_hash:jcsSha256(object),signature:base64url(new Uint8Array(signature))};
    };
  } catch { throw new Error("SIGNING_UNAVAILABLE"); }
}
