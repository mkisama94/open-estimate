import { it,expect,vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { withQuality } from "../fixtures/quality.js";
import { generatedRules, measurementRegistry, skillRegistry } from "../fixtures/measurement.js";
import { saveRun,readRun } from "../../src/local/runs.js";
import { readCertificateSubmission,certificateSubmissionsRoot } from "../../src/local/certificate-submissions.js";
import { sha256Hex } from "../../src/core/canonical.js";
import { createApprovedDraft, createSignedObject } from "../../src/core/certificate.js";
import { createCertificateSigner, base64url } from "../../src/web/signing.js";

it("P3 real CLI prepares durable private input, preserves old run and refuses network until auth is connected",async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"oes-cert-cli-"));vi.stubEnv("OES_RUNS_ROOT",path.join(temp,"runs"));
  try {
    const a=withQuality();
    const run=await saveRun(a,a,{ruleset_ref:generatedRules.ruleset_ref,bundle:generatedRules.bundle},path.join(temp,"project"));
    const before=await fs.readFile(path.join(run.run_directory,"checksums.json"));
    const cli=(command:string,value:unknown)=>spawnSync(process.execPath,["dist/local/cli.js",command],{input:JSON.stringify(value),encoding:"utf8",windowsHide:true,env:process.env});
    const result=cli("prepare-certificate",{run_id:run.run_id,metadata:{title:"合成プロジェクト",description:null,publisher_label:null,scope_note:null,project_url:null,model_label:null}});
    expect(result.status,result.stdout+result.stderr).toBe(0);const output=JSON.parse(result.stdout);
    expect(output).toMatchObject({status:"PREPARED",saved:true,transmitted:false,published:false});
    const saved=await readCertificateSubmission(output.submission_id);
    expect(saved.nonce).toHaveLength(43);expect(saved.frozen_input.model.version).toBe("oes/remote-model/v1");
    expect(result.stdout).not.toContain(saved.nonce);expect(result.stdout).not.toContain(saved.idempotency_key);
    expect(sha256Hex(await fs.readFile(path.join(run.run_directory,"checksums.json")))).toBe(sha256Hex(before));await readRun(run.run_id);
    const request=cli("publish-certificate",{submission_id:output.submission_id,approval_receipt_id:"PRIVATE_RECEIPT"});expect(request.status).toBe(1);expect(request.stdout).toContain("AUTH_CONSENT_NOT_READY");expect(request.stdout).not.toContain("PRIVATE_RECEIPT");
    const now=Date.now(),key=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]),key_id="key_test_"+"1".repeat(32);
    const draft=createApprovedDraft(saved.frozen_input,saved.nonce,saved.metadata,{origin:"https://test.example.org",environment:"test",certificate_id:"cert_"+"2".repeat(32),share_id:"sh_"+"3".repeat(32),status_generation:"sg_"+"4".repeat(32),engine:{engine_version:"test",artifact_sha256:"5".repeat(64)},now},{skills:skillRegistry(saved.frozen_input.skill_integrity),rules:measurementRegistry(),now});
    const signer=await createCertificateSigner(base64url(new Uint8Array(await crypto.subtle.exportKey("pkcs8",key.privateKey))));
    const envelope=await signer(createSignedObject(draft,key_id,now));
    const certificate_path=path.join(temp,"certificate.json"),trusted_keys_path=path.join(temp,"trusted-keys.json");
    await fs.writeFile(certificate_path,JSON.stringify(envelope));
    await fs.writeFile(trusted_keys_path,JSON.stringify([{key_id,algorithm:"Ed25519",public_key:base64url(new Uint8Array(await crypto.subtle.exportKey("raw",key.publicKey))),issuer_origin:"https://test.example.org",deployment_environment:"test"}]));
    const verified=cli("verify-certificate",{certificate_path,trusted_keys_path,submission_id:output.submission_id});expect(verified.status,verified.stdout+verified.stderr).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({verification:{signature:"VALID",hash:"MATCH",current_status:"NOT_CHECKED"},reproduction:{commitment:"MATCH",calculation:"MATCH"},network_used:false});
    const file=path.join(certificateSubmissionsRoot(),output.submission_id,"submission.json");await fs.appendFile(file," ");
    await expect(readCertificateSubmission(output.submission_id)).rejects.toThrow("INVALID_SUBMISSION");
  } finally {vi.unstubAllEnvs();await fs.rm(temp,{recursive:true,force:true});}
},30000);
