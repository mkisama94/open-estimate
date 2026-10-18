#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (Number(process.versions.node.split('.')[0]) < 24) {
  process.stderr.write('Node.js 24 or newer is required.\n'); process.exit(1);
}
const packaged = new URL('../../../server/dist/local/cli.js', import.meta.url);
const entry = existsSync(packaged) ? packaged : new URL('../../../dist/local/cli.js', import.meta.url);
const child = spawn(process.execPath, [fileURLToPath(entry), ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
child.on('error', () => { process.stderr.write('HELPER_START_FAILED\n'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
