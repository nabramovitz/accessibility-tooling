// The Tab walk over 510 buttons, in a file of its own so that it runs
// beside the other test files: with the views, the focus measures inside
// the walk take about 30 s on a slow runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture, flat } from './helpers.js';

// The walk must give the same result with and without the focus measures.
for (const views of [false, true]) {
  test(`more than 500 Tab stops is a note and review, not a gap (views: ${views})`, async () => {
    const m = await generate(fixture('many.html'), { views });
    assert.equal(m.root.gaps, undefined);
    assert.ok(m.notes.includes('Tab walk stopped at 500 Tab stops; the rest not recorded'));
    const stops = flat(m).filter((n) => n.tab);
    assert.equal(stops.length, 500);
    assert.equal(stops.find((n) => n.tab === 500).name, 'B500');
    assert.deepEqual(m.checks['2.1.2'], { pass: [], fail: [], review: ['tab-walk'], na: [] });
  });
}
