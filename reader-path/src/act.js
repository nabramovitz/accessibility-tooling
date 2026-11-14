// The action phase (--act): presses each distinct control of a page once
// and records what changes after it: focus moved, live text, a change of
// context, a write the guard blocked. It runs last in generate(), on a
// copy of the page as loaded, and puts the result in model.actions.
// Findings that need a person are proposals (walk- rules), never fails.
import { readFileSync } from 'node:fs';
import { bare, ready, walk } from './generate.js';
import { addProposal } from './proposals.js';
import { addCheck } from './axe.js';
import { reads } from './reads.js';

// How long the recorder keeps watching after the page is idle again, and
// the longest an action may take to go idle.
export const AFTER_IDLE = 2000;
export const ACTION_LIMIT = 10000;
// A page that makes a new control with each press never runs out of
// distinct actions; past this many presses on one page the walk stops,
// with a run note. Not a cap: real pages stay far below it.
export const ACTION_MAX = 200;
// Hover and focus content (1.4.13): how long to wait for content to appear
// after the pointer or focus arrives, how long it must stay with no move
// (the 1 s of the review), and how long to look after the pointer moves onto it.
export const HOVER_WAIT = 600;
export const PERSIST_WAIT = 1000;
export const HOVER_ONTO = 300;
// Single keys (2.1.4): each is pressed once with focus on the page body.
export const KEYS = 'abcdefghijklmnopqrstuvwxyz0123456789?/.';
// A key's watch after idle is shorter than a press's: a shortcut acts in
// its keydown handler, and the idle wait already covers a request it
// starts. Simplification: an effect a timer draws later than this is
// missed; raise it if a page shows one (39 keys, so each 0.1 s is 4 s a page).
export const KEY_AFTER = 300;
// Updates by themselves (2.2.2): how long the page is watched with no action.
export const WATCH = 10000;
// Steppers (3.3.7): the most steps walked with Next.
export const STEP_MAX = 10;
// Safe values (ruling D4): never a real name; the submit is blocked anyway.
const SAFE = { email: 'a11y-test@example.com', url: 'https://example.com', number: '1', tel: '1', range: null, date: null, color: null, file: null };
// A wrong value for a typed field: letters where a number, an address or a pattern is asked.
const WRONG = { number: 'e', email: 'x', url: 'x' };
// Words of an error text that tell the person how to fix it (3.3.3).
const SUGGEST = /\b(enter|use|must|should|include|choose|select|pick|format|example|e\.g\.|such as|like|only|at least|at most|between|from|up to|valid|characters?|digits?|numbers?)\b/i;

const SIGN_IN = /\/(login|logout)\b/;
const CONFIRM = /confirm|are you sure|cannot be undone|permanently/i;

// ---- Run in the page (passed to evaluate, so each is self-contained). ----

// The recorder: one observer for text that appears. Text in a live region
// is "live"; other new text is "text" unless it is in or holds a dialog,
// is hidden from readers or not drawn, was on the page before the press (drawn again,
// or a clock: digits alike), is hover or focus content the hover phase
// already found (rp.skip: a tooltip is not a status message), or the pressed
// control states its own change (aria-expanded, a tab, ...).
function install() {
  if (window.__rp) return;
  const LIVE = '[aria-live]:not([aria-live=off]),[role=status],[role=alert],[role=log]';
  const DIALOG = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true]';
  const rp = (window.__rp = { ev: [], els: [], quiet: false, seen: '', skip: [] });
  const flat = (t) => t.replace(/\s+/g, '').replace(/\d+/g, '#');
  rp.flat = flat;
  // Text as read: no aria-hidden part (an icon word) and, unless live, no
  // part that is not drawn. The page before a press is read the same way.
  const shown = (p, live) => p && !p.closest('[aria-hidden=true]') && (live || p.getClientRects().length > 0);
  rp.read = (node, live) => {
    if (node.nodeType === 3) return shown(node.parentElement, live) ? node.data : '';
    const out = [];
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode());) if (shown(t.parentElement, live)) out.push(t.data);
    return out.join(' ');
  };
  const add = (type, text) => { if (!rp.ev.some((e) => e.type === type && e.text === text)) rp.ev.push({ at: Date.now(), type, text }); };
  new MutationObserver((ms) => {
    for (const m of ms) {
      const nodes = m.type === 'characterData' ? [m.target] : [...m.addedNodes];
      for (const n of nodes) {
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el || (n.nodeType !== 1 && n.nodeType !== 3)) continue;
        const live = !!el.closest(LIVE);
        const text = rp.read(n, live).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!text) continue;
        if (live) add('live', text);
        else if (!rp.quiet && !el.closest(DIALOG) && !el.querySelector(DIALOG) && !el.closest('[role=tooltip]') && !rp.seen.includes(flat(text)) && !rp.skip.includes(flat(text))) add('text', text);
      }
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

// The controls to press, in document order, one per distinct action; the
// elements are kept in __rp.els, and `i` indexes them.
function candidates(hover) {
  const SEL = (hover ? '[aria-describedby],[mattooltip],[data-tooltip],[tabindex]:not([tabindex="-1"]),' : '') + 'button,[role=button],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=switch],[role=checkbox],[role=radio],summary,select,a[href],input[type=button],input[type=submit],input[type=reset],input[type=checkbox],input[type=radio]';
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const roleOf = (e) => e.getAttribute('role') || ({ A: 'link', SELECT: 'select', SUMMARY: 'summary' }[e.tagName]
    || (e.tagName === 'INPUT' && /^(checkbox|radio)$/.test(e.type) ? e.type : 'button'));
  const nameOf = (e) => {
    let n = e.getAttribute('aria-label');
    const ids = e.getAttribute('aria-labelledby');
    if (!n && ids) n = ids.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ');
    if (!n && e.labels && e.labels.length) n = [...e.labels].map((l) => l.textContent).join(' ');
    if (!n && e.tagName === 'INPUT' && /button|submit|reset/.test(e.type)) n = e.value;
    if (!n && e.tagName !== 'SELECT') n = e.textContent;
    return norm(n || e.getAttribute('title') || e.querySelector('img[alt]')?.alt).slice(0, 80);
  };
  const sig = (e) => { const p = []; for (let x = e; x && x !== document.body; x = x.parentElement) p.push(`${x.tagName}.${[...x.classList].filter((c) => !/\d/.test(c)).sort().join('.')}`); return p.join('<'); };
  const here = location.origin + location.pathname + location.search;
  const out = [];
  const keys = new Set();
  window.__rp.els = [];
  for (const e of document.querySelectorAll(SEL)) {
    if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden' || e.disabled
      || e.getAttribute('aria-disabled') === 'true' || e.closest('[inert],[aria-hidden=true]')) continue;
    if (e.tagName === 'A' && !hover) {
      // A link that goes to another page is the crawl's; one that acts in the page is pressed.
      const h = e.getAttribute('href');
      if (e.target === '_blank') continue;
      if (!/^javascript:/i.test(h)) {
        let u;
        try { u = new URL(h, location.href); } catch { continue; }
        if (u.origin + u.pathname + u.search !== here) continue;
      }
    }
    const role = roleOf(e);
    const name = nameOf(e);
    const row = e.closest('tr,li,[role=row],[role=listitem],[role=option]');
    const word = name.toLowerCase().replace(/\d+/g, '#').split(' ')[0];
    // One shape per control: a row's control is told by its place in the row and its first word,
    // so "Delete" on each row is one; elsewhere by role and name (digits alike); a nameless one
    // by its path of tags and classes alone, so the key holds when a press adds controls.
    const key = row ? `row|${sig(e)}|${role}|${word}` : name ? `${role}|${name.toLowerCase().replace(/\d+/g, '#')}` : `${role}|${sig(e)}`;
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({
      i: window.__rp.els.push(e) - 1, key, role, name,
      input: /^(select|checkbox|radio|switch)$/.test(role),
      quiet: e.hasAttribute('aria-expanded') || e.hasAttribute('aria-pressed') || e.hasAttribute('aria-checked')
        || e.hasAttribute('aria-selected') || /^(tab|summary|switch|checkbox|radio)$/.test(role),
      signout: /\b(sign|log)[ -]?out\b/i.test(name),
      // A down listener on it or on a box around it (reads.js keeps them).
      down: (window.__rpDown || []).some((d) => d === e || d.contains(e)),
      focusable: e.matches('a[href],button,input,select,textarea,summary,[tabindex]'),
    });
  }
  return out;
}

// Where the page is now: address, open dialogs, and where focus is.
function state() {
  const DIALOG = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true]';
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  const body = !a || a === document.body || a === document.documentElement;
  const open = [...document.querySelectorAll(DIALOG)].filter((d) => d.getClientRects().length);
  const name = body ? '' : (a.getAttribute('aria-label') || a.textContent || a.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return {
    url: location.href, dialogs: open.length, body, inDialog: !body && open.some((d) => d.contains(a)),
    active: body ? 'the page body' : `${a.getAttribute('role') || a.tagName.toLowerCase()}${name ? ` "${name}"` : ''}`,
  };
}

// Hover and focus content. mark() remembers every element drawn now; found()
// returns the text of the first new drawn element with text, outside a dialog
// (the top one of a new branch), and keeps it in __rp.hc; shown() is whether
// that element is still drawn.
function mark() {
  const drawn = (e) => e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  window.__rp.drawn = drawn;
  window.__rp.before = new Set([...document.body.querySelectorAll('*')].filter(drawn));
}
function found() {
  const rp = window.__rp;
  const DIALOG = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true]';
  for (const e of document.body.querySelectorAll('*')) {
    if (rp.before.has(e) || !rp.drawn(e) || (e.parentElement && !rp.before.has(e.parentElement) && e.parentElement !== document.body && rp.drawn(e.parentElement))) continue;
    const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t || e.closest(DIALOG) || e.querySelector(DIALOG)) continue;
    rp.hc = e;
    return t.slice(0, 120);
  }
  return null;
}
// Updates by themselves: watches the page for ms with no action and returns
// each drawn block whose text changed at least twice (once is a late load),
// with a label and whether a pause, stop or hide control is near it (in the
// block or up to three parents above it).
function watch(ms) {
  const BLOCK = 'section,article,aside,nav,form,table,ul,ol,dl,p,[role=region],[role=log],[role=marquee],[role=timer],[role=status],[role=feed],[role=list],[role=grid]';
  const PAUSE = /\b(pause|stop|hide|resume|play)\b|auto[- ]?(refresh|update)/i;
  const read = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
  const drawn = (e) => e.getClientRects().length > 0 && !e.closest('[aria-hidden=true]');
  const last = new Map([...document.querySelectorAll(BLOCK)].map((e) => [e, read(e)]));
  const count = new Map();
  const mo = new MutationObserver((ms) => {
    for (const m of ms) {
      const box = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest(BLOCK);
      if (!box || !drawn(box)) continue;
      const t = read(box);
      if (last.has(box) && last.get(box) !== t) count.set(box, (count.get(box) ?? 0) + 1);
      last.set(box, t);
    }
  });
  mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  const label = (e) => {
    const r = e.closest('[aria-label],[aria-labelledby],section,article,[role=region]');
    const ids = r?.getAttribute('aria-labelledby');
    const n = r?.getAttribute('aria-label') || (ids && ids.split(/\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' '))
      || r?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent;
    return (n || e.tagName.toLowerCase()).replace(/\s+/g, ' ').trim().slice(0, 60);
  };
  const near = (e) => {
    for (let x = e, i = 0; x && x !== document.body && i < 4; x = x.parentElement, i++) {
      for (const c of x.querySelectorAll('button,[role=button],[role=switch],input[type=checkbox],a[href]')) {
        if (PAUSE.test(c.getAttribute('aria-label') || c.textContent || c.value || '')) return true;
      }
    }
    return false;
  };
  return new Promise((done) => setTimeout(() => {
    mo.disconnect();
    // An outer block that only holds a changing inner one is the same update.
    const boxes = [...count].filter(([, n]) => n >= 2).map(([e]) => e);
    done(boxes.filter((e) => !boxes.some((o) => o !== e && o.contains(e)))
      .map((e) => ({ label: label(e), n: count.get(e), sample: read(e).slice(0, 80), pause: near(e) })));
  }, ms));
}

// Forms. fieldsIn(i) finds form i (-1: the whole page, for a stepper) and
// keeps its fields and its submit control in __rp.form; it returns what
// Node needs of them. look() is each field's state: marked in error
// (aria-invalid, the browser's own check), the text linked to it, and the
// colours of its border, outline and shadow.
function fieldsIn(i) {
  const scope = i < 0 ? document.body : document.querySelectorAll('form,[role=form]')[i];
  if (!scope) return null;
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const labelOf = (e) => {
    const ids = e.getAttribute('aria-labelledby');
    return norm(e.getAttribute('aria-label') || (ids && ids.split(/\s+/).map((x) => document.getElementById(x)?.textContent || '').join(' '))
      || (e.labels && [...e.labels].map((l) => l.textContent).join(' ')) || e.placeholder || e.name || e.id).slice(0, 60);
  };
  const els = [...scope.querySelectorAll('input,select,textarea')].filter((e) => !/^(hidden|submit|button|reset|image)$/.test(e.type)
    && !e.disabled && !e.readOnly && e.getClientRects().length && !e.closest('[inert],[aria-hidden=true]'));
  const btn = i < 0 ? null : scope.querySelector('button:not([type=button]):not([type=reset]),input[type=submit]')
    || (scope.id && document.querySelector(`button[form="${scope.id}"]`));
  window.__rp.form = { scope, els, btn };
  const name = norm(scope.getAttribute('aria-label') || (btn && (btn.textContent || btn.value)) || 'form').slice(0, 60);
  return {
    name, submit: !!btn, native: i >= 0 && !scope.noValidate,
    fields: els.map((e, j) => ({
      j, label: labelOf(e), tag: e.tagName.toLowerCase(), type: e.tagName === 'INPUT' ? e.type : e.tagName.toLowerCase(),
      value: e.type === 'checkbox' || e.type === 'radio' ? (e.checked ? 'on' : '') : e.value,
      typed: e.tagName === 'INPUT' && (/^(number|email|url)$/.test(e.type) || e.hasAttribute('pattern') || /numeric|decimal/.test(e.inputMode)),
      choices: e.tagName === 'SELECT' || !!e.list || e.getAttribute('role') === 'combobox' || e.hasAttribute('aria-autocomplete'),
    })),
  };
}
function look() {
  const f = window.__rp.form;
  const text = (ids) => (ids || '').split(/\s+/).filter(Boolean).map((x) => document.getElementById(x)).filter((e) => e && e.getClientRects().length)
    .map((e) => e.textContent).join(' ').replace(/\s+/g, ' ').trim();
  return f.els.map((e) => {
    const c = getComputedStyle(e);
    return {
      invalid: e.getAttribute('aria-invalid') === 'true',
      native: !e.validity.valid ? e.validationMessage : '',
      linked: text(`${e.getAttribute('aria-describedby') || ''} ${e.getAttribute('aria-errormessage') || ''}`),
      paint: [c.borderTopColor, c.borderBottomColor, c.outlineColor, c.boxShadow, e.className].join('|'),
      // A focus ring is not an error mark: colours are compared only when the field has no focus.
      focused: e.matches(':focus'),
    };
  });
}

const shown = () => !!window.__rp.hc && window.__rp.hc.isConnected && window.__rp.drawn(window.__rp.hc);
const centre = () => { const r = window.__rp.hc.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };

const other = (v, w) => v.split('#')[0] !== w.split('#')[0];

// ---- Run in Node. ----

// hook.current is where the write guard reports a blocked write, per action.
export async function actions(page, context, idleTime, opts, root, model, notes, hook) {
  const after = opts.actAfter ?? AFTER_IDLE;
  const limit = opts.actIdle ?? ACTION_LIMIT;
  const max = opts.actMax ?? ACTION_MAX;
  const startUrl = page.url();
  const startPath = new URL(startUrl).pathname;
  // The SSH terminal page is not acted on: a path with /ssh, or a terminal widget.
  if (/\/ssh(\/|$)/i.test(startPath) || await page.evaluate(() => !!document.querySelector('.xterm')).catch(() => false)) {
    notes.push('Actions not run: SSH terminal page');
    return;
  }
  model.actions = [];
  const popups = [];
  const onPage = (p) => popups.push(p);
  context.on('page', onPage);
  const flagged = new Set();
  const ok = {};
  const propose = (rule, sc, node, text, say, fix) => { flagged.add(rule); addProposal(model, node, { sc, rule, text, say, propose: fix }); };
  const nodeOf = (c) => {
    let found;
    walk(root, (n) => { if (n.name === c.name && (!found || (n.role === c.role && found.role !== c.role))) found = n; });
    return found ?? root;
  };

  const restart = async (signedOut) => {
    if (signedOut) {
      // The saved state's cookies come back; its local storage does not.
      const st = typeof opts.storageState === 'string' ? JSON.parse(readFileSync(opts.storageState, 'utf8')) : opts.storageState;
      await context.clearCookies();
      if (st?.cookies?.length) await context.addCookies(st.cookies);
    }
    await page.goto(startUrl, { waitUntil: 'load' });
    await ready(page, idleTime, opts, []);
  };
  const list = async (hover) => {
    await page.evaluate(install);
    return page.evaluate(candidates, hover);
  };
  const closePopups = async () => { for (const p of popups.splice(0)) await p.close().catch(() => {}); };
  const quiet = () => ready(page, idleTime, { idle: opts.idle, idleMax: limit }, []);
  // Before a press or a key: the recorder empty, and the page's text as it is now.
  const arm = (q, skip) => page.evaluate(({ q, skip }) => {
    Object.assign(window.__rp, { ev: [], quiet: q, seen: window.__rp.read(document.body).replace(/\s+/g, '').replace(/\d+/g, '#'), skip: skip.map(window.__rp.flat) });
  }, { q, skip });
  const now = () => page.evaluate(state).catch(() => ({ url: page.url(), dialogs: 0, body: false, inDialog: false, active: 'unknown' }));

  try {
    await restart(false);

    // Reads with no action, on the page as loaded; then the controls with a
    // down listener, for the mouse-down test below.
    await reads(page, context, opts, model, notes, { propose, ok: (r) => { ok[r] = 1; }, nodeOf, root });
    const downKeys = (await list()).filter((x) => x.down).map((x) => x.key);

    // Updates by themselves (2.2.2, 2.2.4): the page as loaded, watched with
    // no action. Each updating block is an action of kind idle.
    const watchFor = opts.actWatch ?? WATCH;
    const updating = watchFor > 0 ? await page.evaluate(watch, watchFor).catch(() => []) : [];
    for (const u of updating) {
      const node = nodeOf({ name: u.label, role: '' });
      model.actions.push({ id: `a${model.actions.length + 1}`, kind: 'idle', node: node.id, name: u.label, events: [
        { t: watchFor, type: 'update', text: `text changed ${u.n} times in ${watchFor / 1000} s with no action: "${u.sample}"` },
        { t: watchFor, type: 'control', text: u.pause ? 'a pause, stop or hide control near it' : 'no pause, stop or hide control near it', ok: u.pause },
      ] });
      if (u.pause) ok['walk-update-no-pause'] = ok['walk-update-no-pause-interrupt'] = 1;
      else {
        propose('walk-update-no-pause', '2.2.2', node, u.label, `"${u.label}" updates by itself (${u.n} changes in ${watchFor / 1000} s) with no control near it to pause, stop or hide it`, 'Add a control to pause, stop or hide the updates');
        propose('walk-update-no-pause-interrupt', '2.2.4', node, u.label, `"${u.label}" updates by itself with no way to put the updates off (AAA)`, 'Let the person pause the updates, or turn them off');
      }
    }

    // Hover and focus content (1.4.13): each distinct control, a wider list
    // than the presses (a link is hovered, not followed; an icon with a
    // description or a tooltip attribute is hovered too). Nothing is pressed:
    // the pointer moves and focus is set. A control with no new content
    // leaves no action. Hovers have their own bound, the same ACTION_MAX.
    const hoverText = [];
    const wait = (ms) => page.waitForTimeout(ms);
    const appear = async () => {
      for (const end = Date.now() + (opts.actHover ?? HOVER_WAIT); ; await wait(100)) {
        const t = await page.evaluate(found).catch(() => null);
        if (t || Date.now() >= end) return t;
      }
    };
    const present = () => page.evaluate(shown).catch(() => false);
    const away = async () => { await page.mouse.move(1, 1); await page.evaluate(() => document.activeElement?.blur()).catch(() => {}); };
    let tried = 0;
    for (const key of (await list(true)).map((x) => x.key)) {
      if (tried >= max) { notes.push(`hovers stopped at ${max}`); break; }
      tried++;
      for (const how of ['hover', 'focus']) {
        let c = (await list(true)).find((x) => x.key === key);
        if (!c || (how === 'focus' && !c.focusable)) continue;
        const trigger = async () => {
          await away();
          await page.evaluate(mark);
          const h = (await page.evaluateHandle((i) => window.__rp.els[i], c.i)).asElement();
          if (how === 'hover') {
            await h.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
            const b = await h.boundingBox();
            if (!b) return null;
            await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
          } else await h.focus({ timeout: 1000 }).catch(() => {});
          return appear();
        };
        const before = await now();
        const shownText = await trigger();
        if (shownText) {
          const node = nodeOf(c);
          const events = [];
          let t0 = Date.now();
          const ev = (type, text, good) => events.push({ t: Date.now() - t0, type, text, ok: good });
          const on = how === 'hover' ? 'hover' : 'focus';
          ev('content', `appears on ${on}: "${shownText}"`);
          hoverText.push(shownText);
          // Persistent: stays for 1 s with no move.
          await wait(PERSIST_WAIT);
          const stays = await present();
          ev('persist', stays ? 'stays for 1 s with no move' : 'gone within 1 s with no move', stays);
          if (stays) ok['walk-hover-persist'] = 1;
          else propose('walk-hover-persist', '1.4.13', node, on, `The content that appears on ${on} of "${c.name}" ("${shownText}") goes away by itself within 1 s`, 'Keep it until the person moves the pointer or focus away, or dismisses it');
          // Dismissible: Escape, the pointer and focus unmoved.
          if (stays) {
            await page.keyboard.press('Escape');
            await wait(150);
            const gone = !(await present());
            ev('dismiss', gone ? 'gone after Escape' : 'stays after Escape', gone);
            if (gone) ok['walk-hover-dismiss'] = 1;
            else propose('walk-hover-dismiss', '1.4.13', node, on, `The content that appears on ${on} of "${c.name}" ("${shownText}") stays after Escape`, 'Close it with Escape, with no move of the pointer or focus');
          }
          // Hoverable (hover only): fresh page, pointer onto the content.
          if (stays && how === 'hover') {
            await restart(false);
            c = (await list(true)).find((x) => x.key === key);
            if (c && await trigger()) {
              const { x, y } = await page.evaluate(centre);
              await page.mouse.move(x, y, { steps: 5 });
              await wait(opts.actHoverOnto ?? HOVER_ONTO);
              const kept = await present();
              t0 = Date.now();
              ev('hoverable', kept ? 'stays when the pointer moves onto it' : 'gone when the pointer moves onto it', kept);
              if (kept) ok['walk-hover-hoverable'] = 1;
              else propose('walk-hover-hoverable', '1.4.13', node, on, `The content that appears on hover of "${c.name}" ("${shownText}") goes away when the pointer moves onto it`, 'Keep it while the pointer is on the control or on the content');
            }
          }
          model.actions.push({ id: `a${model.actions.length + 1}`, kind: on, node: node.id, name: c.name, events });
        }
        // The next one starts from the page as loaded when the address moved,
        // a dialog opened, or content is still there.
        const now1 = await now();
        if (shownText || other(before.url, now1.url) || now1.dialogs > before.dialogs || popups.length) {
          await away();
          await closePopups();
          await restart(false);
        } else await away();
      }
    }

    // Mouse down (2.5.2): each control with a down listener. The pointer goes
    // onto it, the button goes down, and the page is read; then the pointer
    // moves away and the button comes up there, so a click never fires. A
    // change while the button is down (new text, a dialog, a new address or
    // window, a write, aria-expanded) means the control acts on down.
    if (downKeys.length) await restart(false);
    for (const key of downKeys) {
      const c = (await list()).find((x) => x.key === key);
      if (!c) continue;
      const h = (await page.evaluateHandle((i) => window.__rp.els[i], c.i)).asElement();
      await h.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      const b = await h.boundingBox();
      if (!b) continue;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
      await page.waitForTimeout(150);
      const before = await now();
      const open0 = await h.getAttribute('aria-expanded').catch(() => null);
      await arm(false, hoverText);
      const events = [];
      const t0 = Date.now();
      const ev = (type, text, extra) => events.push({ t: Date.now() - t0, type, text, ...extra });
      hook.current = (w) => ev('write', `write blocked: ${w}`);
      popups.length = 0;
      await page.mouse.down();
      await quiet();
      await page.waitForTimeout(Math.min(after, KEY_AFTER));
      hook.current = null;
      const st = await now();
      const rec = await page.evaluate(() => (window.__rp ? window.__rp.ev : [])).catch(() => []);
      for (const r of rec) events.push({ t: r.at - t0, type: r.type, text: r.text });
      if (other(before.url, st.url)) ev('context', `url changed to ${bare(st.url)}`, { what: 'url' });
      if (st.dialogs > before.dialogs) ev('context', 'dialog opened', { what: 'dialog' });
      for (const p of popups) ev('context', `new window: ${bare(p.url())}`, { what: 'window' });
      if ((await h.getAttribute('aria-expanded').catch(() => open0)) !== open0) ev('context', 'expanded on down', { what: 'expanded' });
      await page.mouse.move(1, 1, { steps: 2 });
      await page.mouse.up();
      if (!events.length) { ok['walk-down-event'] = 1; continue; }
      events.sort((x, y) => x.t - y.t);
      const node = nodeOf(c);
      model.actions.push({ id: `a${model.actions.length + 1}`, kind: 'down', node: node.id, name: c.name, events });
      propose('walk-down-event', '2.5.2', node, '', `"${c.name}" acts when the mouse button goes down (${events[0].text}), before it comes up`, 'Act when the button comes up (a click), so the person can move away to cancel');
      await closePopups();
      await restart(false);
    }

    const done = new Set();
    for (;;) {
      let c = (await list()).filter((x) => !done.has(x.key)).sort((a, b) => a.signout - b.signout)[0];
      if (!c) break;
      if (done.size >= max) { notes.push(`actions stopped at ${max}`); break; }
      done.add(c.key);
      const events = [];
      let t0 = Date.now();
      const ev = (type, text, extra) => events.push({ t: Date.now() - t0, type, text, ...extra });
      const handleOf = async () => (await page.evaluateHandle((i) => window.__rp.els[i], c.i)).asElement();
      let handle = await handleOf();
      let node = nodeOf(c);
      const record = (kind) => {
        events.sort((a, b) => a.t - b.t);
        model.actions.push({ id: `a${model.actions.length + 1}`, kind, node: node.id, name: c.name, events: [...events] });
      };

      // Focus alone: does focusing the control change the context? (Only the
      // idle wait here, not the long watch, as the control is pressed next.)
      let before = await now();
      popups.length = 0;
      await handle.focus({ timeout: 1000 }).catch(() => {});
      await quiet();
      let st = await now();
      if (other(before.url, st.url) || st.dialogs > before.dialogs || popups.length) {
        ev('context', popups.length ? `new window on focus: ${bare(popups[0].url())}` : other(before.url, st.url) ? `url changed to ${bare(st.url)} on focus` : 'dialog opened on focus', { what: 'focus' });
        propose('walk-context-focus', '3.2.1', node, '', `Focusing "${c.name}" changes the context (a new page, window or dialog) with no other step`, 'Change the context on an action (a press), not on focus');
        record('focus');
        await closePopups();
        await restart(false);
        c = (await list()).find((x) => x.key === c.key);
        if (!c) continue;
        handle = await handleOf();
        events.length = 0;
        t0 = Date.now();
      } else ok['walk-context-focus'] = 1;

      // The press (a select is changed to another option).
      before = await now();
      await arm(c.quiet, hoverText);
      t0 = Date.now();
      hook.current = (w) => ev('write', `write blocked: ${w}`);
      popups.length = 0;
      try {
        if (c.role === 'select') {
          const v = await handle.evaluate((s) => { const o = [...s.options].find((x) => !x.disabled && x.value !== s.value); return o ? o.value : null; });
          if (v === null) { hook.current = null; continue; }
          await handle.selectOption(v, { timeout: Math.min(limit, 3000) });
        } else await handle.click({ timeout: Math.min(limit, 3000) });
      } catch (e) {
        ev('note', `could not press: ${String(e.message).split(/\r?\n/)[0].replace(/^(?:\w+\.)?\w+: /, '')}`);
      }
      await quiet();
      await page.waitForTimeout(after);
      hook.current = null;
      st = await now();

      const rec = await page.evaluate(() => (window.__rp ? window.__rp.ev : [])).catch(() => []);
      for (const r of rec) events.push({ t: r.at - t0, type: r.type, text: r.text });
      if (st.active !== before.active) ev('focus', `${before.active} to ${st.active}`, { from: before.active, to: st.active });
      const moved = other(before.url, st.url);
      const opened = st.dialogs > before.dialogs;
      if (moved) ev('context', `url changed to ${bare(st.url)}`, { what: 'url' });
      if (opened) ev('context', 'dialog opened', { what: 'dialog' });
      for (const p of popups) ev('context', `new window: ${bare(p.url())}`, { what: 'window' });
      const changed = moved || opened || popups.length > 0;

      // Findings.
      if (c.input && changed) propose('walk-context-input', '3.2.2', node, '', `Changing "${c.name}" changes the context (a new page, window or dialog) with no other step`, 'Change the context on an action (a button), or say so before the change');
      else if (c.input) ok['walk-context-input'] = 1;
      if (st.body && !before.body && !moved && !opened) propose('walk-focus-lost', '2.4.3', node, '', `After "${c.name}" focus is lost to the page body`, 'Move focus to the next sensible control');
      // New text is a status message only on the same page and with no live message beside it.
      const live = events.some((e) => e.type === 'live');
      const text = !moved && !live && events.find((e) => e.type === 'text');
      if (text) propose('walk-live-missing', '4.1.3', node, text.text, `New text appears after "${c.name}" with no live region: "${text.text}"`, 'Put the message in a live region (role="status" or role="alert")');
      else if (live) ok['walk-live-missing'] = 1;
      // Signing out changes no data of the person's.
      if (!c.signout && events.some((e) => e.type === 'write')) {
        const confirm = opened || events.some((e) => /^(text|live)$/.test(e.type) && CONFIRM.test(e.text));
        if (!confirm) {
          propose('walk-write-no-confirm', '3.3.4', node, '', `"${c.name}" sends a change (${events.find((e) => e.type === 'write').text.replace('write blocked: ', '')}) with no step to confirm or undo it`, 'Ask for a confirmation, or let the person undo it');
          propose('walk-write-no-confirm-reversal', '3.3.6', node, '', `"${c.name}" sends a change with no step to confirm or undo it (AAA)`, 'Ask for a confirmation, or let the person undo it');
        }
      }

      // A dialog: where focus went in, then Escape, and where focus went back.
      let stuck = false;
      if (opened) {
        if (st.inDialog) ok['walk-dialog-focus'] = 1;
        else propose('walk-dialog-focus', '2.4.3', node, '', `After "${c.name}" opens a dialog, focus stays outside it`, 'Move focus into the dialog');
        t0 = Date.now();
        await page.keyboard.press('Escape');
        let s2 = await now();
        for (const end = Date.now() + limit; s2.dialogs > before.dialogs && Date.now() < end;) {
          await page.waitForTimeout(100);
          s2 = await now();
        }
        if (s2.dialogs > before.dialogs) {
          stuck = true;
          ev('dialog', 'dialog did not close');
        } else {
          ev('dialog', 'dialog closed by Escape');
          const back = await handle.evaluate((el) => document.activeElement === el).catch(() => false);
          ev('focus', back ? 'focus returned to the control' : `focus went to ${s2.active}, not back to the control`, { where: 'after dialog close' });
          if (back) ok['walk-focus-return'] = 1;
          else propose('walk-focus-return', '2.4.3', node, '', `After the dialog opened by "${c.name}" closes, focus is on ${s2.active}, not on the control`, 'Return focus to the control that opened the dialog');
        }
      }

      const out = SIGN_IN.test(new URL(st.url).pathname) && !SIGN_IN.test(startPath);
      if (out) ev('note', 'signed out by the action');
      record('press');
      await closePopups();
      if (out) await restart(true);
      else if (moved || stuck) await restart(false);
    }

    // Forms (3.3.1, 3.3.3): each form with a submit control, from the page as
    // loaded: once with every text field empty, then once for each typed
    // field with a wrong value typed in and the others safe. A field is marked
    // in error when aria-invalid turns true, its border, outline or shadow
    // changes, or (with no novalidate) the browser's own check fails. Its
    // error text is the text linked to it, the browser's message, or new text.
    const formCount = await page.evaluate(() => document.querySelectorAll('form,[role=form]').length).catch(() => 0);
    const fill = async (j, value, typeIt) => {
      const h = (await page.evaluateHandle((k) => window.__rp.form.els[k], j)).asElement();
      const kind = await h.evaluate((e) => (e.tagName === 'SELECT' ? 'select' : e.type));
      if (kind === 'select') {
        const v = await h.evaluate((e) => [...e.options].find((o) => !o.disabled && o.value)?.value ?? null);
        if (v !== null && value !== '') await h.selectOption(v).catch(() => {});
      } else if (kind === 'checkbox' || kind === 'radio') {
        if (value !== '') await h.check({ timeout: 1000 }).catch(() => {});
      } else if (typeIt) {
        await h.fill('', { timeout: 1000 }).catch(() => {});
        await h.focus().catch(() => {});
        await page.keyboard.type(value);
      } else await h.fill(value, { timeout: 1000 }).catch(() => {});
    };
    const safe = (f) => (f.type in SAFE ? SAFE[f.type] : 'a11y-test');
    for (let i = 0; i < formCount; i++) {
      await restart(false);
      await page.evaluate(install);
      const info = await page.evaluate(fieldsIn, i).catch(() => null);
      if (!info || !info.submit || !info.fields.length) continue;
      const cases = [{ what: 'every text field empty', target: null }, ...info.fields.filter((f) => f.typed).map((f) => ({ what: `a wrong value in "${f.label}"`, target: f }))];
      const events = [];
      const t0 = Date.now();
      const ev = (type, text, extra) => events.push({ t: Date.now() - t0, type, text, ...extra });
      for (const cs of cases) {
        if (cs.target) { await restart(false); await page.evaluate(install); await page.evaluate(fieldsIn, i); }
        for (const f of info.fields) {
          if (cs.target === null) { if (!f.choices && f.type !== 'checkbox' && f.type !== 'radio') await fill(f.j, ''); }
          else if (f.j === cs.target.j) await fill(f.j, f.type in WRONG ? WRONG[f.type] : 'abc', true);
          else if (safe(f) !== null) await fill(f.j, safe(f));
        }
        const before = await page.evaluate(look);
        const url0 = page.url();
        await arm(false, hoverText);
        ev('submit', `submitted with ${cs.what}`);
        let wrote = false;
        hook.current = (w) => { wrote = true; ev('write', `write blocked: ${w}`); };
        const btn = (await page.evaluateHandle(() => window.__rp.form.btn)).asElement();
        await btn.click({ timeout: Math.min(limit, 3000) }).catch((e) => ev('note', `could not press: ${String(e.message).split(/\r?\n/)[0]}`));
        await quiet();
        await page.waitForTimeout(after);
        hook.current = null;
        const now2 = await page.evaluate(look).catch(() => null);
        if (!now2 || other(url0, page.url())) { ev('note', 'the form was sent (a new page)'); continue; }
        const added = (await page.evaluate(() => (window.__rp ? window.__rp.ev : [])).catch(() => [])).map((r) => r.text).join(' ');
        const asked = cs.target ? [cs.target] : info.fields;
        let marked = 0;
        for (const f of asked) {
          const b = before[f.j];
          const a = now2[f.j];
          const nat = info.native && a.native;
          const painted = a.paint !== b.paint && !a.focused && !b.focused;
          if (!(nat || (a.invalid && !b.invalid) || painted || (a.linked && a.linked !== b.linked))) continue;
          marked++;
          const node = nodeOf({ name: f.label, role: '' });
          const msg = nat ? a.native : a.linked || added;
          if (!msg) {
            ev('error', `"${f.label}" is marked in error with no text`, { ok: false });
            propose('walk-error-no-text', '3.3.1', node, cs.what, `After a submit with ${cs.what}, "${f.label}" is marked in error with no text that says what is wrong`, 'Describe the error in text, and link it to the field (aria-describedby or aria-errormessage)');
            continue;
          }
          ok['walk-error-no-text'] = 1;
          ev('error', nat ? `browser message on "${f.label}": ${msg}` : `"${f.label}": ${msg.slice(0, 120)}`, { ok: true, linked: !!(nat || a.linked) });
          if (!nat && !a.linked && !msg.toLowerCase().includes(f.label.toLowerCase())) {
            propose('walk-error-unnamed', '3.3.1', node, cs.what, `After a submit with ${cs.what}, the error text ("${msg.slice(0, 80)}") is not linked to "${f.label}" and does not name it`, 'Link the error text to the field, or name the field in it');
          } else ok['walk-error-unnamed'] = 1;
          if (cs.target) {
            if (SUGGEST.test(msg)) ok['walk-error-no-suggestion'] = 1;
            else propose('walk-error-no-suggestion', '3.3.3', node, cs.what, `After ${cs.what}, the error text ("${msg.slice(0, 80)}") does not say how to fix it`, 'Say what is expected, such as the format or an example');
          }
        }
        if (!marked) ev('note', wrote ? 'the form was sent, with no error shown' : 'no field was marked in error');
      }
      model.actions.push({ id: `a${model.actions.length + 1}`, kind: 'submit', node: nodeOf({ name: info.name, role: '' }).id, name: info.name, events });
    }

    // Steppers (3.3.7): a page with a Next or Continue control is walked: the
    // empty fields of each step are filled with safe values and Next is
    // pressed, until no Next, STEP_MAX steps, or a Next that does not go on.
    // A label asked again in a later step, empty and with nothing to choose
    // from, is a proposal. The last step's submit is not pressed.
    // "Next page" of a list paginator is not a step.
    const NEXT = /^(next|continue)\b(?!.*\bpage\b)/i;
    await restart(false);
    if ((await list()).some((x) => NEXT.test(x.name))) {
      const events = [];
      const t0 = Date.now();
      const ev = (type, text, extra) => events.push({ t: Date.now() - t0, type, text, ...extra });
      const asked = new Map();
      let first = null;
      for (let n = 1; n <= STEP_MAX; n++) {
        const info = await page.evaluate(fieldsIn, -1);
        ev('step', `step ${n}: ${info.fields.map((f) => f.label).join(', ') || 'no fields'}`);
        for (const f of info.fields) {
          const key = f.label.toLowerCase();
          if (n > 1 && asked.has(key) && asked.get(key) < n) {
            const node = nodeOf({ name: f.label, role: '' });
            if (!f.value && !f.choices) propose('walk-redundant-entry', '3.3.7', node, f.label, `Step ${n} asks for "${f.label}" again, empty, after an earlier step of the same process asked for it`, 'Fill it in from the earlier step, or let the person pick the earlier value');
            else ok['walk-redundant-entry'] = 1;
          }
          if (!asked.has(key)) asked.set(key, n);
          if (!f.value && safe(f) !== null) await fill(f.j, safe(f));
        }
        const next = (await list()).find((x) => NEXT.test(x.name));
        if (!next) break;
        first ??= next.name;
        if (n === STEP_MAX) { ev('note', `steps stopped at ${STEP_MAX}`); break; }
        const sig = JSON.stringify(info.fields.map((f) => f.label));
        hook.current = (w) => ev('write', `write blocked: ${w}`);
        await (await page.evaluateHandle((k) => window.__rp.els[k], next.i)).asElement().click({ timeout: Math.min(limit, 3000) }).catch(() => {});
        await quiet();
        await page.waitForTimeout(after);
        hook.current = null;
        if (JSON.stringify((await page.evaluate(fieldsIn, -1)).fields.map((f) => f.label)) === sig) { ev('note', `"${next.name}" did not go on at step ${n}`); break; }
      }
      model.actions.push({ id: `a${model.actions.length + 1}`, kind: 'steps', node: root.id, name: `Steps from "${first ?? 'Next'}"`, events });
    }

    // Single keys (2.1.4): from the page as loaded, each key once, with focus
    // on the page body (checked before each key, so a key never types into a
    // field). A key that changes something is an action of kind key, and the
    // page is loaded again. On a page that updates by itself, new text is not
    // counted as a key's doing (the watch above found it changing alone).
    const keys = opts.actKeys ?? KEYS;
    if (keys.length) {
      await restart(false);
      let acted = false;
      let all = true;
      for (const k of keys) {
        await page.evaluate(install);
        const onBody = await page.evaluate(() => { document.activeElement?.blur?.(); const a = document.activeElement; return !a || a === document.body || a === document.documentElement; }).catch(() => false);
        if (!onBody) { notes.push('Single keys stopped: focus does not stay on the page body'); all = false; break; }
        const before = await now();
        await arm(false, hoverText);
        const events = [];
        const t0 = Date.now();
        const ev = (type, text, extra) => events.push({ t: Date.now() - t0, type, text, ...extra });
        hook.current = (w) => ev('write', `write blocked: ${w}`);
        popups.length = 0;
        await page.keyboard.press(k);
        await quiet();
        await page.waitForTimeout(Math.min(after, KEY_AFTER));
        hook.current = null;
        const st = await now();
        if (!updating.length) {
          const rec = await page.evaluate(() => (window.__rp ? window.__rp.ev : [])).catch(() => []);
          for (const r of rec) events.push({ t: r.at - t0, type: r.type, text: r.text });
        }
        if (!st.body) ev('focus', `${before.active} to ${st.active}`, { from: before.active, to: st.active });
        if (other(before.url, st.url)) ev('context', `url changed to ${bare(st.url)}`, { what: 'url' });
        if (st.dialogs > before.dialogs) ev('context', 'dialog opened', { what: 'dialog' });
        for (const p of popups) ev('context', `new window: ${bare(p.url())}`, { what: 'window' });
        if (!events.length) continue;
        acted = true;
        events.sort((a, b) => a.t - b.t);
        model.actions.push({ id: `a${model.actions.length + 1}`, kind: 'key', node: root.id, name: `Key "${k}"`, events });
        propose('walk-single-key', '2.1.4', root, k, `The key "${k}" alone, with focus on the page body, does something (${events[0].text})`, 'Let the person turn the shortcut off or change it, or make it work only when its control has focus');
        await closePopups();
        const out = SIGN_IN.test(new URL(st.url).pathname) && !SIGN_IN.test(startPath);
        await restart(out);
      }
      if (all && !acted) ok['walk-single-key'] = 1;
    }
  } finally {
    context.off('page', onPage);
    hook.current = null;
  }

  const verdict = (sc, rule) => {
    if (flagged.has(rule)) addCheck(model.checks, sc, 'review', rule);
    else if (ok[rule]) addCheck(model.checks, sc, 'pass', rule);
  };
  for (const [sc, rule] of [['2.4.3', 'walk-focus-return'], ['2.4.3', 'walk-dialog-focus'], ['2.4.3', 'walk-focus-lost'], ['3.2.1', 'walk-context-focus'],
    ['3.2.2', 'walk-context-input'], ['4.1.3', 'walk-live-missing'], ['3.3.4', 'walk-write-no-confirm'], ['3.3.6', 'walk-write-no-confirm-reversal'],
    ['3.3.1', 'walk-error-no-text'], ['3.3.1', 'walk-error-unnamed'], ['3.3.3', 'walk-error-no-suggestion'], ['3.3.7', 'walk-redundant-entry'],
    ['2.1.4', 'walk-single-key'], ['2.2.2', 'walk-update-no-pause'], ['2.2.4', 'walk-update-no-pause-interrupt'],
    ['2.5.1', 'walk-gesture'], ['2.5.2', 'walk-down-event'], ['2.5.4', 'walk-motion'], ['2.5.6', 'walk-input-limited'], ['2.5.7', 'walk-drag'],
    ['1.3.2', 'walk-order'], ['1.3.3', 'walk-sensory'], ['2.2.1', 'walk-session-timeout'], ['2.2.3', 'walk-session-timing'],
    ['2.2.5', 'walk-session-reauth'], ['2.2.6', 'walk-session-warning'], ['3.3.8', 'walk-signin-paste'], ['3.3.8', 'walk-signin-puzzle'],
    ['3.3.9', 'walk-signin-paste-enhanced'], ['3.3.9', 'walk-signin-puzzle-enhanced'],
    ['1.4.13', 'walk-hover-dismiss'], ['1.4.13', 'walk-hover-hoverable'], ['1.4.13', 'walk-hover-persist']]) verdict(sc, rule);
}
