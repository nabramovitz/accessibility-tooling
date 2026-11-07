import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bunCommand } from '../src/bun.js';

// cmd.exe would read & ^ and %x% in a path on its command line. On the
// cmd route each argument is in a variable that cmd expands inside
// quotes, so the line holds none of them.
test('the cmd route keeps the arguments off the command line', () => {
  const script = 'C:\\R&D^%x%\\reader-path\\cli.js';
  const c = bunCommand('cmd', [script, '--args-from-env'], { ComSpec: 'C:\\Windows\\system32\\cmd.exe', x: 'EXPANDED' });
  assert.equal(c.file, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepEqual(c.args, ['/d', '/s', '/c', '"bun "%READER_PATH_BUN_ARG0%" "%READER_PATH_BUN_ARG1%""']);
  assert.equal(c.options.windowsVerbatimArguments, true);
  assert.equal(c.options.env.READER_PATH_BUN_ARG0, script);
  assert.equal(c.options.env.READER_PATH_BUN_ARG1, '--args-from-env');
  assert.equal(c.options.env.x, 'EXPANDED');
});

test('the bun route passes the arguments as they are', () => {
  const env = { PATH: '/bin' };
  assert.deepEqual(bunCommand('bun', ['a&b', '%x%'], env), { file: 'bun', args: ['a&b', '%x%'], options: { env } });
});
