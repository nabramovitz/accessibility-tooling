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

test('discover opens two instances of a shape and keeps the one with more links', async () => {
  const { urls, skipped } = await discover(fixture('site2/index.html'), { max: 20 });
  const rel = (u) => new URL(u).pathname.replace(/.*\/fixtures\/site2/, '');
  // The first instance's list has no links; the item is found through the second.
  assert.deepEqual(urls.map(rel), ['/index.html', '/e/111/home.html', '/e/222/list.html', '/e/222/o/333/item.html']);
  assert.deepEqual(skipped, []);
});

test('discover waits for links that come by a request, and for --wait-for', async () => {
  const { createServer } = await import('node:http');
  const srv = createServer((req, res) => {
    if (req.url === '/links') return void setTimeout(() => res.end('ok'), 400);
    res.setHeader('content-type', 'text/html');
    if (req.url === '/') {
      return void res.end(`<title>Start</title><main id="m"></main><script>
        fetch('/links').then(() => { document.getElementById('m').innerHTML = '<a href="/b">B</a>'; });
        setTimeout(() => { document.getElementById('m').insertAdjacentHTML('beforeend', '<a id="late" href="/c">C</a>'); }, 1500);
      </script>`);
    }
    res.end('<title>Page</title><main><h1 id="late">Page</h1></main>');
  });
  await new Promise((r) => srv.listen(0, r));
  const start = `http://localhost:${srv.address().port}/`;
  const paths = (r) => r.urls.map((u) => new URL(u).pathname);
  try {
    assert.deepEqual(paths(await discover(start, { idle: 0 })), ['/']);
    assert.deepEqual(paths(await discover(start)), ['/', '/b']);
    assert.deepEqual(paths(await discover(start, { waitFor: '#late' })), ['/', '/b', '/c']);
  } finally {
    srv.closeAllConnections?.();
    srv.close();
  }
});

test('a request left in flight by one page does not keep the next page busy', async () => {
  const { createServer } = await import('node:http');
  const { chromium } = await import('playwright');
  const { watchRequests } = await import('../src/generate.js');
  const srv = createServer((req, res) => {
    if (req.url === '/hang') return; // never answers
    res.setHeader('content-type', 'text/html');
    res.end(req.url === '/' ? '<title>1</title><script>fetch("/hang")</script>' : '<title>2</title>');
  });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const idleTime = watchRequests(page);
    await page.goto(`${base}/`, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    assert.equal(idleTime(), 0, 'the first page has a request in flight');
    await page.goto(`${base}/b`, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    assert.ok(idleTime() > 0, 'the second page is idle');
  } finally {
    await browser.close();
    srv.closeAllConnections?.();
    srv.close();
  }
});

test('a change of the address inside one document does not end the wait for its requests', async () => {
  const { createServer } = await import('node:http');
  const { chromium } = await import('playwright');
  const { watchRequests } = await import('../src/generate.js');
  const srv = createServer((req, res) => {
    if (req.url === '/slow') return void setTimeout(() => res.end('ok'), 1500);
    res.setHeader('content-type', 'text/html');
    res.end('<title>1</title><script>fetch("/slow"); history.pushState({}, "", "/tab");</script>');
  });
  await new Promise((r) => srv.listen(0, r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const idleTime = watchRequests(page);
    await page.goto(`http://localhost:${srv.address().port}/`, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    assert.equal(new URL(page.url()).pathname, '/tab');
    assert.equal(idleTime(), 0, 'the request is still in flight');
  } finally {
    await browser.close();
    srv.closeAllConnections?.();
    srv.close();
  }
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
