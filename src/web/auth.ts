/** Implementations validate issuer/audience/expiry/scope before returning a principal. */
export interface Principal {subject:string;scopes:readonly string[];expires_at:number;authentication_strength:string}
export interface AuthAdapter {readonly mode:"production"|"test";authenticate(request:Request):Promise<Principal|null>}
export function requirePrincipal(principal:Principal|null,scope:string,now:number):Principal {
  if(!principal || principal.expires_at<=now || !principal.subject)throw new Error("AUTH_REQUIRED");
  if(!principal.scopes.includes(scope))throw new Error("AUTH_REQUIRED");
  return principal;
}
