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
import { discover, inPool } from '../src/crawl.js';
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
    assert.equal(JSON.parse(readFileSync(join(out, 'pages', p.shape, 'model.json'), 'utf8')).shape, p.shape, 'the model knows its shape');
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

test('--add reads the listed pages as well as the found ones; a listed page stands for its shape', async () => {
  const out = tmp();
  const list = join(out, 'add.txt');
  const { writeFileSync } = await import('node:fs');
  // added.html has no link to it; b/67890 is the second c.html, which discovery does not keep.
  writeFileSync(list, `${fixture('site/added.html')}\n${fixture('site/b/67890/c.html')}\n`);
  await run('node', [CLI, 'crawl', SITE, '--add', list, '--out', out, '--no-views']);
  const runJson = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
  assert.deepEqual(runJson.pages.map((p) => path(p.url)), ['/index.html', '/a.html', '/hidden.html', '/added.html', '/b/67890/c.html']);
});

test('--version-url records the build before and after the run, and warns when it changed', async () => {
  const { createServer } = await import('node:http');
  let calls = 0;
  const srv = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ git_commit: ++calls === 1 ? 'aaa' : 'bbb' }));
  });
  await new Promise((r) => srv.listen(0, r));
  const version = `http://localhost:${srv.address().port}/version`;
  try {
    const out = tmp();
    const { stdout } = await run('node', [CLI, 'crawl', fixture('site/a.html'), '--max', '1', '--no-views', '--version-url', version, '--out', out]);
    const runJson = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
    assert.deepEqual(runJson.build, { before: { git_commit: 'aaa' }, after: { git_commit: 'bbb' } });
    assert.ok(stdout.includes('the build changed during the run'), stdout);
  } finally {
    srv.close();
  }
});

test('without --version-url the run has no build', async () => {
  const out = tmp();
  await run('node', [CLI, 'crawl', fixture('site/a.html'), '--max', '1', '--no-views', '--out', out]);
  assert.equal(JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')).build, undefined);
});

test('inPool runs at most n at a time and keeps the order of the items', async () => {
  let now = 0;
  let most = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = await inPool([30, 10, 20, 5, 15], 2, async (ms) => {
    most = Math.max(most, ++now);
    await wait(ms);
    now--;
    return ms * 2;
  });
  assert.deepEqual(out, [60, 20, 40, 10, 30]);
  assert.equal(most, 2);
});

test('inPool starts no new item after a failure, waits for the running ones, and throws', async () => {
  const started = [];
  let ended = 0;
  await assert.rejects(inPool([1, 2, 3, 4], 2, async (x) => {
    started.push(x);
    await new Promise((r) => setTimeout(r, x === 1 ? 5 : 30));
    if (x === 1) throw new Error('page 1 failed');
    ended++;
  }), /page 1 failed/);
  assert.deepEqual(started, [1, 2]);
  assert.equal(ended, 1);
});

test('--jobs reads pages at the same time and keeps the order of the list', async () => {
  const out = tmp();
  const list = join(out, 'urls.txt');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(list, `${fixture('site/a.html')}
${fixture('site/hidden.html')}
${fixture('site/index.html')}
`);
  await run('node', [CLI, 'crawl', '--urls', list, '--out', out, '--no-views', '--jobs', '2']);
  const runJson = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
  assert.deepEqual(runJson.pages.map((p) => p.shape), ['a.html', 'hidden.html', 'index.html']);
});

test('--jobs takes a whole number above 0', async () => {
  await assert.rejects(run('node', [CLI, 'crawl', SITE, '--jobs', '0']), (e) => /--jobs takes a whole number/.test(e.stderr));
});

test('crawl needs a url or --urls', async () => {
  await assert.rejects(run('node', [CLI, 'crawl']), (e) => /usage/.test(e.stderr));
});

import { createServer } from 'node:http';
import { crawl } from '../src/crawl.js';
import { generate } from '../src/generate.js';

// A server: `/go/*` moves to `/z` (302); every other path is a page named by it.
async function server() {
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/go/')) { res.statusCode = 302; res.setHeader('location', '/z'); return void res.end(); }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html lang="en"><title>${req.url}</title><main><h1>Page ${req.url}</h1></main>`);
  });
  await new Promise((r) => srv.listen(0, r));
  return { url: `http://localhost:${srv.address().port}`, close: () => { srv.closeAllConnections?.(); srv.close(); } };
}
const FAST = { views: false, idle: 100, actAfter: 150, actIdle: 800, actHover: 150, actKeys: '', actWatch: 0, actSignIn: 500 };
const model = (out, p) => JSON.parse(readFileSync(join(out, p.dir, 'model.json'), 'utf8'));

test('two listed pages that land on one page: the first is read, the second is dropped unread', async () => {
  const s = await server();
  try {
    const out = tmp();
    const { run: r } = await crawl(null, { ...FAST, urls: [`${s.url}/go/a`, `${s.url}/go/b`], out });
    assert.deepEqual(r.pages.map((p) => new URL(p.url).pathname), ['/go/a']);
    assert.deepEqual(r.dropped.map((p) => [new URL(p.url).pathname, new URL(p.finalUrl).pathname]), [['/go/b', '/z']]);
  } finally { s.close(); }
});

test('generate stops after the load when skip says the landing page is read already', async () => {
  const s = await server();
  try {
    const m = await generate(`${s.url}/go/a`, { ...FAST, skip: (u) => new URL(u).pathname === '/z' });
    assert.equal(new URL(m.finalUrl).pathname, '/z');
    assert.equal(m.skipped, true);
    assert.equal(m.root, undefined, 'the page was not read');
  } finally { s.close(); }
});

test('--act over a run: the session proposals stay on the first page, the others get a note', async () => {
  const s = await server();
  try {
    const out = tmp();
    const storageState = { cookies: [{ name: 'sess', value: 'v', domain: 'localhost', path: '/', expires: Math.round(Date.now() / 1000) + 30 * 60, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] };
    const { run: r } = await crawl(null, { ...FAST, act: true, storageState, urls: [`${s.url}/one`, `${s.url}/two`], out });
    const [one, two] = r.pages.map((p) => model(out, p));
    const session = (m) => (m.proposals || []).filter((p) => p.rule.startsWith('walk-session-')).map((p) => p.rule);
    assert.deepEqual(session(one), ['walk-session-timeout', 'walk-session-timing', 'walk-session-reauth', 'walk-session-warning']);
    assert.deepEqual(session(two), []);
    assert.ok(two.notes.some((n) => /session proposals .* on \S+\/one/.test(n)), two.notes.join(' | '));
    assert.ok(two.checks['2.2.1'].review.includes('walk-session-timeout'), 'the row still needs a person on every page');
  } finally { s.close(); }
});
