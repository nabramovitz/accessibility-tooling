import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/generate.js';
import { crawl } from '../src/crawl.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const WRITES = /write blocked: /;

// A site that logs every request it gets, and every WebSocket open.
// The main page sends a POST, a PUT and a GET, opens a WebSocket, and opens
// a window; that window sends a POST of its own, then a GET marker.
async function site() {
  const seen = [];
  const srv = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.resume();
      res.statusCode = 204;
      return void res.end();
    }
    res.setHeader('content-type', req.url.startsWith('/api') ? 'text/plain' : 'text/html');
    if (req.url === '/popup') {
      return void res.end(`<title>Popup</title><h1>Popup</h1><script>
        fetch('/api/popup-write', { method: 'DELETE' }).catch(() => {}).finally(() => fetch('/api/popup-done'));
      </script>`);
    }
    if (req.url.startsWith('/api')) return void res.end('ok');
    res.end(`<title>Guarded</title><h1>Guarded</h1><script>
      fetch('/api/create', { method: 'POST', body: 'x' }).catch(() => {});
      fetch('/api/update?token=secret', { method: 'PUT', body: 'x' }).catch(() => {});
      fetch('/api/read');
      new WebSocket('ws://' + location.host + '/socket');
      window.open('/popup');
    </script>`);
  });
  srv.on('upgrade', (req, socket) => {
    seen.push(`WS ${req.url}`);
    const key = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
  });
  await new Promise((r) => srv.listen(0, r));
  return {
    url: `http://localhost:${srv.address().port}/`,
    seen,
    writes: () => seen.filter((s) => /^(POST|PUT|PATCH|DELETE) /.test(s)),
    close: () => { srv.closeAllConnections?.(); srv.close(); },
  };
}

const until = async (ok, ms = 5000) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end;) await new Promise((r) => setTimeout(r, 50));
};

test('--act: a POST from the page is blocked and recorded; the server sees none', async () => {
  const s = await site();
  try {
    const m = await generate(s.url, { act: true });
    assert.deepEqual(s.writes().filter((w) => !w.includes('popup')), []);
    const blocked = m.notes.filter((n) => WRITES.test(n));
    assert.ok(blocked.includes('write blocked: POST /api/create'), blocked.join('; '));
    // The query can hold a token: the record has the path only.
    assert.ok(blocked.includes('write blocked: PUT /api/update'), blocked.join('; '));
    assert.ok(!m.notes.join('\n').includes('secret'));
  } finally {
    s.close();
  }
});

test('--act: a GET and a WebSocket still go', async () => {
  const s = await site();
  try {
    await generate(s.url, { act: true });
    assert.ok(s.seen.includes('GET /api/read'), s.seen.join('; '));
    assert.ok(s.seen.includes('WS /socket'), s.seen.join('; '));
  } finally {
    s.close();
  }
});

test('--act: a page opened from the guarded page is guarded too', async () => {
  const s = await site();
  try {
    const m = await generate(s.url, { act: true });
    await until(() => s.seen.includes('GET /api/popup-done'));
    assert.ok(s.seen.includes('GET /popup'), 'the window opened');
    assert.ok(s.seen.includes('GET /api/popup-done'), 'the window ran its script');
    assert.deepEqual(s.writes(), []);
    assert.ok(m.notes.includes('write blocked: DELETE /api/popup-write'), m.notes.join('; '));
  } finally {
    s.close();
  }
});

test('without --act nothing is blocked', async () => {
  const s = await site();
  try {
    const m = await generate(s.url);
    await until(() => s.writes().length >= 3);
    assert.ok(s.seen.includes('POST /api/create'));
    assert.ok(s.seen.includes('PUT /api/update?token=secret'));
    assert.deepEqual(m.notes.filter((n) => WRITES.test(n)), []);
  } finally {
    s.close();
  }
});

// Two tests: each --act page has the 10 s watch and the single keys.
test('--act on the page command', async () => {
  const s = await site();
  try {
    const out = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'out');
    await run('node', [CLI, s.url, '--act', '--out', out]);
    const m = JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'));
    assert.ok(m.notes.includes('write blocked: POST /api/create'));
  } finally {
    s.close();
  }
});

test('--act on crawl; run.json records it', async () => {
  const s = await site();
  try {
    const list = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'urls.txt');
    await run('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(list)}, ${JSON.stringify(s.url)})`]);
    const crawlOut = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'run');
    await run('node', [CLI, 'crawl', '--urls', list, '--act', '--out', crawlOut]);
    assert.equal(JSON.parse(readFileSync(join(crawlOut, 'run.json'), 'utf8')).act, true);

    const plain = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'run');
    await crawl(undefined, { urls: [s.url], out: plain });
    assert.equal(JSON.parse(readFileSync(join(plain, 'run.json'), 'utf8')).act, false);
    await assert.rejects(run('node', [CLI, 'acr', 'x.json', '--act', '--out', 'y.yaml']), /--act does not apply to acr/);
  } finally {
    s.close();
  }
});
