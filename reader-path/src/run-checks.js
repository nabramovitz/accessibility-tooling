// Checks over a whole run: rows that one page cannot decide. Each rule
// writes its result into every model's checks table (so the ACR writer's
// per-page logic holds) and, for a fail, one gap on the first model's
// root. With fewer than two models there is nothing to compare.
import { walk, bare } from './generate.js';
import { addCheck } from './axe.js';
import { proposeLink, linkName, target } from './text-links.js';

const MEDIA_ROWS = ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7', '1.2.8', '1.2.9', '1.4.7'];
const CONTROLS = new Set(['button', 'menuitem', 'switch', 'checkbox', 'radio', 'combobox', 'textbox', 'searchbox', 'tab', 'slider', 'spinbutton']);
const HELP = /\b(help|docs|documentation|support)\b/i;

const label = (m) => bare(m.finalUrl || m.url);
const nodes = (m) => { const all = []; walk(m.root, (n, p) => all.push([n, p])); return all; };
const inLandmark = (n) => { const out = []; walk(n, (d) => { if (d !== n) out.push(d); }); return out; };
// Nodes not inside main: the shell a user sees on every page.
const shell = (m) => {
  const out = [];
  const down = (n, inMain) => { if (!inMain) out.push(n); for (const c of n.c || []) down(c, inMain || n.lm === 'main'); };
  down(m.root, false);
  return out;
};
const same = (xs) => xs.every((x) => x === xs[0]);

export function runChecks(models) {
  if (models.length < 2) return;
  const result = (sc, list, id, why, goal) => {
    for (const m of models) addCheck(m.checks, sc, list, id);
    if (list === 'fail') (models[0].root.gaps ||= []).push([why, sc, goal]);
  };

  // 2.4.2: a title that is the same on every page names the site, not the page.
  const titles = models.map((m) => m.title || '');
  if (same(titles)) {
    result('2.4.2', 'fail', 'run-title', `Every page has the same title "${titles[0]}"; the title does not name the page`, 'Each page has a title that names it');
  } else result('2.4.2', 'pass', 'run-title');

  // 3.2.3: each navigation landmark, by name, compared among the pages
  // that have it: the items in order. A landmark on one page only, or a
  // page without one, is not judged here.
  const navsOf = (m) => {
    const out = new Map();
    walk(m.root, (n) => { if (n.lm === 'navigation') out.set(n.name || '', inLandmark(n).map((d) => d.name || '').filter(Boolean).join(' | ')); });
    return out;
  };
  const navs = models.map(navsOf);
  const counts = new Map();
  for (const map of navs) for (const name of map.keys()) counts.set(name, (counts.get(name) || 0) + 1);
  const shared = [...counts].filter(([, k]) => k >= 2).map(([name]) => name);
  if (shared.length) {
    const odd = [];
    for (const name of shared) {
      const first = navs.findIndex((map) => map.has(name));
      navs.forEach((map, i) => { if (map.has(name) && map.get(name) !== navs[first].get(name)) odd.push(`"${name}" on ${label(models[i])} (first seen on ${label(models[first])})`); });
    }
    if (odd.length) result('3.2.3', 'fail', 'run-navigation', `The navigation items or their order differ: ${odd.join(', ')}`, 'The same navigation, in the same order, on every page');
    else result('3.2.3', 'pass', 'run-navigation');
  }

  // 3.2.4: a control that appears once on a page (a toggle, a user menu)
  // should carry the same name on every page. Controls with several
  // instances (navigation items, cards) and content (headings, links) are
  // left out.
  const names = new Map();
  for (const m of models) {
    const onPage = new Map();
    for (const n of shell(m)) {
      if (!n.comp || !CONTROLS.has(n.role) || !n.name || n.lm) continue;
      const key = `${n.comp} ${n.role}`;
      onPage.set(key, onPage.has(key) ? null : n.name);
    }
    for (const [key, name] of onPage) {
      if (name === null) names.set(key, null);
      else if (names.get(key) !== null) (names.get(key) || names.set(key, new Set()).get(key)).add(name);
    }
  }
  const differ = [...names].filter(([, set]) => set && set.size > 1).map(([key, set]) => `${key}: ${[...set].map((x) => `"${x}"`).join(', ')}`);
  if (differ.length) (models[0].runDetails ||= {})['run-identification'] = differ;
  result('3.2.4', differ.length ? 'review' : 'pass', 'run-identification');

  // 3.2.6: a help link in the shell on every page, on some, or on none.
  const help = models.map((m) => shell(m).some((n) => ['link', 'button'].includes(n.role) && HELP.test(n.name || '')));
  if (help.every(Boolean)) result('3.2.6', 'pass', 'run-help');
  else if (help.some(Boolean)) {
    const missing = models.filter((_, i) => !help[i]).map(label);
    result('3.2.6', 'fail', 'run-help', `A help or documentation link is on some pages but not on ${missing.join(', ')}`, 'Help in the same place on every page');
  } else result('3.2.6', 'na', 'run-help');

  // 2.4.5: navigation on every page plus a search on every page.
  const hasNav = models.every((m) => nodes(m).some(([n]) => n.lm === 'navigation'));
  const hasSearch = models.every((m) => nodes(m).some(([n]) => n.lm === 'search' || n.role === 'searchbox'));
  result('2.4.5', hasNav && hasSearch ? 'pass' : 'review', 'run-ways');

  // 2.4.4, 2.4.9: a link in the shell (outside main) that carries the same
  // name on every page should go to the same place. A name used twice in
  // one page's shell is left to the page check. A proposal on the first
  // model, never a fail.
  const byName = new Map(); // name -> { node, first, pages: Map(target -> page) }
  const twice = new Set();
  for (const m of models) {
    const seen = new Set();
    for (const n of shell(m)) {
      const name = n.role === 'link' && n.href ? linkName(n.name) : '';
      if (!name) continue;
      if (seen.has(name)) twice.add(name);
      seen.add(name);
      const e = byName.get(name) || byName.set(name, { node: n, first: m, pages: new Map() }).get(name);
      if (!e.pages.has(target(n.href))) e.pages.set(target(n.href), label(m));
    }
  }
  for (const [name, e] of byName) {
    if (twice.has(name) || e.pages.size < 2) continue;
    const node = e.first === models[0] ? e.node : models[0].root;
    const where = [...e.pages].map(([to, on]) => `${to} on ${on}`);
    proposeLink(models[0], node, 'text-link-footer-differs', `The link "${e.node.name}" in the page shell goes to different places: ${where.join(', ')}`, 'The same link name goes to the same place on every page');
  }

  // 1.2.x and 1.4.7: audio and video elements over the run.
  const media = models.reduce((k, m) => k + nodes(m).filter(([n]) => ['video', 'audio'].includes(n.role) || ['video', 'audio'].includes(n.comp)).length, 0);
  for (const sc of MEDIA_ROWS) result(sc, media ? 'review' : 'na', 'run-media');
}

// The person's line for a run rule that could not decide (review) or
// found nothing (na). tab-walk's line lives in acr.js.
export const RUN_LINES = {
  'run-identification': { review: 'Needs a person: a component that appears once on a page carries different names on different pages' },
  'run-ways': { review: 'Needs a person: a navigation on every page, no search found; is there a second way to reach each page?' },
  'run-help': { na: 'Needs a person: no help or documentation link found on any page; is the row not applicable?' },
  'run-media': { review: 'Needs a person: audio or video elements found; captions, descriptions and controls', na: 'Needs a person: no audio or video element found on any page; is the row not applicable?' },
};
