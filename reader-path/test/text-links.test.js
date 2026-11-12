import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textLinks } from '../src/text-links.js';
import { runChecks } from '../src/run-checks.js';
import { generate } from '../src/generate.js';
import { fixture } from './helpers.js';

const link = (name, href, id) => ({ id, role: 'link', name, href, c: [] });
const tree = (...links) => ({ role: 'RootWebArea', c: [{ role: 'main', lm: 'main', c: links }] });
const run = (...links) => { const m = { root: tree(...links) }; textLinks(m, m.root); return m; };
const rules = (m, sc = '2.4.4') => (m.proposals ?? []).filter((p) => p.sc === sc).map((p) => p.rule);

test('two links named More that go to different pages: one proposal, for both rows', () => {
  const m = run(link('More', 'https://x.test/apps', 'a'), link('More', 'https://x.test/orgs', 'b'));
  assert.deepEqual(rules(m), ['text-link-same-name', 'text-link-vague']);
  assert.deepEqual(rules(m, '2.4.9'), ['text-link-same-name-alone', 'text-link-vague-alone']);
  const p = m.proposals.find((x) => x.rule === 'text-link-same-name');
  assert.equal(p.node, 'a');
  assert.match(p.say, /"More".*https:\/\/x\.test\/apps.*https:\/\/x\.test\/orgs/);
});

test('same name and same target is not a same-name proposal (a fragment or trailing slash does not count)', () => {
  const m = run(link('Details', 'https://x.test/a', 'a'), link('Details', 'https://x.test/a/#top', 'b'));
  assert.deepEqual(m.proposals ?? [], []);
});

test('a descriptive name, and a link with no target, are not proposed', () => {
  const m = run(link('Read the install guide', 'https://x.test/g', 'a'), link('Docs', undefined, 'b'), link('Docs', 'https://x.test/d', 'c'));
  assert.deepEqual(m.proposals ?? [], []);
});

test('a vague name is a proposal even when it is the only one of its name', () => {
  for (const name of ['Click here', 'here', 'More...', 'Read more »', 'link', 'Learn more']) {
    const m = run(link(name, 'https://x.test/a', 'a'));
    assert.deepEqual(rules(m), ['text-link-vague'], name);
  }
  assert.deepEqual(run(link('More about apps', 'https://x.test/a', 'a')).proposals ?? [], []);
});

test('a name that is only a URL is a proposal with a note that a URL can be the purpose', () => {
  const m = run(link('https://docs.example.test/start', 'https://docs.example.test/start', 'a'), link('www.example.test', 'https://www.example.test/', 'b'));
  assert.deepEqual(rules(m), ['text-link-url', 'text-link-url']);
  assert.match(m.proposals[0].propose, /URL is the purpose/);
  assert.deepEqual(run(link('See https://x.test for details', 'https://x.test', 'a')).proposals ?? [], []);
});

test('a model with no links gets no proposals field', () => {
  const m = { root: { role: 'RootWebArea', c: [] } };
  textLinks(m, m.root);
  assert.equal('proposals' in m, false);
});

// A page: a main, and a shell (outside main) with a footer.
const pageOf = (n, footer = [], main = []) => ({
  url: `https://x.test/${n}`, title: n, checks: {},
  root: { id: 'r', role: 'RootWebArea', c: [{ role: 'main', lm: 'main', c: main }, { role: 'contentinfo', lm: 'contentinfo', c: footer }] },
});

test('run: the same footer link name going to different targets is a proposal on the first page', () => {
  const a = pageOf('a', [link('Docs', 'https://x.test/docs/1', 'f1')]);
  const b = pageOf('b', [link('Docs', 'https://docs.test/', 'f2')]);
  runChecks([a, b]);
  assert.deepEqual(rules(a), ['text-link-footer-differs']);
  assert.deepEqual(rules(a, '2.4.9'), ['text-link-footer-differs-alone']);
  assert.match(a.proposals[0].say, /"Docs".*https:\/\/x\.test\/a.*https:\/\/x\.test\/b/);
  assert.equal(a.proposals[0].node, 'f1');
  assert.equal(b.proposals, undefined);
});

test('run: the same footer link going to the same target, or a link in main only, is not proposed', () => {
  const same = [pageOf('a', [link('Docs', 'https://x.test/docs', 'f1')]), pageOf('b', [link('Docs', 'https://x.test/docs#x', 'f2')])];
  runChecks(same);
  assert.equal(same[0].proposals, undefined);
  const inMain = [pageOf('a', [], [link('More', 'https://x.test/1', 'm1')]), pageOf('b', [], [link('More', 'https://x.test/2', 'm2')])];
  runChecks(inMain);
  assert.equal(inMain[0].proposals, undefined);
});

test('generate: a fixture page gives each proposal and keeps the target on the link node', async () => {
  const m = await generate(fixture('text-links/page.html'));
  const got = m.proposals.filter((p) => p.sc === '2.4.4').map((p) => p.rule).sort();
  assert.deepEqual(got, ['text-link-same-name', 'text-link-url', 'text-link-vague', 'text-link-vague']);
  const more = m.proposals.find((p) => p.rule === 'text-link-same-name');
  assert.match(more.say, /apps\.html.*orgs\.html/);
  assert.equal(m.proposals.some((p) => /Details|install guide/.test(p.say)), false);
});
