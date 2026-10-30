import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {publicationFixture} from '../fixtures/estimate-publication.js';
import {FrbProvider} from '../../src/profiles/frb.js';
import {frbHtml,htmlResponse,fxNow} from '../fixtures/frb.js';
import {createDisplayQuote} from '../../src/core/display-quote.js';
import {checkEstimate} from '../../src/contracts/estimate-result.js';
import {verifyEstimateProof,estimateResultHash} from '../../src/proof/estimate-proof.js';

it('preserves FRB raw trailing zeroes through structured result, proof, publication and verification',async()=>{
 const f=await publicationFixture();try{
  const c=f.result.result.calculation;
  const provider=new FrbProvider(async()=>htmlResponse(frbHtml('156.8700')),()=>fxNow);
  const quote=await createDisplayQuote({report:{...c,measurement:f.result.result.measurement,limitation_codes:f.result.result.limitation_codes},basis:c.basis,report_hash:f.input.expected_report_hash},provider,'ja-JP','JPY',()=>new Date(f.now));
  expect(quote.fx_snapshot?.raw_value).toBe('156.8700');expect(quote.fx_snapshot?.currency_per_usd).toBe('156.87');
  const result={...f.result,display_quote:quote};expect(checkEstimate('result',result)).toBe(result);
  const proof=await f.issuer.issue({...f.request,operation_id:randomUUID(),result,validation_input:{...f.input,display_currency:'JPY'}},f.now);
  expect(await verifyEstimateProof(result,proof,[f.key],'test')).toMatchObject({signature:'VALID'});
  const published=await f.service.register({...f.publish,operation_id:randomUUID(),result,proof});
  const stored=await f.service.read(published.response.public_result_id);expect(stored.result.display_quote.fx_snapshot?.raw_value).toBe('156.8700');
  const changed=structuredClone(result);changed.display_quote.fx_snapshot!.raw_value='156.87';expect(await estimateResultHash(changed)).not.toBe(await estimateResultHash(result));
  await expect(verifyEstimateProof(changed,proof,[f.key])).rejects.toThrow('MISMATCH');
  const normalized=structuredClone(result);normalized.display_quote.fx_snapshot!.currency_per_usd='156.8700';expect(()=>checkEstimate('result',normalized)).toThrow('INVALID_ESTIMATE_RESULT');
  for(const raw of ['0','0.0000','-1','1e2',' 156.8700','156.8700 text','1.1234567890123']){const invalid=structuredClone(result);invalid.display_quote.fx_snapshot!.raw_value=raw;expect(()=>checkEstimate('result',invalid)).toThrow('INVALID_ESTIMATE_RESULT');}
 }finally{f.db.sqlite.close();}
});
