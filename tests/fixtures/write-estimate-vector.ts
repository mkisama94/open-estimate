import fs from 'node:fs/promises';
import {publicationFixture} from './estimate-publication.js';
import {estimateResultHash} from '../../src/proof/estimate-proof.js';
if(process.env.OES_WRITE_ESTIMATE_VECTOR!=='true')throw Error('EXPLICIT_TEST_VECTOR_WRITE_REQUIRED');
const f=await publicationFixture();try{await fs.writeFile('tests/fixtures/estimate-result-vector.json',JSON.stringify({result:f.result,proof:f.proof,key:f.key,result_hash:await estimateResultHash(f.result)},null,2)+'\n');}finally{f.db.sqlite.close();}
