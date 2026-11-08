import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { generate } from '../src/generate.js';
import { RUN_ONLY } from '../src/axe.js';
import { render } from '../src/render.js';
import { findBun, runBun } from '../src/bun.js';
import { fixture, flat } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'reader-path-'));
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// The node that runs cli.js in the cli tests, found once, before a
// test changes the PATH. Under bun test, process.execPath is Bun.
const NODE = process.versions.bun
  ? execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
  : process.execPath;

// Runs axe-core on the page as it is now. The arrow layer is hidden first:
// axe counts it as an overlap and then cannot measure the text below it.
// Returns the A/AA violations and the AAA 1.4.6 ones (text 7 to 1, large
// text 4.5 to 1), and the contrast checks inside the map that axe could
// not finish. The open/close glyphs are icons, not text (axe: nonBmp);
// their colour is checked as a graphic, so they are left out.
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

test('the review page is a model of itself without A/AA or 1.4.6 gaps', async () => {
  const file = join(tmp(), 'index.html');
  writeFileSync(file, render(await generate(fixture('structure.html'))));
  const m = await generate(pathToFileURL(file).href);
  const all = flat(m);
  const bad = all.flatMap((n) => (n.gaps || []).map((g) => [n.name || n.role, g[1], g[2]]))
    .filter((g) => ['A', 'AA'].includes(m.levels[g[1]]) || g[1] === '1.4.6');
  assert.deepEqual(bad, []);
  assert.ok(all.some((n) => n.lm === 'main'));
  assert.equal(all.filter((n) => n.h === 1).length, 1);
});

test('the review page has no A/AA or 1.4.6 gaps in two views and both themes', async () => {
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

// Every colour pair of the review page, painted by the browser in both
// themes. Text needs 7 to 1 (1.4.6; all text on the page is small).
// Borders, outlines, the focus mark and the arrows need 3 to 1 (1.4.11);
// axe-core has no rule for these. The Tab order line is drawn at the
// opacity the page uses.
test('review page colours: text 7 to 1, graphics 3 to 1, both themes', async () => {
  const file = join(tmp(), 'index.html');
  writeFileSync(file, render({ url: 'file:///x', title: 'T', notes: [], root: { id: 'r', t: 'Page', comp: 'RootWebArea', role: 'RootWebArea', c: [] } }));
  const lineOpacity = Number(readFileSync(new URL('../review/template.html', import.meta.url), 'utf8')
    .match(/stroke="var\(--line\)"[^>]*opacity="([\d.]+)"/)[1]);
  const browser = await chromium.launch();
  try {
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ colorScheme });
      await page.goto(pathToFileURL(file).href);
      const low = await page.evaluate((lineOpacity) => {
        const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
        const css = getComputedStyle(document.documentElement);
        // The colour of a token as the browser paints it, with an alpha
        // over a backdrop: [r, g, b] in sRGB.
        const paint = (token, alpha = 1, under) => {
          if (under) { ctx.globalAlpha = 1; ctx.fillStyle = css.getPropertyValue(`--${under}`); ctx.fillRect(0, 0, 1, 1); }
          ctx.globalAlpha = alpha; ctx.fillStyle = css.getPropertyValue(`--${token}`); ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        };
        const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const surfaces = ['bg', 'bg2', 'sel'];
        const pairs = [];
        for (const fg of ['fg', 'mut', 'acc', 'err']) for (const bg of surfaces) pairs.push([`${fg} on ${bg}`, paint(fg), paint(bg), 7]);
        for (const bg of ['acc', 'err', 'warn', 'aaa']) pairs.push([`bg on ${bg}`, paint('bg'), paint(bg), 7]);
        for (const g of ['bd', 'dimbd', 'acc', 'err', 'warn', 'fg', 'mut']) for (const bg of surfaces) pairs.push([`${g} on ${bg}`, paint(g), paint(bg), 3]);
        for (const bg of surfaces) pairs.push([`line on ${bg}`, paint('line', lineOpacity, bg), paint(bg), 3]);
        return pairs.map(([name, a, b, need]) => [name, +ratio(a, b).toFixed(2), need]).filter(([, r, need]) => r < need);
      }, lineOpacity);
      assert.deepEqual(low, [], colorScheme);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

// The other review page tests open the page with this CSP in force.
test('the review page has a strict CSP', () => {
  const html = render({ url: 'file:///x', title: 'T', notes: [], root: { id: 'r', t: 'Page', comp: 'RootWebArea', role: 'RootWebArea', c: [] } });
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">`));
});

test('review page: depth buttons, summary, only the chosen level, empty views, contrast', async () => {
  const model = {
    url: 'file:///x', title: 'T', generated: '2026-01-01T00:00:00.000Z', notes: [], levels: { '1.4.3': 'AA', '1.4.6': 'AAA' },
    root: { id: 'r', t: 'Page', comp: 'RootWebArea', role: 'RootWebArea', name: 'Page', c: [
      { id: 'p', t: 'Panel', comp: 'region', role: 'region', name: 'Panel', lm: 'region', text: 'Panel text',
        contrast: { ratio: 4.5, fg: '#767676', bg: '#ffffff' }, gaps: [['low contrast', '1.4.3', '4.5 to 1']], c: [
          { id: 'b', t: 'Go', comp: 'button', role: 'button', name: 'Go', tab: 1, gaps: [['low contrast', '1.4.6', '7 to 1']], c: [] },
        ] },
    ] },
  };
  const file = join(tmp(), 'index.html');
  writeFileSync(file, render(model));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    assert.deepEqual(await page.locator('#levels button').allInnerTexts(), ['Depth 1', 'Depth 2', 'Depth 3', 'Depth 4', 'All']);
    // The drill down bar marks the chosen depth like the other bars do.
    assert.equal(await page.locator('#levels button[aria-pressed=true]').innerText(), 'Depth 3');
    await page.getByRole('button', { name: 'Depth 1', exact: true }).click();
    assert.equal(await page.locator('#levels button[aria-pressed=true]').innerText(), 'Depth 1');
    // The summary counts the model, and each level's new boxes.
    assert.deepEqual(await page.locator('#sumc dt').allTextContents(), ['boxes', 'Tab stops', 'headings', 'landmarks', 'message boxes', 'contrast measured']);
    assert.deepEqual(await page.locator('#sumc dd').allInnerTexts(), ['3', '1', '0', '1', '0', '1']);
    assert.equal(await page.locator('#sumg caption').innerText(), 'Gaps: 2 gaps in 2 boxes');
    // Columns: gaps at the level, boxes the level adds, boxes that need work up to the level.
    assert.deepEqual(await page.locator('#sumg tbody tr').allInnerTexts(), ['Level A\t0\t0\t0', 'Level AA\t1\t1\t1', 'Level AAA\t1\t1\t2', 'our rule\t0\t0\t2']);
    assert.equal(await page.locator('#sumn').innerText(), 'Shown now: 1 gap in 1 box.');
    // Level AAA includes AA; "Only the chosen level" leaves AA out.
    await page.getByRole('button', { name: /^Level AAA/ }).click();
    assert.equal(await page.locator('#sumn').innerText(), 'Shown now: 2 gaps in 2 boxes.');
    await page.getByRole('button', { name: 'Only the chosen level', exact: true }).click();
    assert.equal(await page.locator('#goal button[data-only]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#sumn').innerText(), 'Shown now: 1 gap in 1 box.');
    await page.getByRole('button', { name: 'Gaps', exact: true }).click();
    assert.deepEqual(await page.locator('#map .hasgap .t').allInnerTexts(), ['Go']);
    await page.getByRole('button', { name: 'Only the chosen level', exact: true }).click();
    await page.getByRole('button', { name: /^Level AA / }).click();
    for (const view of ['Actions and results', 'Messages']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      assert.equal(await page.locator('#empty').innerText(), `${view}: none in this model.`);
      assert.equal(await page.locator('#map').isVisible(), false);
    }
    await page.getByRole('button', { name: 'Structure', exact: true }).click();
    assert.equal(await page.locator('#empty').isVisible(), false);
    await page.locator('#map .pick').filter({ hasText: 'Panel' }).first().click();
    assert.ok((await page.locator('#det').innerText()).includes('4.50 to 1 (#767676 on #ffffff)'));
  } finally {
    await browser.close();
  }
});

test('cli writes model.json and index.html', () => {
  const out = join(tmp(), 'out');
  execFileSync(NODE, [CLI, fixture('structure.html'), '--out', out]);
  assert.ok(existsSync(join(out, 'index.html')));
  assert.equal(JSON.parse(readFileSync(join(out, 'model.json'), 'utf8')).title, 'Fixture');
  assert.ok(readFileSync(join(out, 'index.html'), 'utf8').includes('Reader path model: Fixture'));
});

// A stand-in bun at the start of the PATH, for the cli tests: it answers
// --version as told, logs a run and hands the run to node, with
// process.versions.bun set, so cli.js takes it for a Bun run. On Windows
// it is bun.cmd, and the PATH loses each directory with a real bun.exe,
// as that is found before a .cmd file. Node is started by its full path,
// so the PATH does not matter for it.
function standInBun(works) {
  const dir = tmp();
  const bin = join(dir, 'bin');
  const log = join(dir, 'log');
  const asBun = join(dir, 'as-bun.mjs');
  mkdirSync(bin);
  writeFileSync(asBun, "Object.defineProperty(process.versions, 'bun', { value: '1.4.4', enumerable: true });\n");
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  let path = (env[key] || '').split(delimiter);
  if (process.platform === 'win32') {
    const bat = (s) => s.replace(/%/g, '%%');
    writeFileSync(join(bin, 'bun.cmd'), [
      '@echo off',
      `if "%~1"=="--version" exit /b ${works ? 0 : 1}`,
      `echo run>>"${bat(log)}"`,
      `"${bat(NODE)}" --import "${bat(pathToFileURL(asBun).href)}" %*`,
    ].join('\r\n') + '\r\n');
    path = path.filter((d) => d && !existsSync(join(d, 'bun.exe')));
  } else {
    writeFileSync(join(bin, 'bun'), [
      '#!/bin/sh',
      `if [ "$1" = --version ]; then exit ${works ? 0 : 1}; fi`,
      `echo run >> '${log}'`,
      `exec '${NODE}' --import '${pathToFileURL(asBun).href}' "$@"`,
    ].join('\n') + '\n', { mode: 0o755 });
  }
  env[key] = [bin, ...path].join(delimiter);
  const runs = () => (existsSync(log) ? readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).length : 0);
  return { dir, env, runs };
}

const title = (out) => JSON.parse(readFileSync(join(out, 'model.json'), 'utf8')).title;

// cli.js runs itself again with Bun when `bun --version` works, else it
// goes on with Node.js. The output directory name has characters that
// a shell would read (and a Windows file name can hold), so it shows
// the arguments reach the Bun run as they are.
test('cli runs with bun when bun works, else with node', () => {
  for (const works of [true, false]) {
    const { dir, env, runs } = standInBun(works);
    const out = join(dir, "out & (more) %PATH% $HOME ^!'");
    execFileSync(NODE, [CLI, fixture('structure.html'), '--out', out], { env, stdio: 'pipe' });
    assert.equal(title(out), 'Fixture');
    assert.equal(runs(), works ? 1 : 0, works ? 'bun works: bun runs it once' : 'bun fails: node runs it');
  }
});

// On Windows the path of cli.js goes through cmd.exe to reach bun.cmd.
// A copy of the command in a directory whose name cmd would read shows
// the path arrives as it is; x is set, so %x% would change if expanded.
test('cli hands over to bun from a path that cmd.exe would read', () => {
  const { dir, env, runs } = standInBun(true);
  const app = join(dir, 'R&D^%x%');
  for (const f of ['cli.js', 'package.json', 'src', 'review']) cpSync(join(ROOT, f), join(app, f), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(app, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const out = join(dir, 'out');
  execFileSync(NODE, [join(app, 'cli.js'), fixture('structure.html'), '--out', out], { env: { ...env, x: 'EXPANDED' }, stdio: 'pipe' });
  assert.equal(title(out), 'Fixture');
  assert.equal(runs(), 1);
});

// A READER_PATH_ARGV left in the environment is not the arguments, under
// Node.js, under the hand-over to Bun, and under a real Bun if found.
test('cli ignores a READER_PATH_ARGV it did not set', () => {
  for (const stale of ['[]', 'oops']) {
    for (const works of [true, false]) {
      const { dir, env, runs } = standInBun(works);
      const out = join(dir, 'out');
      execFileSync(NODE, [CLI, fixture('structure.html'), '--out', out], { env: { ...env, READER_PATH_ARGV: stale }, stdio: 'pipe' });
      assert.equal(title(out), 'Fixture', `${stale}, bun ${works ? 'works' : 'fails'}`);
      assert.equal(runs(), works ? 1 : 0);
    }
    const bun = findBun();
    if (bun) {
      const out = join(tmp(), 'out');
      const r = runBun(bun, [CLI, fixture('structure.html'), '--out', out], { env: { ...process.env, READER_PATH_ARGV: stale }, stdio: 'pipe' });
      assert.equal(r.status, 0, String(r.stderr));
      assert.equal(title(out), 'Fixture', `${stale}, real bun`);
    }
  }
});

test('cli under bun exits as the bun run exits', () => {
  const { env, runs } = standInBun(true);
  assert.throws(() => execFileSync(NODE, [CLI, fixture('late.html'), '--settle', 'soon'], { env, stdio: 'pipe' }),
    (e) => e.status === 1 && /--settle/.test(e.stderr) && e.stderr.toString().trim().split(/\r?\n/).length === 1);
  assert.equal(runs(), 1);
});

test('cli exits 1 with the two usage lines when no url is given', () => {
  assert.throws(() => execFileSync(NODE, [CLI], { stdio: 'pipe' }), (e) => e.status === 1 && e.stderr.toString().trim().split(/\r?\n/).length === 2);
});
