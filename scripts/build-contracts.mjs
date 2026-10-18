import fs from 'node:fs';
const old = JSON.parse(fs.readFileSync(new URL('../contracts/oes-ph1.schema.json', import.meta.url), 'utf8'));
const report = structuredClone(old.definitions.Report);
for (const key of ['generated_at', 'localized_reference']) {
  delete report.properties[key]; report.required = report.required.filter(k => k !== key);
}
report.properties.domain.const = 'open-estimate/report/ph1/v3';
report.properties.calculation_basis_hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
report.required.push('calculation_basis_hash');
const string = { type: 'string' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const nullable = value => ({ anyOf: [value, { type: 'null' }] });
const q = nullable(obj({ p25: string, median: string, p75: string }));
const fx = nullable(obj({ currency: string, source_url: { const: 'https://www.federalreserve.gov/releases/h10/current/' }, source_sha256: hash,
  observed_on: string, published_on: string, fetched_at: string, checked_at: string, raw_value: string,
  quote_direction: { enum: ['currency_per_usd', 'usd_per_currency'] }, currency_per_usd: string }));
const quote = obj({ domain: { const: 'open-estimate/display-quote/v1' }, source_report_hash: hash,
  conversion_policy_version: { const: 'frb-display-time-v1' }, displayed_at: string, locale: string, display_currency: string,
  fx_snapshot: fx, localized_reference: obj({ status: { enum: ['AVAILABLE','UPSTREAM_UNAVAILABLE','FX_UNAVAILABLE','FX_STALE'] },
    currency: string, currency_per_usd: nullable(string), amount: q }), person_days: q, limitation_codes: { type: 'array', items: string } });
const view = obj({ evaluation_id: string, assessment_id: string, evaluated_at: string,
  report: { $ref: '#/$defs/Report' }, report_hash: hash, basis: { type: 'object' }, display_quote: { $ref: '#/$defs/DisplayQuote' },
  review: { type: 'object' }, storage: { const: 'LOCAL_ONLY' }, signed: { const: false }, published: { const: false },
  notices: { type: 'array', items: string }, input_reconciled: { type: 'boolean' } });
view.required = view.required.filter(k => k !== 'input_reconciled');
const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Open Estimate local preview 0.3.0',
  $defs: { Assessment: old.definitions.Assessment, Report: report, DisplayQuote: quote, EvaluationView: view } };
fs.writeFileSync(new URL('../contracts/local-preview.schema.json', import.meta.url), JSON.stringify(schema, null, 2)+'\n');
const { remoteArgsSchema } = await import('../dist/remote/model.js');
fs.writeFileSync(new URL('../contracts/remote-model.schema.json', import.meta.url), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Open Estimate remote model v1', ...remoteArgsSchema
}, null, 2)+'\n');
