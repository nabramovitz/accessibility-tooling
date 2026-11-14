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
// No single keys and no idle watch unless a test asks (they cost seconds a page).
const FAST = { act: true, views: false, idle: 100, actAfter: 150, actIdle: 800, actHover: 150, actKeys: '', actWatch: 0 };

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

// Text that is not a status message: no 4.1.3 proposal (seen on the lab).
const noLive = async (body) => {
  const { m } = await run({ body });
  assert.deepEqual(rules(m).filter((r) => r.startsWith('4.1.3')), [], JSON.stringify(m.actions.map((a) => text(a))));
};

test('4.1.3: the text of a dialog added inside an overlay is not a status message', () => noLive(
  `<button id=o>Open</button><div id=ov></div>
  <script>o.onclick = () => { ov.innerHTML = '<div class=pane><div role=dialog aria-label=Sure><p>Are you sure?</p><button>Cancel</button></div></div>'; };
  document.onkeydown = (e) => { if (e.key === 'Escape') ov.innerHTML = ''; };</script>`));

test('4.1.3: text after the address changed is a new page, not a status message', () => noLive(
  `<button id=o>Edit</button><div id=v></div>
  <script>o.onclick = () => { history.pushState({}, '', '/edit'); v.textContent = 'Edit the application name'; };</script>`));

test('4.1.3: text drawn again as it was, or a clock that ticks, is not new', () => noLive(
  `<button id=o>Sort</button><ul id=l><li>alpha</li><li>beta</li></ul><p id=c>Uptime 4h 25m 18s</p>
  <script>o.onclick = () => { l.innerHTML = '<li>beta</li><li>alpha</li>'; c.textContent = 'Uptime 4h 25m 19s'; };</script>`));

test('4.1.3: text drawn again is compared as read: hidden parts and icon words left out on both sides', () => noLive(
  `<button id=o>Summary</button><ul id=l><li>alpha <i aria-hidden="true">sort</i><span hidden>(1 of 2)</span></li></ul>
  <script>o.onclick = () => { l.innerHTML = l.innerHTML; };</script>`));

test('4.1.3: an icon word hidden from readers is not read', () => noLive(
  `<button id=o>Copy</button><span id=i></span>
  <script>o.onclick = () => { i.innerHTML = '<span aria-hidden="true">check_circle</span>'; };</script>`));

test('4.1.3: new text beside a live message in the same action is not proposed', () => noLive(
  `<button id=o>Switch theme</button><span id=lab>Light</span><div role=status id=st></div>
  <script>o.onclick = () => { lab.textContent = 'Dark'; st.textContent = 'Dark mode activated'; };</script>`));

test('3.3.4: signing out is not a change to the person\'s data', async () => {
  const { m } = await run({ body: `<button id=o>Sign out</button><script>o.onclick = () => fetch('/logout', { method: 'POST' });</script>` });
  assert.ok(action(m, 'Sign out').events.some((e) => e.type === 'write'));
  assert.deepEqual(rules(m).filter((r) => r.startsWith('3.3')), []);
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

test('a nameless control is one action, even when a press adds another like it before it', async () => {
  // Each press adds a nameless button of the same shape before the first
  // (up to 20, so the test ends even when the key is not stable).
  const { m } = await run({ body: `<div><button class=add id=b></button></div>
    <script>let n = 0; b.onclick = () => { if (n++ < 20) { const x = document.createElement('button'); x.className = 'add'; b.before(x); } };</script>` });
  assert.equal(m.actions.filter((a) => a.name === '').length, 1);
});

test('a page that keeps adding new controls stops at the action limit, with a note', async () => {
  // Each press adds a button with a new name (letters, so not alike).
  const { m } = await run({ body: `<div id=box><button>Add a</button></div>
    <script>let n = 0; box.onclick = () => { if (n < 20) { const x = document.createElement('button'); x.textContent = 'Add ' + 'bcdefghijklmnopqrstuv'[n++]; box.append(x); } };</script>` }, { actMax: 5 });
  assert.equal(m.actions.length, 5);
  assert.ok(m.notes.includes('actions stopped at 5'), m.notes.join(' | '));
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

// ---- Hover and focus content (1.4.13) ----

// A tooltip on a button, shown on hover and on focus. esc: Escape hides it;
// stay: it stays when the pointer moves onto it; vanish: it hides by itself
// after 400 ms.
const TIP = ({ esc = true, stay = true, vanish = false } = {}) => `<style>.w{position:relative;display:inline-block}#t{position:absolute;top:100%;left:0;white-space:nowrap;background:#eee}</style>
  <span class=w><button id=b>Info</button><span id=t hidden>Shows the info</span></span>
  <script>const hide = () => { t.hidden = true; };
  const show = () => { t.hidden = false; ${vanish ? 'setTimeout(hide, 400);' : ''} };
  b.onmouseenter = b.onfocus = show; b.onblur = hide;
  ${stay ? 'b.parentNode.onmouseleave = hide;' : 'b.onmouseleave = hide;'}
  ${esc ? "document.onkeydown = (e) => { if (e.key === 'Escape') hide(); };" : ''}</script>`;
const OPTS = {};
const tipActs = (m) => m.actions.filter((a) => a.name === 'Info' && /^(hover|focus)$/.test(a.kind));
const sc1413 = (m) => (m.proposals || []).filter((p) => p.sc === '1.4.13').map((p) => p.rule).sort();

test('1.4.13: a tooltip that Escape closes, stays on, and stays 1 s: hover and focus actions, no finding, a pass', async () => {
  const { m } = await run({ body: TIP() }, OPTS);
  assert.deepEqual(tipActs(m).map((a) => a.kind), ['hover', 'focus'], JSON.stringify(m.actions));
  const h = tipActs(m)[0];
  assert.ok(h.events.some((e) => e.type === 'content' && /Shows the info/.test(e.text)), text(h));
  for (const type of ['persist', 'dismiss', 'hoverable']) assert.ok(h.events.some((e) => e.type === type && e.ok === true), `${type}: ${text(h)}`);
  assert.deepEqual(sc1413(m), []);
  assert.deepEqual(tipActs(m)[1].events.map((e) => e.type).filter((t) => t !== 'content').sort(), ['dismiss', 'persist']);
  for (const r of ['walk-hover-dismiss', 'walk-hover-hoverable', 'walk-hover-persist']) assert.ok(m.checks['1.4.13'].pass.includes(r), r);
});

test('1.4.13: a tooltip that Escape does not close: a dismiss proposal, on hover and on focus', async () => {
  const { m } = await run({ body: TIP({ esc: false }) }, OPTS);
  assert.deepEqual(sc1413(m), ['walk-hover-dismiss', 'walk-hover-dismiss']);
  assert.ok(m.checks['1.4.13'].review.includes('walk-hover-dismiss'));
  assert.equal(m.checks['1.4.13'].fail?.length ?? 0, 0);
  assert.ok(!m.checks['1.4.13'].pass?.includes('walk-hover-dismiss'));
  assert.ok(m.proposals.find((p) => p.rule === 'walk-hover-dismiss').say.includes('Info'));
});

test('1.4.13: a tooltip that vanishes when the pointer moves onto it: a hoverable proposal, for hover only', async () => {
  const { m } = await run({ body: TIP({ stay: false }) }, OPTS);
  assert.deepEqual(sc1413(m), ['walk-hover-hoverable']);
  assert.ok(tipActs(m)[0].events.some((e) => e.type === 'hoverable' && e.ok === false), text(tipActs(m)[0]));
});

test('1.4.13: a tooltip that disappears by itself in under 1 s: a persist proposal', async () => {
  const { m } = await run({ body: TIP({ vanish: true }) }, OPTS);
  assert.deepEqual(sc1413(m), ['walk-hover-persist', 'walk-hover-persist']);
  assert.ok(tipActs(m)[0].events.some((e) => e.type === 'persist' && e.ok === false), text(tipActs(m)[0]));
});

test('1.4.13: a control with no hover or focus content: no action, no finding, no check', async () => {
  const { m } = await run({ body: '<button id=b>Plain</button>' }, OPTS);
  assert.deepEqual(m.actions.map((a) => `${a.kind} ${a.name}`), ['press Plain']);
  assert.deepEqual(sc1413(m), []);
  assert.equal(m.checks['1.4.13'], undefined);
});

test('4.1.3: a tooltip added on hover is not a status message when the control is pressed', async () => {
  const { m } = await run({ body: `<span style="position:relative"><button id=b>Info</button></span>
    <script>let t; b.onmouseenter = () => { t = document.createElement('span'); t.textContent = 'Shows the info'; b.after(t); };
    b.onmouseleave = () => t && t.remove(); b.onclick = () => {};</script>` }, OPTS);
  assert.ok(tipActs(m).length, JSON.stringify(m.actions));
  assert.deepEqual(rules(m).filter((r) => r.startsWith('4.1.3')), [], JSON.stringify(m.actions.map(text)));
});

test('the review page: the Timeline shows a hover action and its events', async () => {
  const { m } = await run({ body: TIP({ esc: false }) }, OPTS);
  const dir = mkdtempSync(join(tmpdir(), 'reader-path-'));
  const f = join(dir, 'r.html');
  writeFileSync(f, render(m));
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    await p.goto(pathToFileURL(f).href);
    const t = await p.evaluate(() => document.querySelector('#timeline').textContent);
    assert.ok(/Info/.test(t) && /hover/.test(t) && /Shows the info/.test(t) && /Escape/.test(t), t);
  } finally { await browser.close(); }
});

// ---- Single keys (2.1.4) and updates by themselves (2.2.2, 2.2.4). ----

const SEARCH_KEY = `<div id=panel hidden><label>Search the site <input id=q></label></div>
  <script>document.addEventListener('keydown', (e) => { if (e.key === 's' && e.target === document.body) { panel.hidden = false; q.focus(); } });</script>`;
const kinds = (m, kind) => m.actions.filter((a) => a.kind === kind);

test('2.1.4: "s" on the page body opens search: a key action and a proposal; other keys leave none', async () => {
  const { m } = await run({ body: SEARCH_KEY }, { actKeys: 'as' });
  assert.deepEqual(kinds(m, 'key').map((a) => a.name), ['Key "s"'], JSON.stringify(m.actions));
  assert.ok(kinds(m, 'key')[0].events.some((e) => e.type === 'focus'), text(kinds(m, 'key')[0]));
  assert.deepEqual(rules(m).filter((r) => r.startsWith('2.1.4')), ['2.1.4 walk-single-key']);
  assert.ok(m.proposals.find((p) => p.rule === 'walk-single-key').say.includes('"s"'));
  assert.ok(m.checks['2.1.4'].review.includes('walk-single-key'));
});

test('2.1.4: a shortcut that works only in a field, every key tried: no finding, a pass', async () => {
  const { m } = await run({ body: `<label>Name <input id=f></label><p id=o></p>
    <script>f.addEventListener('keydown', (e) => { if (e.key === 's') o.textContent = 'Saved'; });</script>` }, { actKeys: undefined });
  assert.deepEqual(kinds(m, 'key'), []);
  assert.ok(m.checks['2.1.4'].pass.includes('walk-single-key'), JSON.stringify(m.checks['2.1.4']));
});

test('2.1.4: with a field focused at load, the keys go to the page body, not into the field', async () => {
  const { m, s } = await run({
    body: `<label>Find <input id=f autofocus></label><p id=o></p>
      <script>f.oninput = () => fetch('/typed');
      document.addEventListener('keydown', (e) => { if (e.key === 'k' && e.target === document.body) o.textContent = 'Shortcut used'; });</script>`,
  }, { actKeys: 'ak' });
  assert.ok(!s.seen.some((x) => x.includes('/typed')), s.seen.join(' '));
  assert.deepEqual(kinds(m, 'key').map((a) => a.name), ['Key "k"']);
});

const TICKER = (pause) => `<section aria-label="Events"><h2>Events</h2>${pause ? '<button id=p>Pause</button>' : ''}<ul><li id=e>Event one</li></ul></section>
  <script>const w = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  let n = 0, t = setInterval(() => { e.textContent = 'Event ' + w[++n % w.length]; }, 150);
  ${pause ? 'p.onclick = () => clearInterval(t);' : ''}</script>`;

test('2.2.2: a list that updates by itself with no pause control: an idle action and proposals for 2.2.2 and 2.2.4', async () => {
  const { m } = await run({ body: TICKER(false) }, { actWatch: 1200 });
  const idle = kinds(m, 'idle');
  assert.deepEqual(idle.map((a) => a.name), ['Events'], JSON.stringify(m.actions));
  assert.ok(idle[0].events.some((e) => e.type === 'update'), text(idle[0]));
  assert.deepEqual(rules(m).filter((r) => /^2\.2\./.test(r)).sort(), ['2.2.2 walk-update-no-pause', '2.2.4 walk-update-no-pause-interrupt']);
  assert.ok(m.checks['2.2.2'].review.includes('walk-update-no-pause'));
});

test('2.2.2: the same list with a Pause button beside it: no finding, a pass', async () => {
  const { m } = await run({ body: TICKER(true) }, { actWatch: 1200 });
  assert.equal(kinds(m, 'idle').length, 1, JSON.stringify(m.actions));
  assert.deepEqual(rules(m).filter((r) => /^2\.2\./.test(r)), []);
  assert.ok(m.checks['2.2.2'].pass.includes('walk-update-no-pause'));
  assert.ok(m.checks['2.2.4'].pass.includes('walk-update-no-pause-interrupt'));
});

test('2.2.2: text that changes once after load is not an update: no idle action, no walk check', async () => {
  const { m } = await run({ body: `<section aria-label="News"><p id=x>Loading</p></section>
    <script>setTimeout(() => { x.textContent = 'All quiet'; }, 200);</script>` }, { actWatch: 1000 });
  assert.deepEqual(kinds(m, 'idle'), []);
  const c = m.checks['2.2.2'] ?? {};
  assert.deepEqual([...(c.pass ?? []), ...(c.review ?? [])].filter((r) => r.startsWith('walk-')), []);
});

test('2.1.4: on a page that updates by itself, new text after a key is not the key\'s doing', async () => {
  const { m } = await run({ body: TICKER(false) }, { actWatch: 1000, actKeys: 'ab' });
  assert.deepEqual(kinds(m, 'key'), [], JSON.stringify(kinds(m, 'key')));
  assert.deepEqual(rules(m).filter((r) => r.startsWith('2.1.4')), []);
});

// ---- Forms (3.3.1, 3.3.3) and steppers (3.3.7). ----

// A form with its own checks (novalidate). `style`: 'linked' (text, linked by
// aria-describedby, names the field), 'border' (a red border only), 'vague'
// (linked text with no hint of the fix), 'loose' (text not linked, not naming it).
const FORM = (style) => `<form id=f novalidate>
  <label for=n>Name</label><input id=n aria-describedby=ne><span id=ne></span>
  <label for=a>Age</label><input id=a type=number aria-describedby=ae><span id=ae></span>
  <button>Save</button></form><p id=loose></p>
  <script>const say = (field, box, msg) => {
    if (${JSON.stringify(style)} === 'border') { field.style.borderColor = 'rgb(255, 0, 0)'; return; }
    field.setAttribute('aria-invalid', 'true');
    if (${JSON.stringify(style)} === 'loose') loose.textContent += ' This is wrong.'; else box.textContent = msg;
  };
  f.onsubmit = (e) => { e.preventDefault(); ne.textContent = ae.textContent = ''; loose.textContent = '';
    for (const x of [n, a]) { x.removeAttribute('aria-invalid'); x.style.borderColor = ''; }
    if (!n.value) say(n, ne, 'Name is required: enter a name');
    if (a.validity.badInput) say(a, ae, ${JSON.stringify(style)} === 'vague' ? 'Age is wrong' : 'Age must be a number, such as 42');
    if (n.value && !a.validity.badInput) fetch('/save', { method: 'POST' }); };</script>`;
const submits = (m) => m.actions.filter((a) => a.kind === 'submit');
const sc = (m, re) => rules(m).filter((r) => re.test(r)).sort();

test('3.3.1: a form whose errors are text linked to the field and name it: one submit action, two submits, no finding, passes', async () => {
  const { m, s } = await run({ body: FORM('linked') });
  assert.equal(submits(m).length, 1, JSON.stringify(m.actions.map((a) => a.kind)));
  assert.equal(submits(m)[0].events.filter((e) => e.type === 'submit').length, 2, text(submits(m)[0]));
  assert.ok(submits(m).some((a) => a.events.some((e) => e.type === 'error' && /Name is required/.test(e.text))), submits(m).map(text).join(' || '));
  assert.ok(submits(m).some((a) => a.events.some((e) => e.type === 'error' && /such as 42/.test(e.text))), submits(m).map(text).join(' || '));
  assert.deepEqual(sc(m, /^3\.3\.[13] /), [], JSON.stringify(m.proposals) + submits(m).map(text).join(' || '));
  assert.ok(m.checks['3.3.1'].pass.includes('walk-error-no-text'));
  assert.ok(m.checks['3.3.3'].pass.includes('walk-error-no-suggestion'));
  assert.deepEqual(s.writes, [], 'no write left the browser');
});

test('3.3.1: a field marked in error by a red border only: a no-text proposal', async () => {
  const { m } = await run({ body: FORM('border') });
  assert.ok(sc(m, /^3\.3\.1 /).includes('3.3.1 walk-error-no-text'), JSON.stringify(rules(m)));
  assert.ok(m.proposals.find((p) => p.rule === 'walk-error-no-text').say.includes('Name'));
  assert.ok(m.checks['3.3.1'].review.includes('walk-error-no-text'));
});

test('3.3.1: error text that is not linked to the field and does not name it: an unnamed proposal', async () => {
  const { m } = await run({ body: FORM('loose') });
  assert.ok(sc(m, /^3\.3\.1 /).includes('3.3.1 walk-error-unnamed'), JSON.stringify(rules(m)));
  assert.ok(!sc(m, /^3\.3\.1 /).includes('3.3.1 walk-error-no-text'));
});

test('3.3.3: an error after a wrong value with no hint of the fix: a suggestion proposal', async () => {
  const { m } = await run({ body: FORM('vague') });
  assert.deepEqual(sc(m, /^3\.3\.3 /), ['3.3.3 walk-error-no-suggestion']);
  assert.ok(m.proposals.find((p) => p.rule === 'walk-error-no-suggestion').say.includes('Age is wrong'));
});

test('3.3.1: the browser\'s own check (required, type=email): its message counts, no finding', async () => {
  const { m } = await run({ body: `<form><label for=e>Email</label><input id=e type=email required><button>Send</button></form>` });
  assert.ok(submits(m).some((a) => a.events.some((e) => e.type === 'error' && /browser/.test(e.text))), submits(m).map(text).join(' || '));
  assert.deepEqual(sc(m, /^3\.3\.[13] /), []);
  assert.ok(m.checks['3.3.1'].pass.includes('walk-error-no-text'));
});

// Two steps; the second asks for the organization again, empty or filled.
const STEPPER = (prefill) => `<div id=s1><label for=o1>Organization</label><input id=o1><button id=next>Next</button></div>
  <div id=s2 hidden><label for=o2>Organization</label><input id=o2><label for=sp>Space</label><input id=sp><button id=go>Create</button></div>
  <script>next.onclick = () => { s1.hidden = true; s2.hidden = false; ${prefill ? 'o2.value = o1.value;' : ''} };
  go.onclick = () => fetch('/create', { method: 'POST' });</script>`;

test('3.3.7: a stepper that asks for the organization again, empty: a steps action and a redundant-entry proposal', async () => {
  const { m, s } = await run({ body: STEPPER(false) });
  const st = m.actions.filter((a) => a.kind === 'steps');
  assert.equal(st.length, 1, JSON.stringify(m.actions.map((a) => `${a.kind} ${a.name}`)));
  assert.ok(st[0].events.some((e) => e.type === 'step' && /Organization/.test(e.text) && /Space/.test(e.text)), text(st[0]));
  assert.deepEqual(sc(m, /^3\.3\.7 /), ['3.3.7 walk-redundant-entry']);
  assert.ok(m.proposals.find((p) => p.rule === 'walk-redundant-entry').say.includes('Organization'));
  assert.deepEqual(s.writes, []);
});

test('3.3.7: the same stepper with the organization filled in again: no finding, a pass', async () => {
  const { m } = await run({ body: STEPPER(true) });
  assert.deepEqual(sc(m, /^3\.3\.7 /), []);
  assert.ok(m.checks['3.3.7'].pass.includes('walk-redundant-entry'));
});

test('3.3.7: a Next that does not go on ends the steps with a note', async () => {
  const { m } = await run({ body: `<label for=x>Name</label><input id=x><button>Next</button>` });
  const st = m.actions.filter((a) => a.kind === 'steps');
  assert.equal(st.length, 1);
  assert.ok(st[0].events.some((e) => e.type === 'note' && /did not go on/.test(e.text)), text(st[0]));
  assert.equal(m.checks['3.3.7'], undefined);
});

test('3.3.7: a list paginator\'s "Next page" is not a stepper: no steps action', async () => {
  const { m } = await run({ body: `<label for=q>Filter</label><input id=q><ul><li>One</li></ul><button aria-label="Next page">›</button>` });
  assert.deepEqual(m.actions.filter((a) => a.kind === 'steps'), [], JSON.stringify(m.actions.map((a) => `${a.kind} ${a.name}`)));
});
