// Checks over a whole run: rows that one page cannot decide. Each rule
// writes its result into every model's checks table (so the ACR writer's
// per-page logic holds) and, for a fail, one gap on the first model's
// root. With fewer than two models there is nothing to compare.
import { walk, bare } from './generate.js';
import { addCheck } from './axe.js';

const MEDIA_ROWS = ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7', '1.2.8', '1.2.9', '1.4.7'];
const HELP = /\b(help|docs|documentation|support)\b/i;

const label = (m) => bare(m.finalUrl || m.url);
const nodes = (m) => { const all = []; walk(m.root, (n, p) => all.push([n, p])); return all; };
const inLandmark = (m, lm) => {
  const out = [];
  walk(m.root, function visit(n) { if (n.lm === lm) walk(n, (d) => { if (d !== n) out.push(d); }); });
  return out;
};
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

  // 3.2.3: the navigation landmark's items, in order, on every page that has one.
  const navs = models.map((m) => inLandmark(m, 'navigation').map((n) => n.name || '').filter(Boolean).join(' | '));
  const withNav = navs.map((s, i) => [s, i]).filter(([s]) => s);
  if (withNav.length >= 2) {
    const odd = withNav.filter(([s]) => s !== withNav[0][0]).map(([, i]) => label(models[i]));
    if (odd.length) result('3.2.3', 'fail', 'run-navigation', `The navigation items or their order differ on ${odd.join(', ')} from ${label(models[withNav[0][1]])}`, 'The same navigation, in the same order, on every page');
    else result('3.2.3', 'pass', 'run-navigation');
  }

  // 3.2.4: a component that appears once on a page (a toggle, a user
  // menu) should carry the same name on every page. Components with
  // several instances (navigation items, cards) are left out.
  const names = new Map();
  for (const m of models) {
    const onPage = new Map();
    for (const n of shell(m)) {
      if (!n.comp || !n.role || !n.name || n.lm) continue;
      const key = `${n.comp} ${n.role}`;
      onPage.set(key, onPage.has(key) ? null : n.name);
    }
    for (const [key, name] of onPage) {
      if (name === null) names.set(key, null);
      else if (names.get(key) !== null) (names.get(key) || names.set(key, new Set()).get(key)).add(name);
    }
  }
  const differ = [...names].filter(([, set]) => set && set.size > 1).map(([key]) => key);
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
