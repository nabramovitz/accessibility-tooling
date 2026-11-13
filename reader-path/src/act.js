// The action phase (--act): presses each distinct control of a page once
// and records what changes after it: focus moved, live text, a change of
// context, a write the guard blocked. It runs last in generate(), on a
// copy of the page as loaded, and puts the result in model.actions.
// Findings that need a person are proposals (walk- rules), never fails.
import { readFileSync } from 'node:fs';
import { bare, ready, walk } from './generate.js';
import { addProposal } from './proposals.js';
import { addCheck } from './axe.js';

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
  const now = () => page.evaluate(state).catch(() => ({ url: page.url(), dialogs: 0, body: false, inDialog: false, active: 'unknown' }));

  try {
    await restart(false);

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
      await page.evaluate(({ q, skip }) => {
        Object.assign(window.__rp, { ev: [], quiet: q, seen: window.__rp.read(document.body).replace(/\s+/g, '').replace(/\d+/g, '#'), skip: skip.map(window.__rp.flat) });
      }, { q: c.quiet, skip: hoverText });
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
    ['1.4.13', 'walk-hover-dismiss'], ['1.4.13', 'walk-hover-hoverable'], ['1.4.13', 'walk-hover-persist']]) verdict(sc, rule);
}
