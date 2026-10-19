import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Invoked only after the explicit TypeScript compile stage (build:worker or build).
export async function generateRules(repo) {
  const { createRulesBundle } = await import('../dist/rules/measurement-contract.js');
  return createRulesBundle(await fs.readFile(path.join(repo, 'rules/measurement/source.md'), 'utf8'),
    JSON.parse(await fs.readFile(path.join(repo, 'rules/measurement/contract.json'), 'utf8')));
}
export async function buildRulesHistory(history, generated, action = {}) {
  const { validateRulesRegistry, assertCompatible } = await import('../dist/rules/measurement-contract.js');
  validateRulesRegistry(history);
  const next = structuredClone(history);
  if (action.withdraw || action.current) {
    if (action.withdraw) {
      const r = next.revisions.find(r => r.revision === action.withdraw);
      if (!r) throw new Error('RULESET_UNKNOWN');
      r.status = 'withdrawn';
    }
    if (action.current) next.current_revision = action.current;
  } else {
    assertCompatible(generated.bundle, 'oes/measurement-client/v1');
    const existing = next.revisions.find(r => r.revision === generated.ruleset_ref.revision);
    if (existing?.status === 'withdrawn') throw new Error('RULESET_WITHDRAWN');
    if (!existing) next.revisions.push({ revision: generated.ruleset_ref.revision, status: 'available', bundle: generated.bundle });
    next.current_revision = generated.ruleset_ref.revision;
  }
  validateRulesRegistry(next, true);
  return next;
}
export async function preserveRulesHistory(history, candidate) {
  const { validateRulesRegistry } = await import('../dist/rules/measurement-contract.js');
  validateRulesRegistry(history); validateRulesRegistry(candidate);
  if (history.rules_enforcement_at && history.rules_enforcement_at !== candidate.rules_enforcement_at) throw new Error('RULES_ENFORCEMENT_DATE_CHANGED');
  for (const old of history.revisions) {
    const r = candidate.revisions.find(r => r.revision === old.revision);
    if (!r || JSON.stringify(r.bundle) !== JSON.stringify(old.bundle) || (old.status === 'withdrawn' && r.status !== 'withdrawn')) throw new Error('RULES_HISTORY_LOST');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const generated = await generateRules(fileURLToPath(new URL('../', import.meta.url)));
  console.log(JSON.stringify({ ruleset_ref: generated.ruleset_ref, rule_ids: generated.bundle.rule_ids, utf8_bytes: Buffer.byteLength(generated.bundle.instructions_markdown) }));
}
