import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { generate } from '../src/generate.js';
import { render } from '../src/render.js';
import { fixture, flat } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'reader-path-'));
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));

test('page text is never run', async () => {
  const evil = '<img src=x onerror="window.hit=1"></script><b id="x">';
  const model = {
    url: 'file:///x', title: 'T', generated: '2026-01-01T00:00:00.000Z', notes: [evil],
    root: { id: 'r', t: 'Page', comp: 'RootWebArea', role: 'RootWebArea', name: 'Page', c: [
      { id: 'b', t: evil, comp: 'button', role: 'button', name: evil, tab: 1, c: [] },
    ] },
  };
  const file = join(tmp(), 'index.html');
  writeFileSync(file, render(model));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.hit), undefined);
    assert.equal(await page.evaluate(() => document.getElementById('x')), null);
    assert.ok((await page.locator('#map').innerText()).includes(evil));
  } finally {
    await browser.close();
  }
});

test('the review page is a model of itself without A/AA gaps', async () => {
  const file = join(tmp(), 'index.html');
  writeFileSync(file, render(await generate(fixture('structure.html'))));
  const m = await generate(pathToFileURL(file).href);
  const all = flat(m);
  const bad = all.flatMap((n) => (n.gaps || []).map((g) => [n.name || n.role, g[1], g[2]]))
    .filter((g) => ['A', 'AA'].includes(m.levels[g[1]]));
  assert.deepEqual(bad, []);
  assert.ok(all.some((n) => n.lm === 'main'));
  assert.equal(all.filter((n) => n.h === 1).length, 1);
});

test('cli writes model.json and index.html', () => {
  const out = join(tmp(), 'out');
  execFileSync('node', [CLI, fixture('structure.html'), '--out', out]);
  assert.ok(existsSync(join(out, 'index.html')));
  assert.equal(JSON.parse(readFileSync(join(out, 'model.json'), 'utf8')).title, 'Fixture');
  assert.ok(readFileSync(join(out, 'index.html'), 'utf8').includes('Reader path model: Fixture'));
});

test('cli exits 1 with one line when no url is given', () => {
  assert.throws(() => execFileSync('node', [CLI], { stdio: 'pipe' }), (e) => e.status === 1 && e.stderr.toString().trim().split('\n').length === 1);
});
