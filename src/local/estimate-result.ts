import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {readRun,runsRoot} from "./runs.js";
import {privateDirectory} from "../local-files.js";
import {resolveSafePath} from "../collector/safe-paths.js";
import {projectPublicResult} from "../core/public-result.js";
import {validateAndRecomputeNumericModel} from "../core/numeric-model.js";
import {certificateCalculationProfile} from "../profiles/certificate-basis.js";
import {createDisplayQuote} from "../core/display-quote.js";
import {frbProvider,type FxProvider} from "../profiles/frb.js";
import {jcsSha256,sha256Hex} from "../core/canonical.js";
import {validateRulesBundle} from "../rules/measurement-contract.js";
import {validateResultSnapshot,estimatePresentation,PUBLICATION_POLICY,ESTIMATE_DESTINATION,type ResultSnapshot,type PublicationRequest,type PublicationResult} from "../core/estimate-publication.js";
import type {EstimateInput} from "../core/estimate-preview.js";
import {renderEstimatePdf} from "./estimate-pdf.js";
import {localPreviewDocument} from "./estimate-ui.js";
import {checkContract} from "../core/certificate-contract.js";
import {publicationRequestSchema} from "../core/estimate-publication.js";

export const resultPreviewsRoot=()=>path.join(path.dirname(runsRoot()),"estimate-result-previews");
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function directory(id:string){if(!idPattern.test(id))throw new Error("INVALID_PREVIEW_ID");return resolveSafePath(id,resultPreviewsRoot());}
async function write(dir:string,name:string,value:unknown){await fs.writeFile(path.join(dir,name),JSON.stringify(value,null,2)+"\n",{flag:"wx",mode:0o600});}
export async function prepareResultPreview(args:{run_id:string;display_currency?:string},provider:FxProvider=frbProvider){
  const run=await readRun(args.run_id),model=JSON.parse(await fs.readFile(await resolveSafePath("model.json",run.dir),"utf8"));
  if(jcsSha256(model)!==run.metadata.numeric_model_hash)throw new Error("RUN_CHECKSUM_MISMATCH");
  const context=run.metadata.rules_context as any;validateRulesBundle(context.bundle,context.ruleset_ref);
  const result=projectPublicResult(run.assessment,run.summary),profile=certificateCalculationProfile(),report=validateAndRecomputeNumericModel(model,profile);
  const reportHash=jcsSha256({model,profile,report});
  const input:EstimateInput={schema_version:"oes/owner-estimate-input/v1",evaluation:{model,display_currency:args.display_currency??"JPY",
    skill_integrity:{format:"oes/skill-integrity/v1",skill_id:"open-estimate-assessor",skill_version:run.metadata.skill.version,hash_rule:"oes/skill-package/v1",package_sha256:run.metadata.skill.declared_package_sha256},ruleset_ref:context.ruleset_ref},quality:result.quality,expected_report_hash:reportHash};
  const display_quote=await createDisplayQuote({report,basis:profile,report_hash:reportHash},provider,"ja-JP",input.evaluation.display_currency);
  const snapshot=await validateResultSnapshot({schema_version:"oes/estimate-snapshot/v1",input,result,display_quote,
    scope_coverage:run.assessment.input.acquisition?.scope_coverage??"UNKNOWN",measured_at:run.assessment.assessor.finished_at,scope:"AGREED_AS_BUILT_FUNCTIONAL_SCOPE"});
  await privateDirectory(resultPreviewsRoot());const preview_id=randomUUID(),dir=path.join(resultPreviewsRoot(),preview_id);await fs.mkdir(dir,{mode:0o700});
  const document={preview_id,run_id:args.run_id,snapshot,snapshot_hash:jcsSha256(snapshot)};
  await write(dir,"preview.json",document);await write(dir,"COMPLETE.json",{sha256:sha256Hex(await fs.readFile(path.join(dir,"preview.json")))});
  return regenerateResultPdf(preview_id);
}
export async function readResultPreview(id:string){
  const dir=await directory(id),load=async(name:string)=>{const file=await resolveSafePath(name,dir);if((await fs.stat(file)).size>2*1024*1024)throw new Error("INVALID_PREVIEW");return fs.readFile(file);};
  const raw=await load("preview.json"),marker=JSON.parse((await load("COMPLETE.json")).toString());
  if(sha256Hex(raw)!==marker.sha256)throw new Error("INVALID_PREVIEW");
  const d=JSON.parse(raw.toString()) as {preview_id:string;run_id:string;snapshot:ResultSnapshot;snapshot_hash:string};
  if(d.preview_id!==id||jcsSha256(d.snapshot)!==d.snapshot_hash)throw new Error("INVALID_PREVIEW");await validateResultSnapshot(d.snapshot);
  return {...d,dir};
}
export async function showResultPreview(id:string){
  const p=await readResultPreview(id),run=await readRun(p.run_id);let pdf:{path:string;sha256:string}|null=null;
  try{const marker=JSON.parse(await fs.readFile(await resolveSafePath("pdf-ready.json",p.dir),"utf8"));const full=await resolveSafePath(marker.file,p.dir);if(sha256Hex(await fs.readFile(full))!==marker.sha256)throw new Error("PDF_CORRUPTED");pdf={path:full,sha256:marker.sha256};}catch(e:any){if(e.code!=="ENOENT")throw e;}
  return {preview_id:id,status:pdf?"READY_FOR_REVIEW":"PDF_INCOMPLETE",snapshot:p.snapshot,snapshot_hash:p.snapshot_hash,presentation:estimatePresentation(p.snapshot),pdf,
    local_details:{scope:run.assessment.scope,scope_record:run.assessment.scope_record??null,limitations:run.assessment.quality?.limitations??[],findings:run.assessment.findings,judgments:run.assessment.judgments??[]},
    transmitted:false,publication:{destination:ESTIMATE_DESTINATION,audience:"OWNER_ONLY",retention_days:30,items:["数値モデル","数値結果","品質集計","取得充足状態","測定日","計算条件・固定した為替条件","配布スキル・測定ルールの参照版"],excluded:["ソースコード","対象パス","根拠本文","判断台帳"],primary_action:"この結果をWebに掲載する",secondary_action:"送信せず終了"}};
}
export async function regenerateResultPdf(id:string){
  const p=await readResultPreview(id),file=`estimate-${randomUUID()}.pdf`;
  try{const bytes=await renderEstimatePdf(p.snapshot);await fs.writeFile(path.join(p.dir,file),bytes,{flag:"wx",mode:0o600});
    const run=await readRun(p.run_id);
    await fs.writeFile(path.join(p.dir,file.replace(/\.pdf$/,".html")),localPreviewDocument(p.snapshot,{preview_id:id,pdf_uri:"data:application/pdf;base64,"+bytes.toString("base64"),local_details:{scope:run.assessment.scope,scope_record:run.assessment.scope_record,limitations:run.assessment.quality?.limitations,judgments:run.assessment.judgments}}),{flag:"wx",mode:0o600});
    const marker={file,sha256:sha256Hex(bytes)};const tmp=path.join(p.dir,`pdf-ready-${randomUUID()}.tmp`);await fs.writeFile(tmp,JSON.stringify(marker),{flag:"wx",mode:0o600});await fs.rename(tmp,path.join(p.dir,"pdf-ready.json"));
  }catch{return {...await showResultPreview(id),status:"PDF_INCOMPLETE",error_code:"PDF_GENERATION_FAILED",next_action:"regenerate-pdf"};}
  return showResultPreview(id);
}
export async function consentResultPublication(args:{preview_id:string;user_confirmed:boolean;snapshot_hash:string}){
  const p=await readResultPreview(args.preview_id),view=await showResultPreview(args.preview_id);
  if(args.user_confirmed!==true)throw new Error("EXPLICIT_CONSENT_REQUIRED");if(args.snapshot_hash!==p.snapshot_hash)throw new Error("CONSENT_CONTENT_CHANGED");if(!view.pdf)throw new Error("PDF_REQUIRED");
  const file=path.join(p.dir,"consent.json");
  const request:PublicationRequest={operation_id:p.preview_id,snapshot:p.snapshot,consent:{confirmed:true,snapshot_hash:p.snapshot_hash,policy:PUBLICATION_POLICY,destination:ESTIMATE_DESTINATION,audience:"OWNER_ONLY",retention_days:30,confirmed_at:new Date().toISOString()}};
  try{await fs.writeFile(file,JSON.stringify(request),{flag:"wx",mode:0o600});}catch(e:any){if(e.code!=="EEXIST")throw e;}
  return publicationInput(args.preview_id);
}
export async function publicationInput(id:string){
  const p=await readResultPreview(id),request=JSON.parse(await fs.readFile(await resolveSafePath("consent.json",p.dir),"utf8")) as PublicationRequest;
  checkContract(publicationRequestSchema,request);
  if(request.operation_id!==id||request.consent.snapshot_hash!==p.snapshot_hash||jcsSha256(request.snapshot)!==p.snapshot_hash||request.consent.confirmed!==true)throw new Error("CONSENT_CONTENT_CHANGED");
  return {status:"CONSENT_RECORDED",transmitted:false,request,next_action:"publish_estimate"};
}
export async function recordResultPublication(id:string,result:PublicationResult){
  const {request}=await publicationInput(id),p=await readResultPreview(id);
  if(result.status!=="PUBLISHED"||result.operation_id!==id||result.snapshot_hash!==p.snapshot_hash||!/^https:\/\/open-estimate\.ai-orchestration\.jp\/manage\/estimates\/se_[a-f0-9]{32}$/.test(result.result_url)||!Number.isFinite(Date.parse(result.expires_at))||result.audience!==request.consent.audience||result.retention_days!==30||result.signed!==false||result.public!==false)throw new Error("INVALID_PUBLICATION_RESPONSE");
  await write(p.dir,`publication-${randomUUID()}.json`,{reported_at:new Date().toISOString(),evidence:"HOST_TOOL_RESPONSE",result});return result;
}
export async function migrateLegacyEstimate(id:string){
  const {readEstimateSubmission,estimateSubmissionsRoot}=await import("./estimate-submissions.js"),old=await readEstimateSubmission(id);
  const dir=await resolveSafePath(id,estimateSubmissionsRoot()),receipt=JSON.parse(await fs.readFile(await resolveSafePath("local-receipt.json",dir),"utf8"));
  const run=await readRun(receipt.run_id);if(receipt.checksums_hash!==run.checksums_hash||jcsSha256(old.estimate_input.evaluation.model)!==run.metadata.numeric_model_hash)throw new Error("LEGACY_SUBMISSION_MISMATCH");
  return {...await prepareResultPreview({run_id:receipt.run_id,display_currency:old.estimate_input.evaluation.display_currency}),migrated_from_legacy:true,transmitted:false,notice:"旧受付は送信せず、保存済み結果から新しいローカル確認を作成しました。固定した為替条件を確認し、新しい掲載同意を行ってください。"};
}
