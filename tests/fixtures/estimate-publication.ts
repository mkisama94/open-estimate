import fs from 'node:fs';
import {documentFixture} from './document.js';
import {resultFromDocument,type EstimateProofRequest,type PublishEstimate} from '../../src/contracts/estimate-result.js';
import {EstimateIssuerRepository,EstimateIssuerService} from '../../src/issuer/estimate-service.js';
import {createEstimateSigner,estimateHash} from '../../src/proof/estimate-proof.js';
import {PublicResultsRepository} from '../../src/web/public-results-repository.js';
import {PublicResultsService} from '../../src/web/public-results.js';
export async function publicationFixture(){
 const f=await documentFixture();for(const name of ['0009_estimate_proof_issuances.sql','0010_public_estimate_results.sql'])f.db.sqlite.exec(fs.readFileSync('migrations/'+name,'utf8'));
 const result=resultFromDocument(f.document),input={...f.request.validation_input,schema_version:'oes/estimate-validation-input/v1' as const};
 const request:EstimateProofRequest={schema_version:'oes/estimate-proof-request/v1',operation_id:f.request.operation_id,result,validation_input:input};
 const issuer=new EstimateIssuerService(new EstimateIssuerRepository(f.db),{enabled:true,key:f.key},f.catalog,await createEstimateSigner(f.privateKey));
 const proof=await issuer.issue(request,f.now),legacyProof=await f.service.issue(f.request,f.now);let now=f.now;
 const services={environment:'test' as const,proof_destination:f.key.issuer+'/mcp',publication_destination:'https://test.web.example/api/results',result_origin:'https://test.web.example'};
 const repository=new PublicResultsRepository(f.db),service=new PublicResultsService(repository,{origin:services.result_origin,environment:'test',keys:[f.key],enabled:true},()=>now);
 const token='A'.repeat(43),publish:PublishEstimate={schema_version:'oes/publish-estimate/v1',operation_id:'22222222-2222-4222-8222-222222222222',result,proof,withdrawal_token_hash:await estimateHash({domain:'oes/withdrawal-token/v1',token})};
 return {...f,result,input,request,issuer,proof,legacyProof,services,repository,service,token,publish,setNow:(n:number)=>{now=n;}};
}
