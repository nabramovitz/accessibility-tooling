import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture, flat } from './helpers.js';

test('tab order follows the browser', async () => {
  const all = flat(await generate(fixture('tab.html')));
  const names = all.filter((n) => n.tab).sort((a, b) => a.tab - b.tab).map((n) => n.name);
  assert.deepEqual(names, ['Tab two', 'Link', 'Search', 'Shadow button']);
  assert.equal(all.find((n) => n.name === 'Tab two').tab, 1);
});

test('a focus that does not move is a gap', async () => {
  const m = await generate(fixture('trap.html'));
  assert.ok(m.root.gaps.some((g) => g[1] === '2.1.2'));
  assert.equal(m.levels['2.1.2'], 'A');
  assert.ok(m.notes.includes('Tab walk stopped: focus did not move'));
});

test('a focus loop that skips the start is a gap', async () => {
  const m = await generate(fixture('trap-loop.html'));
  assert.ok(m.root.gaps.some((g) => g[1] === '2.1.2'));
  assert.ok(m.notes.includes('Tab walk stopped: focus loops without returning to the start'));
  assert.deepEqual(flat(m).filter((n) => n.tab).map((n) => n.name), ['A', 'B', 'C']);
});

test('more than 500 Tab stops is a note, not a gap', async () => {
  const m = await generate(fixture('many.html'));
  assert.equal(m.root.gaps, undefined);
  assert.ok(m.notes.includes('Tab walk stopped at 500 Tab stops; the rest not recorded'));
  const stops = flat(m).filter((n) => n.tab);
  assert.equal(stops.length, 500);
  assert.equal(stops.find((n) => n.tab === 500).name, 'B500');
});

test('a page with no Tab stop', async () => {
  const m = await generate(fixture('no-focus.html'));
  assert.equal(flat(m).filter((n) => n.tab).length, 0);
  assert.equal(m.root.gaps, undefined);
  assert.equal(m.levels, undefined);
});

test('Tab stops inside an iframe are not a trap', async () => {
  const m = await generate(fixture('iframe-tab.html'));
  const stops = flat(m).filter((n) => n.tab).sort((a, b) => a.tab - b.tab);
  assert.equal(stops.length, 3);
  assert.equal(stops[0].name, 'A');
  assert.equal(stops[2].name, 'Z');
  assert.equal(m.root.gaps, undefined);
  assert.equal(m.notes.filter((x) => x === 'Tab stops inside iframe not read: about:srcdoc').length, 1);
});

test('the Tab walk starts at the top, not where focus is', async () => {
  const stops = flat(await generate(fixture('autofocus.html'))).filter((n) => n.tab).sort((a, b) => a.tab - b.tab);
  assert.deepEqual(stops.map((n) => n.name), ['First', 'Second', 'Third']);
});

test('a page that stops every Tab press is a gap', async () => {
  const m = await generate(fixture('trap-document.html'));
  assert.ok(m.root.gaps.some((g) => g[1] === '2.1.2'));
  assert.ok(m.notes.includes('Tab walk stopped: focus did not move'));
});
