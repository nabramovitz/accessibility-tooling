import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeRows, buildReport, loadCatalog } from '../src/acr.js';

const catalog = loadCatalog();
const none = { pass: [], fail: [], review: [], na: [] };
const entry = (o) => ({ ...none, ...o });
const model = (checks, over = {}) => ({
  url: 'https://x.test/a?token=1#h', finalUrl: 'https://x.test/a', root: { r: 'document', t: 'Home' }, checks, ...over,
});
const rowOf = (rows, num) => Object.values(rows).flat().find((r) => r.num === num);
const adh = (rows, num) => rowOf(rows, num).components[0].adherence;
const lines = (rows, num) => adh(rows, num).notes.split('\n\n');
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
  assert.ok(a.notes.includes('https://www.w3.org/TR/2023/NOTE-UNDERSTANDING-WCAG20-20230921/ensure-compat-parses.html'));
  assert.ok(!a.notes.includes('/faq/'));
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
  assert.ok(n.includes('Needs a person: the rule of comparable information (the tool checks it in a later version).'));
});

test('chapter 3 order: not-evaluated is worse than supports', () => {
  const rows = proposeRows([model({ '1.4.1': entry({ pass: ['r'] }) })], catalog);
  assert.equal(adh(rows, '302.3').level, 'not-evaluated');
  const both = proposeRows([model({ '1.4.1': entry({ pass: ['r'] }), '1.4.11': entry({ pass: ['r'] }) })], catalog);
  assert.equal(adh(both, '302.3').level, 'supports');
  const na = proposeRows([model({ '1.4.1': entry({ na: ['r'] }), '1.4.11': entry({ na: ['r'] }) })], catalog);
  assert.equal(adh(na, '302.3').level, 'not-evaluated');
});

test('chapter 3 order with given levels: does-not-support first, not-applicable last', () => {
  const given = (levels) => proposeRows([model({})], catalog, (sc) => levels[sc]);
  const at = (levels) => adh(given(levels), '302.3').level;
  assert.equal(at({ '1.4.1': 'does-not-support', '1.4.11': 'partially-supports' }), 'does-not-support');
  assert.equal(at({ '1.4.1': 'partially-supports', '1.4.11': 'not-evaluated' }), 'partially-supports');
  assert.equal(at({ '1.4.1': 'not-applicable', '1.4.11': 'supports' }), 'supports');
  assert.equal(at({ '1.4.1': 'not-applicable', '1.4.11': 'not-applicable' }), 'not-applicable');
  assert.ok(adh(given({ '1.4.1': 'does-not-support' }), '302.3').notes.includes('1.4.1 does-not-support, 1.4.11 not-evaluated'));
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
  assert.ok(adh(rows, '302.9').notes.includes('Needs a person: reading level.'));
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
    assert.equal(a.notes.split('\n\n').at(-1), END(2));
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

test('a file: page is named by its file name only', () => {
  const u = 'file:///Users/someone/pages/my%20page.html';
  const m = model({ '1.1.1': entry({ fail: ['x'] }) }, { url: u, finalUrl: u, root: { r: 'document', t: 'T', gaps: [['why', '1.1.1', 'g']] } });
  const rows = proposeRows([m], catalog);
  assert.ok(lines(rows, '1.1.1').includes('my page.html: T: why'));
  assert.ok(!adh(rows, '1.1.1').notes.includes('someone'));
});

test('an unplaced gap keeps no selector', () => {
  const m = model({ '2.4.4': entry({ fail: ['link-name'] }) }, {
    root: { r: 'document', t: 'T', gaps: [['not placed: a[aria-label="A - token=abc"] > b - Fix this', '2.4.4', 'Links must have names']] },
  });
  const n = adh(proposeRows([m], catalog), '2.4.4').notes;
  assert.ok(!n.includes('token'));
  assert.ok(n.includes('T: not placed - Links must have names'));
});

test('a gap why with line breaks is one line, its lines joined with "; "', () => {
  const why = 'Fix any of the following:\n  Element has no alt\n  No aria-label\n\nFix all of the following:\n  Other';
  const m = model({ '1.1.1': entry({ fail: ['x'] }) }, { root: { r: 'document', t: 'T', gaps: [[why, '1.1.1', 'g']] } });
  const l = lines(proposeRows([m], catalog), '1.1.1');
  assert.ok(l.includes('https://x.test/a: T: Fix any of the following: Element has no alt; No aria-label; Fix all of the following: Other'));
});

test('note lines are Markdown paragraphs', () => {
  const m = model({ '1.1.1': entry({ fail: ['x'] }) }, { root: { r: 'document', t: 'T', gaps: [['a', '1.1.1', 'g'], ['b', '1.1.1', 'g']] } });
  assert.equal(adh(proposeRows([m], catalog), '1.1.1').notes,
    ['Failing rules: x on 1 of 1 page(s)', 'https://x.test/a: T: a', 'https://x.test/a: T: b', END(1)].join('\n\n'));
});

test('Markdown punctuation in a node title is escaped', () => {
  const m = model({ '1.1.1': entry({ fail: ['x'] }) }, { root: { r: 'document', t: '- [x]: #y | z', gaps: [['why', '1.1.1', 'g']] } });
  assert.ok(lines(proposeRows([m], catalog), '1.1.1').includes('https://x.test/a: \\- \\[x\\]: \\#y \\| z: why'));
  const all = model({ '1.1.1': entry({ fail: ['x'] }) }, { root: { r: 'document', t: '+\\`*_()<>', gaps: [['why', '1.1.1', 'g']] } });
  assert.ok(lines(proposeRows([all], catalog), '1.1.1').includes('https://x.test/a: \\+\\\\\\`\\*\\_\\(\\)\\<\\>: why'));
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

test('a Tab walk in review is named as such, not as an axe-core rule', () => {
  const rows = proposeRows([model({ '2.1.2': entry({ review: ['tab-walk', 'r'] }) })], catalog);
  assert.equal(adh(rows, '2.1.2').level, 'not-evaluated');
  assert.ok(lines(rows, '2.1.2').includes('Needs a person: the Tab walk did not read every Tab stop (see the run notes)'));
  assert.ok(lines(rows, '2.1.2').includes('Needs a person: axe-core could not decide (r)'));
  assert.ok(!adh(rows, '2.1.2').notes.includes('decide (tab-walk'));
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

test('302.1 and 302.9 with only supports rows: not-evaluated, a person checks the rest', () => {
  const rows = proposeRows([model({})], catalog, () => 'supports');
  assert.equal(adh(rows, '302.1').level, 'not-evaluated');
  assert.ok(lines(rows, '302.1').includes('Needs a person: the rule of comparable information (the tool checks it in a later version).'));
  assert.equal(adh(rows, '302.9').level, 'not-evaluated');
  assert.ok(lines(rows, '302.9').includes('Needs a person: reading level.'));
  assert.equal(adh(rows, '302.7').level, 'supports');
});

const OPTS = { version: '0', axe: '4', date: '2026-11-07' };
const copy = (x) => JSON.parse(JSON.stringify(x));
const at = (report, ch, num) => report.chapters[ch].criteria.find((r) => r.num === num).components[0].adherence;
const hand = (num, level) => ({ num, components: [{ name: 'web', adherence: { level, notes: 'By hand.' } }] });

test('a base row the tool wrote is proposed again from the new evidence', () => {
  const a = model({ '1.4.3': entry({ pass: ['color-contrast'] }) }, { finalUrl: 'https://x.test/a' });
  const b = model({ '1.4.3': entry({ review: ['color-contrast'] }) }, { finalUrl: 'https://x.test/b' });
  const c = model({}, { finalUrl: 'https://x.test/c' });
  const first = buildReport([a], null, catalog, OPTS).report;
  assert.equal(at(first, 'success_criteria_level_aa', '1.4.3').level, 'supports');
  const base = { ...copy(first), title: 'Mine' };
  const { report } = buildReport([a, b, c], base, catalog, OPTS);
  assert.equal(report.title, 'Mine');
  assert.equal(at(report, 'success_criteria_level_aa', '1.4.3').level, 'not-evaluated');
  assert.match(report.evaluation_methods_used, /on 3 page\(s\)/);
});

test('a chapter 3 row the tool wrote follows a WCAG row a person changed', () => {
  const b = { title: 'T', chapters: {
    success_criteria_level_a: { criteria: ['2.1.1', '2.1.2', '2.2.1', '2.5.1', '2.5.2'].map((n) => hand(n, 'supports')) },
    success_criteria_level_aa: { criteria: [hand('2.5.8', 'supports')] },
  } };
  const first = buildReport([model({})], b, catalog, OPTS).report;
  assert.equal(at(first, 'functional_performance_criteria', '302.7').level, 'supports');
  const next = copy(first);
  next.chapters.success_criteria_level_a.criteria.find((r) => r.num === '2.1.2').components[0].adherence.level = 'does-not-support';
  const { report } = buildReport([model({})], next, catalog, OPTS);
  assert.equal(at(report, 'functional_performance_criteria', '302.7').level, 'does-not-support');
});

test('a person-owned evaluation_methods_used is kept', () => {
  const { report } = buildReport([model({})], { title: 'T', evaluation_methods_used: 'By hand, then reader-path.' }, catalog, OPTS);
  assert.equal(report.evaluation_methods_used, 'By hand, then reader-path.');
});

test('a person row that ranks better than the new evidence is a conflict line', () => {
  const m = model({ '1.4.3': entry({ review: ['color-contrast'] }), '1.1.1': entry({ pass: ['image-alt'] }) });
  const base = { title: 'T', chapters: {
    success_criteria_level_aa: { criteria: [hand('1.4.3', 'supports')] },
    success_criteria_level_a: { criteria: [hand('1.1.1', 'not-evaluated'), hand('1.3.1', 'does-not-support')] },
  } };
  const { conflicts } = buildReport([m], base, catalog, OPTS);
  assert.deepEqual(conflicts, ['base row 1.4.3: supports; new evidence: not-evaluated']);
});

test('an unknown base level is not-evaluated for chapter 3 and is printed', () => {
  const base = { title: 'T', chapters: {
    success_criteria_level_a: { criteria: [hand('1.4.1', 'partialy-supports')] },
    success_criteria_level_aa: { criteria: [hand('1.4.11', 'supports')] },
  } };
  const { report, conflicts } = buildReport([model({})], base, catalog, OPTS);
  assert.equal(at(report, 'functional_performance_criteria', '302.3').level, 'not-evaluated');
  assert.ok(at(report, 'functional_performance_criteria', '302.3').notes.includes('1.4.1 not-evaluated, 1.4.11 supports'));
  assert.ok(conflicts.includes('base row 1.4.1: unknown level partialy-supports'));
  const none = { title: 'T', chapters: { success_criteria_level_a: { criteria: [hand('1.4.1', 'x')] }, success_criteria_level_aa: { criteria: [hand('1.4.11', 'y')] } } };
  assert.equal(at(buildReport([model({})], none, catalog, OPTS).report, 'functional_performance_criteria', '302.3').level, 'not-evaluated');
});

test('a chapter 3 row built with a person level names the base file in its end line', () => {
  const rows = proposeRows([model({}), model({})], catalog, (sc) => (sc === '1.4.1' ? 'supports' : undefined));
  assert.equal(lines(rows, '302.3').at(-1), 'Proposed by reader-path from automated checks and the base file on 2 page(s); a person confirms.');
  assert.equal(lines(rows, '302.7').at(-1), END(2));
  const base = { title: 'T', chapters: { success_criteria_level_a: { criteria: [hand('2.1.2', 'supports')] } } };
  const { report } = buildReport([model({})], base, catalog, OPTS);
  assert.match(at(report, 'functional_performance_criteria', '302.7').notes, /automated checks and the base file on 1 page\(s\); a person confirms\.$/);
  assert.match(at(report, 'functional_performance_criteria', '302.3').notes, /Proposed by reader-path from automated checks on 1 page/);
});

test('a person row in another chapter still counts for chapter 3', () => {
  const base = { title: 'T', chapters: { success_criteria_level_aa: { criteria: [hand('2.1.2', 'does-not-support')] } } };
  const { report } = buildReport([model({})], base, catalog, OPTS);
  assert.equal(at(report, 'functional_performance_criteria', '302.7').level, 'does-not-support');
});

test('a page where axe-core did not check a frame has no result for axe-core rows', () => {
  const framed = model({ '1.1.1': entry({ pass: ['image-alt'] }), '2.1.2': entry({ pass: ['tab-walk'] }) }, { notes: ['axe not added to frame: https://x.test/f'] });
  const ok = model({ '1.1.1': entry({ pass: ['image-alt'] }), '2.1.2': entry({ pass: ['tab-walk'] }) });
  const rows = proposeRows([framed, ok], catalog);
  assert.equal(adh(rows, '1.1.1').level, 'not-evaluated');
  assert.ok(lines(rows, '1.1.1').includes('Needs a person: axe-core did not check a frame on 1 page(s)'));
  assert.equal(adh(rows, '2.1.2').level, 'supports');
  assert.equal(adh(proposeRows([ok], catalog), '1.1.1').level, 'supports');
});

test('Markdown punctuation in a file name is escaped', () => {
  const u = 'file:///tmp/%5Ba%5D(b)_c.html';
  const m = model({ '1.1.1': entry({ fail: ['x'] }) }, { url: u, finalUrl: u, root: { r: 'document', t: 'T', gaps: [['why', '1.1.1', 'g']] } });
  assert.ok(lines(proposeRows([m], catalog), '1.1.1').includes('\\[a\\]\\(b\\)\\_c.html: T: why'));
});

test('a run rule in review or na gets its own line, not the axe-core wording', () => {
  const a = model({ '2.4.5': entry({ review: ['run-ways'] }), '3.2.6': entry({ na: ['run-help'] }), '1.2.1': entry({ na: ['run-media'] }) });
  const b = model({ '2.4.5': entry({ review: ['run-ways'] }), '3.2.6': entry({ na: ['run-help'] }), '1.2.1': entry({ na: ['run-media'] }) }, { finalUrl: 'https://x.test/b' });
  const rows = proposeRows([a, b], catalog);
  assert.ok(lines(rows, '2.4.5').includes('Needs a person: a navigation on every page, no search found; is there a second way to reach each page?'));
  assert.ok(!adh(rows, '2.4.5').notes.includes('axe-core could not decide'));
  assert.ok(lines(rows, '3.2.6').includes('Needs a person: no help or documentation link found on any page; is the row not applicable?'));
  assert.ok(!adh(rows, '3.2.6').notes.includes('axe-core rules found nothing'));
  assert.ok(lines(rows, '1.2.1').includes('Needs a person: no audio or video element found on any page; is the row not applicable?'));
  assert.equal(adh(rows, '1.2.1').level, 'not-evaluated');
});
