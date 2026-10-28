import {jcsBytes} from '../core/canonical-json.js';
export const proofBytes=(statement:unknown)=>jcsBytes(statement);
export function base64url(bytes:Uint8Array){let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decodeBase64url(value:string):Uint8Array<ArrayBuffer>{if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('INVALID_BASE64');const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));if(base64url(bytes)!==value)throw new Error('INVALID_BASE64');return bytes;}
export async function documentHash(markdown:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(markdown))),b=>b.toString(16).padStart(2,'0')).join('');}
