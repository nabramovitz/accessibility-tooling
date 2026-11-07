import { pathToFileURL, fileURLToPath } from 'node:url';
import { walk } from '../src/generate.js';

export const fixture = (name) =>
  pathToFileURL(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))).href;

export const flat = (m) => { const all = []; walk(m.root, (n) => all.push(n)); return all; };
