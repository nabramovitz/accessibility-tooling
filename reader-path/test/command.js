import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBun } from '../src/bun.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The test command, as [file, ...arguments]: `bun test` under Bun or
// when `bun --version` works, else `node --test`. Plain `bun test` stops
// a test after 5 seconds; a browser run can take longer. For node, only
// the test/*.test.js files: the other files in test/ are helpers.
export function testCommand(bun = process.versions.bun ? [process.execPath] : findBun()) {
  if (bun) return [...bun, 'test', '--timeout', '30000'];
  const files = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).sort();
  return [process.execPath, '--test', ...files.map((f) => join('test', f))];
}
