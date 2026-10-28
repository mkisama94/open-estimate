import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateRules, buildRulesHistory } from './build-measurement-rules.mjs';
import { resolveMeasurementRules } from '../dist/remote/measurement-rules.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const repo = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
const output = process.argv[2] ?? 'release/local-marketplace';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'oes-desktop-smoke-'));
const plugin = path.join(temp, 'relocated plugin');
try {
  await fs.cp(path.join(repo, output, 'plugins/open-estimate'), plugin, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(plugin, '.codex-plugin/plugin.json')));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.requires_local_executor, true);
  const mcp = JSON.parse(await fs.readFile(path.join(plugin, '.mcp.json'))).mcpServers['open-estimate'];
  assert.deepEqual(mcp, { type: 'http', url: 'https://open-estimate.ai-orchestration.jp/mcp' });
  const localMcp=JSON.parse(await fs.readFile(path.join(plugin,'.mcp.json'))).mcpServers['open-estimate-local'];
  assert.deepEqual(localMcp,{type:'stdio',command:'node',args:['./server/dist/index.js'],cwd:'.'});
  const run = (command, input) => {
    const child = spawnSync(process.execPath, [path.join(plugin, 'skills/open-estimate-assessor/scripts/oes.mjs'), command], {
      cwd: temp, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, OES_HELPER_STATE: path.join(temp, 'state'), OES_RUNS_ROOT: path.join(temp, 'runs'), OES_WORKFLOWS_ROOT:path.join(temp,'workflows') }, windowsHide: true
    });
    assert.equal(child.status, 0, child.stdout + child.stderr); return JSON.parse(child.stdout);
  };
  const contract = run('contract', {});
  assert.equal(run('skill-integrity', {}).skill_version, pkg.version);
  assert.equal(contract.workspace_root, null);
  assert.equal(contract.skill.skill_version, pkg.version);
  assert.equal(contract.capabilities.immutable_local_runs, true);
  assert.equal(contract.capabilities.quality_records, 'oes/quality-records/v1');
  assert.equal(contract.capabilities.run_comparison_format, 'oes/run-comparison/v2');
  const root = path.join(temp, 'sample-project'); await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'main.js'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, '.env'), 'CANARY=do-not-read\n');
  await fs.copyFile(path.join(repo, 'examples/quality-check/notes.js'), path.join(root, 'notes.js'));
  const scan = run('scan', { root }), common = { root, session_id: scan.session_id };
  assert.equal(scan.summary.source_content_read, false);
  const actual = run('skill-integrity', {});
  const { format, ...release } = actual;
  const rules = await buildRulesHistory({ format: 'oes/measurement-rules-registry/v1', rules_enforcement_at: null, current_revision: null, revisions: [] }, await generateRules(repo));
  const response = resolveMeasurementRules({ skill_integrity: actual, client_protocol: contract.measurement_client_protocol }, rules,
    { policy_version: 'oes/skill-integrity-policy/v1', enforcement_at: null, releases: [{ ...release, publication: 'candidate', acceptance: 'accepted', measurement_client_protocol: contract.measurement_client_protocol }] });
  run('bind-rules', { ...common, rules_response: response });
  const start=run('show-estimate-start',{...common,display_currency:'USD'});
  assert.deepEqual(start.initial_selection,{read:false,verify:false,publish:false});
  run('start-estimate-workflow',{...common,workflow_id:start.workflow_id,terms_hash:start.terms_hash,selection:{read:true,verify:false,publish:false},explicit_answer:'[合成スモーク] ローカル解析だけで開始'});
  const prepared = run('prepare', common);
  assert.equal(prepared.manifest.files.find(f => f.path === '.env').disposition, 'excluded');
  const read = run('read', { ...common, snapshot_id: prepared.snapshot_id, file_id: 'main.js' });
  assert.equal(read.content, '1: export const value = 1;');
  run('read', { ...common, snapshot_id: prepared.snapshot_id, file_id: 'notes.js' });
  const a = JSON.parse(await fs.readFile(path.join(repo, 'examples/recorded-assessment.json'), 'utf8'));
  a.assessment_id = prepared.assessment_id; a.input = prepared.assessment_input;
  a.assessor = { ...prepared.assessor_defaults, finished_at: new Date().toISOString() };
  a.components[0].path_prefixes = ['notes.js'];
  a.scope_record.files = a.input.manifest.files.map(f => ({ path:f.path, membership:f.path==='notes.js'?'included':f.path==='main.js'?'supporting':'outside',
    reason:'Explicit sample scope', confirmation_ref:a.scope_record.confirmations[0].confirmation_id, evidence_refs:[] }));
  a.evidence[0] = {...a.evidence[0],file_path:'notes.js',line_start:5,line_end:14};
  a.evidence[1] = {...a.evidence[1],file_path:'notes.js',line_start:16,line_end:21};
  for (const j of a.judgments) j.rule = {source:'skill',id:response.bundle.rule_ids[0],version:response.ruleset_ref.revision};
  a.quality = {version:'oes/quality-records/v1',scope_rules:[
    {rule_id:'notes',path_prefix:'notes.js',membership:'included',reason:'Notes implementation'},
    {rule_id:'main',path_prefix:'main.js',membership:'supporting',reason:'Sample constant'},
    {rule_id:'secret',path_prefix:'.env',membership:'outside',reason:'Excluded secret configuration'}],
    limitations:a.input.acquisition.issues.map(i=>({...i,impact:'outside',rule_id:'secret',reason:'Secret file outside declared implementation scope',missing:null})),
    boundaries:a.functional_processes.map(p=>({process_id:p.process_id,rerun:'no',rerun_basis:'One HTTP request',continuation:'no',continuation_reason:'Independent user request',queues:[]})),
    attributes:a.data_groups.map(g=>({data_group_id:g.data_group_id,mappings:g.attributes.map(attribute=>({attribute,implementation:'notes.'+attribute,evidence_refs:[a.evidence[0].evidence_id]}))})),findings:[]};
  const exported = run('export', {...common,snapshot_id:prepared.snapshot_id,assessment:a});
  assert.equal(exported.local.summary.measurement.cfp,6);
  run('purge', common);
  assert.equal(run('show-run',{run_id:exported.local.run_id}).summary.measurement.cfp,6);
  const comparison = run('compare-runs',{before_run_id:exported.local.run_id,after_run_id:exported.local.run_id,
    process_changes:[],movement_changes:[],prior_information_consulted:true});
  assert.equal(comparison.summary.format,'oes/run-comparison/v2');
  assert.equal(comparison.summary.identity.find(x=>x.key==='scope').status,'SAME');
  assert.equal(comparison.summary.identity.find(x=>x.key==='source_content').status,'UNKNOWN'); // Excluded .env has no content hash.
  const workflow=run('complete-estimate-workflow',{workflow_id:start.workflow_id,run_id:exported.local.run_id});
  assert.equal(workflow.result.schema_version,'oes/estimate-result/v1');assert.equal(workflow.pdf_status,'READY');assert.equal(workflow.proof_status,'NOT_SELECTED');assert.equal(workflow.publication,null);
  const preview=run('create-document',{run_id:exported.local.run_id,display_currency:'USD'});
  assert.equal(preview.status,'DOCUMENT_READY');assert.equal((await fs.readFile(preview.pdf)).subarray(0,5).toString(),'%PDF-');
  const client=new Client({name:'relocated-local-result',version:'1'},{capabilities:{}});
  const configuredLaunch={command:localMcp.command,args:localMcp.args,cwd:path.resolve(plugin,localMcp.cwd??'.')};
  await client.connect(new StdioClientTransport({...configuredLaunch,env:{...process.env,OES_RUNS_ROOT:path.join(temp,'runs'),OES_WORKFLOWS_ROOT:path.join(temp,'workflows')}}));
  try{const card=await client.callTool({name:'show_document',arguments:{document_dir:preview.dir}});assert.notEqual(card.isError,true);assert.equal(card.structuredContent.document_sha256,preview.document_sha256);
    const resource=await client.readResource({uri:card._meta.ui.resourceUri});assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
    const pdf=await client.callTool({name:'get_document_pdf',arguments:{document_dir:preview.dir}});assert.equal(Buffer.from(pdf._meta.file_base64,'base64').subarray(0,5).toString(),'%PDF-');
    const result=await client.callTool({name:'show_estimate_workflow',arguments:{workflow_id:start.workflow_id}});assert.notEqual(result.isError,true);assert.equal(result.structuredContent.presentation.median,'18');
    const newPdf=await client.callTool({name:'get_estimate_workflow_pdf',arguments:{workflow_id:start.workflow_id}});assert.equal(Buffer.from(newPdf._meta.file_base64,'base64').subarray(0,5).toString(),'%PDF-');
  }finally{await client.close();}
  console.log(JSON.stringify({ status: 'PASS', configured_launch:configuredLaunch, declared_cwd:localMcp.cwd, actual_host_tool_exposure:false, relocated_package: true, immutable_run_after_purge:true,local_result_card:true,local_pdf:true,workflow_start_and_completion:true,unselected_remote_sends:0, version: manifest.version }));
} finally { await fs.rm(temp, { recursive: true, force: true }); }
