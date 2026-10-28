import type {EstimateDocument,DocumentValidationInput,ProofStatement,TrustedDocumentKey} from './document.js';
import {validate as resultValid} from './estimate-result-validator.js';
import {validate as proofValid} from './estimate-proof-validator.js';
import {validate as requestValid} from './estimate-request-validator.js';
import {validate as publishValid} from './estimate-publish-validator.js';
import {validate as responseValid} from './estimate-response-validator.js';
export type EstimateResult=Omit<EstimateDocument,'schema_version'|'template_version'>&{schema_version:'oes/estimate-result/v1'};
export type EstimateValidationInput=Omit<DocumentValidationInput,'schema_version'>&{schema_version:'oes/estimate-validation-input/v1'};
export interface EstimateProofRequest {schema_version:'oes/estimate-proof-request/v1';operation_id:string;result:EstimateResult;validation_input:EstimateValidationInput}
export type EstimateProofStatement=Omit<ProofStatement,'schema_version'|'domain'|'document_sha256'|'verification_method'>&{schema_version:'oes/estimate-proof/v1';domain:'oes/calculation-verified-estimate/v1';result_hash:string;verification_method:'oes/numeric-estimate-verification/v1'};
export interface EstimateProof {statement:EstimateProofStatement;signature:string}
export interface PublishEstimate {schema_version:'oes/publish-estimate/v1';operation_id:string;result:EstimateResult;proof:EstimateProof;withdrawal_token_hash:string}
export interface PublishedEstimate {schema_version:'oes/published-estimate/v1';status:'PUBLISHED';public_result_id:string;canonical_url:string;result_hash:string;published_at:string;expires_at:string}
export type {TrustedDocumentKey as TrustedEstimateKey};
export const PUBLICATION_DAYS=365;
export const PUBLICATION_MS=PUBLICATION_DAYS*24*60*60*1000;
export function checkEstimate<T>(kind:'result'|'proof'|'request'|'publish'|'response',value:unknown):T{
 let nodes=0;function visit(v:unknown,depth=0){if(++nodes>100000||depth>32)throw Error('ESTIMATE_INPUT_TOO_COMPLEX');if(v&&typeof v==='object')for(const x of Object.values(v))visit(x,depth+1);}
 visit(value);const validators={result:resultValid,proof:proofValid,request:requestValid,publish:publishValid,response:responseValid};
 if(!validators[kind](value))throw Error('INVALID_ESTIMATE_'+kind.toUpperCase());return value as T;
}
/** Conversion is in memory; no Markdown round-trip or source run is required. */
export function resultFromDocument(d:EstimateDocument):EstimateResult {const {template_version:_,schema_version:__,...rest}=d;return checkEstimate('result',{schema_version:'oes/estimate-result/v1',...rest});}
export function documentFromResult(r:EstimateResult):EstimateDocument {checkEstimate('result',r);return {...r,schema_version:'oes/estimate-document/v1',template_version:'oes/estimate-markdown/v1'};}
