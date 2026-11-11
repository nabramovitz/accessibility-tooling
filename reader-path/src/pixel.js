// Pixel measures on the Tab-walk shots of a stop. The PNG is decoded by a
// canvas in the page, so there is no image library.
// - 2.4.13 Focus Appearance: the area of the pixels that differ by 3 : 1
//   between the shot with focus and the shot without, against the area
//   of a 2 px perimeter of the box.
// - 1.4.11 Non-text Contrast: the edge of a field, or the glyph of an
//   icon button, against the background, 3 : 1.
// Both are measures of a picture, so each has a margin of error: a gap
// only when clearly under, else a person looks.

export const NEED = 3;
// Margin on the contrast: anti-aliasing, a box on a fractional pixel and
// colour management lighten an edge, so 2.5 : 1 is not clearly under.
export const MARGIN = 2.5;
// Margin on the area: the perimeter is of a box that can sit on a
// fractional pixel, and a ring is blurred at its ends, so 3/4 of the
// area is not clearly under.
export const AREA_MARGIN = 0.75;

export function chan(v) { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export function lum(c) { return 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]); }
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// strong: pixels at NEED or more; lenient: pixels at MARGIN or more.
export function judgeAppearance({ strong, lenient, perimeter }) {
  if (strong >= perimeter) return 'pass';
  if (lenient < perimeter * AREA_MARGIN) return 'fail';
  return 'review';
}

export function judgeBoundary(ratio) {
  if (ratio == null) return 'review';
  if (ratio >= NEED) return 'pass';
  return ratio < MARGIN ? 'fail' : 'review';
}

// Runs in the page. `f`, `u`: base64 PNG of the shot with focus and
// without (`f` may be null); `g`: { clip, box, kind } in CSS px.
// Returns the pixels of the area measure, and the best ratio of the edge
// (a field or an icon button) and, for an icon button, of the glyph
// against the box's own fill. A ratio is null when no side could be read
// (a box at the edge of the shot, a background that is not one colour).
const PIXELS = `(async (f, u, g) => {
  ${chan}
  ${lum}
  ${contrast}
  const L = new Float64Array(256).map((_, i) => chan(i));
  const ratio = (a, b, c, d, e, h) => { const x = 0.2126 * L[a] + 0.7152 * L[b] + 0.0722 * L[c]; const y = 0.2126 * L[d] + 0.7152 * L[e] + 0.0722 * L[h]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const load = async (b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return cx.getImageData(0, 0, bmp.width, bmp.height);
  };
  const U = await load(u);
  const F = f ? await load(f) : null;
  const s = U.width / g.clip.width;
  const out = { strong: 0, lenient: 0, perimeter: 0, edge: null, glyph: null, scale: s };
  const w = g.box.w; const h = g.box.h;
  out.perimeter = (w * h - Math.max(0, w - 4) * Math.max(0, h - 4)) * s * s;
  if (F && F.width === U.width && F.height === U.height) {
    const a = F.data; const b = U.data;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
      const r = ratio(a[i], a[i + 1], a[i + 2], b[i], b[i + 1], b[i + 2]);
      if (r >= ${NEED}) out.strong++;
      if (r >= ${MARGIN}) out.lenient++;
    }
  }
  const px = (x, y) => { const i = (y * U.width + x) * 4; return [U.data[i], U.data[i + 1], U.data[i + 2]]; };
  const med = (v) => v.sort((p, q) => p - q)[v.length >> 1];
  const lineColour = (pts) => [0, 1, 2].map((k) => med(pts.map((p) => p[k])));
  const spread = (pts) => Math.max(...[0, 1, 2].map((k) => { const v = pts.map((p) => p[k]).sort((p, q) => p - q); return v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)]; }));
  const bx = (g.box.x - g.clip.x) * s; const by = (g.box.y - g.clip.y) * s;
  const bw = w * s; const bh = h * s;
  // A side: a line of pixels along it at each offset from -3 CSS px
  // (outside) to +3 (inside); the background is 6 to 7 CSS px outside.
  const at = (side, t, d) => {
    const x = side === 'l' ? bx + d : side === 'r' ? bx + bw - d : t;
    const y = side === 't' ? by + d : side === 'b' ? by + bh - d : t;
    return [Math.round(x), Math.round(y)];
  };
  const ok = (x, y) => x >= 0 && y >= 0 && x < U.width && y < U.height;
  const line = (side, d) => {
    const horiz = side === 't' || side === 'b';
    const from = (horiz ? bx : by) + 4 * s; const to = (horiz ? bx + bw : by + bh) - 4 * s;
    const pts = [];
    for (let t = from; t < to; t += Math.max(1, (to - from) / 200)) { const [x, y] = at(side, t, d); if (!ok(x, y)) return null; pts.push(px(x, y)); }
    return pts.length ? pts : null;
  };
  for (const side of ['l', 't', 'r', 'b']) {
    const bgs = [-6 * s, -7 * s].map((d) => line(side, d));
    if (bgs.some((p) => !p)) continue;
    const all = bgs.flat();
    if (spread(all) > 24) continue;
    const bg = lineColour(all);
    for (let d = -3 * s; d <= 3 * s; d += 1) {
      const pts = line(side, d);
      if (!pts) continue;
      const r = contrast(lineColour(pts), bg);
      if (out.edge === null || r > out.edge) out.edge = r;
    }
  }
  if (g.kind === 'icon') {
    const x0 = Math.round(bx + 3 * s); const x1 = Math.round(bx + bw - 3 * s);
    const y0 = Math.round(by + 3 * s); const y1 = Math.round(by + bh - 3 * s);
    const step = Math.max(1, Math.floor(Math.sqrt(Math.max(1, (x1 - x0) * (y1 - y0)) / 20000)));
    const seen = [];
    for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) if (ok(x, y)) seen.push(px(x, y));
    if (seen.length) {
      const fill = lineColour(seen.slice());
      out.glyph = Math.max(...seen.map((c) => contrast(c, fill)));
    }
  }
  return out;
})`;

// The numbers for one stop, or null when the shots could not be read.
export async function measurePixels(page, focused, unfocused, geom) {
  try {
    return await page.evaluate(
      `${PIXELS}(${JSON.stringify(focused ? focused.toString('base64') : null)}, ${JSON.stringify(unfocused.toString('base64'))}, ${JSON.stringify(geom)})`,
    );
  } catch { return null; }
}
