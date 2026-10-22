import { it,expect } from "vitest";
import worker from "../../src/web/worker.js";
import { publicResultFixture } from "../fixtures/public-result.js";
import { PRODUCTION_ORIGIN } from "../../src/core/certificate.js";
import { CertificateRepository } from "../../src/web/certificate-repository.js";
// @ts-expect-error Browser module is deliberately also executable as native JS in Node.
import { checkSignature,canonicalJson } from "../../public/public-result.js";
import { jcsCanonicalize } from "../../src/core/canonical-json.js";

it.each(["normal","partial","incomplete"] as const)("default Worker renders %s published result from stored signed data",async variant=>{
  const f=await publicResultFixture(variant);try{
    const response=await worker.fetch(new Request(PRODUCTION_ORIGIN+"/e/"+f.share),f.env),html=await response.text();
    expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("no-store");expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    for(const text of ["固定された見積内容","参考工数（人時）","参考工数（人日）","基準USD額","品質と未確定事項","実績に基づく工数・価格の証明ではありません"])expect(html).toContain(text);
    expect(html).not.toContain("PRIVATE_OWNER_CANARY");expect(html).not.toContain(f.body.nonce);expect(html).not.toContain("frozen_input");
    if(variant==="partial"){expect(html).toContain("部分測定");expect(html).toContain("独立再実行の境界が未確認");expect(html).toContain("合計の内数");}
    if(variant==="incomplete"){expect(html).toContain("測定未完了");expect(html).toContain("算出不可／未算出");}
    const json=await worker.fetch(new Request(PRODUCTION_ORIGIN+"/api/v1/shared-estimates/"+f.share+"/certificate.json"),f.env);expect(await json.json()).toEqual(f.envelope);
    const verify=await worker.fetch(new Request(PRODUCTION_ORIGIN+"/verify/"+f.envelope.signed_object.certificate_id),f.env);expect(await verify.text()).toContain("発行記録あり");
  }finally{f.db.sqlite.close();}
});
it("withdrawal blocks HTML, JSON, quote, print variants and conditional re-fetch without asset fallback",async()=>{
  const f=await publicResultFixture();try{
    await new CertificateRepository(f.db).withdraw(f.share,"PRIVATE_OWNER_CANARY",Date.now());
    for(const path of ["/e/"+f.share,"/e/"+f.share+"?print=1","/api/v1/shared-estimates/"+f.share,"/api/v1/shared-estimates/"+f.share+"/certificate.json","/api/v1/shared-estimates/"+f.share+"/display-quote"]){
      const r=await worker.fetch(new Request(PRODUCTION_ORIGIN+path,{headers:{"If-None-Match":"cached"}}),f.env),text=await r.text();
      expect(r.status).toBe(410);expect(r.headers.get("Cache-Control")).toBe("no-store");expect(text).not.toContain("合成アプリ");expect(text).not.toContain("STATIC_FALLBACK_CANARY");
      if(path.startsWith("/e/"))expect(text).toContain("この結果は公開を停止しています");
    }
  }finally{f.db.sqlite.close();}
});
it("unconfigured reads, bad keys, DB outage, old generations and revoked keys fail closed",async()=>{
  const f=await publicResultFixture();try{
    const url=PRODUCTION_ORIGIN+"/e/"+f.share;
    for(const overrides of [{PUBLICATION_READ_ENABLED:"false"},{PUBLIC_STATUS_GENERATION:"bad"},{PUBLIC_SIGNING_KEYS_JSON:"[]"},{PUBLIC_SIGNING_KEYS_JSON:JSON.stringify([{...f.trusted,deployment_environment:"test"}])},{CERTIFICATES_DB:undefined},{PUBLIC_STATUS_GENERATION:"sg_"+"0".repeat(32)}]){
      const r=await worker.fetch(new Request(url),{...f.env,...overrides});expect(r.status).toBe(503);expect(await r.text()).not.toContain("合成アプリ");
    }
    f.db.sqlite.prepare("UPDATE signing_keys SET state='REVOKED'").run();expect((await worker.fetch(new Request(url),f.env)).status).toBe(410);
    f.db.sqlite.prepare("UPDATE signing_keys SET state='ACTIVE'").run();
    f.db.sqlite.prepare("UPDATE publication_contents SET envelope_json='{}'").run();expect((await worker.fetch(new Request(url),f.env)).status).toBe(503);
    expect((await worker.fetch(new Request(PRODUCTION_ORIGIN+"/e/sh_"+"0".repeat(32)),f.env)).status).toBe(404);
    expect((await worker.fetch(new Request(PRODUCTION_ORIGIN+"/api/v1/publications",{method:"POST"}),f.env)).status).toBe(403);
    f.db.sqlite.close();expect((await worker.fetch(new Request(url),f.env)).status).toBe(503);
  }finally{try{f.db.sqlite.close();}catch{}}
});
it("browser JCS and Web Crypto match the server; tampering and unknown keys cannot pass",async()=>{
  const f=await publicResultFixture();try{
    const catalog={schema_version:"oes/signing-keys/v1",issuer_origin:PRODUCTION_ORIGIN,keys:[f.trusted]},expected={certificate:f.envelope.signed_object.certificate_id,hash:f.envelope.signed_object_hash};
    expect(canonicalJson({"€":"a\n",a:[null,0,"日本語",1e-7],"😀":true})).toBe(jcsCanonicalize({a:[null,0,"日本語",1e-7],"😀":true,"€":"a\n"}));
    await expect(checkSignature(f.envelope,catalog,expected)).resolves.toEqual(f.envelope.signed_object);
    const changed=structuredClone(f.envelope);changed.signed_object.metadata.title="改変";
    await expect(checkSignature(changed,catalog,expected)).rejects.toThrow("RESULT_MISMATCH");
    await expect(checkSignature(f.envelope,{...catalog,keys:[]},expected)).rejects.toThrow("UNKNOWN_KEY");
    await expect(checkSignature(f.envelope,{...catalog,issuer_origin:"https://attacker.invalid"},expected)).rejects.toThrow("RESULT_MISMATCH");
    const sig=structuredClone(f.envelope);sig.signature="A".repeat(86);await expect(checkSignature(sig,catalog,expected)).rejects.toThrow("INVALID_SIGNATURE");
  }finally{f.db.sqlite.close();}
});
