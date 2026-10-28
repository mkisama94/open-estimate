import {it,expect} from 'vitest';
import {publicationFixture} from '../fixtures/estimate-publication.js';
import {createPublicResultsController} from '../../src/web/public-results-worker.js';
import {PUBLICATION_MS} from '../../src/contracts/estimate-result.js';
const limiter={limit:async()=>({success:true})};
it('registers without OAuth, deduplicates concurrent writes, keeps the original expiry, and rejects conflicts/secrets/test proof in production',async()=>{const f=await publicationFixture();try{
 const [a,b]=await Promise.all([f.service.register(f.publish),f.service.register(f.publish)]);expect(a.response).toEqual(b.response);expect([a.created,b.created].sort()).toEqual([false,true]);
 expect(Date.parse(a.response.expires_at)-Date.parse(a.response.published_at)).toBe(PUBLICATION_MS);
 const worker=createPublicResultsController(f.service,limiter),url=a.response.canonical_url;
 for(const ms of [15*60000,30*86400000,PUBLICATION_MS-1]){f.setNow(f.now+ms);const r=await worker.fetch(new Request(url));expect(r.status).toBe(200);const html=await r.text();expect(html).toContain('18 時間');expect(html).not.toContain(f.token);expect(html).not.toContain('withdrawal_token');expect((await f.service.register(f.publish)).response).toEqual(a.response);}
 await expect(f.service.register({...f.publish,withdrawal_token_hash:'f'.repeat(64)})).rejects.toMatchObject({status:409});
 await expect(f.service.register({...f.publish,operation_id:crypto.randomUUID(),secret:'x'})).rejects.toMatchObject({status:400});
 f.service.config.environment='production';await expect(f.service.register({...f.publish,operation_id:crypto.randomUUID()})).rejects.toMatchObject({status:422});
 }finally{f.db.sqlite.close();}});
it('gates every read at the 365-day boundary before deletion and retains tombstones after bounded purge',async()=>{const f=await publicationFixture();try{
 const a=await f.service.register(f.publish),worker=createPublicResultsController(f.service,limiter);f.setNow(f.now+PUBLICATION_MS);
 for(const path of [a.response.canonical_url,a.response.canonical_url+'/pdf',f.services.result_origin+'/api/result-operations/'+f.publish.operation_id]){const r=await worker.fetch(new Request(path,{headers:{Authorization:'Bearer '+f.token}}));expect(r.status).toBe(410);expect(await r.text()).not.toContain('person_hours');expect(r.headers.get('Cache-Control')).toContain('no-store');}
 await expect(f.service.register(f.publish)).rejects.toMatchObject({status:410,state:'EXPIRED'});await f.repository.purge(f.now+PUBLICATION_MS);const row=await f.repository.operation(f.publish.operation_id);expect(row?.result_json).toBeNull();expect(row?.proof_json).toBeNull();await expect(f.service.register(f.publish)).rejects.toMatchObject({status:410});
 }finally{f.db.sqlite.close();}});
it('requires a private management secret, supports repeated withdrawal, and never revives a withdrawn result',async()=>{const f=await publicationFixture();try{
 const a=await f.service.register(f.publish),id=a.response.public_result_id;await expect(f.service.withdraw(id,'B'.repeat(43))).rejects.toMatchObject({status:404});await expect(f.service.operation(f.publish.operation_id,'')).rejects.toMatchObject({status:404});
 expect(await f.service.operation(f.publish.operation_id,f.token)).toEqual(a.response);expect(await f.service.withdraw(id,f.token)).toEqual({status:'WITHDRAWN'});expect(await f.service.withdraw(id,f.token)).toEqual({status:'WITHDRAWN'});
 await expect(f.service.read(id)).rejects.toMatchObject({status:410});await expect(f.service.register(f.publish)).rejects.toMatchObject({status:410,state:'WITHDRAWN'});
 const w=createPublicResultsController(f.service,limiter);expect((await w.fetch(new Request(a.response.canonical_url+'/pdf'))).status).toBe(410);expect((await w.fetch(new Request(f.services.result_origin+'/api/results/'+id+'/withdraw'))).status).toBe(404);
 }finally{f.db.sqlite.close();}});
it('bounds streamed bodies and rejects duplicate JSON fields and unsolicited input',async()=>{const f=await publicationFixture();try{const w=createPublicResultsController(f.service,limiter),url=f.services.publication_destination;
 expect((await w.fetch(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(131073)}))).status).toBe(413);
 expect((await w.fetch(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"operation_id":1,"operation_id":2}'}))).status).toBe(400);
 expect((await createPublicResultsController(f.service,{limit:async()=>({success:false})}).fetch(new Request(url,{method:'POST'}))).status).toBe(429);
 }finally{f.db.sqlite.close();}});
