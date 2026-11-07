import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { generate } from '../src/generate.js';
import { RUN_ONLY } from '../src/axe.js';
import { render } from '../src/render.js';
import { fixture, flat } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'reader-path-'));
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

// Runs axe-core on the page as it is now. The arrow layer is hidden first:
// axe counts it as an overlap and then cannot measure the text below it.
// Returns the A/AA violations, and the contrast checks inside the map that
// axe could not finish. The open/close glyphs are icons, not text (axe:
// nonBmp); their colour is checked as a graphic, so they are left out.
async function check(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (runOnly) => {
    document.getElementById('svg').style.display = 'none';
    const r = await axe.run(document, { runOnly });
    document.getElementById('svg').style.display = '';
    const aa = /^wcag(2|21|22)a{1,2}$/;
    return {
      violations: r.violations.filter((v) => v.tags.some((t) => aa.test(t)))
        .flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`)),
      unfinished: r.incomplete.filter((v) => v.id === 'color-contrast')
        .flatMap((v) => v.nodes.filter((n) => n.any.every((c) => c.data?.messageKey !== 'nonBmp')
          && document.querySelector('#map').contains(document.querySelector(n.target[0])))
          .map((n) => n.target.join(' '))),
    };
  }, RUN_ONLY);
}

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

test('the review page has no A/AA gaps in two views and both themes', async () => {
  const file = join(tmp(), 'index.html');
  writeFileSync(file, render(await generate(fixture('gaps.html'))));
  const browser = await chromium.launch();
  try {
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ colorScheme, bypassCSP: true });
      await page.goto(pathToFileURL(file).href);
      assert.deepEqual(await check(page), { violations: [], unfinished: [] }, `${colorScheme}, Structure`);
      await page.getByRole('button', { name: 'Gaps', exact: true }).click();
      await page.getByRole('button', { name: /^Level AAA/ }).click();
      await page.locator('#map .n .pick').filter({ hasText: 'image' }).first().click();
      assert.ok((await page.locator('#det').innerText()).includes('1.1.1'));
      assert.deepEqual(await check(page), { violations: [], unfinished: [] }, `${colorScheme}, Gaps`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
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
