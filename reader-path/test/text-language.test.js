import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { syllables, readingGrade, acronyms, foreignStretches } from '../src/text-language.js';
import { fixture } from './helpers.js';

const rules = (m, rule) => (m.proposals ?? []).filter((p) => p.rule === rule);

test('syllables are counted by rule', () => {
  const cases = { cat: 1, the: 1, make: 1, table: 2, wanted: 2, jumped: 1, beautiful: 3, organization: 5, rhythm: 1 };
  for (const [w, n] of Object.entries(cases)) assert.equal(syllables(w), n, w);
});

test('foreign stretches need three words in another script', () => {
  const s = (t, page) => foreignStretches(t, page).map((x) => x.script);
  assert.deepEqual(s('Say Καλημέρα σε όλους τους φίλους and go', 'Latin'), ['Greek']);
  assert.deepEqual(s('Καλή μέρα', 'Latin'), []);
  assert.deepEqual(s('Καλημέρα σε όλους τους φίλους', 'Greek'), []);
  assert.deepEqual(s('Hello there my friends', 'Greek'), ['Latin']);
});

test('3.1.2: Greek with no lang is a proposal, with lang or as a control name it is not', async () => {
  const m = await generate(fixture('text-language.html'), { views: false });
  const p = rules(m, 'text-language-part');
  assert.equal(p.length, 1);
  assert.equal(p[0].sc, '3.1.2');
  assert.match(p[0].say, /Greek/);
  assert.match(p[0].say, /Καλημέρα/);
  assert.ok(!p.some((x) => /Ευχαριστώ|Σήμερα|Ανάπτυξη|Ελληνικά|Καλή μέρα/.test(x.say)));
});

test('3.1.5: a hard paragraph is a proposal with the grade, an easy one is not', async () => {
  const hard = await generate(fixture('text-hard.html'), { views: false });
  const p = rules(hard, 'text-reading-level');
  assert.equal(p.length, 1);
  assert.equal(p[0].sc, '3.1.5');
  assert.match(p[0].say, /grade \d+/);
  const easy = await generate(fixture('text-language.html'), { views: false });
  assert.equal(rules(easy, 'text-reading-level').length, 0);
});

test('reading grade: too little text gives no grade', () => {
  assert.equal(readingGrade('Short text here.'), null);
  assert.ok(readingGrade(('The cat sat on the mat. ').repeat(30)) < 3);
});

test('3.1.4: capitals with no expansion are one proposal listing the words; an expansion clears them', async () => {
  const bad = await generate(fixture('text-abbr.html'), { views: false });
  const p = rules(bad, 'text-abbreviation');
  assert.equal(p.length, 1);
  assert.equal(p[0].sc, '3.1.4');
  for (const w of ['CF', 'CLI', 'API', 'SSH']) assert.match(p[0].say, new RegExp(`\\b${w}\\b`));
  assert.doesNotMatch(p[0].say, /\bOK\b/);
  const ok = await generate(fixture('text-abbr-ok.html'), { views: false });
  assert.equal(rules(ok, 'text-abbreviation').length, 0);
});

test('acronyms: expansion in brackets, both ways, and abbr text', () => {
  const runs = (...t) => t.map((text) => ({ text }));
  assert.deepEqual(acronyms(runs('Cloud Foundry (CF) is here. CF rocks.'), []), []);
  assert.deepEqual(acronyms(runs('CF (Cloud Foundry) is here.'), []), []);
  assert.deepEqual(acronyms(runs('Use CF and ssh.'), []), ['CF']);
  assert.deepEqual(acronyms(runs('Use CF now.'), [{ text: 'CF', title: 'Cloud Foundry' }]), []);
  assert.deepEqual(acronyms(runs('ALL CAPS HEADING'), []), []);
});

test('the text checks run with views on too', async () => {
  const m = await generate(fixture('text-abbr.html'));
  assert.equal(rules(m, 'text-abbreviation').length, 1);
});
