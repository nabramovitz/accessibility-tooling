import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttps } from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/generate.js';
import { selfSigned } from './cert.js';

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
