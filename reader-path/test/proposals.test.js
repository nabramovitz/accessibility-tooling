import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalKey, addProposal, readDecisions } from '../src/proposals.js';

test('the proposal key does not change when node ids change, nor with a count in a name', () => {
  const page = (id, count) => ({ proposals: [], root: { id, role: 'link', name: `Applications (${count})` } });
  const a = page('n12', 43);
  const b = page('n97', 44);
  addProposal(a, a.root, { sc: '2.4.4', rule: 'text-link', text: 'More  about\napps', say: 's' });
  addProposal(b, b.root, { sc: '2.4.4', rule: 'text-link', text: 'More about apps', say: 's' });
  assert.equal(a.proposals[0].key, b.proposals[0].key);
  assert.equal(a.proposals[0].key, 'text-link|link|Applications (#)|More about apps');
  assert.equal(a.proposals[0].node, 'n12');
  assert.equal(proposalKey({ rule: 'r', role: 'x', name: 'n', text: 'y'.repeat(100) }).length, 'r|x|n|'.length + 80);
});

test('a second proposal with the same key on one page adds to its count', () => {
  const m = { root: { id: 'a', role: 'button', name: 'home Home' } };
  addProposal(m, m.root, { sc: '2.4.6', rule: 'text-icon', text: '', say: 's', propose: 'Home' });
  addProposal(m, { ...m.root, id: 'b' }, { sc: '2.4.6', rule: 'text-icon', text: '', say: 's', propose: 'Home' });
  assert.equal(m.proposals.length, 1);
  assert.equal(m.proposals[0].n, 2);
  assert.deepEqual(Object.keys(m.proposals[0]).sort(), ['key', 'n', 'node', 'propose', 'rule', 'say', 'sc']);
});

test('a decisions file is read, and anything else stops with the reason', () => {
  const ok = { version: 1, decided: [{ page: null, key: 'k', verdict: 'fine', note: '', by: 'N', date: '2026-11-12' }] };
  assert.deepEqual(readDecisions(JSON.stringify(ok)), ok.decided);
  for (const [bad, why] of [
    ['nope', /not JSON/],
    [{ version: 2, decided: [] }, /version 1/],
    [{ version: 1 }, /decided/],
    [{ version: 1, decided: [{ key: 'k', verdict: 'maybe' }] }, /defect or fine/],
    [{ version: 1, decided: [{ verdict: 'fine' }] }, /key/],
    [{ version: 1, decided: [{ key: 'k', verdict: 'fine', page: 3 }] }, /page/],
  ]) assert.throws(() => readDecisions(typeof bad === 'string' ? bad : JSON.stringify(bad)), why);
});
