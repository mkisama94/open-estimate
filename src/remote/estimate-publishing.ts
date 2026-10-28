import {createOidcAuthAdapter} from "../web/oidc-auth.js";
import {EstimatePublicationService} from "../web/estimate-publication.js";
import type {CertificateDatabase} from "../web/certificate-repository.js";
import type {SkillRegistry} from "./skill-integrity.js";
import type {RulesRegistry} from "../rules/measurement-contract.js";
export interface EstimatePublicationEnvironment {ESTIMATE_PUBLICATION_ENABLED?:string;AUTH0_ISSUER?:string;AUTH0_API_AUDIENCE?:string;AUTH0_MCP_CLIENT_IDS?:string;CERTIFICATES_DB?:CertificateDatabase;ESTIMATE_PUBLICATION_LIMITER?:{limit(options:{key:string}):Promise<{success:boolean}>}}
export const protectedResourcePath="/.well-known/oauth-protected-resource/mcp";
export function publicationResourceMetadata(env:EstimatePublicationEnvironment){
 if(!env.AUTH0_ISSUER)throw new Error("AUTH_CONFIGURATION_REQUIRED");
 const issuer=new URL(env.AUTH0_ISSUER);if(issuer.protocol!=="https:"||issuer.pathname!=="/"||issuer.search||issuer.hash||issuer.username||issuer.password)throw new Error("AUTH_CONFIGURATION_REQUIRED");
 return {resource:"https://open-estimate.ai-orchestration.jp/mcp",authorization_servers:[issuer.href],scopes_supported:["estimates:write"],bearer_methods_supported:["header"]};
}
export const publicationAuthChallenge='Bearer resource_metadata="https://open-estimate.ai-orchestration.jp'+protectedResourcePath+'", error="insufficient_scope", error_description="Log in to save this result to your own account"';
export async function publishAuthenticatedEstimate(request:Request,value:unknown,env:EstimatePublicationEnvironment,skills:SkillRegistry,rules:RulesRegistry){
 if(request.headers.has("Cookie"))throw new Error("AUTH_REQUIRED");
 if(!env.AUTH0_ISSUER||!env.AUTH0_API_AUDIENCE||!env.AUTH0_MCP_CLIENT_IDS)throw new Error("AUTH_CONFIGURATION_REQUIRED");
 const auth=createOidcAuthAdapter({issuer:env.AUTH0_ISSUER,audience:env.AUTH0_API_AUDIENCE,client_ids:env.AUTH0_MCP_CLIENT_IDS.split(",").map(x=>x.trim()).filter(Boolean),max_token_age_seconds:3600});
 const principal=await auth.authenticate(request);if(!principal?.scopes.includes("estimates:write"))throw new Error("AUTH_REQUIRED");
 if(env.ESTIMATE_PUBLICATION_ENABLED!=="true"||!env.CERTIFICATES_DB||!env.ESTIMATE_PUBLICATION_LIMITER)throw new Error("ESTIMATE_PUBLICATION_DISABLED");
 if(!(await env.ESTIMATE_PUBLICATION_LIMITER.limit({key:"estimate-owner:"+principal.subject})).success)throw new Error("RATE_LIMITED");
 return new EstimatePublicationService(env.CERTIFICATES_DB,{skills,rules},true).publish(principal,value);
}
