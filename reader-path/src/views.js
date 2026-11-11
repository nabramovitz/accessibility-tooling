// The page under more than one condition: a narrow window (1.4.10), the
// layout of 200 % zoom (1.4.4), the WCAG text spacing (1.4.12), the dark
// colour scheme (1.4.3, 1.4.6) and reduced motion (2.3.3). Each view is measured by a script in the page;
// no screenshot is taken. The
// views run last in generate(): they change the layout, and the page is
// not read again after them.
import { addCheck, axeToChecks, axeToGaps } from './axe.js';
import { ready, placeTarget } from './generate.js';

const MARK = 'data-reader-path-view';
const MAX_NAMED = 20;
// Text that overlaps other text by this share of the smaller box or more
// is a gap. The box of a line is the font's ascent to descent: below a
// quarter the glyphs often do not touch, so a person looks.
const CLEAR_SHARE = 0.25;
const VIEW_IDLE_MAX = 5000;

const SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

const VIEWS = [
  { name: 'narrow', sc: '1.4.10', size: { width: 320, height: 256 }, at: 'in a window 320 px wide', scroll: true },
  { name: 'zoom', sc: '1.4.4', size: { width: 640, height: 360 }, at: 'at 200 % zoom' },
  { name: 'spacing', sc: '1.4.12', css: SPACING, at: 'with the WCAG text spacing' },
];

// The person's line for a view that is not a pass or a fail: what is left.
const LITTLE = 'some text overlaps other text a little or lies under a fixed or sticky box (see the run notes)';
export const VIEW_LINES = {
  'view-narrow': { review: `Needs a person: in a window 320 px wide, content in a table, a grid, preformatted text or an image may scroll sideways, or ${LITTLE}` },
  'view-zoom': { review: `Needs a person: at 200 % zoom ${LITTLE}` },
  'view-spacing': { review: `Needs a person: with the WCAG text spacing ${LITTLE}` },
  'view-dark': { review: 'Needs a person: in dark mode axe-core could not decide the contrast of some text (see the run notes)' },
  'view-motion': { review: 'Needs a person: animation from an interaction is not checked (nothing is pressed); the run notes count the animations that still run with reduced motion asked' },
};

// Runs in the page: the elements with an animation that runs now.
const RUNNING = `(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => {
  const t = a.effect && a.effect.target;
  if (!t) return 'an animation';
  return t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (t.classList[0] ? '.' + t.classList[0] : '') + (a.effect.pseudoElement || '');
}))()`;
const MAX_MOVING = 10;

// Runs in the page, inside MEASURE. The boxes of the text on the page, by
// line (Range client rects of each text node), cut to the boxes that
// scroll or clip them, so text scrolled out of its box is not there; text
// that is not shown is left out. Returns the pairs of boxes that overlap,
// from different elements: [element, element, share of the smaller box,
// pinned], or null with more than MAX boxes. pinned: one of the two is in
// a fixed or sticky box, so the text under it can scroll into view. Boxes of one text node, and of text in
// one element, are lines of the same text and are not compared.
const OVERLAPS = `
  const MAX = 10000;
  const clipsOf = (() => {
    const memo = new Map();
    const of = (e) => {
      if (!e || e === document.body || e === document.documentElement) return [];
      if (memo.has(e)) return memo.get(e);
      const cs = getComputedStyle(e);
      const own = [];
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const r = e.getBoundingClientRect();
        const l = r.left + e.clientLeft, t = r.top + e.clientTop;
        own.push({ l: cs.overflowX !== 'visible' ? l : -Infinity, r: cs.overflowX !== 'visible' ? l + e.clientWidth : Infinity,
          t: cs.overflowY !== 'visible' ? t : -Infinity, b: cs.overflowY !== 'visible' ? t + e.clientHeight : Infinity });
      }
      const all = own.concat(of(e.parentElement));
      memo.set(e, all);
      return all;
    };
    return of;
  })();
  const pinnedOf = (() => {
    const memo = new Map();
    const of = (e) => {
      if (!e || e === document.body || e === document.documentElement) return false;
      if (memo.has(e)) return memo.get(e);
      const v = /^(fixed|sticky)$/.test(getComputedStyle(e).position) || of(e.parentElement);
      memo.set(e, v);
      return v;
    };
    return of;
  })();
  const boxes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent.trim() || el.closest('script, style, noscript, template')) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const clips = clipsOf(el);
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) {
      let l = q.left, r = q.right, t = q.top, b = q.bottom;
      for (const c of clips) { l = Math.max(l, c.l); r = Math.min(r, c.r); t = Math.max(t, c.t); b = Math.min(b, c.b); }
      if (r - l < 2 || b - t < 2) continue;
      boxes.push({ n, el, l, r, t, b, area: (r - l) * (b - t), pin: pinnedOf(el) });
    }
  }
  if (boxes.length > MAX) return null;
  boxes.sort((x, y) => x.t - y.t);
  const pairs = new Map();
  for (let i = 0; i < boxes.length; i++) {
    const x = boxes[i];
    for (let j = i + 1; j < boxes.length && boxes[j].t < x.b; j++) {
      const y = boxes[j];
      if (y.n === x.n || y.el === x.el) continue;
      const w = Math.min(x.r, y.r) - Math.max(x.l, y.l), h = Math.min(x.b, y.b) - Math.max(x.t, y.t);
      if (w <= 0.5 || h <= 0.5) continue;
      const first = x.el.compareDocumentPosition(y.el) & Node.DOCUMENT_POSITION_FOLLOWING;
      const [a, b2] = first ? [x.el, y.el] : [y.el, x.el];
      const share = (w >= 2 && h >= 2) ? (w * h) / Math.min(x.area, y.area) : 0;
      const old = pairs.get(a) || new Map();
      const was = old.get(b2) || [0, false];
      old.set(b2, [Math.max(was[0], share), was[1] || x.pin || y.pin]);
      pairs.set(a, old);
    }
  }
  const out = [];
  for (const [a, m] of pairs) for (const [b2, [share, pin]] of m) out.push([a, b2, share, pin]);
  return out;
`;

// Runs in the page. With `base` it records the text boxes that are clipped
// and the pairs of text that overlap in the default view. Otherwise it
// marks (attribute MARK) the boxes that are clipped now and were not then,
// the text that overlaps other text now and did not then, and, with
// `scroll`, the outermost elements that stick out of a document that
// scrolls sideways. Returns { found, small, capped }. found: [kind, what]
// of the marked elements, in the order of their marks: a box with text of
// its own is 'clipped'; a box whose text is all in its children (a
// container) is 'cut'; text over other text is 'overlap', with the other
// element named. small: the pairs that overlap by under CLEAR_SHARE of the
// smaller box, for a person. capped: there was too much text to compare.
const MEASURE = `((mark, base, scroll, clear) => {
  const KEY = '__readerPathClipped';
  const KEY2 = '__readerPathOverlap';
  const describe = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList[0] ? '.' + e.classList[0] : '');
  const overlaps = (() => {${OVERLAPS}})();
  const EXEMPT = 'table, [role=table], [role=grid], [role=treegrid], pre, img, canvas, svg, video';
  const shown = (e, cs) => cs.display !== 'none' && cs.visibility !== 'hidden' && e.getClientRects().length;
  const cut = (v) => v === 'hidden' || v === 'clip';
  const clipped = [];
  for (const e of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (!shown(e, cs) || !e.textContent.trim()) continue;
    if ((cut(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) || (cut(cs.overflowY) && e.scrollHeight > e.clientHeight + 1)) clipped.push(e);
  }
  if (base) {
    window[KEY] = new WeakSet(clipped);
    const seen = new WeakMap();
    for (const [a, b] of overlaps || []) seen.set(a, (seen.get(a) || new Set()).add(b));
    window[KEY2] = seen;
    return {};
  }
  const before = window[KEY] || new WeakSet();
  const seen = window[KEY2] || new WeakMap();
  const own = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const found = clipped.filter((e) => !before.has(e)).map((e) => [e, own(e) ? 'clipped' : 'cut']);
  const small = [];
  const pinned = [];
  for (const [a, b, share, pin] of overlaps || []) {
    if (share <= 0 || (seen.get(a) && seen.get(a).has(b))) continue;
    if (pin) pinned.push(describe(a) + ' and ' + describe(b));
    else if (share >= clear) found.push([a, 'overlap', describe(b)]);
    else small.push(describe(a) + ' and ' + describe(b));
  }
  const doc = document.scrollingElement;
  if (scroll && doc.scrollWidth > doc.clientWidth + 1) {
    const out = (e) => e.getBoundingClientRect().right + doc.scrollLeft > doc.clientWidth + 1;
    // Inside a box that scrolls or cuts by itself: not the document's scroll.
    const boxed = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true; return false; };
    for (const e of document.body.querySelectorAll('*')) {
      if (!shown(e, getComputedStyle(e)) || !out(e) || boxed(e)) continue;
      if (e.parentElement !== document.body && out(e.parentElement)) continue;
      found.push([e, e.closest(EXEMPT) ? 'exempt' : 'wide']);
    }
  }
  found.forEach(([e], i) => e.setAttribute(mark, String(i)));
  return { found: found.map(([, kind, what]) => [kind, what || '']), small, pinned, capped: !overlaps };
})`;

const CLEAR = `(() => { delete window.__readerPathClipped; delete window.__readerPathOverlap; })()`;

const call = async (cdp, args) => {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `${MEASURE}(${args.map((a) => JSON.stringify(a)).join(', ')})`, returnByValue: true });
  return result.value || {};
};

// The kept node of the element with mark i, and the mark removed.
async function take(cdp, nearestKept, i) {
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const e = document.querySelector('[${MARK}="${i}"]'); if (e) e.removeAttribute('${MARK}'); return e; })()`,
    objectGroup: 'view',
  });
  if (!result.objectId) return undefined;
  const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
  return nearestKept(node.backendNodeId);
}

// Runs in the page: the colours of the root, the body and the first 200
// elements, to see whether the page answers the dark colour scheme.
const COLOURS = `(() => [document.documentElement, document.body, ...[...document.body.querySelectorAll('*')].slice(0, 200)]
  .map((e) => { const c = getComputedStyle(e); return c.color + '|' + c.backgroundColor + '|' + c.borderTopColor; }).join(';'))()`;
const DARK_RULES = { type: 'rule', values: ['color-contrast', 'color-contrast-enhanced'] };
const DARK_ROWS = ['1.4.3', '1.4.6'];

// The dark view: the colours of the default scheme and of the dark one. A
// page whose colours do not change has no dark mode (a note, no check).
// Otherwise only the two contrast rules run, and their results are the
// checks `view-dark` of the rows 1.4.3 and 1.4.6. A fail is the gap of the
// node, with the colours and the ratio as axe-core gives them.
async function dark(page, cdp, nearestKept, root, model, notes, laid) {
  const light = (await cdp.send('Runtime.evaluate', { expression: COLOURS, returnByValue: true })).result.value;
  await page.emulateMedia({ colorScheme: 'dark' });
  try {
    await laid();
    const changed = (await cdp.send('Runtime.evaluate', { expression: COLOURS, returnByValue: true })).result.value !== light;
    if (!changed) {
      notes.push('The page has no dark mode');
      return;
    }
    let results;
    try {
      results = await page.evaluate((runOnly) => axe.run(document, { runOnly }), DARK_RULES);
    } catch (e) {
      const why = String(e.message).split(/\r?\n/)[0].replace(/^(?:page\.)?evaluate: (?:\w*Error: )?/, '');
      notes.push(`axe-core did not run in dark mode: ${why}`);
      for (const sc of DARK_ROWS) addCheck(model.checks, sc, 'review', 'view-dark');
      return;
    }
    for (const [sc, lists] of Object.entries(axeToChecks(results))) {
      for (const list of ['pass', 'fail', 'review']) if (lists[list].length) addCheck(model.checks, sc, list, 'view-dark');
    }
    for (const g of axeToGaps(results)) {
      let node = await placeTarget(cdp, nearestKept, g.target);
      let why = `In dark mode: ${g.why}`;
      if (!node) {
        node = root;
        why = `In dark mode: not placed: ${g.target.map((t) => [].concat(t).join(' ')).join(' > ')} - ${g.why}`;
      }
      (node.gaps ||= []).push([why, g.sc, g.goal]);
      (model.levels ||= {})[g.sc] = g.level;
    }
  } finally {
    await page.emulateMedia({ colorScheme: null });
  }
}

const running = async (cdp) => (await cdp.send('Runtime.evaluate', { expression: RUNNING, returnByValue: true })).result.value || [];

export async function views(page, cdp, idleTime, opts, nearestKept, root, model, notes) {
  const start = page.viewportSize();
  // After a change: the requests it caused, then two frames for the layout.
  const laid = async () => {
    await ready(page, idleTime, { idle: opts.idle, idleMax: VIEW_IDLE_MAX });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  await call(cdp, [MARK, true, false, CLEAR_SHARE]);
  model.views = [];
  for (const view of VIEWS) {
    const size = view.size ?? start;
    if (view.size) await page.setViewportSize(view.size);
    const style = view.css ? await page.addStyleTag({ content: view.css }) : null;
    await laid();
    const { found = [], small = [], pinned = [], capped } = await call(cdp, [MARK, false, !!view.scroll, CLEAR_SHARE]);
    const kinds = found.map(([k]) => k);
    const id = `view-${view.name}`;
    let named = 0;
    for (let i = 0; i < kinds.length; i++) {
      const node = (await take(cdp, nearestKept, i)) ?? root;
      if (kinds[i] === 'exempt' || ++named > MAX_NAMED) continue;
      const other = found[i][1];
      const [why, goal] = {
        wide: [`The page scrolls sideways ${view.at}: this content is wider than the window.`, 'Content fits a window 320 px wide without sideways scroll'],
        clipped: [`Text is clipped ${view.at}; it is not clipped in the default view.`, 'No text is lost'],
        cut: [`This box cuts off its content ${view.at}; it does not in the default view.`, 'No content is lost'],
        overlap: [`Text overlaps other text (${other}) ${view.at}; it does not in the default view.`, 'No text is lost'],
      }[kinds[i]];
      (node.gaps ||= []).push([why, view.sc, goal]);
    }
    const fails = kinds.filter((k) => k !== 'exempt').length;
    if (fails > MAX_NAMED) (root.gaps ||= []).push([`and ${fails - MAX_NAMED} more ${view.at}`, view.sc, 'No text is lost']);
    if (fails) (model.levels ||= {})[view.sc] = 'AA';
    // A pass needs that nothing was left for a person: no content that may
    // scroll sideways (exempt), no small overlap, text compared.
    const left = kinds.includes('exempt') || small.length || pinned.length || capped;
    if (small.length) notes.push(`Text overlaps a little ${view.at}, not in the default view: ${small.slice(0, MAX_NAMED).join('; ')}${small.length > MAX_NAMED ? '; ...' : ''}`);
    if (pinned.length) notes.push(`Text under a fixed or sticky box ${view.at} (it can scroll into view), for a person: ${pinned.slice(0, MAX_NAMED).join('; ')}${pinned.length > MAX_NAMED ? '; ...' : ''}`);
    if (capped) notes.push(`Overlap not checked ${view.at}: more than 10000 text boxes`);
    addCheck(model.checks, view.sc, fails ? 'fail' : left ? 'review' : 'pass', id);
    model.views.push({ name: view.name, ...size });
    if (style) await style.evaluate((e) => e.remove());
  }
  await cdp.send('Runtime.evaluate', { expression: CLEAR });
  await page.setViewportSize(start);

  await laid();
  await dark(page, cdp, nearestKept, root, model, notes, laid);
  model.views.push({ name: 'dark', ...start });

  // Reduced motion: never a pass or a fail here, as nothing is pressed;
  // the counts are the evidence for a person.
  await laid();
  const before = await running(cdp);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await laid();
  const still = await running(cdp);
  await page.emulateMedia({ reducedMotion: null });
  const names = [...new Set(still)];
  const named = names.length ? ` (${names.slice(0, MAX_MOVING).join(', ')}${names.length > MAX_MOVING ? ', ...' : ''})` : '';
  notes.push(`Animations running: ${before.length} in the default view, ${still.length} with reduced motion asked${named}`);
  addCheck(model.checks, '2.3.3', 'review', 'view-motion');
  model.views.push({ name: 'motion', ...start });
}
