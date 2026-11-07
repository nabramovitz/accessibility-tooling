import { chromium } from 'playwright';

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

function indexDom(domRoot) {
  const dom = new Map(); // backendNodeId -> { name, parent }
  const notes = [];
  const visit = (n, parent) => {
    dom.set(n.backendNodeId, { name: n.nodeName.toLowerCase(), parent });
    if (n.nodeName === 'IFRAME') {
      const a = n.attributes || [];
      const i = a.indexOf('src');
      notes.push(`iframe not read: ${i >= 0 ? a[i + 1] : ''}`);
    }
    for (const c of [...(n.shadowRoots || []), ...(n.children || [])]) visit(c, n.backendNodeId);
  };
  visit(domRoot, null);
  return { dom, notes };
}

// Returns { root, nearestKept }; nearestKept(backendId) is the kept model node
// for that DOM node or its nearest ancestor.
function buildTree(nodes, dom) {
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
    return !DROPPED.has(role) || LANDMARKS.has(role) || CUSTOM.test(dom.get(n.backendDOMNodeId)?.name || '');
  };

  const build = (n, keptParent, isRoot) => {
    const role = roleOf(n);
    let here = keptParent;
    if (isKept(n, isRoot)) {
      const name = n.name?.value || '';
      const node = { id: `n${n.backendDOMNodeId}`, role, name };
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
    for (const id of n.childIds || []) build(ax.get(id), here, false);
    return here;
  };
  const root = build(nodes[0], null, true);
  return { root, nearestKept };
}

export async function generate(url, opts = {}) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      bypassCSP: true,
      ...(opts.storageState ? { storageState: opts.storageState } : {}),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    const cdp = await context.newCDPSession(page);

    const { root: domRoot } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { dom, notes } = indexDom(domRoot);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const { root } = buildTree(nodes, dom);

    const title = await page.title();
    const version = browser.version();
    return {
      url,
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
