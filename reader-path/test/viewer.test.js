import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { generate } from '../src/generate.js';
import { RUN_ONLY } from '../src/axe.js';
import { renderViewer } from '../src/render.js';
import { fixture } from './helpers.js';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const VIEWER = fileURLToPath(new URL('../viewer/index.html', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'reader-path-viewer-'));

// Same check as the review page test: A/AA violations and 1.4.6, with
// the arrow layer hidden and the unfinished contrast checks in the map.
async function check(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (runOnly) => {
    document.getElementById('svg').style.display = 'none';
    const r = await axe.run(document, { runOnly });
    document.getElementById('svg').style.display = '';
    const aa = /^wcag(2|21|22)a{1,2}$/;
    const contrast = ['color-contrast', 'color-contrast-enhanced'];
    return {
      violations: r.violations.filter((v) => v.tags.some((t) => aa.test(t)) || v.tags.includes('wcag146'))
        .flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`)),
      unfinished: r.incomplete.filter((v) => contrast.includes(v.id))
        .flatMap((v) => v.nodes.filter((n) => n.any.every((c) => c.data?.messageKey !== 'nonBmp')
          && document.querySelector('#map').contains(document.querySelector(n.target[0])))
          .map((n) => `${v.id} ${n.target.join(' ')}`)),
    };
  }, RUN_ONLY);
}

const modelFile = async (name, mutate = (m) => m) => {
  const file = join(tmp(), name);
  // These tests are about a model with no proposals (the text pass would add one).
  const { proposals, ...model } = await generate(fixture('gaps.html'));
  writeFileSync(file, JSON.stringify(mutate(model)));
  return file;
};

test('the committed viewer is what renderViewer writes, with no model in it', () => {
  const html = readFileSync(VIEWER, 'utf8');
  assert.equal(html, renderViewer());
  assert.ok(!html.includes('type="application/json"'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!/fetch\(|XMLHttpRequest/.test(html));
});

test('the viewer says no model is loaded, then shows the summary of a dropped file', async () => {
  const file = await modelFile('model.json');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(VIEWER).href);
    assert.match(await page.locator('#loadmsg').innerText(), /No model loaded/);
    assert.equal(await page.locator('#loadmsg').getAttribute('role'), 'status');
    assert.equal(await page.locator('#sumc').isVisible(), false);
    // Keyboard: the file chooser is the first and only Tab stop.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'file');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.tagName === 'BUTTON' || document.activeElement.id === 'file'), false);

    await page.setInputFiles('#file', file);
    await page.locator('#sumc').waitFor();
    const tiles = await page.locator('#sumc div').evaluateAll((d) => d.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    assert.ok(tiles.some((t) => /^boxes \d+$/i.test(t)), tiles.join('|'));
    assert.match(await page.locator('#loadmsg').innerText(), /Loaded model\.json/);
    assert.match(await page.locator('h1').innerText(), /Reader path model:/);

    // Tab order with a model: the chooser first, then the path buttons.
    await page.evaluate(() => document.activeElement.blur());
    const stops = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); stops.push(await page.evaluate(() => document.activeElement.id || document.activeElement.textContent.trim())); }
    assert.deepEqual(stops, ['file', 'Structure', 'Reading order']);

    // A second model replaces the first: no duplicated buttons.
    await page.setInputFiles('#file', file);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#modes button').count(), 8);
  } finally {
    await browser.close();
  }
});

test('a file that is not a model gives a plain message and the viewer keeps working', async () => {
  const dir = tmp();
  const bad = {
    'text.json': 'this is not json',
    'array.json': '[1,2,3]',
    'old.json': readFileSync(fileURLToPath(new URL('./fixtures/model-pass.json', import.meta.url)), 'utf8'),
    'node.json': JSON.stringify({ root: { id: 'r', t: 'x', comp: 'a', c: [5] } }),
    'gaps.json': JSON.stringify({ root: { id: 'r', t: 'x', comp: 'a', gaps: 'no' } }),
  };
  const good = await modelFile('ok.json');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(VIEWER).href);
    for (const [name, body] of Object.entries(bad)) {
      writeFileSync(join(dir, name), body);
      await page.setInputFiles('#file', join(dir, name));
      await page.waitForFunction((n) => document.getElementById('loadmsg').textContent.includes(n), name);
      assert.match(await page.locator('#loadmsg').innerText(), /is not a reader path model/, name);
      assert.equal(await page.locator('#sumc').isVisible(), false, name);
    }
    await page.setInputFiles('#file', good);
    await page.locator('#sumc').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('page text in a model is never run in the viewer', async () => {
  const evil = '<img src=x onerror="window.hit=1"></script><b id="x">';
  const file = await modelFile('evil.json', (m) => { m.title = evil; m.notes = [evil]; m.root.t = evil; return m; });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(VIEWER).href);
    await page.setInputFiles('#file', file);
    await page.locator('#sumc').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.hit), undefined);
    assert.equal(await page.evaluate(() => document.getElementById('x')), null);
    assert.ok((await page.locator('#map').innerText()).includes(evil));
    assert.ok((await page.locator('h1').innerText()).includes(evil));
  } finally {
    await browser.close();
  }
});

test('the viewer with no model and with a model has no A/AA or 1.4.6 gaps, both themes', async () => {
  const file = await modelFile('model.json');
  const browser = await chromium.launch();
  try {
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ colorScheme, bypassCSP: true });
      await page.goto(pathToFileURL(VIEWER).href);
      assert.deepEqual(await check(page), { violations: [], unfinished: [] }, `${colorScheme}, empty`);
      await page.setInputFiles('#file', file);
      await page.locator('#sumc').waitFor();
      assert.deepEqual(await check(page), { violations: [], unfinished: [] }, `${colorScheme}, Structure`);
      await page.getByRole('button', { name: 'Gaps', exact: true }).click();
      await page.getByRole('button', { name: /^Level AAA/ }).click();
      assert.deepEqual(await check(page), { violations: [], unfinished: [] }, `${colorScheme}, Gaps`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
