import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shape } from '../src/crawl.js';

test('shape collapses UUID and all-digit segments and joins with underscores', () => {
  assert.equal(shape('/cloud-foundry/5bf170ce-2f87-434f-b99f-4ceb0f18eb26/organizations'), 'cloud-foundry_id_organizations');
  assert.equal(shape('/applications/5bf170ce-2f87-434f-b99f-4ceb0f18eb26/e7842df2-71f7-44e6-9dd8-742151ad4527/ssh/0'), 'applications_id_id_ssh_id');
  assert.equal(shape('/home'), 'home');
  assert.equal(shape('/'), 'root');
  assert.equal(shape('/home/'), 'home');
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../src/crawl.js';
import { fixture } from './helpers.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const SITE = fixture('site/index.html');
const tmp = () => mkdtempSync(join(tmpdir(), 'reader-path-'));
const path = (u) => new URL(u).pathname.replace(/.*\/fixtures\/site/, '');

test('discover walks same-origin links breadth first, one URL per shape, skipping sign-in, fragments and other origins', async () => {
  const { urls, skipped } = await discover(SITE, { max: 20 });
  assert.deepEqual(urls.map(path), ['/index.html', '/a.html', '/b/12345/c.html', '/r.html', '/hidden.html']);
  assert.deepEqual(skipped, []);
});

test('discover stops at --max', async () => {
  const { urls } = await discover(SITE, { max: 2 });
  assert.equal(urls.length, 2);
});

test('the crawl command writes one folder per shape, drops a page that moved to another page, and a run.json', async () => {
  const out = tmp();
  const { stdout } = await run('node', [CLI, 'crawl', SITE, '--out', out, '--settle', '300']);
  const runJson = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
  assert.deepEqual(runJson.pages.map((p) => p.shape).sort(), ['a.html', 'b_id_c.html', 'hidden.html', 'index.html']);
  assert.deepEqual(runJson.dropped.map((p) => path(p.url)), ['/r.html']);
  assert.equal(runJson.start, SITE);
  for (const p of runJson.pages) {
    assert.ok(existsSync(join(out, 'pages', p.shape, 'model.json')), p.shape);
    assert.ok(existsSync(join(out, 'pages', p.shape, 'index.html')), p.shape);
    assert.equal(p.dir, join('pages', p.shape));
  }
  assert.ok(!existsSync(join(out, 'pages', 'r.html')));
  assert.deepEqual(readdirSync(join(out, 'pages')).sort(), ['a.html', 'b_id_c.html', 'hidden.html', 'index.html']);
  assert.ok(stdout.includes('4 page(s)'));
  assert.ok(stdout.includes('1 dropped'));
});

test('--urls takes the list from a file and skips discovery', async () => {
  const out = tmp();
  const list = join(out, 'urls.txt');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(list, `${fixture('site/a.html')}\n\n${fixture('site/hidden.html')}\n`);
  await run('node', [CLI, 'crawl', '--urls', list, '--out', out, '--settle', '300']);
  const runJson = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
  assert.deepEqual(runJson.pages.map((p) => p.shape), ['a.html', 'hidden.html']);
});

test('crawl needs a url or --urls', async () => {
  await assert.rejects(run('node', [CLI, 'crawl']), (e) => /usage/.test(e.stderr));
});
