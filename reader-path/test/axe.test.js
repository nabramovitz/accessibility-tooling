import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { axeToGaps, axeContrast } from '../src/axe.js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fixture, flat } from './helpers.js';

test('axeToGaps maps tags to criterion and level', () => {
  const g = axeToGaps({ violations: [{ id: 'image-alt', help: 'Images must have alternative text',
    tags: ['wcag2a', 'wcag111', 'section508'], nodes: [{ target: ['img'], failureSummary: 'Fix: add alt' }] }] });
  assert.deepEqual(g, [{ target: ['img'], sc: '1.1.1', level: 'A', why: 'Fix: add alt', goal: 'Images must have alternative text', row: 'name' }]);
});

test('wcag1410 becomes 1.4.10', () => {
  const g = axeToGaps({ violations: [{ id: 'x', help: 'h', tags: ['wcag21aa', 'wcag1410'],
    nodes: [{ target: ['a'], failureSummary: 's' }] }] });
  assert.equal(g[0].sc, '1.4.10');
  assert.equal(g[0].level, 'AA');
  assert.equal('row' in g[0], false);
});

test('axeContrast reads passes, violations and incomplete', () => {
  const r = { id: 'color-contrast', nodes: [{ target: ['p'], any: [{ message: 'm', data: { contrastRatio: 4.5, fgColor: '#000', bgColor: '#fff' } }] }] };
  const inc = { id: 'color-contrast', nodes: [{ target: ['q'], any: [{ message: 'unknown bg', data: {} }] }] };
  const c = axeContrast({ violations: [], passes: [r], incomplete: [inc] });
  assert.deepEqual(c, [
    { target: ['p'], ratio: 4.5, fg: '#000', bg: '#fff' },
    { target: ['q'], ratio: null, note: 'unknown bg' },
  ]);
});

test('gaps are placed on their nodes', async () => {
  const m = await generate(fixture('gaps.html'));
  const all = flat(m);
  const img = all.find((n) => n.role === 'image' && n.gaps?.some((g) => g[1] === '1.1.1'));
  assert.ok(img);
  assert.notEqual(img, m.root);
  assert.equal(img.gaps.find((g) => g[1] === '1.1.1')[3], 'name');
  const btn = all.find((n) => n.role === 'button' && n.gaps?.some((g) => g[1] === '4.1.2'));
  assert.ok(btn);
  assert.equal(m.levels['1.1.1'], 'A');
});

test('contrast values are on text nodes', async () => {
  const all = flat(await generate(fixture('gaps.html')));
  const grey = all.find((n) => n.text === 'Grey text');
  const black = all.find((n) => n.text === 'Black text');
  assert.ok(Math.abs(grey.contrast.ratio - 2.85) < 0.02); // axe truncates 2.848 to 2.84
  assert.equal(black.contrast.ratio, 21);
});

// axe-core reaches into a frame only on an http origin, not file://
test('an unplaced target goes on the root', async () => {
  const html = readFileSync(new URL('./fixtures/gaps.html', import.meta.url));
  const srv = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
  await new Promise((r) => srv.listen(0, r));
  try {
    const m = await generate(`http://localhost:${srv.address().port}/`);
    assert.ok(m.root.gaps.some((g) => g[0].startsWith('not placed: iframe > button')));
  } finally {
    srv.close();
  }
});
