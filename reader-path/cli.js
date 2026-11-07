#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBun, runBun } from './src/bun.js';

// Under Node.js, when `bun --version` works, this file runs itself again
// with Bun and exits as that run exits. The arguments go to that run as
// JSON in READER_PATH_ARGV, so no shell reads them on the way; the
// variable also tells that run not to look for Bun again.
const ARGV = 'READER_PATH_ARGV';
if (!process.versions.bun && process.env[ARGV] === undefined) {
  const bun = findBun();
  if (bun) {
    const r = runBun(bun, [fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, [ARGV]: JSON.stringify(process.argv.slice(2)) },
    });
    if (!r.error) {
      if (r.signal) process.kill(process.pid, r.signal);
      process.exit(r.status ?? 1);
    }
  }
}

const USAGE = 'usage: reader-path <url> [--out <dir>] [--storage-state <file>] [--ignore-https-errors]'
  + ' [--wait-for <selector>] [--settle <ms>]';

try {
  // Loaded here, so a run that hands over to Bun does not load them.
  const { generate, pageUrl } = await import('./src/generate.js');
  const { render } = await import('./src/render.js');

  let args = process.argv.slice(2);
  if (process.env[ARGV] !== undefined) {
    args = JSON.parse(process.env[ARGV]);
    delete process.env[ARGV];
  }
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'reader-path-out' },
      'storage-state': { type: 'string' },
      'ignore-https-errors': { type: 'boolean' },
      'wait-for': { type: 'string' },
      settle: { type: 'string' },
    },
  });
  if (positionals.length !== 1) throw new Error(USAGE);
  const settle = values.settle === undefined ? undefined : Number(values.settle);
  if (settle !== undefined && !(Number.isInteger(settle) && settle >= 0)) {
    throw new Error('--settle takes a whole number of milliseconds');
  }
  const model = await generate(pageUrl(positionals[0]), {
    storageState: values['storage-state'],
    ignoreHTTPSErrors: values['ignore-https-errors'],
    waitFor: values['wait-for'],
    settle,
  });
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, 'model.json'), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(join(values.out, 'index.html'), render(model));
  console.log(`wrote ${join(values.out, 'index.html')} and ${join(values.out, 'model.json')}`);
} catch (e) {
  console.error(`reader-path: ${String(e.message).split(/\r?\n/)[0]}`);
  process.exit(1);
}
