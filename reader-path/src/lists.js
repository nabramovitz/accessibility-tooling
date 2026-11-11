// Lists for a person, measured in the default layout (before the views
// change it): text blocks that may fail 1.4.8 (line length over 80
// characters, line height under 1.5, justified text) and images that may
// be text (1.4.5, 1.4.9). Never a pass and never a fail: each row gets a
// review. Each measure is one run note: the count, then the elements
// grouped by name, the largest group first, each with its measured
// value. Elements inside shadow roots are not measured.
import { addCheck } from './axe.js';

const MAX_GROUPS = 10;
const WIDE = 3;

// The person's lines for the report.
export const LIST_LINES = {
  'list-text': { review: 'Needs a person: look at the text blocks named in the run notes (line over 80 characters, line height under 1.5, justified); the tool does not decide' },
  'list-images': { review: 'Needs a person: look at the images named in the run notes (wide raster images and background images with no text); is there text in them?' },
};

// Runs in the page. Returns, for each measure, the elements found as
// [name, value].
// A text block is a visible element that is not inline and has a text node
// of its own. Characters per line are estimated: the width of the content
// box over the average width of a letter in the element's font, taken from
// a canvas; a block counts for line length only if its own text is longer
// than 80 characters, as a shorter text has no longer line. The line
// height 'normal' is taken as 1.2 times the font size. Line height and
// justify count only for text that wraps (a box of two lines or more).
const MEASURE = `(() => {
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList[0] ? '.' + e.classList[0] : '');
  const shown = (e, cs) => cs.display !== 'none' && cs.visibility !== 'hidden' && e.getClientRects().length > 0;
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim();
  const ctx = document.createElement('canvas').getContext('2d');
  const out = { long: [], tight: [], justified: [], images: [], backgrounds: [] };
  for (const e of document.body.querySelectorAll('*')) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|TEXTAREA)$/.test(e.tagName)) continue;
    const cs = getComputedStyle(e);
    if (!shown(e, cs)) continue;
    const text = own(e);
    const box = e.getBoundingClientRect();
    if (e.tagName === 'IMG') {
      const src = e.currentSrc || e.src || '';
      const raster = src && !/^data:image\\/svg|\\.svg([?#]|$)/i.test(src);
      if (raster && box.height >= 10 && box.width > ${WIDE} * box.height) out.images.push([name(e), Math.round(box.width) + ' × ' + Math.round(box.height) + ' px']);
    } else if (!text && /url\\(/.test(cs.backgroundImage) && box.width > 0 && box.height > 0) {
      out.backgrounds.push([name(e)]);
    }
    if (!text || cs.display.startsWith('inline')) continue;
    const size = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? 1.2 * size : parseFloat(cs.lineHeight);
    const wraps = box.height >= 1.9 * lh;
    ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + size + 'px ' + cs.fontFamily;
    const letters = 'abcdefghijklmnopqrstuvwxyz ';
    const avg = ctx.measureText(letters).width / letters.length;
    const content = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (text.length > 80 && avg > 0 && content / avg > 80) out.long.push([name(e), Math.round(content / avg)]);
    if (wraps && lh < 1.5 * size) out.tight.push([name(e), Math.round((lh / size) * 100) / 100]);
    if (wraps && cs.textAlign === 'justify') out.justified.push([name(e)]);
  }
  return out;
})()`;

const range = (v) => (Math.min(...v) === Math.max(...v) ? `${v[0]}` : `${Math.min(...v)} to ${Math.max(...v)}`);
// [kind, the start of the note, the unit, the words for a group's values]
const MEASURES = [
  ['long', '1.4.8 lines over 80 characters', 'text block', (v) => `about ${Math.max(...v)} characters a line`],
  ['tight', '1.4.8 line height under 1.5', 'text block', (v) => `line height ${range(v)}`],
  ['justified', '1.4.8 justified text', 'text block'],
  ['images', '1.4.5, 1.4.9 raster images more than 3 times as wide as high', 'image', (v) => v[0]],
  ['backgrounds', '1.4.5, 1.4.9 background images on elements with no text', 'element'],
];

// One note: "<measure>: none", or "<measure>: <n> <units>: <name> ×<count>
// (<value>), ..." with the largest groups first, then the page order.
function line([kind, start, unit, words], found) {
  if (!found.length) return `${start}: none`;
  const groups = new Map();
  for (const [name, value] of found) (groups.get(name) ?? groups.set(name, []).get(name)).push(value);
  const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
  const parts = sorted.slice(0, MAX_GROUPS).map(([name, v]) => `${name}${v.length > 1 ? ` ×${v.length}` : ''}${words ? ` (${words(v)})` : ''}`);
  if (sorted.length > MAX_GROUPS) parts.push(`and ${sorted.length - MAX_GROUPS} more`);
  return `${start}: ${found.length} ${unit}${found.length > 1 ? 's' : ''}: ${parts.join(', ')}`;
}

export async function lists(cdp, model, notes) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  const f = result.value || { long: [], tight: [], justified: [], images: [], backgrounds: [] };
  for (const m of MEASURES) notes.push(line(m, f[m[0]]));
  addCheck(model.checks, '1.4.8', 'review', 'list-text');
  addCheck(model.checks, '1.4.5', 'review', 'list-images');
  addCheck(model.checks, '1.4.9', 'review', 'list-images');
}
