import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { contrast, judgeAppearance, judgeBoundary } from '../src/pixel.js';
import { fixture, flat } from './helpers.js';

const gapsOf = (m, sc) => flat(m).filter((n) => (n.gaps || []).some((g) => g[1] === sc)).map((n) => n.name);

test('contrast: black on white is 21 : 1, equal colours 1 : 1', () => {
  assert.equal(Math.round(contrast([0, 0, 0], [255, 255, 255])), 21);
  assert.equal(contrast([9, 9, 9], [9, 9, 9]), 1);
});

test('judgeAppearance: pass at the area, review in the margin, gap clearly under', () => {
  const P = 400;
  assert.equal(judgeAppearance({ strong: 400, lenient: 400, perimeter: P }), 'pass');
  assert.equal(judgeAppearance({ strong: 300, lenient: 380, perimeter: P }), 'review');
  assert.equal(judgeAppearance({ strong: 100, lenient: 250, perimeter: P }), 'fail');
  assert.equal(judgeAppearance({ strong: 0, lenient: 0, perimeter: P }), 'fail');
});

test('judgeBoundary: 3 : 1 passes, 2.5 to 3 is review, under 2.5 is a gap, no sample is review', () => {
  assert.equal(judgeBoundary(3.2), 'pass');
  assert.equal(judgeBoundary(2.7), 'review');
  assert.equal(judgeBoundary(1.6), 'fail');
  assert.equal(judgeBoundary(null), 'review');
});

test('2.4.13: a 1 px or a faint ring is a gap, a 2 px black ring passes, a mid grey ring is review', async () => {
  const m = await generate(fixture('focus/appearance.html'));
  assert.deepEqual(gapsOf(m, '2.4.13').sort(), ['Faint', 'One px']);
  assert.equal(m.levels['2.4.13'], 'AAA');
  assert.ok(m.checks['2.4.13'].fail.includes('focus-appearance'));
  const note = m.notes.find((n) => n.startsWith('Focus appearance for a person'));
  assert.ok(note && note.includes('Middle grey') && !note.includes('Two px'), String(note));
});

test('1.4.11: a pale border, icon or icon-only link is a gap; a dark one passes; the check is never a pass', async () => {
  const m = await generate(fixture('focus/contrast.html'));
  assert.deepEqual(gapsOf(m, '1.4.11').sort(), ['Pale border', 'Pale icon', 'Pale link icon']);
  assert.equal(m.levels['1.4.11'], 'AA');
  assert.ok(m.checks['1.4.11'].fail.includes('focus-contrast'));
  assert.deepEqual(m.checks['1.4.11'].pass, []);
});

test('1.4.11: a page with no field and no icon button has no 1.4.11 check', async () => {
  const m = await generate(fixture('focus/target-pass.html'));
  assert.equal(m.checks['1.4.11'], undefined);
});

test('views: false takes no pixel measure', async () => {
  const m = await generate(fixture('focus/appearance.html'), { views: false });
  assert.equal(m.checks['2.4.13'], undefined);
  assert.equal(m.checks['1.4.11'], undefined);
});

test('2.4.13: a focus ring cut off by the window edge or a clipping box is a gap that names the cause', async () => {
  const m = await generate(fixture('focus/cut.html'));
  assert.deepEqual(gapsOf(m, '2.4.13').sort(), ['Clipped button', 'Edge link']);
  const why = (name) => flat(m).find((n) => n.name === name).gaps.find((g) => g[1] === '2.4.13')[0];
  assert.match(why('Edge link'), /^The focus outline is cut off by the left edge of the window: \d+ of \d+ px² show\. Draw it inside the control \(a negative outline-offset\)\.$/);
  assert.match(why('Clipped button'), /^The focus outline is cut off by section\.box \(overflow\): \d+ of \d+ px² show\. Draw it inside the control \(a negative outline-offset\)\.$/);
  const note = m.notes.find((n) => n.startsWith('Focus appearance for a person')) || '';
  assert.ok(!note.includes('inset'), note);
});

test('2.4.13: the window edge is not a cause when the page can scroll that way', async () => {
  const m = await generate(fixture('focus/cut-scroll.html'));
  const why = flat(m).find((n) => n.name === 'No ring low')?.gaps?.find((g) => g[1] === '2.4.13')?.[0] || '';
  assert.ok(!/cut off by the bottom edge/.test(why), why);
});
