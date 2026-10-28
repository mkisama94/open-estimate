import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore native deployment script
import {deploymentConfig,sha256,verifyBundle,checkPrerequisites,checkTarget,checkPublicationPrerequisites} from '../../scripts/ci-web.mjs';
it('requires publication auth settings and the direct-save migration before enabling deployment',()=>{
 const vars={ESTIMATE_PUBLICATION_ENABLED:'true',AUTH0_ISSUER:'https://auth.example/',AUTH0_API_AUDIENCE:'https://example/mcp',AUTH0_MCP_CLIENT_IDS:'host-client'};
 const tables=['saved_estimates','estimate_publications','operation_guards','browser_sessions','browser_login_transactions'].map(name=>({name}));
 expect(()=>checkPublicationPrerequisites(vars,tables)).not.toThrow();expect(()=>checkPublicationPrerequisites({},tables)).toThrow('ESTIMATE_PUBLICATION_DISABLED');expect(()=>checkPublicationPrerequisites({...vars,AUTH0_API_AUDIENCE:''},tables)).toThrow('MISSING_PUBLICATION_CONFIGURATION');expect(()=>checkPublicationPrerequisites(vars,[])).toThrow('MISSING_TABLE');
});

it('deploys the hashed bundle unchanged and rejects a replaced artifact',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'oes-web-build-'));
  try {
    const bundle=path.join(dir,'worker.js');await fs.writeFile(bundle,'export default {}');
    const config=deploymentConfig({name:'open-estimate',assets:{directory:'public'},d1_databases:[{migrations_dir:'migrations'}],vars:{OWNER_PREVIEW_GENERATION:'sg_'+'a'.repeat(32)}},dir,bundle,sha256(await fs.readFile(bundle)),'0.8.1');
    expect(config.no_bundle).toBe(true);
    expect(config.vars.OWNER_PREVIEW_ENABLED).toBe('true');
    expect(config.vars.ISSUANCE_ENABLED).toBe('false');
    expect(config.vars.PUBLICATION_READ_ENABLED).toBe('false');
    expect(config.assets.directory).toBe(path.join(dir,'public'));
    await expect(verifyBundle(config)).resolves.toBeUndefined();
    await fs.writeFile(bundle,'changed');
    await expect(verifyBundle(config)).rejects.toThrow('WEB_BUNDLE_CHANGED');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
it('refuses wrong Worker, missing secrets and missing migration tables',()=>{
  expect(()=>checkTarget({WRANGLER_CI_OVERRIDE_NAME:'open-estimate-mcp'})).toThrow('WRONG_WORKER');
  const secrets=['AUTH0_WEB_CLIENT_SECRET','BROWSER_SESSION_SECRET','PREVIEW_TRANSFER_CODE_SECRET'].map(name=>({name}));
  const tables=['preview_transfers','preview_transfer_consents','saved_estimates','operation_guards','certificate_previews'].map(name=>({name,sql:name==='preview_transfer_consents'?"CHECK(operation IN ('prepare_certificate_preview','prepare_estimate_preview'))":''}));
  expect(()=>checkPrerequisites(secrets,tables)).not.toThrow();
  expect(()=>checkPrerequisites(secrets,tables.map(t=>({...t,sql:''})))).toThrow('MISSING_MIGRATION:0006');
  expect(()=>checkPrerequisites(secrets.slice(0,2),tables)).toThrow('MISSING_SECRET:PREVIEW_TRANSFER_CODE_SECRET');
  expect(()=>checkPrerequisites(secrets,tables.filter(t=>t.name!=='saved_estimates'))).toThrow('MISSING_TABLE:saved_estimates');
});
