import {PublicResultsService,PublicResultsError} from './public-results.js';
import {PublicResultsRepository,type PublicDatabase} from './public-results-repository.js';
import {publicResultHtml} from './public-result-view.js';
import {renderStructuredEstimatePdf} from '../document/estimate-pdf.js';
import type {TrustedEstimateKey} from '../contracts/estimate-result.js';
import keys from '../../profiles/document-signing-keys.json' with {type:'json'};
import {parseStrictJson} from '../core/json-parser.js';
export interface PublicResultsEnvironment {PUBLIC_RESULTS_DB?:PublicDatabase;PUBLIC_RESULTS_ENABLED?:string;PUBLIC_RESULTS_ORIGIN?:string;PUBLIC_RESULTS_ENVIRONMENT?:string;PUBLIC_RESULTS_LIMITER?:{limit(o:{key:string}):Promise<{success:boolean}>}}
export const PUBLIC_RESULT_BODY_LIMIT=128*1024;
export const publicResultsHeaders={'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{...publicResultsHeaders,'Content-Type':'application/json; charset=utf-8'}});
export const isPublicResultsPath=(p:string)=>p==='/api/results'||p.startsWith('/results/')||p.startsWith('/api/results/')||p.startsWith('/api/result-operations/');
async function readBody(request:Request){
 if(request.headers.has('Content-Encoding')||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')??''))throw new PublicResultsError('INVALID_PUBLICATION_INPUT',400);
 const reader=request.body?.getReader();if(!reader)throw new PublicResultsError('INVALID_PUBLICATION_INPUT',400);let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>PUBLIC_RESULT_BODY_LIMIT){await reader.cancel();throw new PublicResultsError('PUBLICATION_TOO_LARGE',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new PublicResultsError('INVALID_PUBLICATION_INPUT',400);}
}
export function createPublicResultsController(service:PublicResultsService,limiter:NonNullable<PublicResultsEnvironment['PUBLIC_RESULTS_LIMITER']>){return {async fetch(request:Request){
 try{
  const u=new URL(request.url);if(u.origin!==service.config.origin||u.search)throw new PublicResultsError('RESULT_NOT_FOUND',404);
  const token=()=>{const a=request.headers.get('Authorization')??'';return /^Bearer [A-Za-z0-9_-]{43}$/.test(a)?a.slice(7):'';};
  const limited=async(key:string)=>{if(!(await limiter.limit({key})).success)throw new PublicResultsError('PUBLICATION_RATE_LIMITED',429);};
  if(request.method==='POST'&&u.pathname==='/api/results'){await limited('publish-global');const v=await service.register(await readBody(request));return json(v.response,v.created?201:200);}
  const page=u.pathname.match(/^\/results\/(res_[a-f0-9]{32})(\/pdf)?$/);
  if(request.method==='GET'&&page){const v=await service.read(page[1]);if(page[2]){const pdf=await renderStructuredEstimatePdf(v.result,v.proof,v.publication);service.active(await service.repository.result(page[1]));return new Response(pdf.slice().buffer as ArrayBuffer,{headers:{...publicResultsHeaders,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="estimate.pdf"'}});}const html=publicResultHtml(v.result,v.proof,v.publication);service.active(await service.repository.result(page[1]));return new Response(html,{headers:{...publicResultsHeaders,'Content-Type':'text/html; charset=utf-8'}});}
  const op=u.pathname.match(/^\/api\/result-operations\/([a-f0-9-]{36})$/);if(request.method==='GET'&&op){await limited('management-global');return json(await service.operation(op[1],token()));}
  const stop=u.pathname.match(/^\/api\/results\/(res_[a-f0-9]{32})\/withdraw$/);if(request.method==='POST'&&stop){await limited('management-global');return json(await service.withdraw(stop[1],token()));}
  throw new PublicResultsError('RESULT_NOT_FOUND',404);
 }catch(e){const known=e instanceof PublicResultsError;const status=known?e.status:503;return json({error:{code:known?e.code:'PUBLICATION_SERVICE_UNAVAILABLE',retryable:status===429||status===503,...(known&&e.state?{state:e.state}:{})}},status);}
}};}
export function publicResultsService(env:PublicResultsEnvironment){if(!env.PUBLIC_RESULTS_DB||!env.PUBLIC_RESULTS_ORIGIN||!['test','production'].includes(env.PUBLIC_RESULTS_ENVIRONMENT??''))throw Error('PUBLIC_RESULTS_CONFIGURATION_REQUIRED');return new PublicResultsService(new PublicResultsRepository(env.PUBLIC_RESULTS_DB),{origin:env.PUBLIC_RESULTS_ORIGIN,environment:env.PUBLIC_RESULTS_ENVIRONMENT as 'test'|'production',keys:keys as TrustedEstimateKey[],enabled:env.PUBLIC_RESULTS_ENABLED==='true'});}
export default {async fetch(request:Request,env:PublicResultsEnvironment){try{if(!env.PUBLIC_RESULTS_LIMITER)throw Error('PUBLIC_RESULTS_CONFIGURATION_REQUIRED');return await createPublicResultsController(publicResultsService(env),env.PUBLIC_RESULTS_LIMITER).fetch(request);}catch{return json({error:{code:'PUBLICATION_SERVICE_UNAVAILABLE',retryable:true}},503);}},async scheduled(_event:unknown,env:PublicResultsEnvironment){await publicResultsService(env).repository.purge(Date.now());}};
