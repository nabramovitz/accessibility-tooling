#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from './src/generate.js';
import { render } from './src/render.js';

const USAGE = 'usage: reader-path <url> [--out <dir>] [--storage-state <file>]';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'reader-path-out' },
      'storage-state': { type: 'string' },
    },
  });
  if (positionals.length !== 1) throw new Error(USAGE);
  const arg = positionals[0];
  const url = /^[a-z][a-z0-9+.-]*:/i.test(arg) ? arg : pathToFileURL(arg).href;
  const model = await generate(url, { storageState: values['storage-state'] });
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, 'model.json'), JSON.stringify(model, null, 2) + '\n');
  writeFileSync(join(values.out, 'index.html'), render(model));
  console.log(`wrote ${join(values.out, 'index.html')} and ${join(values.out, 'model.json')}`);
} catch (e) {
  console.error(`reader-path: ${String(e.message).split('\n')[0]}`);
  process.exit(1);
}
