// Lists for a person, measured in the default layout (before the views
// change it): text blocks that may fail 1.4.8 (line length over 80
// characters, line height under 1.5, justified text) and images that may
// be text (1.4.5, 1.4.9). Never a pass and never a fail: each row gets a
// review with the counts and the first names as a run note. Elements
// inside shadow roots are not measured.
import { addCheck } from './axe.js';

const MAX_NAMED = 10;
const WIDE = 3;

// The person's lines for the report.
export const LIST_LINES = {
  'list-text': { review: 'Needs a person: look at the text blocks named in the run notes (line over 80 characters, line height under 1.5, justified); the tool does not decide' },
  'list-images': { review: 'Needs a person: look at the images named in the run notes (wide raster images and background images with no text); is there text in them?' },
};

// Runs in the page. Returns the names of the text blocks and images found.
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
      if (raster && box.height >= 10 && box.width > ${WIDE} * box.height) out.images.push(name(e));
    } else if (!text && /url\\(/.test(cs.backgroundImage) && box.width > 0 && box.height > 0) {
      out.backgrounds.push(name(e));
    }
    if (!text || cs.display.startsWith('inline')) continue;
    const size = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? 1.2 * size : parseFloat(cs.lineHeight);
    const wraps = box.height >= 1.9 * lh;
    ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + size + 'px ' + cs.fontFamily;
    const letters = 'abcdefghijklmnopqrstuvwxyz ';
    const avg = ctx.measureText(letters).width / letters.length;
    const content = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (text.length > 80 && avg > 0 && content / avg > 80) out.long.push(name(e));
    if (wraps && lh < 1.5 * size) out.tight.push(name(e));
    if (wraps && cs.textAlign === 'justify') out.justified.push(name(e));
  }
  return out;
})()`;

const said = (names) => {
  const unique = [...new Set(names)];
  return unique.length ? ` (${unique.slice(0, MAX_NAMED).join(', ')}${unique.length > MAX_NAMED ? ', ...' : ''})` : '';
};

export async function lists(cdp, model, notes) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  const f = result.value || { long: [], tight: [], justified: [], images: [], backgrounds: [] };
  notes.push(`Text blocks (1.4.8): ${f.long.length} with lines over 80 characters${said(f.long)}, ${f.tight.length} with line height under 1.5${said(f.tight)}, ${f.justified.length} justified${said(f.justified)}`);
  notes.push(`Images that may be text (1.4.5, 1.4.9): ${f.images.length} raster images wider than 3 times their height${said(f.images)}, ${f.backgrounds.length} background images on elements with no text${said(f.backgrounds)}; elements in shadow roots are not measured`);
  addCheck(model.checks, '1.4.8', 'review', 'list-text');
  addCheck(model.checks, '1.4.5', 'review', 'list-images');
  addCheck(model.checks, '1.4.9', 'review', 'list-images');
}
