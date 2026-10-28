import {checkContract} from '../../src/core/certificate-contract.js';
import {experienceStep} from '../../src/remote/experience.js';
import {uuidSchema,transferCreateSchema,emptyTransferSchema,anyOwnerPreviewSchema} from '../../src/core/preview-transfer-contract.js';
import {ESTIMATE_POLICY,ESTIMATE_METADATA_HASH,estimateInputSchema} from '../../src/core/estimate-preview.js';
import {validateResultSnapshot} from '../../src/core/estimate-publication.js';
import {validateAndRecomputeNumericModel} from '../../src/core/numeric-model.js';
import {certificateCalculationProfile,getCertificateBasis} from '../../src/profiles/certificate-basis.js';
import {createDisplayQuote} from '../../src/core/display-quote.js';
import {jcsSha256} from '../../src/core/canonical.js';
export default {async fetch(){try{
 const stage=experienceStep({stage:'scope'});
 checkContract(uuidSchema,'00000000-0000-4000-8000-000000000000');
 checkContract(emptyTransferSchema,{});
 checkContract(transferCreateSchema,{input_commitment:{domain:'oes/owner-estimate-commitment/v1',algorithm:'SHA-256',digest:'1'.repeat(64)},metadata_hash:ESTIMATE_METADATA_HASH,policy_version:ESTIMATE_POLICY,client_secret_hash:'2'.repeat(64)});
 let rejected=0;for(const schema of [estimateInputSchema,anyOwnerPreviewSchema]){try{checkContract(schema,{private_path:'CANARY'});}catch(e){if(!(e instanceof Error)||e.message!=='INVALID_INPUT')throw e;rejected++;}}
 const model:any={version:'oes/remote-model/v1',analysis_complete:true,partial:false,applicability_limit:false,users:1,stores:0,groups:[0],processes:[{status:'accepted',trigger_user:0,trigger_group:0,movements:[{type:'Entry',group:0,peer:0,store:null,distinct:false,variant:null},{type:'Exit',group:0,peer:0,store:null,distinct:false,variant:null}]}]};
 const profile=certificateCalculationProfile(),report=validateAndRecomputeNumericModel(model,profile),hash=jcsSha256({model,profile,report});
 const quality={record_format:'RECORDED_V2',quality_version:'oes/quality-records/v1',analysis_complete:true,scan_complete:true,provisional_process_count:0,provisional_cfp_subtotal:0,unresolved_process_count:0,candidate_counts:{identified:1,counted:1,outside:0,merged:0,unresolved:0},unread_counts:{in_scope:0,outside:0,supporting:0,scope_unknown:0},unknown_boundary_counts:{rerun:0,continuation:0},partial_reason_codes:[],record_gap_codes:[]};
 const snapshot:any={schema_version:'oes/estimate-snapshot/v1',input:{schema_version:'oes/owner-estimate-input/v1',evaluation:{model,display_currency:'USD',skill_integrity:{format:'oes/skill-integrity/v1',skill_id:'open-estimate-assessor',skill_version:'0.0.0',hash_rule:'oes/skill-package/v1',package_sha256:'1'.repeat(64)},ruleset_ref:{ruleset_id:'oes-measurement',revision:'1'.repeat(64)}},quality,expected_report_hash:hash},result:{schema_version:'oes/public-result-candidate/v1',projection_version:'oes/public-result-projection/1.0.0',measurement:report.measurement,quality,calculation:{...getCertificateBasis(),effort:report.effort,reference_usd:report.reference_usd},assurance:{input:'CLIENT_REPORTED',calculation_check:'LOCAL_RECOMPUTED_MATCH',semantic_assessment:'NOT_INDEPENDENTLY_VERIFIED',signed:false},limitation_codes:[...new Set([...report.limitation_codes,'TEST_DATA_ONLY'])].sort()},display_quote:await createDisplayQuote({report,basis:profile,report_hash:hash},{get:async()=>{throw Error('NO_FX');}},'ja-JP','USD'),scope_coverage:'COMPLETE',measured_at:new Date().toISOString(),scope:'AGREED_AS_BUILT_FUNCTIONAL_SCOPE'};
 delete snapshot.result.calculation.schema_version;await validateResultSnapshot(snapshot);
 snapshot.display_quote.localized_reference.amount.median='1';try{await validateResultSnapshot(snapshot);}catch(e){if(!(e instanceof Error)||e.message!=='RESULT_MISMATCH')throw e;rejected++;}
 return Response.json({ok:true,stage:stage.stage,rejected,cfp:report.measurement.cfp});
 }catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:String(e)});}}};
