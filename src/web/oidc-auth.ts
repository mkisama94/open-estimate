import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { jcsSha256 } from "../core/canonical.js";
import type { AuthAdapter, Principal } from "./auth.js";

export interface OidcAuthConfig {
  issuer:string;
  audience:string;
  client_ids:readonly string[];
  max_token_age_seconds:number;
}
/** The issuer is operator configuration. No jku, x5u or issuer from a token selects keys. */
export function oidcOwnerId(issuer:string,subject:string):string {
  return "owner_"+jcsSha256({domain:"oes/oidc-owner/v1",issuer,subject});
}
export function createOidcAuthAdapter(config:OidcAuthConfig,testing?:{keys:JWTVerifyGetKey;now:()=>number}):AuthAdapter {
  let issuer:URL;
  try {issuer=new URL(config.issuer);}catch {throw new Error("INVALID_AUTH_CONFIGURATION");}
  if(issuer.protocol!=="https:" || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname!=="/" || issuer.href!==config.issuer
    || !config.audience || config.audience===config.issuer+"userinfo" || !config.client_ids.length || config.client_ids.some(id=>!id || id.length>256)
    || !Number.isInteger(config.max_token_age_seconds) || config.max_token_age_seconds<60 || config.max_token_age_seconds>3600)throw new Error("INVALID_AUTH_CONFIGURATION");
  const keys=testing?.keys??createRemoteJWKSet(new URL(".well-known/jwks.json",issuer),{timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:600000});
  const clock=testing?.now??Date.now;
  return {
    mode:testing?"test":"production",
    async authenticate(request:Request):Promise<Principal|null> {
      const authorization=request.headers.get("Authorization");
      if(!authorization || authorization.length>16384 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))return null;
      try {
        const now=clock();
        const {payload,protectedHeader}=await jwtVerify(authorization.slice(7),keys,{algorithms:["RS256"],issuer:config.issuer,audience:config.audience,
          requiredClaims:["iss","sub","aud","exp","iat","azp"],maxTokenAge:config.max_token_age_seconds,clockTolerance:30,currentDate:new Date(now)});
        // This API accepts delegated human access tokens, never ID tokens or client credentials.
        if(protectedHeader.jku!==undefined || protectedHeader.x5u!==undefined || protectedHeader.jwk!==undefined || typeof protectedHeader.kid!=="string" || !protectedHeader.kid
          || typeof payload.sub!=="string" || !payload.sub || payload.sub.length>512 || payload.sub.endsWith("@clients") || payload.gty==="client-credentials"
          || typeof payload.azp!=="string" || !config.client_ids.includes(payload.azp) || typeof payload.scope!=="string" || typeof payload.exp!=="number" || payload.exp*1000<=now)return null;
        const reported=payload.scope.split(" ");
        // Operator permissions require a separate adapter/authorization path.
        const scopes=["certificates:manage","estimates:write"].filter(scope=>reported.includes(scope));
        if(!scopes.length)return null;
        return {subject:oidcOwnerId(config.issuer,payload.sub),scopes,expires_at:payload.exp*1000,authentication_strength:"OIDC_ACCESS_TOKEN_VERIFIED"};
      } catch {return null;}
    }
  };
}
