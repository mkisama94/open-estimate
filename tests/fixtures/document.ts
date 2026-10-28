import {createPrivateKey,createPublicKey} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {directFixture} from './direct-estimate.js';
import type {EstimateDocument,DocumentProofRequest,TrustedDocumentKey} from '../../src/contracts/document.js';
import {renderDocumentMarkdown} from '../../src/document/markdown.js';
import {DocumentIssuerRepository,type IssuerDatabase, type IssuerStatement} from '../../src/issuer/repository.js';
import {DocumentIssuerService} from '../../src/issuer/service.js';
import {createDocumentSigner} from '../../src/issuer/signing.js';
export class IssuerSqlite implements IssuerDatabase {
 sqlite=new DatabaseSync(':memory:');
 constructor(){this.sqlite.exec(fs.readFileSync('migrations/0008_document_proof_issuances.sql','utf8'));}
 prepare(sql:string):IssuerStatement {let values:unknown[]=[];return {bind(...v:unknown[]){values=v;return this;},first:async<T>()=>this.sqlite.prepare(sql).get(...values as any[]) as T??null,...{execute:()=>this.sqlite.prepare(sql).run(...values as any[])}};}
 async batch(statements:IssuerStatement[]){this.sqlite.exec('BEGIN');try{for(const s of statements)(s as any).execute();this.sqlite.exec('COMMIT');}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
}
export async function documentFixture(){
 const f=await directFixture();f.db.sqlite.close();const now=Date.parse('2026-10-28T00:00:00.000Z');f.snapshot.measured_at='2026-10-27T00:00:00.000Z';f.snapshot.display_quote.displayed_at=f.snapshot.measured_at;
 const document:EstimateDocument={schema_version:'oes/estimate-document/v1',template_version:'oes/estimate-markdown/v1',measured_at:f.snapshot.measured_at,ruleset_ref:f.snapshot.input.evaluation.ruleset_ref,scope:f.snapshot.scope,scope_coverage:f.snapshot.scope_coverage,result:f.snapshot.result,display_quote:f.snapshot.display_quote};
 const request:DocumentProofRequest={schema_version:'oes/document-proof-request/v1',operation_id:'11111111-1111-4111-8111-111111111111',document,markdown:renderDocumentMarkdown(document),validation_input:{schema_version:'oes/document-validation-input/v1',...f.snapshot.input.evaluation,quality:f.snapshot.input.quality,expected_report_hash:f.snapshot.input.expected_report_hash}};
 // Fixed test-only seed; not trusted by production or packaged profiles.
 const testPrivateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.alloc(32,7)]),format:'der',type:'pkcs8'}),pair={privateKey:testPrivateKey,publicKey:createPublicKey(testPrivateKey)},privateKey=pair.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),publicKey=pair.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url');
 const key:TrustedDocumentKey={key_id:'doc_test_'+'1'.repeat(32),algorithm:'Ed25519',public_key:publicKey,issuer:'https://test.open-estimate.example',environment:'test'};
 const db=new IssuerSqlite(),repository=new DocumentIssuerRepository(db),config={enabled:true,issuer:key.issuer,environment:'test' as const,key},sign=await createDocumentSigner(privateKey),catalog={...f.catalog,now};
 return {...f,now,document,request,key,pair,privateKey,db,repository,config,catalog,sign,service:new DocumentIssuerService(repository,config,catalog,sign)};
}
