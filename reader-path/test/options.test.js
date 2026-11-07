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
import { generate, pageUrl } from '../src/generate.js';
import { render } from '../src/render.js';
import { selfSigned } from './cert.js';
import { fixture, flat } from './helpers.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));

// Serves one handler on a free port; returns { url, close }.
async function serve(make, handler) {
  const srv = make(handler);
  await new Promise((r) => srv.listen(0, r));
  return { port: srv.address().port, close: () => srv.close() };
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
  assert.equal(late(await generate(fixture('late.html'))), false);
  assert.equal(late(await generate(fixture('late.html'), { settle: 800 })), true);
  assert.equal(late(await generate(fixture('late.html'), { waitFor: 'h1' })), true);
  const out = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'out');
  await run('node', [CLI, fixture('late.html'), '--wait-for', 'h1', '--settle', '50', '--out', out]);
  assert.equal(late(JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'))), true);
});

test('--settle takes a number of milliseconds', async () => {
  await assert.rejects(run('node', [CLI, fixture('late.html'), '--settle', 'soon']),
    (e) => e.code === 1 && /--settle/.test(e.stderr) && e.stderr.trim().split('\n').length === 1);
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
