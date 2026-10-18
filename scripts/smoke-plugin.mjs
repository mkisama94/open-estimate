import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(repo, 'release/local-marketplace/plugins/open-estimate');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'oes-plugin-smoke-'));
const plugin = path.join(temporary, 'installed-plugin');
await fs.cp(source, plugin, { recursive: true });
const mcp = JSON.parse(await fs.readFile(path.join(plugin, '.mcp.json'), 'utf8')).mcpServers['open-estimate'];
const output = path.join(repo, 'release', 'validation');
await fs.mkdir(output, { recursive: true });
const fixture = JSON.parse(await fs.readFile(path.join(repo, 'examples/basic-assessment.json'), 'utf8'));
const env = { ...process.env, ...mcp.env, OES_WORKSPACE_ROOT: repo, OES_STATE_DIR: path.join(temporary, 'state'), OES_CACHE_ROOT: path.join(temporary, 'source-cache') };
async function connect() {
  const transport = new StdioClientTransport({ command: mcp.command, args: mcp.args.map(a => a.replaceAll('${PLUGIN_ROOT}', plugin)), cwd: plugin, env, stderr: 'pipe' });
  const client = new Client({ name: 'oes-package-smoke', version: '0.2.0' });
  await client.connect(transport);
  await client.listTools(); // register output validators, as a real host does
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}
let first, second;
try {
  first = await connect();
  const contract = await call(first, 'get_assessor_contract');
  assert.equal(contract.workspace_root, null);
  const discovery = await call(first, 'discover_workspace', { context_path: repo });
  await call(first, 'confirm_workspace', { candidate_id: discovery.candidate_id, user_confirmed: true });
  const prep = await call(first, 'prepare_repository', { relative_path: 'examples/quality-check' });
  for (const file of prep.manifest.files) if (file.disposition !== 'excluded') {
    let start = 1;
    while (start !== null) {
      const chunk = await call(first, 'read_repository_file', { snapshot_id: prep.snapshot_id, file_id: file.path, start_line: start });
      start = chunk.next_start_line;
    }
  }
  const assessment = structuredClone(fixture);
  assessment.assessment_id = prep.assessment_id;
  assessment.assessor = { ...prep.assessor_defaults, finished_at: new Date().toISOString() };
  assessment.input = prep.assessment_input;
  assessment.components[0].path_prefixes = ['notes.js'];
  assessment.data_groups[0].attributes = ['id', 'title', 'content'];
  assessment.functional_processes[1].movements.find(m => m.type === 'Exit').data_group_id = 'dg-note';
  assessment.evidence[0] = { ...assessment.evidence[0], file_path: 'notes.js', line_start: 5, line_end: 14 };
  assessment.evidence[1] = { ...assessment.evidence[1], file_path: 'notes.js', line_start: 16, line_end: 21 };
  const view = await call(first, 'evaluate_assessment', { snapshot_id: prep.snapshot_id, assessment: JSON.stringify(assessment), display_currency: 'USD' });
  assert.equal(view.report.measurement.cfp, 6);
  assert.equal(view.report.effort.person_hours.median, '18');
  assert.equal(view.report.reference_usd.amount_usd.median, '900');
  assert.equal(view.signed, false);
  await first.close(); first = undefined;
  second = await connect();
  const secondDiscovery = await call(second, 'discover_workspace', { context_path: repo });
  await call(second, 'confirm_workspace', { candidate_id: secondDiscovery.candidate_id, user_confirmed: true });
  const reopened = await call(second, 'get_evaluation', { evaluation_id: view.evaluation_id, display_currency: 'USD' });
  assert.equal(reopened.report_hash, view.report_hash);
  const html = await call(second, 'render_report', { evaluation_id: view.evaluation_id, display_currency: 'JPY' });
  await fs.writeFile(path.join(output, 'local-preview-smoke.html'), (await fs.readFile(html.path, 'utf8')).replace('<main>', '<main><p>自動検証用サンプル。評価IDの保存記録は検証終了後に削除されています。</p>'));
  const evidence = { checked_at: new Date().toISOString(), isolated_install: true, restarted_server: true,
    cfp: view.report.measurement.cfp, median_person_hours: view.report.effort.person_hours.median,
    reference_usd: view.report.reference_usd.amount_usd.median, report_hash: view.report_hash,
    display_quote: html.display_quote, report_path: path.join(output, 'local-preview-smoke.html'),
    note: 'Hand-authored Assessment against real sample source; not a model extraction or desktop UI installation test.' };
  await fs.writeFile(path.join(output, 'plugin-smoke.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await first?.close(); await second?.close();
  const resolved = path.resolve(temporary);
  // Verify the exact generated temporary directory before recursive cleanup.
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('oes-plugin-smoke-') || (await fs.lstat(resolved)).isSymbolicLink())
    throw new Error('Unsafe smoke cleanup path');
  await fs.rm(resolved, { recursive: true, force: true });
}
