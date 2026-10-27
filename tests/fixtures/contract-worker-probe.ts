import {checkContract} from '../../src/core/certificate-contract.js';
import {experienceStep} from '../../src/remote/experience.js';
import {uuidSchema,transferCreateSchema,emptyTransferSchema,anyOwnerPreviewSchema} from '../../src/core/preview-transfer-contract.js';
import {ESTIMATE_POLICY,ESTIMATE_METADATA_HASH,estimateInputSchema} from '../../src/core/estimate-preview.js';
export default {async fetch(){try{
 const stage=experienceStep({stage:'scope'});
 checkContract(uuidSchema,'00000000-0000-4000-8000-000000000000');
 checkContract(emptyTransferSchema,{});
 checkContract(transferCreateSchema,{input_commitment:{domain:'oes/owner-estimate-commitment/v1',algorithm:'SHA-256',digest:'1'.repeat(64)},metadata_hash:ESTIMATE_METADATA_HASH,policy_version:ESTIMATE_POLICY,client_secret_hash:'2'.repeat(64)});
 let rejected=0;for(const schema of [estimateInputSchema,anyOwnerPreviewSchema]){try{checkContract(schema,{private_path:'CANARY'});}catch(e){if(!(e instanceof Error)||e.message!=='INVALID_INPUT')throw e;rejected++;}}
 return Response.json({ok:true,stage:stage.stage,rejected});
 }catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:String(e)});}}};
