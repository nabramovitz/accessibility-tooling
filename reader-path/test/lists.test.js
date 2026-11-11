import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { fixture } from './helpers.js';

const note = (m, start) => m.notes.find((n) => n.startsWith(start));
const TEXT = 'Text blocks (1.4.8): ';
const IMAGES = 'Images that may be text (1.4.5, 1.4.9): ';

test('a long line: counted and named in the 1.4.8 note, row in review', async () => {
  const m = await generate(fixture('lists/long.html'));
  assert.match(note(m, TEXT), /^Text blocks \(1\.4\.8\): 1 with lines over 80 characters \(p#long\), 0 with line height under 1\.5, 0 justified$/);
  assert.deepEqual(m.checks['1.4.8'].review, ['list-text']);
  assert.deepEqual(m.checks['1.4.8'].fail, []);
  assert.deepEqual(m.checks['1.4.8'].pass, []);
});

test('a tight line height: counted and named', async () => {
  const m = await generate(fixture('lists/tight.html'));
  assert.match(note(m, TEXT), /0 with lines over 80 characters, 1 with line height under 1\.5 \(p#tight\), 0 justified/);
});

test('justified text: counted and named', async () => {
  const m = await generate(fixture('lists/justified.html'));
  assert.match(note(m, TEXT), /0 with line height under 1\.5, 1 justified \(p#just\)/);
});

test('a wide raster image: named; a square image and an svg are not', async () => {
  const m = await generate(fixture('lists/banner.html'));
  assert.match(note(m, IMAGES), /: 1 raster images wider than 3 times their height \(img#banner\), 0 background images/);
  assert.deepEqual(m.checks['1.4.5'].review, ['list-images']);
  assert.deepEqual(m.checks['1.4.9'].review, ['list-images']);
  assert.deepEqual(m.checks['1.4.5'].fail, []);
});

test('a background image on a box with no text: named; a box with text is not', async () => {
  const m = await generate(fixture('lists/background.html'));
  assert.match(note(m, IMAGES), /0 raster images wider than 3 times their height, 1 background images on elements with no text \(div#bg\)/);
});

test('a page with none of these: counts of 0, rows still in review', async () => {
  const m = await generate(fixture('lists/none.html'));
  assert.match(note(m, TEXT), /: 0 with lines over 80 characters, 0 with line height under 1\.5, 0 justified$/);
  assert.match(note(m, IMAGES), /: 0 raster images wider than 3 times their height, 0 background images on elements with no text;/);
  assert.deepEqual(m.checks['1.4.8'].review, ['list-text']);
});

test('views: false leaves the lists out', async () => {
  const m = await generate(fixture('lists/long.html'), { views: false });
  assert.equal(note(m, TEXT), undefined);
  assert.ok(!m.checks['1.4.8']?.review.includes('list-text'));
});
