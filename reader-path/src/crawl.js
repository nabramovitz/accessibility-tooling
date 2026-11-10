// A run over a site: find the pages by their links, one page per route
// shape, then read each with generate(). The crawl follows links only; it
// never presses a button or sends a form.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { generate, bare, watchRequests, ready } from './generate.js';
import { render } from './render.js';

const ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;
const SIGN_IN = /\/(login|logout)\b/;

// One folder name per route shape: ids collapse, so one page stands for
// every page of that shape. `base` is the start page's directory, so a
// file: run gets short names.
export function shape(pathname, base = '/') {
  const rel = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const parts = rel.split('/').filter(Boolean).map((p) => (ID.test(p) ? 'id' : p));
  return parts.length ? parts.join('_') : 'root';
}

const dirOf = (u) => new URL(u).pathname.replace(/[^/]*$/, '');

const pageOptions = (opts) => ({
  ...(opts.ignoreHTTPSErrors ? { ignoreHTTPSErrors: true } : {}),
  ...(opts.storageState ? { storageState: opts.storageState } : {}),
});

// Breadth first over same-site links from `start`; one URL per shape.
// Up to two instances of a shape are opened and the links of both are
// followed; the run keeps the one with more same-site links (a tie keeps
// the first), so a first instance that is a dead end does not hide the
// pages below its shape.
export async function discover(start, opts = {}) {
  const max = opts.max ?? 100;
  const startUrl = new URL(start);
  const base = dirOf(start);
  const sameSite = (u) => u.protocol === startUrl.protocol && u.host === startUrl.host;
  const seen = new Map([[shape(startUrl.pathname, base), [bare(start)]]]);
  const linkCount = new Map();
  const queue = [bare(start)];
  const skipped = [];
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(pageOptions(opts));
    const page = await context.newPage();
    const idleTime = watchRequests(page);
    while (queue.length && seen.size < max) {
      const url = queue.shift();
      try {
        await page.goto(url, { waitUntil: 'load' });
        await ready(page, idleTime, opts);
      } catch (e) {
        skipped.push({ url, why: String(e.message).split('\n')[0] });
        continue;
      }
      if (SIGN_IN.test(new URL(page.url()).pathname)) {
        skipped.push({ url, why: 'a sign-in page came in its place; the crawl stopped' });
        break;
      }
      // A page that moves on by itself (meta refresh) destroys the first read.
      const links = () => page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      const hrefs = await links().catch(async () => { await page.waitForLoadState('load').catch(() => {}); return links().catch(() => []); });
      const found = new Set();
      for (const h of hrefs) {
        if (!h || h.startsWith('#')) continue;
        let u;
        try { u = new URL(h, url); } catch { continue; }
        if (!sameSite(u) || SIGN_IN.test(u.pathname)) continue;
        const href = bare(u.href);
        found.add(href);
        const key = shape(u.pathname, base);
        const instances = seen.get(key);
        if (!instances) {
          if (seen.size >= max) continue;
          seen.set(key, [href]);
        } else if (instances.length < 2 && instances[0] !== href) {
          instances.push(href);
        } else continue;
        queue.push(href);
      }
      linkCount.set(url, found.size);
    }
  } finally {
    await browser.close();
  }
  const links = (u) => linkCount.get(u) ?? 0;
  const urls = [...seen.values()].map(([first, second]) => (second && links(second) > links(first) ? second : first));
  return { urls, skipped };
}

// The run: discover (or take `opts.urls`), read every page, write the run
// folder. A page that moved to another page of the run is dropped.
export async function crawl(start, opts = {}) {
  const out = opts.out ?? 'reader-path-run';
  const found = opts.urls ? { urls: opts.urls.map(bare), skipped: [] } : await discover(start, opts);
  const base = dirOf(start ?? found.urls[0]);
  const models = [];
  for (const url of found.urls) models.push(await generate(url, opts));
  const urls = new Set(models.map((m) => m.url));
  const dropped = models.filter((m) => m.finalUrl !== m.url && urls.has(m.finalUrl));
  const kept = models.filter((m) => !dropped.includes(m));
  const pages = kept.map((m) => {
    const dir = join('pages', shape(new URL(m.url).pathname, base));
    mkdirSync(join(out, dir), { recursive: true });
    writeFileSync(join(out, dir, 'model.json'), JSON.stringify(m, null, 2) + '\n');
    writeFileSync(join(out, dir, 'index.html'), render(m));
    return { url: m.url, finalUrl: m.finalUrl, shape: shape(new URL(m.url).pathname, base), dir };
  });
  const run = {
    start: start ?? null,
    generated: new Date().toISOString(),
    browser: models[0]?.browser ?? null,
    pages,
    dropped: dropped.map((m) => ({ url: m.url, finalUrl: m.finalUrl })),
    skipped: found.skipped,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  return { out, run };
}
