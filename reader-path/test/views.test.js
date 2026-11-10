import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture, flat } from './helpers.js';

const gaps = (m, sc) => flat(m).flatMap((n) => (n.gaps || []).filter((g) => g[1] === sc).map((g) => [n.t || n.name || n.role, g[0]]));
const VIEW_ROWS = ['1.4.10', '1.4.4', '1.4.12'];

test('a page that reflows: the three views are in the model, in review, with no gap', async () => {
  const m = await generate(fixture('views/fluid.html'));
  assert.deepEqual(m.views, [
    { name: 'narrow', width: 320, height: 256 },
    { name: 'zoom', width: 640, height: 360 },
    { name: 'spacing', width: 1280, height: 720 },
  ]);
  assert.ok(m.checks['1.4.10'].review.includes('view-narrow'));
  assert.ok(m.checks['1.4.4'].review.includes('view-zoom'));
  assert.ok(m.checks['1.4.12'].review.includes('view-spacing'));
  // Text that is cut off in the default view too is not a finding of these rows.
  for (const sc of VIEW_ROWS) assert.deepEqual(gaps(m, sc), [], sc);
});

test('a block with a fixed width: sideways scroll at 320 px is a 1.4.10 gap on the block', async () => {
  const m = await generate(fixture('views/fixed.html'));
  assert.ok(m.checks['1.4.10'].fail.includes('view-narrow'));
  assert.equal(m.levels['1.4.10'], 'AA');
  const found = gaps(m, '1.4.10');
  assert.equal(found.length, 1);
  assert.match(found[0][1], /sideways/);
  assert.ok(!m.checks['1.4.4'].fail.includes('view-zoom'));
});

test('a wide table: sideways scroll at 320 px is review, not a gap', async () => {
  const m = await generate(fixture('views/table.html'));
  assert.ok(m.checks['1.4.10'].review.includes('view-narrow'));
  assert.ok(!m.checks['1.4.10'].fail.includes('view-narrow'));
  assert.deepEqual(gaps(m, '1.4.10'), []);
});

test('text clipped only in a view is a gap of that view', async () => {
  const m = await generate(fixture('views/clip.html'));
  // Both boxes are too low for a line height of 1.5.
  assert.equal(gaps(m, '1.4.12').length, 2);
  assert.ok(m.checks['1.4.12'].fail.includes('view-spacing'));
  // The long label wraps to two lines at 320 px; the short one does not.
  assert.equal(gaps(m, '1.4.10').length, 1);
  assert.match(gaps(m, '1.4.10')[0][1], /clipped/);
  assert.deepEqual(gaps(m, '1.4.4'), []);
});

test('views: false reads the page in the default view only', async () => {
  const m = await generate(fixture('views/fixed.html'), { views: false });
  assert.equal(m.views, undefined);
  assert.ok(!m.checks['1.4.10']?.fail.includes('view-narrow'));
  assert.ok(!m.checks['1.4.10']?.review.includes('view-narrow'));
});

test('--no-views on the command line', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const out = mkdtempSync(join(tmpdir(), 'reader-path-'));
  await promisify(execFile)('node', [fileURLToPath(new URL('../cli.js', import.meta.url)), fixture('views/fixed.html'), '--no-views', '--out', out]);
  const m = JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'));
  assert.equal(m.views, undefined);
});
