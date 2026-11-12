import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { proposeRows, loadCatalog } from '../src/acr.js';
import { fixture } from './helpers.js';

const OPTS = { views: false };
const ofRule = (m, rule) => (m.proposals || []).filter((p) => p.rule === rule);

test('fields for a person\'s own data with no autocomplete are proposals; fields with autocomplete are not', async () => {
  const m = await generate(fixture('purpose/form.html'), OPTS);
  const fields = ofRule(m, 'text-purpose-field');
  const said = fields.map((p) => p.say).join('\n');
  assert.equal(fields.length, 4, said);
  for (const word of ['First name', 'Contact', 'User name', 'Password']) assert.match(said, new RegExp(word));
  assert.ok(!/Application name|Email address|Search apps/.test(said), said);
  for (const p of fields) assert.equal(p.sc, '1.3.6');
  assert.equal(fields.find((p) => /First name/.test(p.say)).propose, 'autocomplete="given-name"');
  assert.equal(fields.find((p) => /Contact/.test(p.say)).propose, 'autocomplete="email"');
  assert.equal(fields.find((p) => /User name/.test(p.say)).propose, 'autocomplete="username"');
  // A proposal is never a fail.
  assert.ok(!(m.checks['1.3.6']?.fail || []).length);
});

test('a div named like a landmark, with no landmark role, is a proposal; list items and landmark elements are not', async () => {
  const m = await generate(fixture('purpose/form.html'), OPTS);
  const regions = ofRule(m, 'text-purpose-region');
  assert.deepEqual(regions.map((p) => p.say.match(/div[.#]\S+/)[0]).sort(), ['div#footer', 'div.sidebar'].sort());
  for (const p of regions) assert.equal(p.sc, '1.3.6');
});

test('a form with autocomplete and a header with a role makes no purpose proposals', async () => {
  const m = await generate(fixture('purpose/form-ok.html'), OPTS);
  // Only this check's rules: other text checks may propose on this page.
  assert.deepEqual((m.proposals || []).filter((p) => p.rule.startsWith('text-purpose-')), []);
});

test('media counts: per page in the model and a note, and the proposals run with views on too', async () => {
  const m = await generate(fixture('purpose/media.html'), OPTS);
  assert.deepEqual(m.media, { video: 2, audio: 1, object: 1, embed: 1, iframe: 2, autoplay: 1 });
  assert.ok(m.notes.includes('Media elements: 2 video, 1 audio, 1 object, 1 embed, 2 media iframe, 1 autoplay'), m.notes.join('|'));
  const none = await generate(fixture('purpose/no-media.html'), OPTS);
  assert.deepEqual(none.media, { video: 0, audio: 0, object: 0, embed: 0, iframe: 0, autoplay: 0 });
  assert.ok(!none.notes.some((n) => n.startsWith('Media elements')));
  const withViews = await generate(fixture('purpose/form.html'));
  assert.equal(ofRule(withViews, 'text-purpose-field').length, 4);
});

test('the 1.2.x and 1.4.2 row notes say where media is, or that none is', async () => {
  const catalog = loadCatalog();
  const a = await generate(fixture('purpose/no-media.html'), OPTS);
  const b = await generate(fixture('purpose/form-ok.html'), OPTS);
  const c = await generate(fixture('purpose/media.html'), OPTS);
  const rowNote = (rows, num) => Object.values(rows).flat().find((r) => r.num === num).components[0].adherence.notes;
  const rows = proposeRows([a, b], catalog);
  for (const sc of ['1.2.1', '1.2.5', '1.2.9', '1.4.2']) assert.ok(rowNote(rows, sc).includes('No media elements on 2 pages'), sc);
  assert.ok(!rowNote(rows, '1.4.3').includes('media elements'));
  const some = proposeRows([a, c], catalog);
  const note = rowNote(some, '1.4.2');
  assert.match(note, /Media elements on file:.*media\.html \(2 video, 1 audio, 1 object, 1 embed, 2 media iframe, 1 autoplay\); none on 1 other page/);
  assert.ok(!note.includes('No media elements'));
  // The tool does not decide: no level of not-applicable.
  assert.notEqual(Object.values(rows).flat().find((r) => r.num === '1.4.2').components[0].adherence.level, 'not-applicable');
});
