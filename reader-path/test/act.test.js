import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from '../src/generate.js';
import { render } from '../src/render.js';

// Short waits for the tests; the defaults are 2 s after idle and 10 s.
const FAST = { act: true, views: false, idle: 100, actAfter: 150, actIdle: 800 };

// A site: `pages` maps a path to html (or a function of the request that
// ends the response itself). Every request is logged.
async function site(pages) {
  const seen = [];
  const srv = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const p = pages[req.url.split('?')[0]];
    if (typeof p === 'function') return p(req, res);
    if (p === undefined) { res.statusCode = req.method === 'GET' ? 404 : 204; return void res.end(); }
    res.setHeader('content-type', 'text/html');
    res.end(p);
  });
  await new Promise((r) => srv.listen(0, r));
  return {
    url: `http://localhost:${srv.address().port}/`,
    seen,
    writes: () => seen.filter((s) => /^(POST|PUT|PATCH|DELETE) /.test(s)),
    close: () => { srv.closeAllConnections?.(); srv.close(); },
  };
}

const page = (body) => `<!doctype html><html lang="en"><title>T</title><main><h1>T</h1>${body}</main>`;
const run = async (pages, opts = {}) => {
  const s = await site({ '/': page(pages.body ?? ''), ...(pages.routes || {}) });
  try { return { m: await generate(s.url, { ...FAST, ...opts }), s: { seen: [...s.seen], writes: s.writes() } }; } finally { s.close(); }
};
const action = (m, name) => m.actions.find((a) => a.name === name);
const rules = (m) => (m.proposals || []).map((p) => `${p.sc} ${p.rule}`);
const text = (a) => a.events.map((e) => `${e.type}: ${e.text}`).join(' | ');

const NATIVE_DIALOG = `<button id=o>Open</button><dialog id=d><p>Hi</p><button id=c>Close</button></dialog>
  <script>o.onclick = () => d.showModal(); c.onclick = () => d.close();</script>`;
const LOSING_DIALOG = `<button id=o>Open</button><div id=d role=dialog aria-label=Hi hidden><p>Hi</p><button id=c tabindex=0>Close</button></div>
  <script>const close = () => { d.hidden = true; document.activeElement.blur(); };
  o.onclick = () => { d.hidden = false; c.focus(); };
  d.onkeydown = (e) => { if (e.key === 'Escape') close(); }; c.onclick = close;</script>`;

test('a dialog that opens and returns focus: no finding, a pass', async () => {
  const { m } = await run({ body: NATIVE_DIALOG });
  const a = action(m, 'Open');
  assert.equal(a.kind, 'press');
  assert.ok(a.events.some((e) => e.type === 'context' && /dialog opened/.test(e.text)), text(a));
  assert.ok(a.events.some((e) => e.type === 'focus' && /returned/.test(e.text)), text(a));
  assert.deepEqual(rules(m).filter((r) => r.startsWith('2.4.3')), []);
  assert.ok(m.checks['2.4.3'].pass.includes('walk-focus-return'));
  assert.ok(m.root.id && a.node, 'the action points at a node');
});

test('a dialog that does not return focus: a 2.4.3 proposal', async () => {
  const { m } = await run({ body: LOSING_DIALOG });
  assert.deepEqual(rules(m).filter((r) => r.startsWith('2.4.3')), ['2.4.3 walk-focus-return']);
  assert.ok(m.checks['2.4.3'].review.includes('walk-focus-return'));
  assert.equal(m.checks['2.4.3'].fail?.includes('walk-focus-return') ?? false, false);
  assert.ok(m.proposals[0].say.includes('Open'));
});

const DELETE_CONFIRM = `<button id=o>Delete</button><dialog id=d><p>Sure?</p><button id=y>Confirm</button></dialog>
  <script>o.onclick = () => d.showModal(); y.onclick = () => fetch('/api/x', { method: 'DELETE' });</script>`;
const DELETE_NONE = `<button id=o>Delete</button><script>o.onclick = () => fetch('/api/x', { method: 'DELETE' });</script>`;

test('a delete with a confirm step: no write, no 3.3.4 proposal', async () => {
  const { m, s } = await run({ body: DELETE_CONFIRM });
  assert.deepEqual(s.writes, []);
  assert.deepEqual(rules(m).filter((r) => r.startsWith('3.3')), []);
});

test('a delete with no confirm step: blocked, recorded, proposed for 3.3.4 and 3.3.6', async () => {
  const { m, s } = await run({ body: DELETE_NONE });
  assert.deepEqual(s.writes, []);
  assert.ok(action(m, 'Delete').events.some((e) => e.type === 'write' && e.text === 'write blocked: DELETE /api/x'), text(action(m, 'Delete')));
  assert.deepEqual(rules(m).filter((r) => r.startsWith('3.3')).sort(), ['3.3.4 walk-write-no-confirm', '3.3.6 walk-write-no-confirm-reversal']);
  assert.ok(m.checks['3.3.4'].review.includes('walk-write-no-confirm'));
});

const SNACK = (attrs) => `<button id=o>Save</button><div id=s ${attrs}></div><script>o.onclick = () => { s.textContent = 'Saved the thing'; };</script>`;

test('a snackbar with no live region: a 4.1.3 proposal', async () => {
  const { m } = await run({ body: SNACK('') });
  assert.ok(action(m, 'Save').events.some((e) => e.type === 'text' && /Saved the thing/.test(e.text)));
  assert.deepEqual(rules(m).filter((r) => r.startsWith('4.1.3')), ['4.1.3 walk-live-missing']);
});

test('a snackbar in a live region: live text, a pass', async () => {
  const { m } = await run({ body: SNACK('role=status') });
  assert.ok(action(m, 'Save').events.some((e) => e.type === 'live' && /Saved the thing/.test(e.text)));
  assert.deepEqual(rules(m).filter((r) => r.startsWith('4.1.3')), []);
  assert.ok(m.checks['4.1.3'].pass.includes('walk-live-missing'));
});

test('a select that navigates on change: a 3.2.2 proposal', async () => {
  const { m } = await run({
    body: `<label>Go to <select id=s aria-label=Section onchange="location.href='/two'"><option>One</option><option value=/two>Two</option></select></label>`,
    routes: { '/two': page('<p>two</p>') },
  });
  const a = action(m, 'Section');
  assert.ok(a.events.some((e) => e.type === 'context' && /url/.test(e.text)), text(a));
  assert.deepEqual(rules(m).filter((r) => r.startsWith('3.2')), ['3.2.2 walk-context-input']);
});

test('a control that opens a dialog on focus alone: a 3.2.1 proposal', async () => {
  const { m } = await run({
    body: `<button id=o onfocus="d.hidden = false">Jump</button><div id=d role=dialog aria-label=Hi hidden>Hi</div>`,
  });
  assert.equal(action(m, 'Jump').kind, 'focus', JSON.stringify(m.actions));
  assert.ok(rules(m).includes('3.2.1 walk-context-focus'));
});

test('a dialog with no Escape: "dialog did not close", the page is loaded again, the walk goes on', async () => {
  const { m } = await run({
    body: `<button id=o>Open</button><div id=d role=dialog aria-label=Trap hidden><p>Stuck</p></div>
      <script>o.onclick = () => { d.hidden = false; }; d.onkeydown = (e) => e.preventDefault();</script>
      <button id=n>Next</button>`,
  });
  assert.ok(action(m, 'Open').events.some((e) => /dialog did not close/.test(e.text)), text(action(m, 'Open')));
  assert.ok(action(m, 'Next'), 'the next control was pressed after the reload');
});

test('an action that signs out indirectly: "signed out by the action", the state is loaded again, the walk goes on', async () => {
  const login = (req, res) => { res.setHeader('content-type', 'text/html'); res.end(page('<h1>Sign in</h1>')); };
  const home = (req, res) => {
    if (!/sid=1/.test(req.headers.cookie || '')) { res.statusCode = 302; res.setHeader('location', '/login'); return void res.end(); }
    res.setHeader('content-type', 'text/html');
    res.end(page(`<button id=o>Refresh</button><button id=n>Other</button>
      <script>o.onclick = () => fetch('/api/data').then((r) => { if (r.status === 401) location.href = '/login'; });</script>`));
  };
  const s = await site({
    '/': home, '/login': login,
    '/api/data': (req, res) => { res.statusCode = 401; res.setHeader('set-cookie', 'sid=; Max-Age=0; Path=/'); res.end(); },
  });
  try {
    const state = { cookies: [{ name: 'sid', value: '1', domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] };
    const m = await generate(s.url, { ...FAST, storageState: state });
    assert.ok(action(m, 'Refresh').events.some((e) => e.text === 'signed out by the action'), text(action(m, 'Refresh')));
    assert.ok(action(m, 'Other'), 'pressed after the session was restored');
    assert.equal(m.title, 'T');
  } finally { s.close(); }
});

test('policy: one action for a control in each row; links away and the SSH page are left; sign out goes last', async () => {
  const rows = [1, 2, 3].map((i) => `<li>Row ${i} <button>Delete row ${i}</button> <button>Edit row ${i}</button></li>`).join('');
  const { m } = await run({
    body: `<ul>${rows}</ul><button>Sign out</button><button>Menu</button><a href="/elsewhere">Away</a><a href="#top">Top</a>`,
    routes: { '/elsewhere': page('x') },
  });
  const names = m.actions.map((a) => a.name);
  assert.equal(names.filter((n) => /^Delete/.test(n)).length, 1);
  assert.equal(names.filter((n) => /^Edit/.test(n)).length, 1);
  assert.ok(names.includes('Delete row 1'), 'pressed on the first row');
  assert.ok(!names.includes('Away'));
  assert.ok(names.includes('Top'));
  assert.equal(names.at(-1), 'Sign out');
});

test('the SSH page is not acted on', async () => {
  const s = await site({ '/': page('<button>Go</button>'), '/ssh': page('<div class=xterm></div><button>Go</button>') });
  try {
    const m = await generate(`${s.url}ssh`, { ...FAST });
    assert.deepEqual(m.actions ?? [], []);
    assert.ok(m.notes.some((n) => /SSH/.test(n)));
  } finally { s.close(); }
});

test('without --act nothing new runs', async () => {
  const s = await site({ '/': page(DELETE_NONE) });
  try {
    const m = await generate(s.url, { views: false, idle: 100 });
    assert.equal(m.actions, undefined);
    assert.deepEqual((m.proposals || []).filter((p) => /^walk-/.test(p.rule)), []);
    assert.deepEqual(s.seen.filter((x) => /^DELETE/.test(x)), []);
  } finally { s.close(); }
});

test('the review page: a Timeline section, hidden when the model has no actions', async () => {
  const { m } = await run({ body: SNACK('') });
  const dir = mkdtempSync(join(tmpdir(), 'reader-path-'));
  const browser = await chromium.launch();
  try {
    const shown = async (model) => {
      const f = join(dir, `${Math.random()}.html`);
      writeFileSync(f, render(model));
      const p = await browser.newPage();
      await p.goto(pathToFileURL(f).href);
      const r = await p.evaluate(() => ({ hidden: document.querySelector('#timeline').hidden, h: document.querySelector('#timeline h2')?.textContent, items: document.querySelectorAll('#timeline li').length, text: document.querySelector('#timeline').textContent }));
      await p.close();
      return r;
    };
    const withActions = await shown(m);
    assert.equal(withActions.hidden, false);
    assert.equal(withActions.h, 'Timeline');
    assert.ok(withActions.items >= 1 && /Save/.test(withActions.text) && /Saved the thing/.test(withActions.text), withActions.text);
    const { actions, ...old } = m;
    assert.equal((await shown(old)).hidden, true);
  } finally { await browser.close(); }
});
