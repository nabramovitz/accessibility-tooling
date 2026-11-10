import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttps } from 'node:https';
import { createServer as createHttp } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, pageUrl, bare } from '../src/generate.js';
import { render } from '../src/render.js';
import { selfSigned } from './cert.js';
import { fixture, flat } from './helpers.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));

// Serves one handler on a free port; returns { url, close }.
async function serve(make, handler) {
  const srv = make(handler);
  await new Promise((r) => srv.listen(0, r));
  return { port: srv.address().port, close: () => { srv.closeAllConnections?.(); srv.close(); } };
}
const page = (body) => (req, res) => { res.setHeader('content-type', 'text/html'); res.end(body); };

test('a self-signed https page needs --ignore-https-errors', async () => {
  const s = await serve((h) => createHttps(selfSigned(), h), page('<title>Secure</title><h1>Hi</h1>'));
  const url = `https://localhost:${s.port}/`;
  try {
    await assert.rejects(generate(url), /ERR_CERT/);
    assert.equal((await generate(url, { ignoreHTTPSErrors: true })).title, 'Secure');
    const out = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'out');
    await run('node', [CLI, url, '--ignore-https-errors', '--out', out]);
    assert.equal(JSON.parse(readFileSync(join(out, 'model.json'), 'utf8')).title, 'Secure');
  } finally {
    s.close();
  }
});

const late = (m) => flat(m).some((n) => n.h === 1 && n.name === 'Late heading');

test('a page that renders late is read with --settle or --wait-for', async () => {
  assert.equal(late(await generate(fixture('late.html'), { idle: 0 })), false);
  assert.equal(late(await generate(fixture('late.html'), { settle: 800 })), true);
  assert.equal(late(await generate(fixture('late.html'), { waitFor: 'h1' })), true);
  const out = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'out');
  await run('node', [CLI, fixture('late.html'), '--wait-for', 'h1', '--settle', '50', '--out', out]);
  assert.equal(late(JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'))), true);
});

// A page that gets its content by three requests, one after the other,
// 300 ms each; `/hang` never answers.
const loading = (req, res) => {
  if (req.url === '/data') return void setTimeout(() => res.end('{}'), 300);
  if (req.url === '/hang') return;
  res.setHeader('content-type', 'text/html');
  res.end(`<title>Loads</title><main id="m"><p>Loading</p></main><script>
    (async () => {
      for (let i = 0; i < 3; i++) await fetch('/data');
      document.getElementById('m').innerHTML = '<h1>Late heading</h1>';
      if (location.search === '?hang') fetch('/hang');
    })();
  </script>`);
};

test('a page is read when no request has been in flight for --idle ms', async () => {
  const s = await serve(createHttp, loading);
  const url = `http://localhost:${s.port}/`;
  try {
    const m = await generate(url);
    assert.equal(late(m), true, 'the default waits for the requests');
    assert.deepEqual(m.notes.filter((n) => /still loading/.test(n)), []);
    assert.equal(late(await generate(url, { idle: 0 })), false, '--idle 0 reads at the load event');
    const out = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'out');
    await run('node', [CLI, url, '--idle', '0', '--out', out]);
    assert.equal(late(JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'))), false);
  } finally {
    s.close();
  }
});

test('a request that never ends gives a note, and the page is still read', async () => {
  const s = await serve(createHttp, loading);
  try {
    const m = await generate(`http://localhost:${s.port}/?hang`, { idleMax: 2000 });
    assert.equal(late(m), true);
    assert.ok(m.notes.includes('Page still loading after 2 s: a request is still in flight'), m.notes.join(' | '));
  } finally {
    s.close();
  }
});

test('--idle takes a number of milliseconds', async () => {
  await assert.rejects(run('node', [CLI, fixture('late.html'), '--idle', 'soon']),
    (e) => e.code === 1 && /--idle/.test(e.stderr) && e.stderr.trim().split(/\r?\n/).length === 1);
});

test('--settle takes a number of milliseconds', async () => {
  await assert.rejects(run('node', [CLI, fixture('late.html'), '--settle', 'soon']),
    (e) => e.code === 1 && /--settle/.test(e.stderr) && e.stderr.trim().split(/\r?\n/).length === 1);
});

test('a redirect is a note, with the final url and status', async () => {
  const s = await serve(createHttp, (req, res) => {
    if (req.url === '/old') { res.writeHead(302, { location: '/new?token=abc' }); res.end(); return; }
    res.writeHead(req.url.startsWith('/new') ? 200 : 404, { 'content-type': 'text/html' });
    res.end('<title>New</title><h1>New</h1>');
  });
  const base = `http://localhost:${s.port}`;
  try {
    const m = await generate(`${base}/old`);
    assert.equal(m.url, `${base}/old`);
    assert.equal(m.finalUrl, `${base}/new`);
    assert.equal(m.status, 200);
    assert.ok(m.notes.includes(`Page moved to ${base}/new`));
    const same = await generate(`${base}/new?other=1#top`);
    assert.equal(same.notes.some((x) => x.startsWith('Page moved')), false);
    const missing = await generate(`${base}/missing`);
    assert.equal(missing.status, 404);
  } finally {
    s.close();
  }
});

test('a sign-in token in the final URL is not written', async () => {
  const s = await serve(createHttp, (req, res) => {
    if (req.url === '/old') { res.writeHead(302, { location: '/new?token=secret#x' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>New</title><h1>New</h1>');
  });
  const base = `http://localhost:${s.port}`;
  try {
    const m = await generate(`${base}/old`);
    assert.equal(m.finalUrl, `${base}/new`);
    assert.equal(JSON.stringify(m).includes('secret'), false);
    assert.equal(render(m).includes('secret'), false);
  } finally {
    s.close();
  }
});

// A Windows path starts with a drive letter and a colon, as a URL starts
// with its scheme; a scheme here has two letters or more.
test('a path, also a Windows path, becomes a file URL', async () => {
  assert.equal(pageUrl('https://localhost/a?b'), 'https://localhost/a?b');
  assert.equal(pageUrl('about:blank'), 'about:blank');
  assert.equal(pageUrl(fileURLToPath(fixture('late.html'))), fixture('late.html'));
  assert.match(pageUrl('C:\\pages\\a.html'), /^file:\/\//);
  assert.match(pageUrl('c:/pages/a.html'), /^file:\/\//);
  const out = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'out');
  await run('node', [CLI, fileURLToPath(fixture('structure.html')), '--out', out]);
  assert.equal(JSON.parse(readFileSync(join(out, 'model.json'), 'utf8')).title, 'Fixture');
});

test('a bare url has no query, fragment, user name or password', () => {
  assert.equal(bare('https://user:tok@h.test/p?q=1#f'), 'https://h.test/p');
  assert.equal(bare('https://user@h.test/p'), 'https://h.test/p');
});
