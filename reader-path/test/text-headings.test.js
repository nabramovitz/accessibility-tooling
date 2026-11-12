import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture, flat } from './helpers.js';

const mine = (m) => (m.proposals ?? []).filter((p) => p.rule.startsWith('text-'));
const rules = (m, rule) => mine(m).filter((p) => p.rule === rule);

test('an icon word beside the real text of a heading is a proposal; hidden, plain and sole icons are not', async () => {
  const m = await generate(fixture('text-headings/icon.html'));
  const ps = rules(m, 'text-icon-label');
  assert.equal(ps.length, 1, JSON.stringify(mine(m)));
  assert.equal(ps[0].sc, '2.4.6');
  assert.match(ps[0].say, /"home Home".*"home"/);
  assert.match(ps[0].propose, /Home/);
  assert.equal(flat(m).find((n) => n.id === ps[0].node).name, 'home Home');
});

test('an icon word in a button name is a proposal for our rule, named from the title or the text', async () => {
  const m = await generate(fixture('text-headings/icon.html'));
  const ps = rules(m, 'text-icon-name');
  const by = (name) => ps.find((p) => flat(m).find((n) => n.id === p.node).name === name);
  assert.equal(ps.length, 3, JSON.stringify(ps));
  assert.ok(ps.every((p) => p.sc === '302.1'));
  assert.match(by('more_vert').propose, /More actions/);
  assert.match(by('delete Remove').propose, /"Remove"/);
  assert.match(by('menu_open').propose, /nearby heading "Icons"/);
});

test('one icon word on every row of a list is one proposal with a count', async () => {
  const m = await generate(fixture('text-headings/list.html'));
  const ps = rules(m, 'text-icon-name');
  assert.equal(ps.length, 1);
  assert.equal(ps[0].n, 40);
});

test('an empty heading is a proposal; a full or hidden one is not', async () => {
  const m = await generate(fixture('text-headings/structure.html'));
  const ps = rules(m, 'text-empty-heading');
  assert.equal(ps.length, 1);
  assert.equal(ps[0].sc, '2.4.6');
  assert.equal(flat(m).find((n) => n.id === ps[0].node).h, 2);
});

test('two fields with one label in one form are a proposal; other forms and radios are not', async () => {
  const m = await generate(fixture('text-headings/structure.html'));
  const ps = rules(m, 'text-label-same');
  assert.equal(ps.length, 1);
  assert.equal(ps[0].n, 2);
  assert.match(ps[0].say, /"Name"/);
});

test('a main with no heading is a proposal that names the page title; a main with one is not', async () => {
  const bare = await generate(fixture('text-headings/no-heading.html'));
  const ps = rules(bare, 'text-main-no-heading');
  assert.equal(ps.length, 1);
  assert.equal(ps[0].sc, '2.4.6');
  assert.match(ps[0].propose, /No heading here/);
  assert.equal(rules(await generate(fixture('text-headings/structure.html')), 'text-main-no-heading').length, 0);
});

test('a focusable box with no name is a proposal; named, scroll and tabindex -1 boxes are not', async () => {
  const m = await generate(fixture('text-headings/boxes.html'));
  const ps = rules(m, 'text-focus-nameless');
  assert.equal(ps.length, 2, JSON.stringify(ps));
  assert.ok(ps.every((p) => p.sc === '302.1'));
  assert.deepEqual(ps.map((p) => p.propose).sort(), [
    'Name it "Tray" (the visible text)',
    'Name it from the nearby heading "Boxes"',
  ].sort());
});

test('a card with parts and no group name is a proposal, once with a count; named and thin cards are not', async () => {
  const m = await generate(fixture('text-headings/boxes.html'));
  const ps = rules(m, 'text-card-group');
  assert.equal(ps.length, 1, JSON.stringify(ps));
  assert.equal(ps[0].n, 2);
  assert.equal(ps[0].sc, '302.1');
  assert.match(ps[0].propose, /aria-labelledby/);
});

test('the checks are proposals and never a fail', async () => {
  const m = await generate(fixture('text-headings/icon.html'));
  assert.ok(mine(m).length);
  assert.equal(m.checks['2.4.6']?.fail?.length ?? 0, 0);
});

test('the text pass runs with views off', async () => {
  const m = await generate(fixture('text-headings/icon.html'), { views: false });
  assert.equal(rules(m, 'text-icon-label').length, 1);
});
