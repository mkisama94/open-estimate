import { beforeAll,it,expect } from "vitest";
import { generateKeyPair,exportJWK,SignJWT,createLocalJWKSet } from "jose";
import { createOidcAuthAdapter,oidcOwnerId } from "../../src/web/oidc-auth.js";
const issuer="https://tenant-test.example.org/",audience="https://api-test.example.org/certificates",now=Date.parse("2026-10-20T00:00:00Z"),seconds=now/1000;
let pair:Awaited<ReturnType<typeof generateKeyPair>>,keys:ReturnType<typeof createLocalJWKSet>;
beforeAll(async()=>{pair=await generateKeyPair("RS256");keys=createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),kid:"test-rsa",alg:"RS256",use:"sig"}]});});
const config={issuer,audience,client_ids:["web-client","cli-client"],max_token_age_seconds:900};
const adapter=()=>createOidcAuthAdapter(config,{keys,now:()=>now});
async function token(changes:Record<string,unknown>={},header:Record<string,unknown>={}) {
  return new SignJWT({iss:issuer,sub:"google-oauth2|synthetic",aud:audience,exp:seconds+300,iat:seconds,azp:"web-client",scope:"openid email certificates:manage",...changes})
    .setProtectedHeader({alg:"RS256",kid:"test-rsa",...header}).sign(pair.privateKey);
}
const request=(value:string)=>new Request("https://api-test.example.org/api/v1/publications",{headers:{Authorization:"Bearer "+value}});
it("verifies signed human access token and derives owner only from issuer/sub",async()=>{
  const a=adapter(),principal=await a.authenticate(request(await token({email:"alice@example.org"})));
  expect(principal).toEqual({subject:oidcOwnerId(issuer,"google-oauth2|synthetic"),scopes:["certificates:manage"],expires_at:(seconds+300)*1000,authentication_strength:"OIDC_ACCESS_TOKEN_VERIFIED"});
  expect(a.mode).toBe("test");
  const email=await a.authenticate(request(await token({email:"alice@example.org",sub:"email|synthetic"})));
  expect(email?.subject).not.toBe(principal?.subject);
  const changed=await a.authenticate(request(await token({email:"changed@example.org"})));
  expect(changed?.subject).toBe(principal?.subject);
});
it.each([
  {iss:"https://foreign.example.org/"},{aud:"web-client"},{exp:seconds-1},{iat:seconds-1000},{iat:seconds+100},{nbf:seconds+100},
  {scope:"openid email"},{scope:["certificates:manage"]},{azp:"foreign-client"},{sub:"machine@clients"},{gty:"client-credentials"},{sub:""},
  {exp:undefined},{iat:undefined},{azp:undefined}
])("rejects invalid claims %j",async changes=>{expect(await adapter().authenticate(request(await token(changes)))).toBeNull();});
it.each([{jku:"https://evil.example.org/keys"},{x5u:"https://evil.example.org/cert"},{jwk:{kty:"RSA"}},{kid:"unknown"}])("rejects header-selected trust %j",async header=>{
  expect(await adapter().authenticate(request(await token({},header)))).toBeNull();
});
it("rejects forged/unsigned/HS256 credentials and cookies without bearer credentials",async()=>{
  const a=adapter(),valid=await token(),parts=valid.split(".");
  parts[1]=Buffer.from(JSON.stringify({iss:issuer,sub:"admin",scope:"certificates:manage"})).toString("base64url");
  expect(await a.authenticate(request(parts.join(".")))).toBeNull();
  const hs=await new SignJWT({iss:issuer,sub:"fake",aud:audience,exp:seconds+300,iat:seconds,azp:"web-client",scope:"certificates:manage"}).setProtectedHeader({alg:"HS256",kid:"test-rsa"}).sign(new Uint8Array(32));
  expect(await a.authenticate(request(hs))).toBeNull();
  expect(await a.authenticate(request("eyJhbGciOiJub25lIn0.e30."))).toBeNull();
  expect(await a.authenticate(new Request("https://api-test.example.org/",{headers:{Cookie:"session="+valid}}))).toBeNull();
});
it("does not elevate operator scopes and separates local key injection from production",async()=>{
  const p=await adapter().authenticate(request(await token({scope:"certificates:manage certificates:operate"})));
  expect(p?.scopes).toEqual(["certificates:manage"]);
  expect(createOidcAuthAdapter(config).mode).toBe("production");
  expect(()=>createOidcAuthAdapter({...config,issuer:"http://localhost/"})).toThrow("INVALID_AUTH_CONFIGURATION");
  expect(()=>createOidcAuthAdapter({...config,client_ids:[]})).toThrow("INVALID_AUTH_CONFIGURATION");
});
