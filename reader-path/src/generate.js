import './hold-children.js';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { RUN_ONLY, axeToGaps, axeContrast, axeToChecks, addCheck } from './axe.js';

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const DROPPED = new Set(['generic', 'none', 'StaticText', 'InlineTextBox', 'LineBreak']);
const LANDMARKS = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'region', 'search', 'form']);

const CUSTOM = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

export function walk(node, fn, parent = null) {
  fn(node, parent);
  for (const child of node.c || []) walk(child, fn, node);
}

const prop = (ax, name) => (ax.properties || []).find((p) => p.name === name)?.value?.value;

function stateOf(ax) {
  const s = [];
  const expanded = prop(ax, 'expanded');
  if (expanded === true) s.push('expanded');
  if (expanded === false) s.push('collapsed');
  const checked = prop(ax, 'checked');
  if (checked === 'true' || checked === 'mixed') s.push('checked');
  const pressed = prop(ax, 'pressed');
  if (pressed === 'true' || pressed === 'mixed') s.push('pressed');
  if (prop(ax, 'disabled') === true) s.push('disabled');
  if (prop(ax, 'required') === true) s.push('required');
  const invalid = prop(ax, 'invalid');
  if (invalid && invalid !== 'false') s.push('invalid');
  return s.join(', ');
}

function boxOf(ax, role) {
  const live = prop(ax, 'live');
  if (live === 'polite' || live === 'assertive') return { live };
  if (live) return undefined;
  if (role === 'alert') return { live: 'assertive' };
  if (role === 'status' || role === 'log') return { live: 'polite' };
  return undefined;
}

// The document an iframe shows, from its flat [name, value, ...] attribute
// list: about:srcdoc for srcdoc (it wins over src), else src without its
// query and fragment.
function frameSrc(attributes = []) {
  const attr = (name) => {
    for (let i = 0; i < attributes.length; i += 2) if (attributes[i] === name) return attributes[i + 1];
    return undefined;
  };
  if (attr('srcdoc') !== undefined) return 'about:srcdoc';
  const src = attr('src');
  return src ? src.split(/[?#]/)[0] : 'about:blank';
}

function indexDom(domRoot) {
  const dom = new Map(); // backendNodeId -> { name, parent }
  const notes = [];
  const visit = (n, parent) => {
    dom.set(n.backendNodeId, { name: n.nodeName.toLowerCase(), parent });
    if (n.nodeName === 'IFRAME') notes.push(`iframe not read: ${frameSrc(n.attributes)}`);
    for (const c of [...(n.shadowRoots || []), ...(n.children || [])]) visit(c, n.backendNodeId);
  };
  visit(domRoot, null);
  return { dom, notes };
}

// Returns { root, nearestKept }; nearestKept(backendId) is the kept model node
// for that DOM node or its nearest ancestor.
export function buildTree(nodes, dom) {
  const customOf = (id) => {
    for (let x = id; x != null; x = dom.get(x)?.parent) {
      const name = dom.get(x)?.name;
      if (name && CUSTOM.test(name)) return name;
    }
    return undefined;
  };
  const ax = new Map(nodes.map((n) => [n.nodeId, n]));

  // backendDOMNodeId -> nearest kept model node
  const kept = new Map();
  const nearestKept = (backendId) => {
    for (let x = backendId; x != null; x = dom.get(x)?.parent) {
      if (kept.has(x)) return kept.get(x);
    }
    return undefined;
  };

  const roleOf = (n) => n.role?.value;
  const isKept = (n, isRoot) => {
    if (isRoot) return true;
    if (n.ignored) return false;
    const role = roleOf(n);
    return !DROPPED.has(role) || LANDMARKS.has(role) || prop(n, 'focusable') === true
      || CUSTOM.test(dom.get(n.backendDOMNodeId)?.name || '');
  };

  const build = (n, keptParent, isRoot) => {
    const role = roleOf(n);
    let here = keptParent;
    if (isKept(n, isRoot)) {
      const name = n.name?.value || '';
      const id = n.backendDOMNodeId != null ? `n${n.backendDOMNodeId}` : `a${n.nodeId}`;
      const node = { id, role, name };
      node.t = name || role;
      node.comp = customOf(n.backendDOMNodeId) || role;
      if (n.description?.value) node.desc = n.description.value;
      const state = stateOf(n);
      if (state) node.state = state;
      if (role === 'heading') node.h = prop(n, 'level');
      if (LANDMARKS.has(role)) node.lm = role;
      const box = boxOf(n, role);
      if (box) node.box = box;
      node.c = [];
      if (keptParent) keptParent.c.push(node);
      here = node;
    } else if (role === 'StaticText' && !n.ignored && keptParent && n.name?.value) {
      keptParent.text = keptParent.text ? `${keptParent.text} ${n.name.value}` : n.name.value;
    }
    if (n.backendDOMNodeId != null && here) kept.set(n.backendDOMNodeId, here);
    for (const id of n.childIds || []) {
      const child = ax.get(id);
      if (child) build(child, here, false);
    }
    return here;
  };
  const root = build(nodes[0], null, true);
  return { root, nearestKept };
}

// Adds axe-core to each frame. A frame that refuses it (for example one that
// is removed while the page loads) is a note; the run goes on.
export async function addAxe(frames, notes) {
  for (const frame of frames) {
    try {
      await frame.addScriptTag({ path: AXE_PATH });
    } catch {
      notes.push(`axe not added to frame: ${bare(frame.url())}`);
    }
  }
}

// Runs axe-core and puts gaps (node.gaps) and contrast (node.contrast) on the
// nearest kept node. A target that cannot be placed is a gap on the root.
// When axe-core does not run, a note says why and the model has no gaps.
async function axePass(page, cdp, nearestKept, root, model, notes) {
  await addAxe(page.frames(), notes);
  let results;
  try {
    results = await page.evaluate((runOnly) => axe.run(document, { runOnly }), RUN_ONLY);
  } catch (e) {
    // Playwright starts the message with the call's name: "page.evaluate"
    // under Node.js, "evaluate" under Bun. The note is the same for both.
    const why = String(e.message).split(/\r?\n/)[0].replace(/^(?:page\.)?evaluate: (?:\w*Error: )?/, '');
    notes.push(`axe-core did not run: ${why}`);
    return;
  }

  for (const [sc, lists] of Object.entries(axeToChecks(results))) {
    for (const [list, ids] of Object.entries(lists)) ids.forEach((id) => addCheck(model.checks, sc, list, id));
  }

  const place = async (target) => {
    if (target.length !== 1) return undefined;
    try {
      const path = [].concat(target[0]);
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: `(() => { const p = ${JSON.stringify(path)};
          let e = document.querySelector(p[0]);
          for (const s of p.slice(1)) e = e && e.shadowRoot && e.shadowRoot.querySelector(s);
          return e; })()`,
        objectGroup: 'axe',
      });
      if (!result.objectId) return undefined;
      const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
      return nearestKept(node.backendNodeId);
    } catch {
      return undefined;
    }
  };

  for (const g of axeToGaps(results)) {
    let node = await place(g.target);
    let why = g.why;
    if (!node) {
      node = root;
      why = `not placed: ${g.target.map((t) => [].concat(t).join(' ')).join(' > ')} - ${g.why}`;
    }
    (node.gaps ||= []).push(g.row ? [why, g.sc, g.goal, g.row] : [why, g.sc, g.goal]);
    (model.levels ||= {})[g.sc] = g.level;
  }
  for (const c of axeContrast(results)) {
    const node = await place(c.target);
    if (!node) continue;
    const { target, ...value } = c;
    const old = node.contrast;
    if (!old || (old.ratio === null && value.ratio !== null) || (value.ratio !== null && value.ratio < old.ratio)) {
      node.contrast = value;
    }
  }
}

const MAX_TABS = 500;
const ACTIVE = `(() => { let e = document.activeElement;
  while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement;
  return e; })()`;

// Moves the start of sequential focus to the top of the document, so the
// walk does not start where the page put focus (autofocus, a script). The
// start is a temporary element with tabindex 1 at the top of the body: from
// there, Tab goes to the first stop of the page order, positive tabindex
// first. A tabindex -1 start would skip the positive tabindex stops. The
// element is removed after the first Tab press.
const START = 'data-reader-path-start';
const TOP = `(() => { const e = document.createElement('span'); e.tabIndex = 1;
  e.setAttribute('${START}', ''); document.body.prepend(e); e.focus(); })()`;
const UNTOP = `(() => { const e = document.querySelector('[${START}]');
  const still = !!e && document.activeElement === e; if (e) e.remove(); return still; })()`;

// Presses Tab and gives `tab` (1-based) to the nearest kept node of each stop.
// Returns the result for 2.1.2: fail for a stop gap; review when the walk
// did not read every stop (an iframe, or MAX_TABS reached); else pass.
async function tabWalk(page, cdp, nearestKept, root, notes, model) {
  await cdp.send('Runtime.evaluate', { expression: TOP });
  const stop = (why, note) => {
    (root.gaps ||= []).push([why, '2.1.2', 'Tab moves focus to the next control']);
    (model.levels ||= {})['2.1.2'] = 'A';
    notes.push(note);
    return 'fail';
  };
  let unread = false;
  const end = () => (unread ? 'review' : 'pass');
  const seen = new Set();
  let first = null;
  let prev = null;
  let n = 0;
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab');
    if (i === 0) {
      const { result: still } = await cdp.send('Runtime.evaluate', { expression: UNTOP, returnByValue: true });
      if (still.value) return stop('Tab does not move focus out of this control.', 'Tab walk stopped: focus did not move');
    }
    const { result } = await cdp.send('Runtime.evaluate', { expression: ACTIVE, objectGroup: 'tab' });
    if (!result.objectId) return end();
    const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
    if (node.nodeName === 'BODY') return end();
    const id = node.backendNodeId;
    if (node.nodeName === 'IFRAME') {
      if (id === prev) continue; // focus is moving inside the frame, which is not read
      notes.push(`Tab stops inside iframe not read: ${frameSrc(node.attributes)}`);
      unread = true;
    }
    if (id === prev) {
      return stop('Tab does not move focus out of this control.', 'Tab walk stopped: focus did not move');
    }
    if (id === first) return end();
    if (seen.has(id)) {
      return stop('Tab moves focus round a loop and never back to the start.',
        'Tab walk stopped: focus loops without returning to the start');
    }
    seen.add(id);
    first ??= id;
    prev = id;
    const kept = nearestKept(id);
    if (kept && !kept.tab) kept.tab = ++n;
  }
  // No repeat in MAX_TABS presses: a long page, not a trap, but the rest
  // of the page is not checked.
  notes.push(`Tab walk stopped at ${MAX_TABS} Tab stops; the rest not recorded`);
  return 'review';
}

// A url without its query, fragment, user name and password: these can
// hold sign-in tokens.
export function bare(u) {
  try {
    const x = new URL(u);
    x.search = '';
    x.hash = '';
    x.username = '';
    x.password = '';
    return x.href;
  } catch {
    return String(u).split(/[?#]/)[0];
  }
}

// The url for a command line argument: a url as it is, else a file path
// as a file: url. A scheme has two characters or more, so a Windows path
// such as C:\page.html is a path.
export function pageUrl(arg) {
  return /^[a-z][a-z0-9+.-]+:/i.test(arg) ? arg : pathToFileURL(arg).href;
}

// How long a page has had no request in flight. Call before goto(); the
// function it returns gives the idle time in ms (0 while a request is open).
// A stream (EventSource, WebSocket) stays open for good and is not counted.
export function watchRequests(page) {
  const open = new Set();
  let last = Date.now();
  page.on('request', (r) => {
    if (['eventsource', 'websocket'].includes(r.resourceType())) return;
    open.add(r);
    last = Date.now();
  });
  const done = (r) => { if (open.delete(r)) last = Date.now(); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  // A request that a navigation cut off ends with no event: forget the
  // requests of the page that is gone.
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) open.clear(); });
  return () => (open.size ? 0 : Date.now() - last);
}

const IDLE = 500;
const IDLE_MAX = 30000;

// After the load event: the selector (waitFor), then no request in flight
// for `idle` ms (0 turns this off; it gives up after idleMax with a note),
// then the fixed wait (settle).
export async function ready(page, idleTime, opts = {}, notes = []) {
  if (opts.waitFor) await page.waitForSelector(opts.waitFor);
  const idle = opts.idle ?? IDLE;
  const max = opts.idleMax ?? IDLE_MAX;
  const from = Date.now();
  while (idle && idleTime() < idle) {
    if (Date.now() - from >= max) {
      notes.push(`Page still loading after ${Math.round(max / 1000)} s: a request is still in flight`);
      break;
    }
    await page.waitForTimeout(50);
  }
  if (opts.settle) await page.waitForTimeout(opts.settle);
}

// opts: storageState, ignoreHTTPSErrors, waitFor (a selector), idle (ms
// with no request in flight; default 500), settle (ms to wait after that).
export async function generate(url, opts = {}) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      bypassCSP: true,
      ...(opts.ignoreHTTPSErrors ? { ignoreHTTPSErrors: true } : {}),
      ...(opts.storageState ? { storageState: opts.storageState } : {}),
    });
    const page = await context.newPage();
    const idleTime = watchRequests(page);
    const response = await page.goto(url, { waitUntil: 'load' });
    const notes = [];
    await ready(page, idleTime, opts, notes);
    // Without query and fragment: a redirect can carry a sign-in token.
    const finalUrl = bare(page.url());
    if (finalUrl !== bare(url)) notes.push(`Page moved to ${finalUrl}`);
    const cdp = await context.newCDPSession(page);

    const { root: domRoot } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { dom, notes: domNotes } = indexDom(domRoot);
    notes.push(...domNotes);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const { root, nearestKept } = buildTree(nodes, dom);
    walk(root, (n) => {
      if (n.lm === 'main' && !(n.c || []).length && !n.text) notes.push('Page content empty: main has no content after settle');
    });
    const model = { checks: {} };
    await axePass(page, cdp, nearestKept, root, model, notes);
    addCheck(model.checks, '2.1.2', await tabWalk(page, cdp, nearestKept, root, notes, model), 'tab-walk');

    const title = await page.title();
    const version = browser.version();
    return {
      ...model,
      url,
      finalUrl,
      ...(response ? { status: response.status() } : {}),
      title,
      generated: new Date().toISOString(),
      browser: `chromium ${version}`,
      notes,
      root,
    };
  } finally {
    await browser.close();
  }
}
