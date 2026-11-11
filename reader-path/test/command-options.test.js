import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const MODEL = fileURLToPath(new URL('./fixtures/model-pass.json', import.meta.url));
const refused = (flag, command) => (e) => e.code === 1 && e.stderr.includes(`${flag} does not apply to ${command}`) && /usage/.test(e.stderr);

test('acr refuses the page and crawl options', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'r.yaml');
  for (const args of [['--idle', '500'], ['--settle', '1'], ['--storage-state', 'x.json'], ['--ignore-https-errors'],
    ['--wait-for', 'main'], ['--no-views'], ['--max', '3'], ['--urls', 'u.txt'], ['--jobs', '2']]) {
    await assert.rejects(run('node', [CLI, 'acr', MODEL, ...args, '--out', out]), refused(args[0], 'acr'));
  }
  assert.ok(!existsSync(out));
});

test('the page command refuses the acr and crawl options', async () => {
  for (const args of [['--base', 'b.yaml'], ['--max', '3'], ['--urls', 'u.txt'], ['--jobs', '2']]) {
    await assert.rejects(run('node', [CLI, 'file:///nowhere.html', ...args]), refused(args[0], 'the page command'));
  }
});

test('crawl refuses --base', async () => {
  await assert.rejects(run('node', [CLI, 'crawl', 'file:///nowhere.html', '--base', 'b.yaml']), refused('--base', 'crawl'));
});

test('acr still takes --base and --out', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'reader-path-')), 'r.yaml');
  await run('node', [CLI, 'acr', MODEL, '--out', out]);
  assert.ok(existsSync(out));
});
