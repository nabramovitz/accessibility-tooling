import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture } from './helpers.js';

const note = (m, start) => m.notes.find((n) => n.startsWith(start));
const LONG = '1.4.8 lines over 80 characters: ';
const TIGHT = '1.4.8 line height under 1.5: ';
const JUSTIFIED = '1.4.8 justified text: ';
const WIDE = '1.4.5, 1.4.9 raster images more than 3 times as wide as high: ';
const BACK = '1.4.5, 1.4.9 background images on elements with no text: ';

test('a long line: counted and named in its own note, row in review', async () => {
  const m = await generate(fixture('lists/long.html'));
  assert.match(note(m, LONG), /^1\.4\.8 lines over 80 characters: 1 text block: p#long \(about \d+ characters a line\)$/);
  assert.equal(note(m, TIGHT), `${TIGHT}none`);
  assert.equal(note(m, JUSTIFIED), `${JUSTIFIED}none`);
  assert.deepEqual(m.checks['1.4.8'].review, ['list-text']);
  assert.deepEqual(m.checks['1.4.8'].fail, []);
  assert.deepEqual(m.checks['1.4.8'].pass, []);
});

test('a tight line height: counted, named, with the line height', async () => {
  const m = await generate(fixture('lists/tight.html'));
  assert.match(note(m, TIGHT), /^1\.4\.8 line height under 1\.5: 1 text block: p#tight \(line height 1\.\d+\)$/);
});

test('blocks of one kind are grouped, the largest group first, with the range of values', async () => {
  const m = await generate(fixture('lists/tight-many.html'));
  assert.equal(note(m, TIGHT), `${TIGHT}4 text blocks: p.cell ×3 (line height 1.2), p#one (line height 1.3)`);
});

test('justified text: counted and named', async () => {
  const m = await generate(fixture('lists/justified.html'));
  assert.equal(note(m, JUSTIFIED), `${JUSTIFIED}1 text block: p#just`);
});

test('wide raster images, thin ones too, with their size; a square image and an svg are not', async () => {
  const m = await generate(fixture('lists/banner.html'));
  assert.equal(note(m, WIDE), `${WIDE}2 images: img#banner (400 × 50 px), img#thin (400 × 4 px)`);
  assert.deepEqual(m.checks['1.4.5'].review, ['list-images']);
  assert.deepEqual(m.checks['1.4.9'].review, ['list-images']);
  assert.deepEqual(m.checks['1.4.5'].fail, []);
});

test('a background image on a box with no text: named; a box with text is not', async () => {
  const m = await generate(fixture('lists/background.html'));
  assert.equal(note(m, BACK), `${BACK}1 element: div#bg`);
});

test('a page with none of these: five notes that say none, rows still in review', async () => {
  const m = await generate(fixture('lists/none.html'));
  for (const start of [LONG, TIGHT, JUSTIFIED, WIDE, BACK]) assert.equal(note(m, start), `${start}none`);
  assert.deepEqual(m.checks['1.4.8'].review, ['list-text']);
});

test('views: false leaves the lists out', async () => {
  const m = await generate(fixture('lists/long.html'), { views: false });
  assert.equal(note(m, LONG), undefined);
  assert.ok(!m.checks['1.4.8']?.review.includes('list-text'));
});
