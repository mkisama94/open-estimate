import {documentPreview} from './document-preview.js';
import keys from '../../profiles/document-signing-keys.json' with {type:'json'};
import type {TrustedDocumentKey} from '../contracts/document.js';
/** Standalone build: no OAuth, DB, issuer runtime or numeric engine. */
export default {fetch(request:Request){return new URL(request.url).pathname==='/preview'?documentPreview(request,keys as TrustedDocumentKey[]):new Response('Not found',{status:404});}};
