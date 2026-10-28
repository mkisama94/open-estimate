import {randomUUID} from "node:crypto";
import {withQuality} from "./quality.js";
import {generatedRules,measurementRegistry,skillRegistry} from "./measurement.js";
import {legacyIntegrity} from "./skill-policy.js";
import {projectModel,validateAndRecomputeNumericModel} from "../../src/core/numeric-model.js";
import {createEvaluation} from "../../src/core/evaluation.js";
import {getLocalProfile} from "../../src/profiles/local-profile.js";
import {certificateCalculationProfile} from "../../src/profiles/certificate-basis.js";
import {projectPublicResult} from "../../src/core/public-result.js";
import {createDisplayQuote} from "../../src/core/display-quote.js";
import {jcsSha256} from "../../src/core/canonical.js";
import {PUBLICATION_POLICY,ESTIMATE_DESTINATION,type ResultSnapshot,type PublicationRequest} from "../../src/core/estimate-publication.js";
import {PreviewSqlite} from "./owner-preview.js";
import fs from "node:fs";
export async function directFixture(){
 const a=withQuality();a.input.acquisition!.scope_coverage="COMPLETE";
 const evaluation=createEvaluation(a,getLocalProfile()),model=projectModel(a),profile=certificateCalculationProfile(),report=validateAndRecomputeNumericModel(model,profile);
 const expected_report_hash=jcsSha256({model,profile,report});
 const result=projectPublicResult(a,{measurement:evaluation.report.measurement,calculation:{environment:"TEST",basis:evaluation.basis,effort:evaluation.report.effort,reference_usd:evaluation.report.reference_usd,limitation_codes:evaluation.report.limitation_codes}});
 const display_quote=await createDisplayQuote({report,basis:profile,report_hash:expected_report_hash},{get:async()=>{throw Error("FX_NOT_NEEDED");}},"ja-JP","USD");
 const snapshot:ResultSnapshot={schema_version:"oes/estimate-snapshot/v1",input:{schema_version:"oes/owner-estimate-input/v1",evaluation:{model,display_currency:"USD",skill_integrity:legacyIntegrity as any,ruleset_ref:generatedRules.ruleset_ref},quality:result.quality,expected_report_hash},result,display_quote,scope_coverage:"COMPLETE",measured_at:new Date().toISOString(),scope:"AGREED_AS_BUILT_FUNCTIONAL_SCOPE"};
 const request:PublicationRequest={operation_id:randomUUID(),snapshot,consent:{confirmed:true,snapshot_hash:jcsSha256(snapshot),policy:PUBLICATION_POLICY,destination:ESTIMATE_DESTINATION,audience:"OWNER_ONLY",retention_days:30,confirmed_at:new Date().toISOString()}};
 const db=new PreviewSqlite();db.sqlite.exec(fs.readFileSync("migrations/0007_direct_estimate_publications.sql","utf8"));
 const now=Date.now(),principal={subject:"owner-a",scopes:["estimates:write"],expires_at:now+3600000,authentication_strength:"synthetic-verified"};
 return {a,snapshot,request,db,now,principal,catalog:{skills:skillRegistry(legacyIntegrity),rules:measurementRegistry()}};
}
