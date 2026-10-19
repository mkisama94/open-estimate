import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const target = path.resolve(repo, 'dist');
if (path.dirname(target) !== repo || path.basename(target) !== 'dist') throw new Error('UNSAFE_BUILD_PATH');
try {
  if ((await fs.lstat(target)).isSymbolicLink() || await fs.realpath(target) !== target) throw new Error('UNSAFE_BUILD_PATH');
  await fs.rm(target, { recursive: true, force: true });
} catch (e) { if (e.code !== 'ENOENT') throw e; }
