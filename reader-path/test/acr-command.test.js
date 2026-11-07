import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { loadCatalog } from '../src/acr.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const fx = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const FAIL = fx('model-fail.json');
const PASS = fx('model-pass.json');
const tmp = () => mkdtempSync(join(tmpdir(), 'reader-path-'));

async function acr(args, out = join(tmp(), 'r.yaml')) {
  const r = await run('node', [CLI, 'acr', ...args, '--out', out]);
  return { stdout: r.stdout, report: yaml.load(readFileSync(out, 'utf8')), text: readFileSync(out, 'utf8') };
}
const row = (report, chapter, num) => report.chapters[chapter].criteria.find((r) => r.num === num);
const AA = 'success_criteria_level_aa';

test('two models give a report that loads, with catalog nums and levels', async () => {
  const { report } = await acr([FAIL, PASS]);
  const catalog = loadCatalog();
  const nums = new Set(catalog.chapters.flatMap((c) => c.criteria.map((x) => String(x.id))));
  const terms = new Set(['supports', 'partially-supports', 'does-not-support', 'not-applicable', 'not-evaluated']);
  assert.equal(report.catalog, '2.5-edition-wcag-2.2-508-en');
  assert.match(report.report_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(report.evaluation_methods_used, /reader-path 0\.1\.0.*axe-core 4\.\d+\.\d+.*Chromium 140.*2 page/s);
  const rows = Object.values(report.chapters).flatMap((c) => c.criteria);
  assert.ok(rows.length > 80);
  for (const r of rows) {
    assert.ok(nums.has(r.num), r.num);
    assert.ok(terms.has(r.components[0].adherence.level), r.num);
  }
  assert.equal(row(report, AA, '1.4.3').components[0].adherence.level, 'partially-supports');
  assert.equal(row(report, 'success_criteria_level_a', '1.1.1').components[0].adherence.level, 'supports');
});

test('a title with YAML syntax reads back the same', async () => {
  const { report } = await acr([FAIL]);
  const notes = row(report, AA, '1.4.3').components[0].adherence.notes;
  assert.ok(notes.split('\n').includes('https://x.test/bad: - [x]: #y: Contrast is too low'));
});

test('without --base: placeholders and a line to fill them', async () => {
  const { report, stdout } = await acr([PASS]);
  assert.equal(report.title, 'Accessibility Conformance Report (draft)');
  assert.equal(report.product.name, 'PRODUCT NAME');
  assert.equal(report.author.email, 'AUTHOR EMAIL');
  assert.match(stdout, /fill title, product\.name and author\.email/);
  assert.match(stdout, /wrote .*r\.yaml/);
  assert.match(stdout, /\d+ A and AA rows still not-evaluated \(a report cannot be published with them\)/);
});

test('the printed count matches the not-evaluated A and AA rows', async () => {
  const { report, stdout } = await acr([PASS]);
  const n = ['success_criteria_level_a', AA].flatMap((c) => report.chapters[c].criteria)
    .filter((r) => r.components[0].adherence.level === 'not-evaluated').length;
  assert.ok(n > 0);
  assert.ok(stdout.includes(`${n} A and AA rows still not-evaluated`));
});

test('base rows win, and a contradiction is printed', async () => {
  const { report, stdout } = await acr([FAIL, '--base', fx('acr-base.yaml')]);
  assert.equal(report.title, 'Example product ACR');
  assert.equal(report.product.name, 'Example');
  assert.doesNotMatch(stdout, /fill title/);
  const r = row(report, AA, '1.4.3');
  assert.equal(r.components[0].adherence.level, 'supports');
  assert.equal(r.components[0].adherence.notes, 'Checked by hand.');
  assert.ok(stdout.split('\n').includes('base row 1.4.3: supports; new evidence: partially-supports'));
  assert.equal(report.chapters[AA].notes, 'Kept as is.');
  assert.equal(report.chapters.hardware.criteria[0].num, '402');
  assert.ok(report.chapters[AA].criteria.length > 5);
});

test('no contradiction line when the evidence agrees', async () => {
  const { stdout } = await acr([PASS, '--base', fx('acr-base.yaml')]);
  assert.doesNotMatch(stdout, /new evidence/);
});

test('a base evaluation_methods_used is kept', async () => {
  const base = join(tmp(), 'b.yaml');
  writeFileSync(base, 'title: T\nproduct: { name: P }\nauthor: { email: a@b.test }\nevaluation_methods_used: By hand.\n');
  const { report } = await acr([PASS, '--base', base]);
  assert.equal(report.evaluation_methods_used, 'By hand.');
});

test('a model without checks stops the command', async () => {
  const old = fx('model-old.json');
  await assert.rejects(run('node', [CLI, 'acr', old, '--out', join(tmp(), 'r.yaml')]), (e) => {
    assert.equal(e.code, 1);
    assert.equal(e.stderr.trim(), `reader-path: model has no checks; run reader-path again: ${old}`);
    return true;
  });
});

test('acr needs a model and --out', async () => {
  await assert.rejects(run('node', [CLI, 'acr', PASS]), (e) => e.code === 1 && /usage: reader-path acr/.test(e.stderr));
  await assert.rejects(run('node', [CLI, 'acr', '--out', join(tmp(), 'r.yaml')]), (e) => e.code === 1 && /usage: reader-path acr/.test(e.stderr));
});
