import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../src/run-checks.js';

// A page: title, a navigation landmark with named links, a main, extras.
const nav = (...names) => ({ role: 'navigation', lm: 'navigation', name: 'Main', comp: 'app-side-nav', c: names.map((n) => ({ role: 'link', name: n, comp: 'app-nav-item' })) });
const page = (title, { items = ['Home', 'Apps'], main = [], extra = [] } = {}) => ({
  url: `https://x.test/${title.toLowerCase().replace(/\W+/g, '-')}`, finalUrl: `https://x.test/${title.toLowerCase().replace(/\W+/g, '-')}`, title,
  checks: {}, root: { role: 'RootWebArea', name: title, c: [nav(...items), { role: 'main', lm: 'main', c: main }, ...extra] },
});
const kind = (m, sc, k) => (m.checks[sc]?.[k] ?? []);
const gaps = (m) => (m.root.gaps ?? []);

test('one model: no run checks', () => {
  const m = page('Home');
  runChecks([m]);
  assert.deepEqual(m.checks, {});
});

test('the same title on every page fails 2.4.2 on every model, with one gap on the first root', () => {
  const a = page('Stratos'); const b = page('Stratos');
  runChecks([a, b]);
  assert.deepEqual(kind(a, '2.4.2', 'fail'), ['run-title']);
  assert.deepEqual(kind(b, '2.4.2', 'fail'), ['run-title']);
  const g = gaps(a).find((x) => x[1] === '2.4.2');
  assert.ok(g[0].includes('Every page has the same title "Stratos"'));
  assert.equal(gaps(b).length, 0);
});

test('different titles pass 2.4.2', () => {
  const a = page('Home'); const b = page('Applications');
  runChecks([a, b]);
  assert.deepEqual(kind(a, '2.4.2', 'pass'), ['run-title']);
  assert.equal(gaps(a).length, 0);
});

test('the same navigation items in the same order pass 3.2.3; a difference fails and names the page', () => {
  const same = [page('Home'), page('Apps')];
  runChecks(same);
  assert.deepEqual(kind(same[0], '3.2.3', 'pass'), ['run-navigation']);
  const a = page('Home'); const b = page('Apps', { items: ['Apps', 'Home'] });
  runChecks([a, b]);
  assert.deepEqual(kind(a, '3.2.3', 'fail'), ['run-navigation']);
  const g = gaps(a).find((x) => x[1] === '3.2.3');
  assert.ok(g[0].includes('https://x.test/apps'));
});

test('the same component and role outside main with different names goes to review on 3.2.4', () => {
  const toggle = (name) => ({ role: 'button', name, comp: 'app-theme-toggle' });
  const a = page('Home', { extra: [toggle('Toggle theme to dark mode')] });
  const b = page('Apps', { extra: [toggle('Theme')] });
  runChecks([a, b]);
  assert.deepEqual(kind(a, '3.2.4', 'review'), ['run-identification']);
  const ok = [page('Home', { extra: [toggle('Theme')] }), page('Apps', { extra: [toggle('Theme')] })];
  runChecks(ok);
  assert.deepEqual(kind(ok[0], '3.2.4', 'pass'), ['run-identification']);
});

test('a help link on every page passes 3.2.6, on some pages fails, on none is na', () => {
  const help = { role: 'link', name: 'Documentation', comp: 'a' };
  const all = [page('Home', { extra: [help] }), page('Apps', { extra: [help] })];
  runChecks(all);
  assert.deepEqual(kind(all[0], '3.2.6', 'pass'), ['run-help']);
  const some = [page('Home', { extra: [help] }), page('Apps')];
  runChecks(some);
  assert.deepEqual(kind(some[0], '3.2.6', 'fail'), ['run-help']);
  assert.ok(gaps(some[0]).find((x) => x[1] === '3.2.6')[0].includes('https://x.test/apps'));
  const none = [page('Home'), page('Apps')];
  runChecks(none);
  assert.deepEqual(kind(none[0], '3.2.6', 'na'), ['run-help']);
});

test('navigation plus a search on every page passes 2.4.5; navigation alone goes to review', () => {
  const search = { role: 'searchbox', name: 'Search' };
  const both = [page('Home', { extra: [search] }), page('Apps', { extra: [search] })];
  runChecks(both);
  assert.deepEqual(kind(both[0], '2.4.5', 'pass'), ['run-ways']);
  const navOnly = [page('Home'), page('Apps')];
  runChecks(navOnly);
  assert.deepEqual(kind(navOnly[0], '2.4.5', 'review'), ['run-ways']);
});

test('no audio or video on any page is na on every 1.2.x row and 1.4.7; a video goes to review', () => {
  const none = [page('Home'), page('Apps')];
  runChecks(none);
  for (const sc of ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7', '1.2.8', '1.2.9', '1.4.7']) {
    assert.deepEqual(kind(none[0], sc, 'na'), ['run-media'], sc);
    assert.deepEqual(kind(none[1], sc, 'na'), ['run-media'], sc);
  }
  const video = [page('Home', { main: [{ role: 'video', name: 'Intro' }] }), page('Apps')];
  runChecks(video);
  assert.deepEqual(kind(video[0], '1.2.1', 'review'), ['run-media']);
});

test('3.2.3 compares each navigation landmark by name among the pages that have it', () => {
  const tabs = (...items) => ({ role: 'navigation', lm: 'navigation', name: 'Application', comp: 'app-page-side-nav', c: items.map((n) => ({ role: 'link', name: n })) });
  const same = [page('Home'), page('App', { extra: [tabs('Summary', 'Routes')] }), page('App 2', { extra: [tabs('Summary', 'Routes')] })];
  runChecks(same);
  assert.deepEqual(kind(same[0], '3.2.3', 'pass'), ['run-navigation']);
  const differ = [page('Home'), page('App', { extra: [tabs('Summary', 'Routes')] }), page('App 2', { extra: [tabs('Routes', 'Summary')] })];
  runChecks(differ);
  assert.deepEqual(kind(differ[0], '3.2.3', 'fail'), ['run-navigation']);
  const g = gaps(differ[0]).find((x) => x[1] === '3.2.3')[0];
  assert.ok(g.includes('"Application"') && g.includes('https://x.test/app-2'), g);
  const blank = [page('Home'), page('Apps'), { ...page('Blank'), root: { role: 'RootWebArea', name: 'Blank' } }];
  runChecks(blank);
  assert.deepEqual(kind(blank[0], '3.2.3', 'pass'), ['run-navigation']);
});

test('the 3.2.4 review names the component and its names', () => {
  const toggle = (name) => ({ role: 'button', name, comp: 'app-theme-toggle' });
  const a = page('Home', { extra: [toggle('Toggle theme to dark mode')] });
  const b = page('Apps', { extra: [toggle('Theme')] });
  runChecks([a, b]);
  assert.deepEqual(a.runDetails['run-identification'], ['app-theme-toggle button: "Toggle theme to dark mode", "Theme"']);
});
