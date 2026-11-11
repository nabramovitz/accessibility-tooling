// The page under more than one condition: a narrow window (1.4.10), the
// layout of 200 % zoom (1.4.4), the WCAG text spacing (1.4.12) and
// reduced motion (2.3.3). Each view is measured by a script in the page;
// no screenshot is taken. The
// views run last in generate(): they change the layout, and the page is
// not read again after them.
import { addCheck } from './axe.js';
import { ready } from './generate.js';

const MARK = 'data-reader-path-view';
const MAX_NAMED = 20;
const VIEW_IDLE_MAX = 5000;

const SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

const VIEWS = [
  { name: 'narrow', sc: '1.4.10', size: { width: 320, height: 256 }, at: 'in a window 320 px wide', scroll: true },
  { name: 'zoom', sc: '1.4.4', size: { width: 640, height: 360 }, at: 'at 200 % zoom' },
  { name: 'spacing', sc: '1.4.12', css: SPACING, at: 'with the WCAG text spacing' },
];

// The person's line for a view with no finding: what the view did not check.
const REST = 'text that overlaps other text is not checked';
export const VIEW_LINES = {
  'view-narrow': { review: `Needs a person: in a window 320 px wide, content in a table, a grid, preformatted text or an image may scroll sideways; ${REST}` },
  'view-zoom': { review: `Needs a person: at 200 % zoom no text is newly clipped; ${REST}` },
  'view-spacing': { review: `Needs a person: with the WCAG text spacing no text is newly clipped; ${REST}` },
  'view-motion': { review: 'Needs a person: animation from an interaction is not checked (nothing is pressed); the run notes count the animations that still run with reduced motion asked' },
};

// Runs in the page: the elements with an animation that runs now.
const RUNNING = `(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => {
  const t = a.effect && a.effect.target;
  if (!t) return 'an animation';
  return t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (t.classList[0] ? '.' + t.classList[0] : '') + (a.effect.pseudoElement || '');
}))()`;
const MAX_MOVING = 10;

// Runs in the page. With `base` it records the text boxes that are clipped
// in the default view. Otherwise it marks (attribute MARK) the boxes that
// are clipped now and were not then, and, with `scroll`, the outermost
// elements that stick out of a document that scrolls sideways. Returns
// the kinds of the marked elements, in the order of their marks: a box
// with text of its own is 'clipped'; a box whose text is all in its
// children (a container) is 'cut'.
const MEASURE = `((mark, base, scroll) => {
  const KEY = '__readerPathClipped';
  const EXEMPT = 'table, [role=table], [role=grid], [role=treegrid], pre, img, canvas, svg, video';
  const shown = (e, cs) => cs.display !== 'none' && cs.visibility !== 'hidden' && e.getClientRects().length;
  const cut = (v) => v === 'hidden' || v === 'clip';
  const clipped = [];
  for (const e of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (!shown(e, cs) || !e.textContent.trim()) continue;
    if ((cut(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) || (cut(cs.overflowY) && e.scrollHeight > e.clientHeight + 1)) clipped.push(e);
  }
  if (base) { window[KEY] = new WeakSet(clipped); return []; }
  const before = window[KEY] || new WeakSet();
  const own = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const found = clipped.filter((e) => !before.has(e)).map((e) => [e, own(e) ? 'clipped' : 'cut']);
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
  return found.map(([, kind]) => kind);
})`;

const CLEAR = `(() => { delete window.__readerPathClipped; })()`;

const call = async (cdp, args) => {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `${MEASURE}(${args.map((a) => JSON.stringify(a)).join(', ')})`, returnByValue: true });
  return result.value || [];
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

const running = async (cdp) => (await cdp.send('Runtime.evaluate', { expression: RUNNING, returnByValue: true })).result.value || [];

export async function views(page, cdp, idleTime, opts, nearestKept, root, model, notes) {
  const start = page.viewportSize();
  // After a change: the requests it caused, then two frames for the layout.
  const laid = async () => {
    await ready(page, idleTime, { idle: opts.idle, idleMax: VIEW_IDLE_MAX });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  await call(cdp, [MARK, true, false]);
  model.views = [];
  for (const view of VIEWS) {
    const size = view.size ?? start;
    if (view.size) await page.setViewportSize(view.size);
    const style = view.css ? await page.addStyleTag({ content: view.css }) : null;
    await laid();
    const kinds = await call(cdp, [MARK, false, !!view.scroll]);
    const id = `view-${view.name}`;
    let named = 0;
    for (let i = 0; i < kinds.length; i++) {
      const node = (await take(cdp, nearestKept, i)) ?? root;
      if (kinds[i] === 'exempt' || ++named > MAX_NAMED) continue;
      const [why, goal] = {
        wide: [`The page scrolls sideways ${view.at}: this content is wider than the window.`, 'Content fits a window 320 px wide without sideways scroll'],
        clipped: [`Text is clipped ${view.at}; it is not clipped in the default view.`, 'No text is lost'],
        cut: [`This box cuts off its content ${view.at}; it does not in the default view.`, 'No content is lost'],
      }[kinds[i]];
      (node.gaps ||= []).push([why, view.sc, goal]);
    }
    const fails = kinds.filter((k) => k !== 'exempt').length;
    if (fails > MAX_NAMED) (root.gaps ||= []).push([`and ${fails - MAX_NAMED} more ${view.at}`, view.sc, 'No text is lost']);
    if (fails) (model.levels ||= {})[view.sc] = 'AA';
    addCheck(model.checks, view.sc, fails ? 'fail' : 'review', id);
    model.views.push({ name: view.name, ...size });
    if (style) await style.evaluate((e) => e.remove());
  }
  await cdp.send('Runtime.evaluate', { expression: CLEAR });
  await page.setViewportSize(start);

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
