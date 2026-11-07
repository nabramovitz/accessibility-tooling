import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture, flat } from './helpers.js';

test('landmarks and headings', async () => {
  const m = await generate(fixture('structure.html'));
  const all = flat(m);
  assert.equal(m.title, 'Fixture');
  assert.deepEqual(all.filter((n) => n.lm).map((n) => [n.lm, n.name]), [['navigation', 'Main']]);
  assert.deepEqual(all.filter((n) => n.h).map((n) => [n.h, n.name]), [[1, 'Home'], [3, 'Shortcuts']]);
});

test('hidden content is not in the model', async () => {
  const all = flat(await generate(fixture('structure.html')));
  assert.equal(all.filter((n) => n.name === 'Hidden A' || n.name === 'Hidden B').length, 0);
});

test('shadow DOM button has its custom element as comp', async () => {
  const all = flat(await generate(fixture('structure.html')));
  const b = all.find((n) => n.name === 'Add to favorites');
  assert.ok(b);
  assert.equal(b.role, 'button');
  assert.equal(b.comp, 'x-star');
});

test('message box and state', async () => {
  const all = flat(await generate(fixture('structure.html')));
  const box = all.find((n) => n.box && n.box.live === 'polite' && /3 endpoints shown/.test(n.text || ''));
  assert.ok(box);
  assert.equal(all.find((n) => n.name === 'Menu').state, 'collapsed');
});

test('a focusable generic element is its own node', async () => {
  const all = flat(await generate(fixture('focusable.html')));
  const kept = all.find((n) => n.lm === 'region' && n.name === 'Kept');
  assert.deepEqual(kept.c.map((n) => [n.role, n.text, n.tab]), [['generic', 'One', 1], ['generic', 'Two', 2]]);
});
