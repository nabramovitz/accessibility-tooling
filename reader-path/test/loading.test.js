import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate.js';
import { crawl, discover } from '../src/crawl.js';
import { fixture } from './helpers.js';

const sign = (m) => m.notes.filter((n) => n.startsWith('Page shows a loading sign'));
const opts = { views: false, idle: 0 };

test('a status that says Loading gives a run note', async () => {
  const m = await generate(fixture('loading-status.html'), opts);
  assert.deepEqual(sign(m), ['Page shows a loading sign: Loading organizations…']);
});

test('a progressbar gives a run note', async () => {
  const m = await generate(fixture('loading-bar.html'), opts);
  assert.deepEqual(sign(m), ['Page shows a loading sign: Working']);
});

test('a busy node gives a run note', async () => {
  const m = await generate(fixture('loading-busy.html'), opts);
  assert.equal(sign(m).length, 1, m.notes.join(' | '));
});

test('a page with no loading sign has no note', async () => {
  assert.deepEqual(sign(await generate(fixture('structure.html'), opts)), []);
});

test('run.json lists the pages that show a loading sign', async () => {
  const out = mkdtempSync(join(tmpdir(), 'reader-path-'));
  const urls = [fixture('loading-status.html'), fixture('structure.html')];
  const { run } = await crawl(undefined, { ...opts, urls, out });
  assert.deepEqual(run.loading, [fixture('loading-status.html')]);
  assert.deepEqual(run.discoverStillLoading, []);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')).loading, run.loading);
});

test('discover names the pages where its wait gave up', async () => {
  const srv = createServer((req, res) => {
    if (req.url === '/hang') return;
    res.setHeader('content-type', 'text/html');
    res.end(req.url === '/' ? '<title>1</title><main><a href="/b">B</a></main><script>fetch("/hang")</script>' : '<title>2</title><main>B</main>');
  });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  try {
    const found = await discover(`${base}/`, { idleMax: 1000 });
    assert.deepEqual(found.stillLoading, [`${base}/`]);
  } finally {
    srv.closeAllConnections?.();
    srv.close();
  }
});
