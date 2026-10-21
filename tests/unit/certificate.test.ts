import { it, expect } from "vitest";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { withQuality } from "../fixtures/quality.js";
import { measurementRegistry, skillRegistry, generatedRules } from "../fixtures/measurement.js";
import { legacyIntegrity } from "../fixtures/skill-policy.js";
import { projectModel, validateAndRecomputeNumericModel } from "../../src/core/numeric-model.js";
import { projectPublicResult } from "../../src/core/public-result.js";
import { createEvaluation } from "../../src/core/evaluation.js";
import { getLocalProfile } from "../../src/profiles/local-profile.js";
import { createApprovedDraft, createSignedObject, draftHash, inputCommitment, recomputeCertificateResult, signedObjectBytes } from "../../src/core/certificate.js";
import { verifyCertificate, verifyCertificateInput } from "../../src/core/certificate-verify.js";
import { createCertificateSigner, base64url } from "../../src/web/signing.js";
import { readCertificateJson } from "../../src/core/certificate-json.js";
import { jcsCanonicalize, jcsSha256 } from "../../src/core/canonical.js";
import { jcsBytes } from "../../src/core/canonical-json.js";
import type { FrozenInput, CertificateMetadata } from "../../src/core/certificate-contract.js";
import { publicDisplayQuote } from "../../src/core/public-display-quote.js";
import { parseFrbRelease } from "../../src/profiles/frb.js";
import { frbHtml,fxNow } from "../fixtures/frb.js";
import { certificateHtml } from "../../src/web/public-views.js";

const now=Date.parse("2026-10-20T00:00:00.000Z"),nonce=base64url(new Uint8Array(32).fill(7));
const catalog={skills:skillRegistry(legacyIntegrity),rules:measurementRegistry(),now};
const metadata:CertificateMetadata={title:"合成テスト 🧪",description:null,publisher_label:null,scope_note:null,project_url:null,model_label:null};
const server={origin:"https://test.example.org",environment:"test" as const,certificate_id:"cert_"+"1".repeat(32),share_id:"sh_"+"2".repeat(32),status_generation:"sg_"+"3".repeat(32),engine:{engine_version:"test-build",artifact_sha256:"4".repeat(64)},now};
const keyId="key_test_"+"5".repeat(32);
export function certificateFixture(a=withQuality()) {
  const e=createEvaluation(a,getLocalProfile());
  const saved={measurement:e.report.measurement,calculation:{environment:"TEST",basis:e.basis,effort:e.report.effort,reference_usd:e.report.reference_usd,limitation_codes:e.report.limitation_codes}};
  const input:FrozenInput={schema_version:"oes/certificate-input/v1",model:projectModel(a),candidate:projectPublicResult(a,saved),skill_integrity:legacyIntegrity as FrozenInput["skill_integrity"],ruleset_ref:generatedRules.ruleset_ref};
  return {input,draft:createApprovedDraft(input,nonce,metadata,server,catalog)};
}
// RFC 8032 section 7.1 test 1. Public fixed TEST key only; never a deployment key.
const seed="9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const privateKey=createPrivateKey({key:Buffer.from("302e020100300506032b657004220420"+seed,"hex"),format:"der",type:"pkcs8"});
const publicKey=createPublicKey(privateKey);
const raw=publicKey.export({format:"jwk"}).x!;
const trusted=[{key_id:keyId,algorithm:"Ed25519" as const,public_key:raw,issuer_origin:server.origin,deployment_environment:"test" as const}];
async function signedFixture() {
  const f=certificateFixture(),object=createSignedObject(f.draft,keyId,now);
  const signer=await createCertificateSigner(privateKey.export({type:"pkcs8",format:"der"}).toString("base64url"));
  return {...f,envelope:await signer(object)};
}
it("C01/C09 deterministic result, draft and JCS bytes preserve unicode and explicit assurance",()=>{
  const {input,draft}=certificateFixture();
  expect(draft.result.measurement).toEqual(input.candidate.measurement);
  expect(draft.result.assurance.quality_check).toBe("CLIENT_REPORTED_CONSISTENCY_CHECKED");
  expect(draftHash(draft)).toBe(draftHash(structuredClone(draft)));
  expect(Buffer.from(jcsBytes({"€":"a\n",a:1})).toString()).toBe(jcsCanonicalize({a:1,"€":"a\n"}));
  expect(input.candidate.assurance.signed).toBe(false);
});
it("C02 keeps v2 unadopted processes without placeholder triggers",()=>{
  const a=withQuality(),p=a.functional_processes[0];p.status="unresolved";p.movements=[];
  a.function_candidates![0].disposition="unresolved";a.judgments![0].status="unresolved";a.judgments![0].unresolved_points=["unknown"];
  a.judgments![0].targets=a.judgments![0].targets.filter(t=>t.kind!=="movement");
  const {input,draft}=certificateFixture(a);
  expect(input.model.version).toBe("oes/remote-model/v2");expect(input.model.unadopted_process_count).toBe(1);
  expect(draft.result.measurement.status).toBe("PARTIAL");expect(draft.result.quality.unresolved_process_count).toBe(1);
});
it("C03 keeps unknown boundaries and provisional counts PARTIAL",()=>{
  const a=withQuality();a.quality!.boundaries[0].rerun="unknown";a.judgments![0].status="provisional";a.judgments![0].unresolved_points=["confirm"];
  const {draft}=certificateFixture(a);expect(draft.result.measurement.status).toBe("PARTIAL");expect(draft.result.quality.partial_reason_codes).toContain("BOUNDARY_RERUN_UNKNOWN");
});
it.each(["sample_size","min_cfp","coefficient","wage"])("C04 rejects changed basis %s under the same IDs",field=>{
  const {input}=certificateFixture(),b=input.candidate.calculation.basis;
  if(field==="sample_size")b.benchmark.sample_size=1;
  if(field==="min_cfp")b.benchmark.min_cfp=2;
  if(field==="coefficient")b.benchmark.hours_per_cfp.median="4";
  if(field==="wage")b.wage.hourly_wage_usd="51";
  expect(()=>recomputeCertificateResult(input,catalog)).toThrow("BASIS_MISMATCH");
});
it("C05/C07 rejects a different numeric model and contradictory client quality",()=>{
  const {input}=certificateFixture();input.model.processes.pop();
  expect(()=>recomputeCertificateResult(input,catalog)).toThrow("RESULT_MISMATCH");
  const other=certificateFixture().input;other.candidate.quality.analysis_complete=false;
  expect(()=>recomputeCertificateResult(other,catalog)).toThrow();
});
it.each(["UNSUPPORTED","INCOMPLETE"])("C06 retains %s with null estimates",status=>{
  const a=withQuality();a.functional_processes=[];a.function_candidates=[];a.judgments=[];a.quality!.boundaries=[];
  if(status==="UNSUPPORTED") {a.findings=[{finding_id:"unsupported",category:"applicability_limit",severity:"blocking",message:"unknown",evidence_refs:[],targets:[],impact:"scope",resolution:"open"}];a.quality!.findings=[{finding_id:"unsupported",subject:"implementation"}];}
  const {draft}=certificateFixture(a);expect(draft.result.measurement.status).toBe(status);expect(draft.result.calculation.reference_usd.amount_usd).toBeNull();
});
it.each(['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":"\\ud800"}','{"x":9007199254740992}','{"x":1e400}','['.repeat(130)+'0'+']'.repeat(130)])("C08 rejects malformed or ambiguous raw input %s",raw=>{
  expect(()=>readCertificateJson(Buffer.from(raw))).toThrow("INVALID_INPUT");
});
it("C08 rejects invalid UTF-8, huge input and aggregate movements",()=>{
  expect(()=>readCertificateJson(Uint8Array.from([0xc3,0x28]))).toThrow("INVALID_INPUT");
  expect(()=>readCertificateJson(new Uint8Array(1024*1024+1))).toThrow("INPUT_TOO_LARGE");
  const {input}=certificateFixture(),p=input.model.processes[0];input.model.processes=Array.from({length:1001},()=>p);
  expect(()=>validateAndRecomputeNumericModel(input.model,getLocalProfile())).toThrow("INVALID_REMOTE_MODEL");
});
it("C09 RFC 8032 independent known Ed25519 vector",async()=>{
  const expected="e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
  const sig=sign(null,Buffer.alloc(0),privateKey);expect(sig.toString("hex")).toBe(expected);
  const key=await crypto.subtle.importKey("raw",Buffer.from(raw,"base64url"),"Ed25519",false,["verify"]);
  expect(await crypto.subtle.verify("Ed25519",key,sig,Buffer.alloc(0))).toBe(true);
});
it("C10 Node crypto and standard Web Crypto verify canonical payload and retained public fixture",async()=>{
  const fs=await import("node:fs");
  const retained=JSON.parse(fs.readFileSync("tests/fixtures/certificates/complete.json","utf8"));
  const retainedKeys=JSON.parse(fs.readFileSync("tests/fixtures/certificates/trusted-test-keys.json","utf8"));
  expect((await verifyCertificate(retained,retainedKeys)).signature).toBe("VALID");
  const {envelope}=await signedFixture();
  expect(verify(null,signedObjectBytes(envelope.signed_object),publicKey,Buffer.from(envelope.signature,"base64url"))).toBe(true);
  expect(await verifyCertificate(envelope,trusted)).toEqual({schema:"VALID",hash:"MATCH",signature:"VALID",issuer_trust:"TRUSTED",current_status:"NOT_CHECKED"});
});
it.each(["metadata","issuer","limitation","environment","key_id","unknown"])("C11 refuses modified %s without stripping fields",async field=>{
  const {envelope}=await signedFixture();
  const s:any=envelope.signed_object;
  if(field==="metadata")s.metadata.title="changed";
  if(field==="issuer")s.issuer.origin="https://evil.example.org";
  if(field==="limitation")s.result.limitation_codes.pop();
  if(field==="environment")s.deployment_environment="production";
  if(field==="key_id")s.key_id="key_test_"+"9".repeat(32);
  if(field==="unknown")s.unknown="do not strip";
  const r=await verifyCertificate(envelope,trusted);expect(r.signature).not.toBe("VALID");
});
it("C12/C13 private input commitment mismatch and no trust in embedded or arbitrary keys",async()=>{
  const {input,envelope}=await signedFixture();
  expect(verifyCertificateInput(envelope,input,nonce,catalog)).toEqual({commitment:"MATCH",calculation:"MATCH"});
  expect(verifyCertificateInput(envelope,input,base64url(new Uint8Array(32)),catalog).commitment).toBe("MISMATCH");
  expect((await verifyCertificate(envelope,[])).signature).toBe("UNKNOWN_KEY");
  expect((await verifyCertificate({...envelope,public_key:raw},trusted)).schema).toBe("INVALID");
  expect(inputCommitment(input,nonce).digest).not.toBe(jcsSha256(input));
});
it("rejects expired drafts, wrong environment and empty/untrusted deployment registries",()=>{
  const {input,draft}=certificateFixture();
  expect(()=>createSignedObject(draft,keyId,now+900000)).toThrow("PREVIEW_EXPIRED");
  expect(()=>createSignedObject(draft,"key_prod_"+"5".repeat(32),now)).toThrow("INVALID_ENVIRONMENT");
  expect(()=>recomputeCertificateResult(input)).toThrow();
});
it("F01/F02 public FX projection changes only the display and excludes private fields",async()=>{
  const {envelope}=await signedFixture(),before=JSON.stringify(envelope);
  const provider=(rate:string)=>({get:async()=>({status:"AVAILABLE" as const,snapshot:parseFrbRelease(frbHtml(rate),fxNow).get("JPY")!,limitation_codes:[]})});
  const one=await publicDisplayQuote(envelope,provider("150"),"ja-JP","JPY",()=>fxNow);
  const two=await publicDisplayQuote(envelope,provider("160"),"ja-JP","JPY",()=>fxNow);
  expect(one.localized_reference.amount).not.toEqual(two.localized_reference.amount);expect(one.signed).toBe(false);
  expect(JSON.stringify(one)).not.toContain("source_report_hash");expect(JSON.stringify(envelope)).toBe(before);
  const unavailable=await publicDisplayQuote(envelope,{get:async()=>({status:"FX_UNAVAILABLE",snapshot:null,limitation_codes:["FX_UNAVAILABLE","FRB_TIMEOUT"]})},"ja-JP","JPY",()=>fxNow);
  expect(unavailable.localized_reference.amount).toBeNull();expect(unavailable.person_days).not.toBeNull();
});
it("P06 public HTML escapes user metadata and keeps TEST and assurance limitations visible",async()=>{
  const {envelope}=await signedFixture();envelope.signed_object.metadata.title='<script>alert("x")</script>';
  const html=certificateHtml(envelope,server.share_id,{certificate_id:server.certificate_id,signed_object_hash:envelope.signed_object_hash,key_id:keyId,registration:"REGISTERED",certificate_state:"ACTIVE",publication_state:"PUBLIC",key_state:"ACTIVE",status_generation:server.status_generation,status_checked_at:new Date(now).toISOString(),reason_code:null});
  expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain("実績に基づく工数・価格の証明ではありません");expect(html).toContain("公式検証URL");
});
it("C08 counts movements across all process arrays before accepting a large model",()=>{
  const movements=Array.from({length:999},(_,group)=>({type:"Entry",group,peer:0,store:null,distinct:false,variant:null}));
  movements.push({type:"Exit",group:0,peer:0,store:null,distinct:false,variant:null});
  const model={version:"oes/remote-model/v1",analysis_complete:true,partial:false,applicability_limit:false,users:1,stores:0,groups:Array.from({length:999},(_,i)=>i),processes:Array.from({length:11},()=>({status:"accepted",trigger_user:0,trigger_group:0,movements}))};
  expect(()=>validateAndRecomputeNumericModel(model,getLocalProfile())).toThrow("MODEL_TOO_LARGE");
});
it("C09 formatting and property order do not change signature verification",async()=>{
  const {envelope}=await signedFixture();
  const reverse=(x:any):any=>Array.isArray(x)?x.map(reverse):x && typeof x==="object"?Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reverse(v)])):x;
  const formatted=readCertificateJson(Buffer.from(JSON.stringify(reverse(envelope),null,4)));
  expect((await verifyCertificate(formatted,trusted)).signature).toBe("VALID");
});
