// 1.4.1 Use of Color, by style (no pixels): small elements among siblings
// of one tag and class that differ only in colour and carry no text and no
// name (status dots). One script in the page reads the computed styles;
// each group is placed on the nearest kept tree node of its first element.
import { addProposal } from './proposals.js';

const SMALL = 24;

// Runs in the page. Returns [{ el, tag, cls, colours: [rgb string] }] for
// every group of 2 or more nameless small siblings with 2 or more colours.
function readGroups(small) {
  const SKIP = /^(input|select|textarea|button|a|img|video|audio|canvas|iframe|script|style)$/;
  const blank = (s) => !(s || '').trim();
  const clear = (c) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  const named = (e) => e.matches('[aria-label],[aria-labelledby],[title],[alt]')
    || !!e.querySelector('[aria-label],[aria-labelledby],[title],[alt],title');
  const colourOf = (e, cs) => {
    if (!clear(cs.backgroundColor)) return cs.backgroundColor;
    if (parseFloat(cs.borderTopWidth) > 0 && !clear(cs.borderTopColor)) return cs.borderTopColor;
    if (e instanceof SVGElement && cs.fill !== 'none') return cs.fill;
    return cs.color;
  };
  // A text node or element with text next to the element names it.
  const labelled = (e) => [e.previousSibling, e.nextSibling].some((s) => s && (s.nodeType === 3 || s.nodeType === 1) && !blank(s.textContent));
  const groups = [];
  const seen = new Set();
  for (const e of document.body.querySelectorAll('*')) {
    const parent = e.parentElement;
    if (!parent || seen.has(parent)) continue;
    seen.add(parent);
    const by = new Map();
    for (const k of parent.children) {
      if (SKIP.test(k.tagName.toLowerCase())) continue;
      const cs = getComputedStyle(k);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = k.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.width > small || r.height > small) continue;
      if (!blank(k.textContent) || named(k) || labelled(k)) continue;
      // Same tag and the same look but for colour: size, shape, border width.
      const key = [k.tagName, Math.round(r.width), Math.round(r.height), cs.display, cs.borderTopLeftRadius, cs.borderTopWidth].join('|');
      (by.get(key) || by.set(key, []).get(key)).push({ el: k, colour: colourOf(k, cs) });
    }
    for (const all of by.values()) {
      // Same class, or a shared one beside a modifier (dot, dot--ok).
      const first = [...all[0].el.classList];
      const list = all.filter((x) => (first.length ? first.some((c) => x.el.classList.contains(c)) : x.el.classList.length === 0));
      const colours = [...new Set(list.map((x) => x.colour))];
      if (list.length < 2 || colours.length < 2) continue;
      const k = list[0].el;
      groups.push({ el: k, count: list.length, tag: k.tagName.toLowerCase(), cls: [...k.classList].filter((c) => list.every((x) => x.el.classList.contains(c))), colours });
    }
  }
  return groups;
}

const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

// A basic colour name for an rgb() string.
export function colourName(c) {
  const [r, g, b] = parse(c);
  if ([r, g, b].some((v) => v == null || Number.isNaN(v))) return c;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 510;
  if (d < 20) return l < 0.15 ? 'black' : l > 0.88 ? 'white' : 'grey';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return l > 0.7 ? 'pink' : 'red';
  if (h < 40) return 'orange';
  if (h < 65) return 'amber';
  if (h < 75) return 'yellow';
  if (h < 165) return 'green';
  if (h < 200) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

const hex = (c) => '#' + parse(c).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export async function textColour(page, cdp, nearestKept, root, model, notes) {
  try {
    const info = await page.evaluate(`(() => (${readGroups.toString()})(${SMALL}).map(({ el, ...rest }) => rest))()`);
    if (!info.length) return;
    // The same call again, giving the elements themselves for placing.
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(${readGroups.toString()})(${SMALL}).map((g) => g.el)`,
      objectGroup: 'text-colour',
    });
    const { result: props } = await cdp.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
    const els = props.filter((p) => /^\d+$/.test(p.name)).sort((a, b) => a.name - b.name);
    for (let i = 0; i < info.length; i++) {
      const g = info[i];
      let node;
      if (els[i]?.value?.objectId) {
        const { node: d } = await cdp.send('DOM.describeNode', { objectId: els[i].value.objectId });
        node = nearestKept(d.backendNodeId);
      }
      const names = [...new Set(g.colours.map(colourName))];
      const kind = g.tag + g.cls.map((c) => '.' + c).join('');
      const list = g.colours.map((c) => `${colourName(c)} ${hex(c)}`).join(', ');
      addProposal(model, node ?? root, {
        sc: '1.4.1',
        rule: 'text-colour-only',
        text: [...g.colours.map(colourName)].sort().join(', '),
        say: `${g.count} small elements (${kind}) among siblings differ only in colour (${list}) and have no text or name: colour alone carries their meaning${names.length < g.colours.length ? ' (some colours are close in name)' : ''}`,
        propose: 'Give each a visible word or an accessible name (aria-label or hidden text) that says what the colour means',
      });
    }
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'text-colour' });
  } catch (e) {
    notes.push(`1.4.1 colour-only check not run: ${String(e.message).split('\n')[0]}`);
  }
}
