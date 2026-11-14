// Reads with no action (--act, before the first action, on the page as
// loaded): the pointer listeners (2.5.1, 2.5.4, 2.5.6, 2.5.7, and the
// controls the mouse-down test of act.js tries for 2.5.2), the reading
// order against the drawn order (1.3.2), instructions by shape, colour or
// place (1.3.3), where the person is (model.location, a run check for
// 2.4.8), the session length (2.2.1, 2.2.3, 2.2.5, 2.2.6) and the sign-in
// page (3.3.8, 3.3.9). Findings are proposals for a person, never fails.
import { readFileSync } from 'node:fs';
import { bare, guardWrites } from './generate.js';

// A time limit longer than 20 hours is outside 2.2.1.
const DAY_LIMIT = 20 * 60;
// How long a fresh context waits for a password field.
export const SIGN_IN_WAIT = 5000;
// The most proposals of one kind on a page.
const MAX = 5;
const DOWN = new Set(['pointerdown', 'mousedown', 'touchstart']);
const GESTURE = new Set(['touchmove', 'gesturestart', 'gesturechange']);
const LISTENED = new Set([...DOWN, ...GESTURE, 'dragstart']);

// ---- Run in the page. ----

// The page's pointer marks: each listened element was pushed to
// window.__rpl as [element, type] by Node. Kept for act.js: __rpDown, the
// elements with a down listener.
function pointers() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const nameOf = (e) => norm(e.getAttribute('aria-label') || e.textContent || e.tagName.toLowerCase());
  const root = (e) => !e || e === document || e === document.documentElement || e === document.body;
  const L = (window.__rpl || []).filter(([e]) => !root(e) && e.nodeType === 1);
  window.__rpDown = L.filter(([, t]) => ['pointerdown', 'mousedown', 'touchstart'].includes(t)).map(([e]) => e);
  const uniq = (els) => [...new Set(els)].map(nameOf);
  const drag = [...document.querySelectorAll('[draggable=true],.cdk-drag'), ...L.filter(([, t]) => t === 'dragstart').map(([e]) => e)];
  const ta = (e) => getComputedStyle(e).touchAction;
  return {
    gesture: uniq(L.filter(([, t]) => /^(touchmove|gesture)/.test(t)).map(([e]) => e)),
    drag: uniq(drag),
    touchOff: [document.documentElement, document.body].some((e) => ta(e) === 'none'),
  };
}

// Blocks of main with their own text, in reading order (the tree), with
// their boxes. A later block drawn wholly above an earlier one in the same
// column (more than a line higher), or wholly before it on the same line
// (left in a left-to-right page), is out of order. Columns read one after
// the other are not: the later column does not overlap the earlier one.
function order() {
  const main = document.querySelector('main,[role=main]') || document.body;
  const rtl = getComputedStyle(main).direction === 'rtl';
  const blocks = [];
  for (const e of main.querySelectorAll('*')) {
    if (e.closest('[aria-hidden=true]') || ![...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) continue;
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed' || cs.position === 'sticky') continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    blocks.push({ e, r, line: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2, text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
  }
  const out = [];
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1];
    const b = blocks[i];
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const column = b.r.left < a.r.right && b.r.right > a.r.left;
    const line = b.r.top < a.r.bottom && b.r.bottom > a.r.top;
    if (column && b.r.top < a.r.top - a.line && b.r.bottom <= a.r.top + 2) out.push({ first: a.text, then: b.text, how: 'above' });
    else if (line && (rtl ? b.r.left >= a.r.right : b.r.right <= a.r.left)) out.push({ first: a.text, then: b.text, how: rtl ? 'to the right of' : 'to the left of' });
  }
  return out;
}

// Sentences of main that point by shape, colour or place (1.3.3).
function sensory() {
  const SENSE = /\b(?:(?:on|to|at|in) the (?:left|right|top|bottom)|above|below|(?:red|green|round|square|blue|yellow)\s+(?:button|icon|link|box|circle|square|mark|light|field|one|text))\b/i;
  const main = document.querySelector('main,[role=main]') || document.body;
  const out = [];
  for (const s of (main.innerText || '').split(/(?<=[.!?])\s+|\n+/)) {
    const t = s.replace(/\s+/g, ' ').trim();
    if (SENSE.test(t) && !out.includes(t)) out.push(t.slice(0, 120));
  }
  return out;
}

// Where the person is: a breadcrumb, else a current item in a navigation.
function where() {
  const NAV = 'nav,[role=navigation]';
  const crumb = [...document.querySelectorAll(`${NAV},[class*=breadcrumb i]`)].some((e) => /breadcrumb/i.test(`${e.getAttribute('aria-label') || ''} ${e.className || ''}`));
  if (crumb) return 'breadcrumb';
  return [...document.querySelectorAll('[aria-current]:not([aria-current=false])')].some((e) => e.closest(NAV)) ? 'current' : null;
}

// The first drawn password field: does a paste reach it (no handler cancels
// it), and is there a puzzle (a canvas or a captcha) beside it.
function signIn() {
  const pw = [...document.querySelectorAll('input[type=password]')].find((e) => e.getClientRects().length);
  if (!pw) return null;
  const dt = new DataTransfer();
  dt.setData('text/plain', 'a11y-test');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  pw.dispatchEvent(ev);
  const PUZZLE = 'canvas,[class*=captcha i],[id*=captcha i],iframe[src*=captcha i],iframe[title*=captcha i],[data-sitekey]';
  const p = (pw.closest('form') || document.body).querySelector(PUZZLE) || document.querySelector(PUZZLE);
  return { pasted: !ev.defaultPrevented, puzzle: p ? (p.getAttribute('aria-label') || p.getAttribute('title') || p.tagName.toLowerCase()).slice(0, 60) : null };
}

// ---- Run in Node. ----

// propose(rule, sc, node, text, say, fix) and ok(rule) are act.js's;
// nodeOf({ name }) finds the tree node.
export async function reads(page, context, opts, model, notes, { propose, ok, nodeOf, root }) {
  // Listeners, through the DevTools protocol: window's, and those of every
  // node of the document.
  const cdp = await context.newCDPSession(page);
  let wins = [];
  try {
    const all = async (expression, depth) => {
      const { result } = await cdp.send('Runtime.evaluate', { expression });
      return (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth, pierce: true })).listeners;
    };
    wins = (await all('window', 0)).map((l) => l.type);
    for (const l of await all('document', -1)) {
      if (!l.backendNodeId || !LISTENED.has(l.type)) continue;
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: l.backendNodeId }).catch(() => ({}));
      if (object?.objectId) await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, arguments: [{ value: l.type }], functionDeclaration: 'function (t) { (window.__rpl ||= []).push([this, t]); }' });
    }
  } catch (e) {
    notes.push(`Listeners not read: ${String(e.message).split(/\r?\n/)[0]}`);
  } finally {
    await cdp.detach().catch(() => {});
  }
  const p = await page.evaluate(pointers);
  const each = (list, rule, sc, say, fix) => {
    for (const name of list.slice(0, MAX)) propose(rule, sc, nodeOf({ name, role: '' }), name, say(name), fix);
    if (!list.length) ok(rule);
  };
  each(p.gesture, 'walk-gesture', '2.5.1', (n) => `"${n}" listens for a swipe or a touch with more than one finger`, 'Offer a single tap or click that does the same (2.5.1)');
  each(p.drag, 'walk-drag', '2.5.7', (n) => `"${n}" can be dragged`, 'Offer a single tap or click that does the same, such as move up and move down buttons (2.5.7)');
  if (wins.some((t) => /^device(motion|orientation)$/.test(t))) propose('walk-motion', '2.5.4', root, 'motion', 'The page listens for device motion or orientation', 'Offer a control that does the same, and a way to turn the motion response off');
  else ok('walk-motion');
  if (p.touchOff) propose('walk-input-limited', '2.5.6', root, 'touch-action', 'The page turns off touch input on the whole page (touch-action: none) (AAA)', 'Let every input the platform has work, pointer, touch and keyboard');
  else ok('walk-input-limited');

  const pairs = await page.evaluate(order);
  for (const x of pairs.slice(0, MAX)) {
    propose('walk-order', '1.3.2', nodeOf({ name: x.then, role: '' }), `${x.first}|${x.then}`, `"${x.then}" comes after "${x.first}" in the reading order, but is drawn ${x.how} it`, 'Make the code order match the order on the screen');
  }
  if (!pairs.length) ok('walk-order');

  const words = await page.evaluate(sensory);
  for (const t of words.slice(0, MAX)) propose('walk-sensory', '1.3.3', root, t, `An instruction points by shape, colour or place: "${t}"`, 'Name the control as well, by its text or label');
  if (!words.length) ok('walk-sensory');

  model.location = await page.evaluate(where);

  // The session: the soonest end of a cookie the saved sign-in holds, read
  // after the load (the server may have renewed it). Names only, no values.
  if (opts.storageState) {
    const st = typeof opts.storageState === 'string' ? JSON.parse(readFileSync(opts.storageState, 'utf8')) : opts.storageState;
    const names = new Set((st?.cookies ?? []).map((c) => c.name));
    const live = (await context.cookies(page.url())).filter((c) => names.has(c.name));
    const ends = live.filter((c) => c.expires > 0).sort((a, b) => a.expires - b.expires)[0];
    if (ends) {
      const mins = Math.round((ends.expires - Date.now() / 1000) / 60);
      notes.push(`The session cookie "${ends.name}" ends in about ${mins} min (read after the load)`);
      if (mins < DAY_LIMIT) {
        const s = `The session ends in about ${mins} min (the cookie "${ends.name}")`;
        propose('walk-session-timeout', '2.2.1', root, ends.name, `${s}; a person checks that a warning comes first, with a way to extend it`, 'Warn at least 20 s before the end, and let the person extend the session with a simple action');
        propose('walk-session-timing', '2.2.3', root, ends.name, `${s}: a time limit (AAA)`, 'No time limit, unless timing is essential');
        propose('walk-session-reauth', '2.2.5', root, ends.name, `${s}; a person checks that the work goes on with no data lost after signing in again (AAA)`, 'Keep what the person entered across a new sign-in');
        propose('walk-session-warning', '2.2.6', root, ends.name, `${s}; a person checks that the person is told how long a pause may last (AAA)`, 'Say how long the session lasts with no activity, or keep the data for 20 hours');
      }
    } else if (live.length) notes.push('The session cookies have no end time (they end when the browser closes); the server\'s own limit is not seen');
  }

  // The sign-in page: this page if it has a password field; else, with a
  // saved sign-in, the start page in a fresh context with no cookies
  // (writes blocked there too).
  const check = async (pg, node) => {
    const r = await pg.evaluate(signIn).catch(() => null);
    if (!r) return false;
    if (r.pasted) { ok('walk-signin-paste'); ok('walk-signin-paste-enhanced'); } else {
      propose('walk-signin-paste', '3.3.8', node, 'paste', 'The sign-in page blocks paste into the password field', 'Allow paste, so a password manager can fill it');
      propose('walk-signin-paste-enhanced', '3.3.9', node, 'paste', 'The sign-in page blocks paste into the password field (AAA)', 'Allow paste, so a password manager can fill it');
    }
    if (!r.puzzle) { ok('walk-signin-puzzle'); ok('walk-signin-puzzle-enhanced'); } else {
      propose('walk-signin-puzzle', '3.3.8', node, r.puzzle, `The sign-in page shows a puzzle ("${r.puzzle}")`, 'Offer a way to sign in with no puzzle to solve or remember');
      propose('walk-signin-puzzle-enhanced', '3.3.9', node, r.puzzle, `The sign-in page shows a puzzle ("${r.puzzle}") (AAA: not even object recognition)`, 'Offer a way to sign in with no puzzle at all');
    }
    return true;
  };
  if (await check(page, nodeOf({ name: 'Password', role: 'textbox' }))) return;
  if (!opts.storageState) return;
  // simplification: read once a page, not once a run (a run of N pages loads the sign-in page N times).
  const fresh = await context.browser().newContext({ bypassCSP: true, ...(opts.ignoreHTTPSErrors ? { ignoreHTTPSErrors: true } : {}) });
  try {
    await guardWrites(fresh, () => {});
    const pg = await fresh.newPage();
    await pg.goto(page.url(), { waitUntil: 'load' });
    await pg.waitForSelector('input[type=password]', { state: 'visible', timeout: opts.actSignIn ?? SIGN_IN_WAIT }).catch(() => {});
    if (await check(pg, root)) notes.push(`The sign-in page read in a fresh context: ${bare(pg.url())}`);
  } finally {
    await fresh.close();
  }
}
