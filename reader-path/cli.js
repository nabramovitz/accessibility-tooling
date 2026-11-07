#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBun, runBun } from './src/bun.js';

// Under Node.js, when `bun --version` works, this file runs itself again
// with Bun and exits as that run exits. That run gets one argument, the
// token below, and the real arguments as JSON in READER_PATH_ARGV, so no
// shell reads them on the way. Only a Bun run with the token as its one
// argument reads the variable, and a run with the token does not look
// for Bun again. Any other READER_PATH_ARGV is dropped.
const ARGV = 'READER_PATH_ARGV';
const TOKEN = '--args-from-env';
const argv = process.argv.slice(2);
const token = argv.length === 1 && argv[0] === TOKEN;
const passed = process.versions.bun && token ? process.env[ARGV] : undefined;
delete process.env[ARGV];

if (!process.versions.bun && !token) {
  const bun = findBun();
  if (bun) {
    // Ctrl+C reaches both runs. This one waits for the Bun run to close
    // its browser, then exits as it did.
    const wait = () => {};
    process.on('SIGINT', wait);
    process.on('SIGTERM', wait);
    const r = runBun(bun, [fileURLToPath(import.meta.url), TOKEN], {
      stdio: 'inherit',
      env: { ...process.env, [ARGV]: JSON.stringify(argv) },
    });
    process.off('SIGINT', wait);
    process.off('SIGTERM', wait);
    if (!r.error) {
      if (r.signal) process.kill(process.pid, r.signal);
      process.exit(r.status ?? 1);
    }
  }
}

const USAGE = 'usage: reader-path <url> [--out <dir>] [--storage-state <file>] [--ignore-https-errors]'
  + ' [--wait-for <selector>] [--settle <ms>]\n'
  + '       reader-path acr <model.json>... [--base <yaml>] --out <file.yaml>';
const ACR_USAGE = 'usage: ' + USAGE.split('\n')[1].trim();

async function writeAcr(files, { base, out }) {
  const { default: yaml } = await import('js-yaml');
  const { buildReport, dump, loadCatalog } = await import('./src/acr.js');
  const models = files.map((f) => {
    const m = JSON.parse(readFileSync(f, 'utf8'));
    if (!m.checks) throw new Error(`model has no checks; run reader-path again: ${f}`);
    return m;
  });
  const own = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const axe = JSON.parse(readFileSync(new URL('./node_modules/axe-core/package.json', import.meta.url), 'utf8'));
  const d = new Date();
  const date = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-');
  const { report, conflicts, pending } = buildReport(models, base ? yaml.load(readFileSync(base, 'utf8')) : null,
    loadCatalog(), { version: own.version, axe: axe.version, date });
  writeFileSync(out, dump(report));
  console.log(`wrote ${out}`);
  conflicts.forEach((c) => console.log(c));
  if (!base) console.log('fill title, product.name and author.email before the report is used');
  console.log(`${pending} A and AA rows still not-evaluated (a report cannot be published with them)`);
}

try {
  // Loaded here, so a run that hands over to Bun does not load them.

  const { values, positionals } = parseArgs({
    args: passed === undefined ? argv : JSON.parse(passed),
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      base: { type: 'string' },
      'storage-state': { type: 'string' },
      'ignore-https-errors': { type: 'boolean' },
      'wait-for': { type: 'string' },
      settle: { type: 'string' },
    },
  });
  if (positionals[0] === 'acr') {
    if (positionals.length < 2 || !values.out) throw new Error(ACR_USAGE);
    await writeAcr(positionals.slice(1), values);
    process.exit(0);
  }
  if (positionals.length !== 1) throw new Error(USAGE);
  const { generate, pageUrl } = await import('./src/generate.js');
  const { render } = await import('./src/render.js');
  const out = values.out ?? 'reader-path-out';
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
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'model.json'), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(join(out, 'index.html'), render(model));
  console.log(`wrote ${join(out, 'index.html')} and ${join(out, 'model.json')}`);
} catch (e) {
  console.error(`reader-path: ${String(e.message).split(/\r?\n/)[0]}`);
  process.exit(1);
}
