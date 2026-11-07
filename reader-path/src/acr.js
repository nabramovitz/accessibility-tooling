import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { walk, bare } from './generate.js';

const CHAPTERS = ['success_criteria_level_a', 'success_criteria_level_aa', 'success_criteria_level_aaa', 'functional_performance_criteria'];
const MAX_GAP_LINES = 20;
const ERRATA = ['https://www.w3.org/WAI/WCAG21/errata/', 'https://www.w3.org/WAI/standards-guidelines/wcag/faq/'];

// Chapter 3 rows: the related WCAG rows and an extra sentence for the note.
const FPC = {
  '302.1': { rows: ['1.1.1', '1.3.1', '1.3.2', '2.1.1', '2.4.3', '4.1.2'], extra: 'Note: the rule of comparable information is checked in a later version.' },
  '302.2': { rows: ['1.4.3', '1.4.4', '1.4.10', '1.4.12', '2.4.7', '2.4.11'] },
  '302.3': { rows: ['1.4.1', '1.4.11'] },
  '302.4': { rows: ['1.2.1', '1.2.2', '1.2.4'] },
  '302.5': { rows: ['1.2.2', '1.4.7'] },
  '302.6': { rows: [] },
  '302.7': { rows: ['2.1.1', '2.1.2', '2.2.1', '2.5.1', '2.5.2', '2.5.8'] },
  '302.8': { rows: ['2.1.1', '2.1.2', '2.2.1', '2.5.1', '2.5.2', '2.5.8'] },
  '302.9': { rows: ['2.4.6', '3.2.3', '3.2.4', '3.3.1', '3.3.2'], extra: 'Note: reading level needs a person.' },
};
// First is worst.
const WORST = ['partially-supports', 'not-evaluated', 'supports', 'not-applicable'];

export function loadCatalog() {
  return yaml.load(readFileSync(new URL('../catalog/2.5-edition-wcag-2.2-508-en.yaml', import.meta.url), 'utf8'));
}

const label = (m) => m.finalUrl ?? bare(m.url);
const list = (m, sc, kind) => m.checks?.[sc]?.[kind] ?? [];
const union = (models, sc, kind) => [...new Set(models.flatMap((m) => list(m, sc, kind)))];

// One line. An unplaced gap has an axe selector in its text, and a selector
// can hold a url with a query or an attribute value from the page, so the
// text is not used: the goal (rule help text) is written instead.
function plain([why, , goal]) {
  const w = why.startsWith('not placed') ? `not placed - ${goal}` : why;
  return w.replace(/\s+/g, ' ').trim();
}

function gapLines(models, sc) {
  const out = [];
  for (const m of models) {
    walk(m.root, (node) => {
      for (const gap of node.gaps || []) if (gap[1] === sc) out.push(`${label(m)}: ${node.t || node.role}: ${plain(gap)}`);
    });
  }
  return out.length > MAX_GAP_LINES ? [...out.slice(0, MAX_GAP_LINES), `and ${out.length - MAX_GAP_LINES} more`] : out;
}

// The proposal for one WCAG criterion over all pages: { level, lines }.
function wcag(models, sc) {
  if (sc === '4.1.1') {
    return { level: 'supports', lines: [`WCAG 2.2 removed 4.1.1. The WCAG 2.1 errata and the WCAG 2.0 Understanding note say content using HTML or XML always satisfies it: ${ERRATA.join(' ')}`] };
  }
  const failing = models.filter((m) => list(m, sc, 'fail').length);
  if (failing.length) {
    const rules = `Failing rules: ${union(models, sc, 'fail').join(', ')} on ${failing.length} of ${models.length} page(s)`;
    return { level: 'partially-supports', lines: [rules, ...gapLines(models, sc)] };
  }
  const review = union(models, sc, 'review');
  const passing = models.filter((m) => list(m, sc, 'pass').length);
  if (passing.length) {
    const lines = [`Rules that passed: ${union(models, sc, 'pass').join(', ')}, on ${passing.length} of ${models.length} page(s)`];
    if (review.length) lines.push(`Needs a person: axe-core could not decide (${review.join(', ')})`);
    return { level: 'supports', lines };
  }
  if (review.length) return { level: 'not-evaluated', lines: [`Needs a person: axe-core could not decide (${review.join(', ')})`] };
  const onlyNa = models.every((m) => list(m, sc, 'na').length);
  if (onlyNa) return { level: 'not-applicable', lines: [`Rules that did not apply: ${union(models, sc, 'na').join(', ')}`] };
  return { level: 'not-evaluated', lines: ['Needs a person: no automated check'] };
}

function fpc(num, byCriterion) {
  const { rows, extra } = FPC[num];
  if (!rows.length) return { level: 'not-evaluated', lines: ['Needs a person: does any function need speech?'] };
  const levels = rows.map((r) => byCriterion(r).level);
  const level = WORST.find((l) => levels.includes(l));
  const lines = [`Worst of the related rows: ${rows.map((r, i) => `${r} ${levels[i]}`).join(', ')}`];
  if (extra) lines.push(extra);
  return { level, lines };
}

export function proposeRows(models, catalog) {
  if (!models.length) throw new Error('no models');
  const cache = new Map();
  const byCriterion = (sc) => {
    if (!cache.has(sc)) cache.set(sc, wcag(models, sc));
    return cache.get(sc);
  };
  const end = `Proposed by reader-path from automated checks on ${models.length} page(s); a person confirms.`;
  const out = {};
  for (const id of CHAPTERS) {
    const chapter = catalog.chapters.find((c) => c.id === id);
    const isFpc = id === 'functional_performance_criteria';
    out[id] = chapter.criteria.map((c) => {
      const num = String(c.id);
      const { level, lines } = isFpc ? fpc(num, byCriterion) : byCriterion(num);
      return { num, components: [{ name: isFpc ? 'none' : 'web', adherence: { level, notes: [...lines, end].join('\n') } }] };
    });
  }
  return out;
}

const BASE_LEVELS = ['supports', 'not-applicable'];
const level = (row) => row.components?.find((c) => c.name === 'web' || c.name === 'none')?.adherence?.level;

// The report: the base file's fields as they are, the tool's rows for
// the nums the base does not have. Returns { report, conflicts, pending }:
// conflicts are lines for base rows that new evidence contradicts, pending
// is the number of A and AA rows still not-evaluated.
export function buildReport(models, base, catalog, { version, axe, date }) {
  const proposed = proposeRows(models, catalog);
  const report = base && Object.keys(base).length ? { ...base } : {
    title: 'Accessibility Conformance Report (draft)',
    product: { name: 'PRODUCT NAME' },
    author: { email: 'AUTHOR EMAIL' },
  };
  report.catalog = '2.5-edition-wcag-2.2-508-en';
  report.report_date = date;
  report.evaluation_methods_used ??= `Automated checks with reader-path ${version} and axe-core ${axe} in ${models[0].browser}, `
    + `on ${models.length} page(s). A person confirms every row.`;
  const chapters = {};
  const conflicts = [];
  let pending = 0;
  for (const id of CHAPTERS) {
    const own = report.chapters?.[id]?.criteria || [];
    const mine = new Map(own.map((r) => [String(r.num), r]));
    const rows = proposed[id].map((p) => {
      const b = mine.get(p.num);
      if (!b) return p;
      mine.delete(p.num);
      if (BASE_LEVELS.includes(level(b)) && level(p) === 'partially-supports') {
        conflicts.push(`base row ${p.num}: ${level(b)}; new evidence: partially-supports`);
      }
      return b;
    });
    rows.push(...mine.values());
    if (id.endsWith('_a') || id.endsWith('_aa')) pending += rows.filter((r) => level(r) === 'not-evaluated').length;
    chapters[id] = { ...report.chapters?.[id], criteria: rows };
  }
  for (const [id, chapter] of Object.entries(report.chapters || {})) chapters[id] ??= chapter;
  report.chapters = chapters;
  return { report, conflicts, pending };
}

export const dump = (report) => yaml.dump(report, { lineWidth: 80, noRefs: true });
