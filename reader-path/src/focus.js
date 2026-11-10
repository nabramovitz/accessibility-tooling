// Measures at each Tab stop, taken inside the Tab walk, with focus put
// there by the Tab key:
// - 2.4.7: a shot of the stop's box with focus and one after focus has
//   moved on. The same bytes mean that no pixel changed.
// - 2.4.11 / 2.4.12: is something fixed or sticky on top of the box.
import { addCheck } from './axe.js';

const MAX_STOPS = 150;
const PAD = 8;
// Tab presses to wait for focus to leave the surroundings of a stop.
const MAX_WAIT = 3;

// The person's lines for the report.
export const FOCUS_LINES = {
  'focus-visible': { review: 'Needs a person: the look with and without focus was not compared at every Tab stop (see the run notes)' },
  'focus-obscured': { review: 'Needs a person: not every Tab stop was checked for content on top of it (see the run notes)' },
};

// Runs in the page. `now`: the focused element's box, whether it takes
// text (its caret is hidden in a shot), and how many of five points
// (centre and corners) lie under a fixed or sticky element. `was`: the
// boxes, now, of the earlier stops in `ids` (the numbers this gave them).
const STATE = `((ids) => {
  const KEY = '__readerPathFocus';
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const out = { vw: innerWidth, vh: innerHeight };
  const els = (window[KEY] ||= []);
  out.was = ids.map((i) => (els[i] && els[i].isConnected ? box(els[i]) : null));
  let e = document.activeElement;
  while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement;
  if (!e || e === document.body || e.tagName === 'IFRAME') return out;
  out.id = els.push(e) - 1;
  const b = box(e);
  const text = e.isContentEditable || e.tagName === 'TEXTAREA'
    || (e.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|image|range|color|file)$/.test(e.type));
  const stays = (h) => { for (let p = h; p && p !== document.documentElement; p = p.parentElement || (p.getRootNode().host ?? null)) {
    if (p === e || p.contains(e)) return null;
    if (/^(fixed|sticky)$/.test(getComputedStyle(p).position)) return p; } return null; };
  const hit = (x, y) => { let h = document.elementFromPoint(x, y);
    while (h && h.shadowRoot && h.shadowRoot.elementFromPoint(x, y) && h.shadowRoot.elementFromPoint(x, y) !== h) h = h.shadowRoot.elementFromPoint(x, y);
    return h; };
  let points = 0; let covered = 0; let by = '';
  for (const [x, y] of [[b.x + b.w / 2, b.y + b.h / 2], [b.x + 1, b.y + 1], [b.x + b.w - 1, b.y + 1], [b.x + 1, b.y + b.h - 1], [b.x + b.w - 1, b.y + b.h - 1]]) {
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    points++;
    const h = hit(x, y);
    const top = h && h !== e && !e.contains(h) ? stays(h) : null;
    if (top) { covered++; by ||= top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (top.classList[0] ? '.' + top.classList[0] : ''); }
  }
  out.now = { ...b, text, points, covered, by };
  return out;
})`;

const CLEAR = `(() => { delete window.__readerPathFocus; })()`;

const same = (a, b) => ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.5);
const meet = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// focus.after(): call after each Tab press. focus.at(node): call when the
// walk has a new stop, with its kept node. focus.finish(): the checks.
export function focusWatch(page, cdp, model, root, notes) {
  let state = null; // the page state after the last Tab press
  let pending = []; // stops with no second shot yet: { id, node, box, clip, shot, age }
  let stops = 0;
  let capped = false;
  const uncompared = [];
  const fails = { '2.4.7': 0, '2.4.11': 0, '2.4.12': 0 };
  const gap = (node, why, sc, goal, level) => {
    (node.gaps ||= []).push([why, sc, goal]);
    (model.levels ||= {})[sc] = level;
    fails[sc]++;
  };
  const nameOf = (node) => node.name || node.t || node.role || node.r || 'a control';
  const shoot = (clip) => page.screenshot({ clip, animations: 'disabled', caret: 'hide' }).catch(() => null);

  return {
    // The second shot of a stop is taken once focus is off its
    // surroundings (the next stops can be right beside it) and only if
    // the stop has not moved (a scroll, a layout change).
    async after() {
      if (capped && !pending.length) { state = null; return; }
      const { result } = await cdp.send('Runtime.evaluate', { expression: `${STATE}(${JSON.stringify(pending.map((p) => p.id))})`, returnByValue: true });
      state = result.value || { was: [] };
      const now = state.now && { x: state.now.x, y: state.now.y, width: state.now.w, height: state.now.h };
      const wait = [];
      for (const [i, last] of pending.entries()) {
        const was = state.was[i];
        if (!last.shot || !was || !same(was, last.box)) { uncompared.push(nameOf(last.node)); continue; }
        if (now && meet(now, last.clip)) {
          if (++last.age > MAX_WAIT) uncompared.push(nameOf(last.node)); else wait.push(last);
          continue;
        }
        const shot = await shoot(last.clip);
        if (!shot || (shot.equals(last.shot) && last.box.text)) uncompared.push(nameOf(last.node));
        else if (shot.equals(last.shot)) gap(last.node, 'This control looks the same with and without focus.', '2.4.7', 'A control with focus shows a focus indicator', 'AA');
      }
      pending = wait;
    },

    async at(node) {
      const now = state?.now;
      if (!now) return;
      if (stops >= MAX_STOPS) {
        if (!capped) notes.push(`Focus measures stopped at ${MAX_STOPS} Tab stops; the rest not measured`);
        capped = true;
        return;
      }
      stops++;
      if (now.points && now.covered === now.points) {
        gap(node, `With focus, this control is under other content (${now.by}).`, '2.4.11', 'A control with focus is not fully hidden', 'AA');
      }
      if (now.covered) {
        gap(node, `With focus, a part of this control is under other content (${now.by}).`, '2.4.12', 'No part of a control with focus is hidden', 'AAA');
      }
      const x = Math.max(0, now.x - PAD);
      const y = Math.max(0, now.y - PAD);
      const clip = { x, y, width: Math.min(state.vw, now.x + now.w + PAD) - x, height: Math.min(state.vh, now.y + now.h + PAD) - y };
      const seen = now.w > 0 && now.h > 0 && clip.width > 0 && clip.height > 0;
      pending.push({ id: state.id, node, box: now, clip, shot: seen ? await shoot(clip) : null, age: 0 });
    },

    async finish(walk) {
      // Focus is off the last stops now, unless the walk stopped on one
      // (a trap, the 500 limit): those stay uncompared.
      await this.after();
      for (const last of pending) uncompared.push(nameOf(last.node));
      pending = [];
      await cdp.send('Runtime.evaluate', { expression: CLEAR });
      if (uncompared.length) notes.push(`Focus not compared at ${uncompared.length} Tab stop(s): ${uncompared.slice(0, 10).join(', ')}${uncompared.length > 10 ? ', ...' : ''}`);
      if (!stops) return;
      const partial = capped || walk !== 'pass';
      addCheck(model.checks, '2.4.7', fails['2.4.7'] ? 'fail' : partial || uncompared.length ? 'review' : 'pass', 'focus-visible');
      for (const sc of ['2.4.11', '2.4.12']) addCheck(model.checks, sc, fails[sc] ? 'fail' : partial ? 'review' : 'pass', 'focus-obscured');
    },
  };
}
