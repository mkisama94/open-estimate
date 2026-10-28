import {validate as validateDocument} from './estimate-document-validator.js';
import {validate as validateProof} from './document-proof-validator.js';
import type {EstimateDocument,DocumentProof} from './document.js';
/** Display readers never import the numeric verification-input schema. */
export function checkEstimateDocument(value:unknown):EstimateDocument {if(!validateDocument(value))throw new Error('INVALID_DOCUMENT');return value as EstimateDocument;}
export function checkDocumentProof(value:unknown):DocumentProof {if(!validateProof(value))throw new Error('INVALID_DOCUMENT_PROOF');return value as DocumentProof;}
