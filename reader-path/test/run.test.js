import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { testCommand } from './command.js';

test('the test command is bun test, else node --test with the test files only', () => {
  assert.deepEqual(testCommand(['bun']), ['bun', 'test', '--timeout', '30000']);
  const [node, flag, ...files] = testCommand(null);
  assert.equal(node, process.execPath);
  assert.equal(flag, '--test');
  assert.ok(files.includes(join('test', 'run.test.js')), files.join(' '));
  assert.ok(files.includes(join('test', 'tree.test.js')), files.join(' '));
  assert.deepEqual(files.filter((f) => !/^test[\\/][\w-]+\.test\.js$/.test(f)), []);
});
