import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readRun} from './runs.js';
import {privateDirectory} from '../local-files.js';
import {projectPublicResult} from '../core/public-result.js';
import {validateAndRecomputeNumericModel} from '../core/numeric-model.js';
import {certificateCalculationProfile} from '../profiles/certificate-basis.js';
import {createDisplayQuote} from '../core/display-quote.js';
import {frbProvider,type FxProvider} from '../profiles/frb.js';
import {jcsSha256,sha256Hex} from '../core/canonical.js';
import {documentHash} from '../proof/crypto.js';
import {validateRulesBundle} from '../rules/measurement-contract.js';
import type {EstimateDocument,DocumentValidationInput} from '../contracts/document.js';
import {renderDocumentMarkdown} from '../document/markdown.js';
import {documentsRoot} from './document-paths.js';
import {readDocumentFile,writeDocumentFile,jsonFile,renderDocumentPdfFile,showDocument} from './document-result.js';
export async function fixedDocumentFromRun(args:{run_id:string;display_currency?:string;fixed_display_quote?:EstimateDocument['display_quote']},provider:FxProvider=frbProvider){
 const run=await readRun(args.run_id),model=JSON.parse((await readDocumentFile(run.dir,'model.json')).toString());
 if(jcsSha256(model)!==run.metadata.numeric_model_hash)throw new Error('RUN_CHECKSUM_MISMATCH');
 const context=run.metadata.rules_context as any;validateRulesBundle(context.bundle,context.ruleset_ref);
 const result=projectPublicResult(run.assessment,run.summary),profile=certificateCalculationProfile(),report=validateAndRecomputeNumericModel(model,profile),reportHash=jcsSha256({model,profile,report});
 if(jcsSha256(report.measurement)!==jcsSha256(result.measurement)||jcsSha256(report.effort)!==jcsSha256(result.calculation.effort)||jcsSha256(report.reference_usd)!==jcsSha256(result.calculation.reference_usd))throw new Error('DOCUMENT_NUMERIC_MISMATCH');
 const input:DocumentValidationInput={schema_version:'oes/document-validation-input/v1',model,display_currency:args.display_currency??'JPY',skill_integrity:{format:'oes/skill-integrity/v1',skill_id:'open-estimate-assessor',skill_version:run.metadata.skill.version,hash_rule:'oes/skill-package/v1',package_sha256:run.metadata.skill.declared_package_sha256},ruleset_ref:context.ruleset_ref,quality:result.quality,expected_report_hash:reportHash};
 const display_quote=args.fixed_display_quote??await createDisplayQuote({report,basis:profile,report_hash:reportHash},provider,'ja-JP',input.display_currency);
 const document:EstimateDocument={schema_version:'oes/estimate-document/v1',template_version:'oes/estimate-markdown/v1',measured_at:run.assessment.assessor.finished_at,ruleset_ref:context.ruleset_ref,scope:'AGREED_AS_BUILT_FUNCTIONAL_SCOPE',scope_coverage:run.assessment.input.acquisition?.scope_coverage??'UNKNOWN',result,display_quote};
 return {document,input,run};
}
export async function createDocument(args:{run_id:string;display_currency?:string},provider:FxProvider=frbProvider){
 const {document,input,run}=await fixedDocumentFromRun(args,provider);
 const markdown=renderDocumentMarkdown(document);await privateDirectory(documentsRoot());const dir=path.join(documentsRoot(),randomUUID());await fs.mkdir(dir,{mode:0o700});
 await writeDocumentFile(dir,'document.json',jsonFile(document));await writeDocumentFile(dir,'estimate.md',markdown);
 await writeDocumentFile(dir,'document-ready.json',jsonFile({document_sha256:await documentHash(markdown),json_sha256:sha256Hex(jsonFile(document))}));
 await writeDocumentFile(dir,'validation-input.json',jsonFile(input));
 await writeDocumentFile(dir,'local-reference.json',jsonFile({run_id:args.run_id,scope:run.assessment.scope,scope_record:run.assessment.scope_record,judgments:run.assessment.judgments,limitations:run.assessment.quality?.limitations}));
 try{await renderDocumentPdfFile(dir);}catch{return {...await showDocument(dir),status:'PDF_INCOMPLETE',next_action:'render-document-pdf'};}return showDocument(dir);
}
