import type {PublicResultCandidate} from '../core/public-result.js';
import type {DisplayQuote} from '../core/display-quote.js';
import type {RulesetRef} from '../rules/measurement-contract.js';
import type {NumericModel} from '../core/numeric-model.js';
import schemas from './document.schema.json' with {type:'json'};
import {validators} from './document-validators.js';

/** Portable data only. Runtime contracts contain no calculation, adapter or environment. */
export interface EstimateDocument {
 schema_version:'oes/estimate-document/v1'; template_version:'oes/estimate-markdown/v1';
 measured_at:string; ruleset_ref:RulesetRef; scope:'AGREED_AS_BUILT_FUNCTIONAL_SCOPE';
 scope_coverage:'COMPLETE'|'MISSING'|'UNKNOWN'; result:PublicResultCandidate; display_quote:DisplayQuote;
}
export interface DocumentValidationInput {schema_version:'oes/document-validation-input/v1';model:NumericModel;quality:PublicResultCandidate['quality'];ruleset_ref:RulesetRef;skill_integrity:{format:'oes/skill-integrity/v1';skill_id:'open-estimate-assessor';skill_version:string;hash_rule:'oes/skill-package/v1';package_sha256:string};display_currency:string;expected_report_hash:string}
export interface DocumentProofRequest {schema_version:'oes/document-proof-request/v1';operation_id:string;document:EstimateDocument;markdown:string;validation_input:DocumentValidationInput}
export interface ProofStatement {
 schema_version:'oes/document-proof/v1';domain:'oes/calculation-verified-document/v1';algorithm:'Ed25519';
 issuer:string;proof_id:string;issued_at:string;document_sha256:string;ruleset_ref:RulesetRef;
 verification:'CALCULATION_VERIFIED';verification_method:'oes/numeric-document-verification/v1';
 scope:readonly string[];limitations:readonly string[];key_id:string;environment:'test'|'production';
}
export interface DocumentProof {statement:ProofStatement;signature:string}
export interface TrustedDocumentKey {key_id:string;algorithm:'Ed25519';public_key:string;issuer:string;environment:'test'|'production'}
export const PROOF_SCOPE=['DOCUMENT_FORMAT','NUMERIC_CONSISTENCY','RULESET_REFERENCE','DOCUMENT_BINDING'] as const;
export const PROOF_LIMITATIONS=['SOURCE_COVERAGE_CLIENT_REPORTED','AI_SEMANTICS_NOT_AUDITED','FX_AUTHENTICITY_NOT_AUDITED','ACTUAL_EFFORT_NOT_GUARANTEED','SUBMITTER_IDENTITY_NOT_VERIFIED','FREE_TEXT_NOT_VERIFIED'] as const;
export const documentSchema=schemas.document,proofRequestSchema=schemas.request,documentProofSchema=schemas.proof;
export function checkDocumentContract<T>(kind:'document'|'request'|'proof',value:unknown):T {
 if(!validators[kind](value))throw new Error('INVALID_DOCUMENT_'+kind.toUpperCase());return value as T;
}
