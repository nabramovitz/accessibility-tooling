import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { holdNeeded } from '../src/hold-children.js';
import { fixture, flat } from './helpers.js';

// A garbage collection while the second browser of this process runs.
// Bun 1.3.14 then closed the pipe fds of the first, finished browser a
// second time; the second browser had the same fd numbers, so its pipe
// closed and the run waited for ever (src/hold-children.js works round
// it there). Bun 1.4.4 and Node.js have no such fault; under Node.js
// the collection is only asked for when node runs with --expose-gc.
test('a second run in one process survives a garbage collection', async () => {
  await generate(fixture('tab.html'));
  const collect = () => (globalThis.Bun ? Bun.gc(true) : globalThis.gc?.());
  const timer = setTimeout(collect, 400);
  try {
    const m = await generate(fixture('tab.html'), { settle: 800 });
    assert.equal(flat(m).filter((n) => n.tab).length, 4);
  } finally {
    clearTimeout(timer);
  }
});

test('children are held only under Bun older than 1.4.4', () => {
  assert.equal(holdNeeded('1.3.14'), true);
  assert.equal(holdNeeded('1.4.3'), true);
  assert.equal(holdNeeded('0.9.99'), true);
  assert.equal(holdNeeded('1.4.4'), false);
  assert.equal(holdNeeded('1.4.10'), false);
  assert.equal(holdNeeded('1.10.0'), false);
  assert.equal(holdNeeded('2.0.0'), false);
  assert.equal(holdNeeded(undefined), false);
});
