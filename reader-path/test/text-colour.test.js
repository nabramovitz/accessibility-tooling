import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture, flat } from './helpers.js';

test('status dots that differ only in colour, with no text or name, are one proposal', async () => {
  const m = await generate(fixture('colour/dots.html'), { views: false });
  const ps = (m.proposals ?? []).filter((p) => p.rule === 'text-colour-only');
  assert.equal(ps.length, 1);
  const [p] = ps;
  assert.equal(p.sc, '1.4.1');
  assert.match(p.say, /3 small elements \(span\.dot\)/);
  assert.match(p.say, /green/);
  assert.match(p.say, /red/);
  assert.match(p.say, /amber|orange|yellow/);
  assert.ok(p.propose);
  assert.ok(flat(m).some((n) => n.id === p.node), 'the proposal names a node in the tree');
  assert.deepEqual(m.checks['1.4.1']?.fail ?? [], [], 'never a fail by itself');
});

test('it runs with the views on too', async () => {
  const m = await generate(fixture('colour/dots.html'));
  assert.equal(m.proposals.filter((p) => p.rule === 'text-colour-only').length, 1);
});

test('same colour, a text label, a name, a title, big boxes, one dot, or other classes: no proposal', async () => {
  const m = await generate(fixture('colour/fine.html'), { views: false });
  assert.deepEqual((m.proposals ?? []).filter((p) => p.rule === 'text-colour-only'), []);
});
