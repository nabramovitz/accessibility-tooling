import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bunCommand, findBun } from '../src/bun.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The test command, as { file, args, options } for spawnSync: `bun test`
// under Bun or when `bun --version` works, else `node --test`. Plain
// `bun test` stops a test after 5 seconds; a browser run can take
// longer. For node, only the test/*.test.js files: the other files in
// test/ are helpers. route is a route of findBun, or null for none.
export function testCommand(route = process.versions.bun ? 'self' : findBun()) {
  const bunArgs = ['test', '--timeout', '30000'];
  if (route === 'self') return { file: process.execPath, args: bunArgs, options: {} };
  if (route) return bunCommand(route, bunArgs);
  const files = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).sort();
  return { file: process.execPath, args: ['--test', ...files.map((f) => join('test', f))], options: {} };
}
