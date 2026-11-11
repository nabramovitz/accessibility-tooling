import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture, flat } from './helpers.js';

const gapsOf = (m, sc) => flat(m).filter((n) => (n.gaps || []).some((g) => g[1] === sc)).map((n) => n.name);

test('a control that looks the same with and without focus is a 2.4.7 gap', async () => {
  const m = await generate(fixture('focus/visible.html'));
  assert.deepEqual(gapsOf(m, '2.4.7'), ['No indicator']);
  assert.equal(m.levels['2.4.7'], 'AA');
  assert.ok(m.checks['2.4.7'].fail.includes('focus-visible'));
  // An empty text field shows a caret only; the shot hides it, so a person looks.
  assert.ok(m.notes.includes('Focus not compared at 1 Tab stop(s): Empty field'));
});

test('every control with a visible change: 2.4.7 and 2.4.11 pass', async () => {
  const m = await generate(fixture('tab.html'));
  assert.deepEqual(m.checks['2.4.7'].pass, ['focus-visible']);
  assert.deepEqual(m.checks['2.4.7'].fail, []);
  assert.deepEqual(m.checks['2.4.11'].pass, ['focus-obscured']);
  assert.deepEqual(m.checks['2.4.12'].pass, ['focus-obscured']);
});

test('a focused control under a fixed bar: all of it is 2.4.11, a part is 2.4.12', async () => {
  const m = await generate(fixture('focus/obscured.html'));
  assert.deepEqual(gapsOf(m, '2.4.11'), ['Fully covered']);
  assert.deepEqual(gapsOf(m, '2.4.12').sort(), ['Fully covered', 'Half covered']);
  assert.equal(m.levels['2.4.11'], 'AA');
  assert.equal(m.levels['2.4.12'], 'AAA');
  assert.ok(m.checks['2.4.11'].fail.includes('focus-obscured'));
  assert.ok(m.checks['2.4.12'].fail.includes('focus-obscured'));
  const under = flat(m).find((n) => n.name === 'Fully covered');
  assert.match(under.gaps.find((g) => g[1] === '2.4.11')[0], /footer/);
});

test('the focus measures stop after 150 Tab stops, with a note and review', async () => {
  const m = await generate(fixture('many.html'));
  assert.ok(m.notes.includes('Focus measures stopped at 150 Tab stops; the rest not measured'));
  assert.deepEqual(m.checks['2.4.7'].review, ['focus-visible']);
  assert.deepEqual(m.checks['2.4.11'].review, ['focus-obscured']);
});

test('a Tab stop under 44 px is a 2.5.5 gap; a link in text and a labelled native box go to a person', async () => {
  const m = await generate(fixture('focus/target.html'));
  assert.deepEqual(gapsOf(m, '2.5.5'), ['Small']);
  const small = flat(m).find((n) => n.name === 'Small');
  assert.match(small.gaps.find((g) => g[1] === '2.5.5')[0], /20 × 20 px/);
  assert.equal(m.levels['2.5.5'], 'AAA');
  assert.ok(m.checks['2.5.5'].fail.includes('focus-target'));
  assert.ok(m.notes.includes('Target size for a person at 2 Tab stop(s): Help, Agree'));
});

test('every Tab stop 44 px or more: 2.5.5 passes', async () => {
  const m = await generate(fixture('focus/target-pass.html'));
  assert.deepEqual(m.checks['2.5.5'].pass, ['focus-target']);
});

test('views: false takes no focus measure', async () => {
  const m = await generate(fixture('focus/visible.html'), { views: false });
  assert.equal(m.checks['2.4.7'], undefined);
});
