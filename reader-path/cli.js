#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
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

const usage = (text) => Object.assign(new Error(text), { usage: true });

function loadModel(f) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { throw new Error(`cannot read ${f}`); }
  let m;
  try { m = JSON.parse(text); } catch { m = null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error(`not a model file: ${f}`);
  if (!m.checks) throw new Error(`model has no checks; run reader-path again: ${f}`);
  return m;
}

function loadBase(f, yaml) {
  // The core schema has no timestamps: a date stays the text it was.
  const base = yaml.load(readFileSync(f, 'utf8'), { schema: yaml.CORE_SCHEMA }) ?? {};
  if (typeof base !== 'object' || Array.isArray(base)) throw new Error(`base is not a YAML mapping: ${f}`);
  const mapping = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (base.chapters != null && !mapping(base.chapters)) throw new Error(`chapters is not a mapping: ${f}`);
  for (const [id, chapter] of Object.entries(base.chapters ?? {})) {
    if (!mapping(chapter)) throw new Error(`chapter is not a mapping: ${id} in ${f}`);
    const rows = chapter.criteria;
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new Error(`criteria is not a list: ${id} in ${f}`);
    const seen = new Set();
    for (const r of rows) {
      if (!mapping(r)) throw new Error(`criteria row is not a mapping: ${id} in ${f}`);
      const num = String(r.num);
      if (seen.has(num)) throw new Error(`base has two rows for ${num} in ${id}`);
      seen.add(num);
    }
  }
  return base;
}

async function writeAcr(files, { base, out }) {
  // Loaded here, so a run that hands over to Bun does not load them.
  const { default: yaml } = await import('js-yaml');
  const { buildReport, dump, loadCatalog } = await import('./src/acr.js');
  // A file given twice, in any spelling, is one page.
  const seen = new Set();
  files = files.filter((f) => !seen.has(resolve(f)) && seen.add(resolve(f)));
  const models = files.map(loadModel);
  const own = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const axe = createRequire(import.meta.url)('axe-core/package.json');
  const d = new Date();
  const date = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-');
  const loaded = base ? loadBase(base, yaml) : null;
  const { report, conflicts, pending, automated } = buildReport(models, loaded, loadCatalog(), { version: own.version, axe: axe.version, date });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, dump(report));
  console.log(`wrote ${out}`);
  conflicts.forEach((x) => console.log(x));
  const said = (m, start) => m.notes?.some?.((x) => String(x).startsWith(start));
  models.forEach((m, i) => {
    if (said(m, 'axe-core did not run')) console.log(`${files[i]}: axe-core did not run on this page; its rows need a person`);
    if (said(m, 'axe not added to frame')) console.log(`${files[i]}: axe-core did not check a frame on this page; its rows need a person`);
  });
  if (!Object.keys(loaded ?? {}).length) console.log('fill title, product.name and author.email before the report is used');
  const rows = (n) => (n === 1 ? 'row' : 'rows');
  console.log(`${pending} A and AA ${rows(pending)} still not-evaluated (a report cannot be published with them)`);
  console.log(`${automated} ${rows(automated)} proposed supports from automated rules only; a person confirms them`);
}

async function writePage(url, values) {
  const { generate, pageUrl } = await import('./src/generate.js');
  const { render } = await import('./src/render.js');
  const out = values.out ?? 'reader-path-out';
  const settle = values.settle === undefined ? undefined : Number(values.settle);
  if (settle !== undefined && !(Number.isInteger(settle) && settle >= 0)) {
    throw new Error('--settle takes a whole number of milliseconds');
  }
  const model = await generate(pageUrl(url), {
    storageState: values['storage-state'],
    ignoreHTTPSErrors: values['ignore-https-errors'],
    waitFor: values['wait-for'],
    settle,
  });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'model.json'), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(join(out, 'index.html'), render(model));
  console.log(`wrote ${join(out, 'index.html')} and ${join(out, 'model.json')}`);
}

try {
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
    if (positionals.length < 2 || !values.out) throw usage(USAGE);
    await writeAcr(positionals.slice(1), values);
  } else {
    if (positionals.length !== 1) throw usage(USAGE);
    await writePage(positionals[0], values);
  }
} catch (e) {
  console.error(`reader-path: ${e.usage ? e.message : String(e.message).split(/\r?\n/)[0]}`);
  process.exit(1);
}
