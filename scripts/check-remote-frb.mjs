// Send only the repository's synthetic numeric fixture, never local source.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { projectModel } from '../dist/remote/model.js';
import { Decimal } from 'decimal.js';

const endpoint = new URL(process.argv[2] ?? 'http://127.0.0.1:8791/mcp');
const local = ['127.0.0.1', 'localhost'].includes(endpoint.hostname);
assert.ok(local || endpoint.protocol === 'https:');
assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
const fixture = JSON.parse(await fs.readFile(new URL('../examples/basic-assessment.json', import.meta.url), 'utf8'));
const client = new Client({ name: 'oes-frb-runtime-check', version: '0.4.1' });
try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  await client.listTools();
  const result = await client.callTool({ name: 'evaluate_model', arguments: { model: projectModel(fixture), display_currency: 'JPY' } });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const { report, display_quote: quote } = result.structuredContent;
  const summary = { endpoint: endpoint.href, checked_at: new Date().toISOString(), synthetic_fixture: true,
    cfp: report.measurement.cfp, median_hours: report.effort.person_hours?.median,
    median_usd: report.reference_usd.amount_usd?.median, fx_status: quote.localized_reference.status,
    median_jpy: quote.localized_reference.amount?.median ?? null, fx_snapshot: quote.fx_snapshot,
    limitation_codes: quote.limitation_codes };
  const dir = new URL('../release/validation/', import.meta.url);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(new URL(`frb-mcp-${local ? 'local' : 'remote'}-check.json`, dir), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(summary.cfp, 6);
  assert.equal(summary.median_hours, '18');
  assert.equal(summary.median_usd, '900');
  assert.equal(summary.fx_status, 'AVAILABLE');
  assert.ok(!quote.limitation_codes.includes('FX_CACHE_AFTER_FAILURE'));
  assert.equal(summary.median_jpy, new Decimal('900').mul(quote.fx_snapshot.currency_per_usd).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed());
} finally { await client.close(); }
