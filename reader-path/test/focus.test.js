import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { stopName } from '../src/focus.js';
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

// A change no pixel of which reaches 1.5 : 1 (a background a shade
// darker) is not one a person can be sure to see: not a pass.
test('a focus change too faint to see goes to a person for 2.4.7', async () => {
  const m = await generate(fixture('focus/faint.html'));
  assert.deepEqual(gapsOf(m, '2.4.7'), []);
  assert.deepEqual(m.checks['2.4.7'].review, ['focus-visible']);
  assert.ok(m.notes.includes('Focus change too faint to see for a person at 1 Tab stop(s): Faint change'), m.notes.join('\n'));
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

test('a skip link shown only with focus is compared; a stop scrolled out of view is not', async () => {
  const m = await generate(fixture('focus/skip.html'));
  assert.deepEqual(gapsOf(m, '2.4.7'), []);
  const note = m.notes.find((n) => n.startsWith('Focus not compared'));
  assert.ok(note && note.includes('Scroll A'), String(note));
  assert.ok(!note.includes('Skip to content'), note);
});

test('views: false takes no focus measure', async () => {
  const m = await generate(fixture('focus/visible.html'), { views: false });
  assert.equal(m.checks['2.4.7'], undefined);
});

test('a Tab stop with no name of its own is named by its role and the first name inside it', () => {
  assert.equal(stopName({ role: 'row', c: [{ role: 'cell', name: '', c: [] }, { role: 'cell', name: 'nodejs-sample', c: [] }] }), 'row "nodejs-sample"');
  assert.equal(stopName({ role: 'row', c: [] }), 'row');
  assert.equal(stopName({ role: 'button', name: 'Save', c: [] }), 'Save');
});

// The next Tab stop scrolls the window: the earlier stop moved but is
// still in view, so it is compared where it is now.
test('a stop moved by a scroll and still in view is compared where it is', async () => {
  const m = await generate(fixture('focus/scroll-shift.html'));
  assert.deepEqual(gapsOf(m, '2.4.7'), ['Plain moved']);
  assert.ok(!m.notes.some((n) => n.startsWith('Focus not compared')), m.notes.join('\n'));
});

// Rows that touch, each with three buttons: a row is compared once focus has
// left its surroundings, however many stops that takes.
test('rows that touch are compared once focus leaves them', async () => {
  const m = await generate(fixture('focus/rows.html'));
  assert.deepEqual(gapsOf(m, '2.4.7'), []);
  assert.ok(!m.notes.some((n) => n.startsWith('Focus not compared')), m.notes.join('\n'));
});
