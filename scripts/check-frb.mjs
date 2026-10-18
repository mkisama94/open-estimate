import fs from 'node:fs/promises';
import { FrbProvider } from '../dist/profiles/frb.js';
const result = await new FrbProvider().get('JPY');
await fs.mkdir(new URL('../release/validation/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../release/validation/frb-live-check.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'AVAILABLE' || result.limitation_codes.length) process.exitCode = 1;
