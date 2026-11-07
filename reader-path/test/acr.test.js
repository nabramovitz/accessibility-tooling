import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeRows, loadCatalog } from '../src/acr.js';

const catalog = loadCatalog();
const none = { pass: [], fail: [], review: [], na: [] };
const entry = (o) => ({ ...none, ...o });
const model = (checks, over = {}) => ({
  url: 'https://x.test/a?token=1#h', finalUrl: 'https://x.test/a', root: { r: 'document', t: 'Home' }, checks, ...over,
});
const rowOf = (rows, num) => Object.values(rows).flat().find((r) => r.num === num);
const adh = (rows, num) => rowOf(rows, num).components[0].adherence;
const lines = (rows, num) => adh(rows, num).notes.split('\n');
const END = (n) => `Proposed by reader-path from automated checks on ${n} page(s); a person confirms.`;

test('a failing rule on any page: partially-supports, with the gaps', () => {
  const m = model({ '1.1.1': entry({ fail: ['image-alt'] }) }, {
    root: { r: 'document', t: 'Home', c: [{ r: 'img', t: 'Logo', gaps: [['no alt', '1.1.1', 'g'], ['other', '1.3.1', 'g']] }] },
  });
  const rows = proposeRows([m], catalog);
  const a = adh(rows, '1.1.1');
  assert.equal(a.level, 'partially-supports');
  assert.ok(lines(rows, '1.1.1').includes('https://x.test/a: Logo: no alt'));
  assert.ok(lines(rows, '1.1.1').includes('Failing rules: image-alt on 1 of 1 page(s)'));
  assert.ok(!a.notes.includes('other'));
});

test('a fail on one page of two names that page', () => {
  const a = model({ '1.1.1': entry({ pass: ['image-alt'] }) }, { finalUrl: 'https://x.test/ok' });
  const b = model({ '1.1.1': entry({ fail: ['image-alt'] }) }, {
    finalUrl: 'https://x.test/bad', root: { r: 'document', t: 'Bad', gaps: [['no alt', '1.1.1', 'g']] },
  });
  const rows = proposeRows([a, b], catalog);
  assert.equal(adh(rows, '1.1.1').level, 'partially-supports');
  assert.ok(adh(rows, '1.1.1').notes.includes('https://x.test/bad: Bad: no alt'));
  assert.ok(!adh(rows, '1.1.1').notes.includes('x.test/ok'));
});

test('fail entries without placed gaps still partially-supports, with rule ids', () => {
  const rows = proposeRows([model({ '1.1.1': entry({ fail: ['image-alt'] }) })], catalog);
  assert.equal(adh(rows, '1.1.1').level, 'partially-supports');
  assert.ok(adh(rows, '1.1.1').notes.includes('image-alt'));
});

test('a note has at most 20 gap lines, then "and N more"', () => {
  const gaps = Array.from({ length: 23 }, (_, i) => [`why ${i}`, '1.1.1', 'g']);
  const m = model({ '1.1.1': entry({ fail: ['image-alt'] }) }, { root: { r: 'document', t: 'T', gaps } });
  const l = lines(proposeRows([m], catalog), '1.1.1');
  assert.equal(l.filter((x) => x.includes(': T: why')).length, 20);
  assert.ok(l.includes('and 3 more'));
});

test('no fail and pass or na on every page: supports, with rules and page count', () => {
  const rows = proposeRows([model({ '1.1.1': entry({ pass: ['image-alt', 'input-image-alt'] }) }), model({ '1.1.1': entry({ na: ['image-alt'] }) })], catalog);
  const a = adh(rows, '1.1.1');
  assert.equal(a.level, 'supports');
  assert.ok(a.notes.includes('image-alt, input-image-alt'));
  assert.ok(a.notes.includes('1 of 2 page(s)'));
});

test('no fail, no pass, some review: not-evaluated, needs a person', () => {
  const rows = proposeRows([model({ '1.4.3': entry({ review: ['color-contrast'] }) })], catalog);
  assert.equal(adh(rows, '1.4.3').level, 'not-evaluated');
  assert.ok(adh(rows, '1.4.3').notes.includes('Needs a person: axe-core could not decide (color-contrast)'));
});

test('only na on every page: not-evaluated, a person says if the row applies', () => {
  const rows = proposeRows([model({ '1.2.1': entry({ na: ['video-caption'] }) }), model({ '1.2.1': entry({ na: ['audio-caption'] }) })], catalog);
  assert.equal(adh(rows, '1.2.1').level, 'not-evaluated');
  assert.ok(lines(rows, '1.2.1').includes('Needs a person: the axe-core rules found nothing to check (video-caption, audio-caption); is the row not applicable?'));
});

test('na on one page, no entry on the other: not-evaluated', () => {
  const rows = proposeRows([model({ '1.2.1': entry({ na: ['video-caption'] }) }), model({})], catalog);
  assert.equal(adh(rows, '1.2.1').level, 'not-evaluated');
});

test('pass on one page, no entry on another: not-evaluated', () => {
  const rows = proposeRows([model({ '1.1.1': entry({ pass: ['image-alt'] }) }), model({}), model({})], catalog);
  assert.equal(adh(rows, '1.1.1').level, 'not-evaluated');
  assert.ok(lines(rows, '1.1.1').includes('Needs a person: no automated result on 2 of 3 page(s)'));
  assert.ok(lines(rows, '1.1.1').includes('Rules that passed: image-alt, on 1 of 3 page(s)'));
});

test('no entry: not-evaluated, no automated check', () => {
  const rows = proposeRows([model({})], catalog);
  assert.equal(adh(rows, '1.2.2').level, 'not-evaluated');
  assert.ok(adh(rows, '1.2.2').notes.includes('Needs a person: no automated check'));
});

test('4.1.1 is supports with the errata links, whatever the checks say', () => {
  const rows = proposeRows([model({ '4.1.1': entry({ fail: ['duplicate-id'] }) })], catalog);
  const a = adh(rows, '4.1.1');
  assert.equal(a.level, 'supports');
  assert.ok(a.notes.includes('https://www.w3.org/WAI/WCAG21/errata/'));
  assert.ok(a.notes.includes('https://www.w3.org/WAI/standards-guidelines/wcag/faq/'));
});

test('chapter 3 takes the worst related level and names the rows', () => {
  const checks = {};
  for (const c of ['1.1.1', '1.3.1', '1.3.2', '2.1.1', '2.4.3']) checks[c] = entry({ pass: ['r'] });
  checks['4.1.2'] = entry({ fail: ['button-name'] });
  const rows = proposeRows([model(checks)], catalog);
  assert.equal(adh(rows, '302.1').level, 'partially-supports');
  const n = adh(rows, '302.1').notes;
  assert.ok(n.includes('4.1.2 partially-supports'));
  assert.ok(n.includes('1.1.1 supports'));
  assert.ok(n.includes('the rule of comparable information is checked in a later version'));
});

test('chapter 3 order: not-evaluated is worse than supports', () => {
  const rows = proposeRows([model({ '1.4.1': entry({ pass: ['r'] }) })], catalog);
  assert.equal(adh(rows, '302.3').level, 'not-evaluated');
  const both = proposeRows([model({ '1.4.1': entry({ pass: ['r'] }), '1.4.11': entry({ pass: ['r'] }) })], catalog);
  assert.equal(adh(both, '302.3').level, 'supports');
  const na = proposeRows([model({ '1.4.1': entry({ na: ['r'] }), '1.4.11': entry({ na: ['r'] }) })], catalog);
  assert.equal(adh(na, '302.3').level, 'not-evaluated');
});

test('302.6 needs a person', () => {
  const a = adh(proposeRows([model({})], catalog), '302.6');
  assert.equal(a.level, 'not-evaluated');
  assert.ok(a.notes.includes('Needs a person: does any function need speech?'));
});

test('302.7 and 302.8 share rows; 302.9 adds the reading level sentence', () => {
  const rows = proposeRows([model({})], catalog);
  for (const c of ['2.1.1', '2.1.2', '2.2.1', '2.5.1', '2.5.2', '2.5.8']) {
    assert.ok(adh(rows, '302.7').notes.includes(`${c} `));
    assert.ok(adh(rows, '302.8').notes.includes(`${c} `));
  }
  assert.ok(adh(rows, '302.9').notes.includes('reading level needs a person'));
  assert.ok(adh(rows, '302.2').notes.includes('2.4.11 '));
  assert.ok(adh(rows, '302.4').notes.includes('1.2.4 '));
  assert.ok(adh(rows, '302.5').notes.includes('1.4.7 '));
});

test('every note ends with the proposed-by line; no does-not-support or not-applicable', () => {
  const na = Object.fromEntries(catalog.chapters.flatMap((c) => c.criteria).map((c) => [String(c.id), entry({ na: ['r'] })]));
  const rows = proposeRows([model({ ...na, '1.1.1': entry({ fail: ['x'] }) }), model(na)], catalog);
  const all = Object.values(rows).flat();
  assert.ok(all.length > 80);
  for (const r of all) {
    const a = r.components[0].adherence;
    assert.equal(a.notes.split('\n').at(-1), END(2));
    assert.notEqual(a.level, 'does-not-support');
    assert.notEqual(a.level, 'not-applicable');
  }
});

test('rows come in catalog order, in the four chapters, with the right component', () => {
  const rows = proposeRows([model({})], catalog);
  assert.deepEqual(Object.keys(rows), ['success_criteria_level_a', 'success_criteria_level_aa', 'success_criteria_level_aaa', 'functional_performance_criteria']);
  for (const ch of Object.keys(rows)) {
    const cat = catalog.chapters.find((c) => c.id === ch).criteria.map((c) => String(c.id));
    assert.deepEqual(rows[ch].map((r) => r.num), cat);
  }
  assert.equal(rows.success_criteria_level_a[0].components[0].name, 'web');
  assert.equal(rows.functional_performance_criteria[0].components[0].name, 'none');
});

test('the page label falls back to the bare url', () => {
  const m = model({ '1.1.1': entry({ fail: ['x'] }) }, { finalUrl: undefined, root: { r: 'document', t: 'T', gaps: [['why', '1.1.1', 'g']] } });
  assert.ok(adh(proposeRows([m], catalog), '1.1.1').notes.includes('https://x.test/a'));
  assert.ok(!adh(proposeRows([m], catalog), '1.1.1').notes.includes('token'));
});

test('an unplaced gap keeps no selector', () => {
  const m = model({ '2.4.4': entry({ fail: ['link-name'] }) }, {
    root: { r: 'document', t: 'T', gaps: [['not placed: a[aria-label="A - token=abc"] > b - Fix this', '2.4.4', 'Links must have names']] },
  });
  const n = adh(proposeRows([m], catalog), '2.4.4').notes;
  assert.ok(!n.includes('token'));
  assert.ok(n.includes('T: not placed - Links must have names'));
});

test('a gap why with line breaks is one line', () => {
  const why = 'Fix any of the following:\n  Element has no name\n\nFix all of the following:\n  Other';
  const m = model({ '1.1.1': entry({ fail: ['x'] }) }, { root: { r: 'document', t: 'T', gaps: [[why, '1.1.1', 'g']] } });
  const l = lines(proposeRows([m], catalog), '1.1.1');
  assert.ok(l.includes('https://x.test/a: T: Fix any of the following: Element has no name Fix all of the following: Other'));
});

test('no models throws', () => {
  assert.throws(() => proposeRows([], catalog), /no models/);
});

test('an empty title falls back to the role', () => {
  const m = model({ '1.1.1': entry({ fail: ['x'] }) }, { root: { role: 'document', t: '', gaps: [['why', '1.1.1', 'g']] } });
  assert.ok(adh(proposeRows([m], catalog), '1.1.1').notes.includes('https://x.test/a: document: why'));
});

test('failing rules are one line over the pages', () => {
  const a = model({ '1.1.1': entry({ fail: ['r1'] }) });
  const b = model({ '1.1.1': entry({ fail: ['r2', 'r1'] }) });
  const c = model({});
  assert.ok(lines(proposeRows([a, b, c], catalog), '1.1.1').includes('Failing rules: r1, r2 on 2 of 3 page(s)'));
});

test('pass with review on any page: not-evaluated, with both rule lists', () => {
  const rows = proposeRows([model({ '1.4.3': entry({ pass: ['p'] }) }), model({ '1.4.3': entry({ pass: ['q'], review: ['color-contrast'] }) })], catalog);
  assert.equal(adh(rows, '1.4.3').level, 'not-evaluated');
  assert.ok(lines(rows, '1.4.3').includes('Rules that passed: p, q, on 2 of 2 page(s)'));
  assert.ok(lines(rows, '1.4.3').includes('Needs a person: axe-core could not decide (color-contrast)'));
});

test('4.1.1 note names the errata and the Understanding note', () => {
  assert.ok(adh(proposeRows([model({})], catalog), '4.1.1').notes.includes('WCAG 2.1 errata and the WCAG 2.0 Understanding note say content using HTML or XML always satisfies it:'));
});
