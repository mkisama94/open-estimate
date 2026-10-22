// This verifier only fetches the serving site's catalog, JSON and status.
// It never follows an issuer URL supplied by a certificate.
export function canonicalJson(v) {
  if(v===null || typeof v!=="object") {
    if(typeof v==="number" && !Number.isFinite(v))throw Error("INVALID_JSON");
    return JSON.stringify(v);
  }
  if(Array.isArray(v))return "["+v.map(canonicalJson).join(",")+"]";
  return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonicalJson(v[k])).join(",")+"}";
}
const decode=s=>{if(!/^[A-Za-z0-9_-]+$/.test(s))throw Error("INVALID_SIGNATURE");return Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));};
export async function checkSignature(envelope,catalog,expected) {
  const s=envelope.signed_object;
  if(s.schema_version!=="oes/signed-calculation-certificate/v1" || s.domain!=="oes/server-recomputed-certificate/v1" || s.algorithm!=="Ed25519"
    || s.certificate_id!==expected.certificate || envelope.signed_object_hash!==expected.hash || catalog.schema_version!=="oes/signing-keys/v1"
    || s.issuer.origin!==catalog.issuer_origin)throw Error("RESULT_MISMATCH");
  const key=catalog.keys.find(k=>k.key_id===s.key_id && k.algorithm==="Ed25519" && k.deployment_environment===s.deployment_environment);
  if(!key)throw Error("UNKNOWN_KEY");
  const bytes=new TextEncoder().encode(canonicalJson(s));
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  if(hash!==envelope.signed_object_hash)throw Error("RESULT_MISMATCH");
  const publicKey=await crypto.subtle.importKey("raw",decode(key.public_key),{name:"Ed25519"},false,["verify"]);
  if(!await crypto.subtle.verify("Ed25519",publicKey,decode(envelope.signature),bytes))throw Error("INVALID_SIGNATURE");
  return s;
}
async function getJson(path){const r=await fetch(path,{cache:"no-store",credentials:"omit",redirect:"error",signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(r.status===410?"WITHDRAWN":"STATUS_UNAVAILABLE");return r.json();}
if(typeof document!=="undefined"){
  document.getElementById("print-result")?.addEventListener("click",()=>window.print());
  const article=document.querySelector("[data-public-result]"),button=document.getElementById("verify-signature"),output=document.getElementById("signature-result");
  button?.addEventListener("click",async()=>{
    button.disabled=true;output.textContent="署名と現在の状態を確認しています…";
    try{
      const [envelope,catalog]=await Promise.all([getJson(`/api/v1/shared-estimates/${article.dataset.share}/certificate.json`),getJson("/.well-known/oes-signing-keys.json")]);
      const s=await checkSignature(envelope,catalog,{certificate:article.dataset.certificate,hash:article.dataset.hash});
      const status=await getJson(`/api/v1/certificates/${s.certificate_id}/status`);
      const active=status.certificate_id===s.certificate_id && status.signed_object_hash===envelope.signed_object_hash && status.key_id===s.key_id
        && status.registration==="REGISTERED" && status.certificate_state==="ACTIVE" && status.publication_state==="PUBLIC"
        && ["ACTIVE","RETIRED"].includes(status.key_state) && status.status_generation===s.status_generation;
      output.textContent=active?"署名一致：取得したJSONと公式公開鍵が一致しました。現在の発行記録あり・公開中です。ソースやAIの解釈を独立に検証したものではありません。":"署名一致：取得したJSONは一致しました。現在の公開・有効状態は確認できません。公式検証URLで確認してください。";
    }catch(e){output.textContent=e.message==="UNKNOWN_KEY"?"署名確認：公式カタログに対応する鍵がありません（UNKNOWN_KEY）。":e.message==="WITHDRAWN"?"公開停止または失効により、現在の結果は取得できません。":"署名と現在状態を確認できません。改変、通信障害、またはブラウザーの暗号機能が非対応の可能性があります。署名JSONと公式検証URLで確認してください。";}
    finally{button.disabled=false;}
  });
}
