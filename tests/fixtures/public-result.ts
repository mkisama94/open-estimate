import { randomUUID } from "node:crypto";
import { previewFixture } from "./owner-preview.js";
import { createApprovedDraft,createSignedObject,PRODUCTION_ORIGIN } from "../../src/core/certificate.js";
import { base64url,createCertificateSigner } from "../../src/web/signing.js";
export async function publicResultFixture(variant:"normal"|"partial"|"incomplete"="normal"){
  const f=previewFixture("https://public-fixture.example.org",variant),now=f.now.value;
  const key=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
  const key_id="key_prod_"+"7".repeat(32),generation=f.config.generation,share="sh_"+"8".repeat(32);
  const signer=await createCertificateSigner(base64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8",key.privateKey))));
  const trusted={key_id,algorithm:"Ed25519",public_key:base64url(new Uint8Array(await crypto.subtle.exportKey("raw",key.publicKey))),issuer_origin:PRODUCTION_ORIGIN,deployment_environment:"production",created_at:new Date(now).toISOString()};
  const draft=createApprovedDraft(f.body.frozen_input,f.body.nonce,{...f.body.metadata,title:"合成アプリの公開結果",description:"公開結果画面を検証するための合成データです。実プロジェクトの見積りではありません。"},{origin:PRODUCTION_ORIGIN,environment:"production",certificate_id:"cert_"+"9".repeat(32),share_id:share,status_generation:generation,engine:f.config.engine,now},f.config.catalog);
  const envelope=await signer(createSignedObject(draft,key_id,now));
  f.db.sqlite.prepare("INSERT INTO issuance_policy VALUES(1,0,?)").run(generation);
  f.db.sqlite.prepare("INSERT INTO signing_keys VALUES(?,'ACTIVE',?)").run(key_id,JSON.stringify(trusted));
  f.db.sqlite.prepare("INSERT INTO certificates VALUES(?,?,?,?,'ACTIVE',?,NULL)").run(draft.certificate_id,envelope.signed_object_hash,key_id,envelope.signed_object.issued_at,generation);
  f.db.sqlite.prepare("INSERT INTO publications VALUES(?,?,?,'PUBLIC',?)").run(share,draft.certificate_id,"PRIVATE_OWNER_CANARY",envelope.signed_object.issued_at);
  f.db.sqlite.prepare("INSERT INTO publication_contents VALUES(?,?)").run(share,JSON.stringify(envelope));
  const env={PUBLICATION_READ_ENABLED:"true",PUBLIC_STATUS_GENERATION:generation,PUBLIC_SIGNING_KEYS_JSON:JSON.stringify([trusted]),CERTIFICATES_DB:f.db,ASSETS:{fetch:async()=>new Response("STATIC_FALLBACK_CANARY")}};
  return {...f,env,envelope,trusted,share,requestId:randomUUID()};
}
