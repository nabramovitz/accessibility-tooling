import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture, flat } from './helpers.js';

const gaps = (m, sc) => flat(m).flatMap((n) => (n.gaps || []).filter((g) => g[1] === sc).map((g) => [n.t || n.name || n.role, g[0]]));
const VIEW_ROWS = ['1.4.10', '1.4.4', '1.4.12'];

test('a page that reflows: the views are in the model, and the three rows pass, with no gap', async () => {
  const m = await generate(fixture('views/fluid.html'));
  assert.deepEqual(m.views, [
    { name: 'narrow', width: 320, height: 256 },
    { name: 'zoom', width: 640, height: 360 },
    { name: 'spacing', width: 1280, height: 720 },
    { name: 'dark', width: 1280, height: 720 },
    { name: 'motion', width: 1280, height: 720 },
  ]);
  assert.ok(m.checks['1.4.10'].pass.includes('view-narrow'));
  assert.ok(m.checks['1.4.4'].pass.includes('view-zoom'));
  assert.ok(m.checks['1.4.12'].pass.includes('view-spacing'));
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

test('reduced motion: the animations that still run are named, and 2.3.3 is for a person', async () => {
  const m = await generate(fixture('views/motion.html'));
  assert.ok(m.notes.includes('Animations running: 2 in the default view, 1 with reduced motion asked (div#busy.spin)'), m.notes.join('\n'));
  assert.deepEqual(m.checks['2.3.3'].review, ['view-motion']);
  assert.deepEqual(gaps(m, '2.3.3'), []);
});

test('a box that cuts off the text of its children: the gap names the box, not text', async () => {
  const m = await generate(fixture('views/box.html'));
  const found = gaps(m, '1.4.10');
  assert.equal(found.length, 1);
  assert.match(found[0][1], /^This box cuts off its content in a window 320 px wide; it does not in the default view\.$/);
});

test('text that overlaps other text only when it wraps: a gap in the zoom and narrow views', async () => {
  const m = await generate(fixture('views/overlap-zoom.html'));
  for (const sc of ['1.4.4', '1.4.10', '1.4.12']) {
    const found = gaps(m, sc);
    assert.equal(found.length, 1, sc);
    assert.match(found[0][1], /^Text overlaps other text \(div\.card\) (at 200 % zoom|in a window 320 px wide|with the WCAG text spacing); it does not in the default view\.$/);
  }
  assert.ok(m.checks['1.4.4'].fail.includes('view-zoom'));
  assert.ok(m.checks['1.4.10'].fail.includes('view-narrow'));
  assert.equal(m.levels['1.4.4'], 'AA');
  // The wider letters and words wrap the text at the text spacing too.
  assert.ok(m.checks['1.4.12'].fail.includes('view-spacing'));
});

test('a small overlap is a run note and review, not a gap', async () => {
  const m = await generate(fixture('views/overlap-small.html'));
  assert.deepEqual(gaps(m, '1.4.4'), []);
  assert.ok(m.checks['1.4.4'].review.includes('view-zoom'));
  assert.ok(!m.checks['1.4.4'].pass.includes('view-zoom'));
  assert.deepEqual(m.checks['1.4.4'].fail, []);
  assert.ok(m.notes.some((n) => /^Text overlaps a little at 200 % zoom, not in the default view: p\.a and p\.b$/.test(n)), m.notes.join('\n'));
});

test('a clear overlap by a larger shift is a gap', async () => {
  const m = await generate(fixture('views/overlap-clear.html'));
  assert.equal(gaps(m, '1.4.4').length, 1);
  assert.ok(m.checks['1.4.4'].fail.includes('view-zoom'));
});

test('text that overlaps in the default view too is not a finding', async () => {
  const m = await generate(fixture('views/overlap-always.html'));
  for (const sc of VIEW_ROWS) assert.deepEqual(gaps(m, sc), [], sc);
  assert.ok(m.checks['1.4.4'].pass.includes('view-zoom'));
  assert.ok(!m.notes.some((n) => /overlaps a little/.test(n)));
});

test('hidden text and text scrolled out of its box do not overlap', async () => {
  const m = await generate(fixture('views/overlap-skip.html'));
  for (const sc of VIEW_ROWS) assert.deepEqual(gaps(m, sc), [], sc);
  assert.ok(m.checks['1.4.4'].pass.includes('view-zoom'));
  assert.ok(!m.notes.some((n) => /overlaps a little/.test(n)));
});

test('low contrast only in dark mode: a gap that says so, on both contrast rows', async () => {
  const m = await generate(fixture('views/dark-low.html'));
  assert.ok(m.checks['1.4.3'].fail.includes('view-dark'));
  assert.ok(m.checks['1.4.6'].fail.includes('view-dark'));
  // The default view passes: the page in light colours is fine.
  assert.ok(m.checks['1.4.3'].pass.includes('color-contrast'));
  assert.ok(!m.checks['1.4.3'].fail.includes('color-contrast'));
  // axe-core reports the enhanced rule only for text that passes the
  // 4.5 to 1 minimum, so the two rows name different text.
  const dark = (sc) => gaps(m, sc).filter((g) => /^In dark mode: /.test(g[1]));
  assert.ok(dark('1.4.3').length >= 1);
  assert.match(dark('1.4.3')[0][1], /contrast of \d\.\d+ \(foreground color: #555555, background color: #222222/);
  assert.equal(dark('1.4.6').length, 1);
  assert.match(dark('1.4.6')[0][1], /contrast of 5\.\d+ \(foreground color: #999999, background color: #222222/);
  assert.ok(!m.notes.includes('The page has no dark mode'));
});

test('good colours in dark mode: both rows pass, no gap', async () => {
  const m = await generate(fixture('views/dark-good.html'));
  assert.ok(m.checks['1.4.3'].pass.includes('view-dark'));
  assert.ok(m.checks['1.4.6'].pass.includes('view-dark'));
  assert.deepEqual(gaps(m, '1.4.3'), []);
  assert.deepEqual(gaps(m, '1.4.6'), []);
});

test('a page with no dark styles: a run note and no check', async () => {
  const m = await generate(fixture('views/dark-none.html'));
  assert.ok(m.notes.includes('The page has no dark mode'));
  for (const sc of ['1.4.3', '1.4.6']) {
    for (const list of ['pass', 'fail', 'review']) assert.ok(!(m.checks[sc]?.[list] || []).includes('view-dark'), `${sc} ${list}`);
  }
  assert.ok(m.views.some((v) => v.name === 'dark'));
});

test('the dark view comes after spacing and before motion', async () => {
  const m = await generate(fixture('views/dark-low.html'));
  assert.deepEqual(m.views.map((v) => v.name), ['narrow', 'zoom', 'spacing', 'dark', 'motion']);
});

test('views: false has no dark view', async () => {
  const m = await generate(fixture('views/dark-low.html'), { views: false });
  assert.equal(m.views, undefined);
  assert.ok(!m.checks['1.4.3']?.fail.includes('view-dark'));
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
