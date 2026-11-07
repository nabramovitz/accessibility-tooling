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

test('a focus loop that skips the start stops at 500 presses', async () => {
  const m = await generate(fixture('trap-loop.html'));
  assert.ok(m.root.gaps.some((g) => g[1] === '2.1.2'));
  assert.ok(m.notes.includes('Tab walk stopped after 500 presses'));
});

test('a page with no Tab stop', async () => {
  const m = await generate(fixture('no-focus.html'));
  assert.equal(flat(m).filter((n) => n.tab).length, 0);
  assert.equal(m.root.gaps, undefined);
  assert.equal(m.levels, undefined);
});
