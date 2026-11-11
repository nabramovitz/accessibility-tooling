// Measures at each Tab stop, taken inside the Tab walk, with focus put
// there by the Tab key:
// - 2.4.7: a shot of the stop's box with focus and one after focus has
//   moved on. The same bytes mean that no pixel changed.
// - 2.4.11 / 2.4.12: is something fixed or sticky on top of the box.
// - 2.5.5: is the box 44 x 44 px or more.
// - 2.4.13 and 1.4.11: pixel measures on the same two shots (pixel.js).
import { addCheck } from './axe.js';
import { measurePixels, judgeAppearance, judgeBoundary, NEED } from './pixel.js';

const MAX_STOPS = 150;
const PAD = 8;
// Tab presses to wait for focus to leave the surroundings of a stop.
const MAX_WAIT = 3;
const TARGET = 44;

// The person's lines for the report.
export const FOCUS_LINES = {
  'focus-visible': { review: 'Needs a person: the look with and without focus was not compared at every Tab stop (see the run notes)' },
  'focus-obscured': { review: 'Needs a person: not every Tab stop was checked for content on top of it (see the run notes)' },
  'focus-appearance': { review: 'Needs a person: the size and contrast of the focus indicator are measured from a picture and some Tab stops are inside the margin of error, were not compared, or have an indicator beyond 8 px (see the run notes)' },
  'focus-contrast': { review: 'Needs a person: only the edge of a field and the icon of a button at a Tab stop are measured from a picture; other graphics and states are not (see the run notes)' },
  'focus-target': { review: 'Needs a person: a Tab stop under 44 px is in a line of text, a browser control or a control with a label, or not every Tab stop was measured (see the run notes)' },
};

// Runs in the page. `now`: the focused element's box, whether it takes
// text (its caret is hidden in a shot), and how many of five points
// (centre and corners) lie under a fixed or sticky element, and whether
// a small box is for a person (WCAG exceptions to 2.5.5 the tool cannot
// decide: a link in a line of text, the browser's own control, a label
// that is a part of the target), and `scroll`: the scroll positions of
// the window and of every ancestor. `was`: the scroll positions, now, of
// the earlier stops in `ids` (the numbers this gave them).
const STATE = `((ids) => {
  const KEY = '__readerPathFocus';
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const scroll = (e) => { const s = [scrollX, scrollY];
    for (let p = e.parentElement || (e.getRootNode().host ?? null); p; p = p.parentElement || (p.getRootNode().host ?? null)) s.push(p.scrollLeft, p.scrollTop);
    return s.join(','); };
  const out = { vw: innerWidth, vh: innerHeight };
  const els = (window[KEY] ||= []);
  out.was = ids.map((i) => (els[i] && els[i].isConnected ? scroll(els[i]) : null));
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
  const cs = getComputedStyle(e);
  let block = e.parentElement;
  while (block && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
  const inline = cs.display === 'inline' && !!block && block.textContent.trim().length > e.textContent.trim().length;
  const native = ((e.tagName === 'INPUT' && /^(checkbox|radio|range|color|file)$/.test(e.type)) || e.tagName === 'SELECT') && cs.appearance !== 'none';
  const person = inline || native || !!(e.labels && e.labels.length);
  const icon = (e.tagName === 'BUTTON' || e.getAttribute('role') === 'button') && !e.innerText.trim();
  const kind = (e.tagName === 'INPUT' && text && !e.isContentEditable) || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' ? 'input' : icon ? 'icon' : '';
  out.now = { ...b, text, kind, points, covered, by, person, scroll: scroll(e) };
  return out;
})`;

const CLEAR = `(() => { delete window.__readerPathFocus; })()`;

const meet = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// focus.after(): call after each Tab press. focus.at(node): call when the
// walk has a new stop, with its kept node. focus.finish(): the checks.
export function focusWatch(page, cdp, model, root, notes) {
  let state = null; // the page state after the last Tab press
  let pending = []; // stops with no second shot yet: { id, node, box, clip, shot, age }
  let stops = 0;
  let capped = false;
  const uncompared = [];
  const small = []; // stops under 44 px for a person
  const look = []; // stops whose indicator is inside the margin of error
  const edge = []; // fields and icon buttons inside the margin of error
  let edges = 0; // fields and icon buttons whose edge was measured
  const fails = { '2.4.7': 0, '2.4.11': 0, '2.4.12': 0, '2.5.5': 0, '2.4.13': 0, '1.4.11': 0 };
  const gap = (node, why, sc, goal, level) => {
    (node.gaps ||= []).push([why, sc, goal]);
    (model.levels ||= {})[sc] = level;
    fails[sc]++;
  };
  const nameOf = (node) => node.name || node.t || node.role || node.r || 'a control';
  // 2.4.13 from both shots, and 1.4.11 from the shot without focus.
  const pixels = async (last, focused, unfocused) => {
    const name = nameOf(last.node);
    const geom = { clip: last.clip, box: { x: last.box.x, y: last.box.y, w: last.box.w, h: last.box.h }, kind: last.box.kind };
    const px = await measurePixels(page, focused, unfocused, geom);
    if (!px) { look.push(name); if (last.box.kind) edge.push(name); return; }
    if (focused) {
      const verdict = judgeAppearance(px);
      const sq = px.scale * px.scale;
      if (verdict === 'fail') {
        gap(last.node, `With focus, the visible change is ${Math.round(px.strong / sq)} px² at ${NEED} : 1 or more; a 2 px perimeter of the control is ${Math.round(px.perimeter / sq)} px².`, '2.4.13', 'A focus indicator is at least a 2 px perimeter, at 3 : 1 against the unfocused look', 'AAA');
      } else if (verdict === 'review') look.push(name);
    } else look.push(name);
    if (last.box.kind) {
      const best = Math.max(px.edge ?? 0, px.glyph ?? 0) || null;
      const verdict = judgeBoundary(best);
      if (verdict === 'fail') {
        gap(last.node, `The ${last.box.kind === 'input' ? 'edge of this field' : 'icon of this button'} is ${best.toFixed(1)} : 1 against what is around it; at least ${NEED} : 1 is needed.`, '1.4.11', 'The edge of a field and the icon of a button are at least 3 : 1', 'AA');
        edges++;
      } else if (verdict === 'review') edge.push(name);
      else edges++;
    }
  };
  const shoot = (clip) => page.screenshot({ clip, animations: 'disabled', caret: 'hide' }).catch(() => null);

  return {
    // The second shot of a stop is taken once focus is off its
    // surroundings (the next stops can be right beside it) and only if
    // nothing scrolled: then the clip is the same area of the screen. A
    // box that changes with focus (a skip link) is compared as it is.
    async after() {
      if (capped && !pending.length) { state = null; return; }
      const { result } = await cdp.send('Runtime.evaluate', { expression: `${STATE}(${JSON.stringify(pending.map((p) => p.id))})`, returnByValue: true });
      state = result.value || { was: [] };
      const now = state.now && { x: state.now.x, y: state.now.y, width: state.now.w, height: state.now.h };
      const wait = [];
      for (const [i, last] of pending.entries()) {
        const was = state.was[i];
        if (!last.shot || was === null || was !== last.box.scroll) { uncompared.push(nameOf(last.node)); continue; }
        if (now && meet(now, last.clip)) {
          if (++last.age > MAX_WAIT) uncompared.push(nameOf(last.node)); else wait.push(last);
          continue;
        }
        const shot = await shoot(last.clip);
        if (!shot) { uncompared.push(nameOf(last.node)); continue; }
        // Equal shots of a text field: its caret is hidden, so a person looks.
        const caret = shot.equals(last.shot) && last.box.text;
        if (caret) uncompared.push(nameOf(last.node));
        else if (shot.equals(last.shot)) gap(last.node, 'This control looks the same with and without focus.', '2.4.7', 'A control with focus shows a focus indicator', 'AA');
        await pixels(last, caret ? null : last.shot, shot);
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
      const [w, h] = [Math.round(now.w), Math.round(now.h)];
      if (!w || !h) small.push(nameOf(node));
      else if (w < TARGET || h < TARGET) {
        if (now.person) small.push(nameOf(node));
        else gap(node, `This control is ${w} × ${h} px; a target is at least ${TARGET} × ${TARGET} px.`, '2.5.5', 'A target is at least 44 by 44 px', 'AAA');
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
      if (small.length) notes.push(`Target size for a person at ${small.length} Tab stop(s): ${small.slice(0, 10).join(', ')}${small.length > 10 ? ', ...' : ''}`);
      const shown = (list) => `${list.length} Tab stop(s): ${list.slice(0, 10).join(', ')}${list.length > 10 ? ', ...' : ''}`;
      if (look.length) notes.push(`Focus appearance for a person at ${shown(look)}`);
      if (edge.length) notes.push(`Non-text contrast for a person at ${shown(edge)}`);
      if (!stops) return;
      const partial = capped || walk !== 'pass';
      addCheck(model.checks, '2.4.7', fails['2.4.7'] ? 'fail' : partial || uncompared.length ? 'review' : 'pass', 'focus-visible');
      for (const sc of ['2.4.11', '2.4.12']) addCheck(model.checks, sc, fails[sc] ? 'fail' : partial ? 'review' : 'pass', 'focus-obscured');
      addCheck(model.checks, '2.4.13', fails['2.4.13'] ? 'fail' : partial || uncompared.length || look.length ? 'review' : 'pass', 'focus-appearance');
      // NOTE: never a pass: graphics other than the edge of a field and the icon of a button are not measured.
      if (fails['1.4.11'] || edges || edge.length) addCheck(model.checks, '1.4.11', fails['1.4.11'] ? 'fail' : 'review', 'focus-contrast');
      addCheck(model.checks, '2.5.5', fails['2.5.5'] ? 'fail' : partial || small.length ? 'review' : 'pass', 'focus-target');
    },
  };
}
