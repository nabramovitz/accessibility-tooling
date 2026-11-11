import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { walk, bare } from './generate.js';
import { RUN_LINES } from './run-checks.js';
import { VIEW_LINES } from './views.js';
import { FOCUS_LINES } from './focus.js';

const LINES = { ...RUN_LINES, ...VIEW_LINES, ...FOCUS_LINES };

// The tool's own rules, beside axe-core's: the Tab walk, the run checks,
// the views and the focus measures.
const own = (r) => r === 'tab-walk' || /^(run|view|focus)-/.test(r);

const CHAPTERS = ['success_criteria_level_a', 'success_criteria_level_aa', 'success_criteria_level_aaa', 'functional_performance_criteria'];
const MAX_GAP_LINES = 20;
const ERRATA = ['https://www.w3.org/WAI/WCAG21/errata/', 'https://www.w3.org/TR/2023/NOTE-UNDERSTANDING-WCAG20-20230921/ensure-compat-parses.html'];

// Chapter 3 rows: the related WCAG rows and, for a part no WCAG row
// covers, a sentence for the note.
const FPC = {
  '302.1': { rows: ['1.1.1', '1.3.1', '1.3.2', '2.1.1', '2.4.3', '4.1.2'], extra: 'Needs a person: the rule of comparable information (the tool checks it in a later version).' },
  '302.2': { rows: ['1.4.3', '1.4.4', '1.4.10', '1.4.12', '2.4.7', '2.4.11'] },
  '302.3': { rows: ['1.4.1', '1.4.11'] },
  '302.4': { rows: ['1.2.1', '1.2.2', '1.2.4'] },
  '302.5': { rows: ['1.2.2', '1.4.7'] },
  '302.6': { rows: [] },
  '302.7': { rows: ['2.1.1', '2.1.2', '2.2.1', '2.5.1', '2.5.2', '2.5.8'] },
  '302.8': { rows: ['2.1.1', '2.1.2', '2.2.1', '2.5.1', '2.5.2', '2.5.8'] },
  '302.9': { rows: ['2.4.6', '3.2.3', '3.2.4', '3.3.1', '3.3.2'], extra: 'Needs a person: reading level.' },
};
// First is worst.
const WORST = ['does-not-support', 'partially-supports', 'not-evaluated', 'supports', 'not-applicable'];
const FPC_ID = 'functional_performance_criteria';

export function loadCatalog() {
  return yaml.load(readFileSync(new URL('../catalog/2.5-edition-wcag-2.2-508-en.yaml', import.meta.url), 'utf8'));
}

// A file: page is named by its file name only: the path can hold the
// user's name, and the report is meant to be published. The name is
// escaped for Markdown, as a node title is.
function label(m) {
  const u = m.finalUrl ?? bare(m.url);
  if (!/^file:/i.test(u)) return u;
  const name = u.split('/').pop();
  try { return md(decodeURIComponent(name)); } catch { return md(name); }
}
const list = (m, sc, kind) => m.checks?.[sc]?.[kind] ?? [];
const union = (models, sc, kind) => [...new Set(models.flatMap((m) => list(m, sc, kind)))];

// One line: the lines of an axe-core summary are joined with "; ". An
// unplaced gap has an axe selector in its text, and a selector can hold a
// url with a query or an attribute value from the page, so the text is not
// used: the goal (rule help text) is written instead.
function plain([why, , goal]) {
  const w = why.startsWith('not placed') ? `not placed - ${goal}` : why;
  return w.split(/\r?\n/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('; ').replace(/:; /g, ': ');
}

// A node title comes from the page; notes are read as Markdown.
const md = (s) => String(s).replace(/[\\`*_[\]()<>|#]/g, '\\$&').replace(/^[-+]/, '\\$&');

function gapLines(models, sc) {
  const out = [];
  for (const m of models) {
    walk(m.root, (node) => {
      for (const gap of node.gaps || []) if (gap[1] === sc) out.push(`${label(m)}: ${md(node.t || node.role)}: ${plain(gap)}`);
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
  // supports needs a pass, and a pass or na on every page (all of it,
  // frames included). The tool never writes not-applicable: an axe-core
  // rule with nothing to check does not show that the criterion does not
  // apply.
  const [pass, review, na] = ['pass', 'review', 'na'].map((kind) => union(models, sc, kind));
  if (!pass.length && !review.length && !na.length) return { level: 'not-evaluated', lines: ['Needs a person: no automated check'], quiet: true };
  const passing = models.filter((m) => list(m, sc, 'pass').length);
  const missing = models.filter((m) => !['pass', 'review', 'na'].some((kind) => list(m, sc, kind).length));
  const lines = [];
  if (pass.length) lines.push(`Rules that passed: ${pass.join(', ')}, on ${passing.length} of ${models.length} page(s)`);
  const axeReview = review.filter((r) => !own(r));
  if (review.includes('tab-walk')) lines.push('Needs a person: the Tab walk did not read every Tab stop (see the run notes)');
  for (const r of review) {
    if (!LINES[r]?.review) continue;
    const detail = models.find((m) => m.runDetails?.[r])?.runDetails[r];
    lines.push(detail ? `${LINES[r].review}: ${detail.join('; ')}` : LINES[r].review);
  }
  if (axeReview.length) lines.push(`Needs a person: axe-core could not decide (${axeReview.join(', ')})`);
  const axeNa = na.filter((r) => !own(r));
  if (!pass.length && axeNa.length) lines.push(`Needs a person: the axe-core rules found nothing to check (${axeNa.join(', ')}); is the row not applicable?`);
  for (const r of na) if (RUN_LINES[r]?.na) lines.push(RUN_LINES[r].na);
  if (missing.length) lines.push(`Needs a person: no automated result on ${missing.length} of ${models.length} page(s)`);
  // A frame that refused axe-core is not checked: its page has no result
  // for a row that axe-core rules check.
  const axeRules = [...pass, ...review, ...na].some((r) => !own(r));
  const framed = axeRules ? models.filter((m) => m.notes?.some?.((x) => String(x).startsWith('axe not added to frame'))) : [];
  if (framed.length) lines.push(`Needs a person: axe-core did not check a frame on ${framed.length} page(s)`);
  return { level: pass.length && !review.length && !missing.length && !framed.length ? 'supports' : 'not-evaluated', lines };
}

function fpc(num, levelOf) {
  const { rows, extra } = FPC[num];
  if (!rows.length) return { level: 'not-evaluated', lines: ['Needs a person: does any function need speech?'] };
  const levels = rows.map(levelOf);
  const worst = WORST.find((l) => levels.includes(l));
  const lines = [`Worst of the related rows: ${rows.map((r, i) => `${r} ${levels[i]}`).join(', ')}`];
  if (extra) lines.push(extra);
  // The part in the extra sentence is not checked, so it is not supports.
  return { level: extra && worst === 'supports' ? 'not-evaluated' : worst, lines };
}

// levelOf(num), when given, is the level of a WCAG row for the chapter 3
// rows (a row a person wrote); undefined means the tool's own proposal. A
// chapter 3 row built with a person's level says so in its end line.
// quiet, when given, gets the nums of rows whose evidence has nothing to say:
// no automated check behind them.
export function proposeRows(models, catalog, levelOf, quiet = new Set()) {
  if (!models.length) throw new Error('no models');
  const cache = new Map();
  const byCriterion = (sc) => {
    if (!cache.has(sc)) cache.set(sc, wcag(models, sc));
    return cache.get(sc);
  };
  const end = (from) => `Proposed by reader-path from ${from} on ${models.length} page(s); a person confirms.`;
  const out = {};
  for (const id of CHAPTERS) {
    const chapter = catalog.chapters.find((c) => c.id === id);
    const isFpc = id === FPC_ID;
    out[id] = chapter.criteria.map((c) => {
      const num = String(c.id);
      const { level, lines } = isFpc ? fpc(num, (sc) => levelOf?.(sc) ?? byCriterion(sc).level) : byCriterion(num);
      if (isFpc ? FPC[num].rows.every((sc) => byCriterion(sc).quiet && levelOf?.(sc) === undefined) : byCriterion(num).quiet) quiet.add(num);
      const fromBase = isFpc && FPC[num].rows.some((sc) => levelOf?.(sc) !== undefined);
      const last = end(fromBase ? 'automated checks and the base file' : 'automated checks');
      return { num, components: [{ name: isFpc ? 'none' : 'web', adherence: { level, notes: [...lines, last].join('\n\n') } }] };
    });
  }
  return out;
}

const METHODS = 'Automated checks with reader-path ';
// A row whose note still ends with the tool's end line is the tool's own
// row from an earlier run, not a person's: it is proposed again.
const TOOL_END = /(?:^|\n)Proposed by reader-path from automated checks[^\n]*; a person confirms\.\s*$/;
// A num that YAML read as a number (302.6, 402) is written as a string.
const strNums = (rows) => rows.map((r) => ({ ...r, num: String(r.num) }));
const adherence = (row) => row.components?.find?.((c) => c?.name === 'web' || c?.name === 'none')?.adherence;
const level = (row) => adherence(row)?.level;
const toolOwned = (row) => TOOL_END.test(String(adherence(row)?.notes ?? ''));

// The report: the base file's fields as they are, the tool's rows for
// the nums the base does not have or has as the tool's own rows. The chapter 3 rows come from the WCAG
// rows after this merge. Returns { report, conflicts, pending, automated }:
// conflicts are lines for person rows better than the new evidence, pending
// is the number of A and AA rows still not-evaluated, automated the number
// of WCAG rows the tool wrote as supports from rules (4.1.1 is not one).
export function buildReport(models, base, catalog, { version, axe, date }) {
  const quiet = new Set();
  const own = proposeRows(models, catalog, undefined, quiet);
  const report = base && Object.keys(base).length ? { ...base } : {
    title: 'Accessibility Conformance Report (draft)',
    product: { name: 'PRODUCT NAME' },
    author: { email: 'AUTHOR EMAIL' },
  };
  report.catalog = '2.5-edition-wcag-2.2-508-en';
  report.report_date = date;
  if (report.evaluation_methods_used == null || String(report.evaluation_methods_used).startsWith(METHODS)) {
    report.evaluation_methods_used = `${METHODS}${version} and axe-core ${axe} in ${models[0].browser}, `
      + `on ${models.length} page(s). A person confirms every row.`;
  }
  const chapters = {};
  const conflicts = [];
  let pending = 0;
  let automated = 0;
  // The levels of the person rows in the report, for chapter 3.
  const person = new Map();
  for (const id of CHAPTERS) {
    const mine = new Map((report.chapters?.[id]?.criteria || []).filter((r) => !toolOwned(r)).map((r) => [String(r.num), r]));
    const proposed = id === FPC_ID ? proposeRows(models, catalog, (sc) => person.get(sc), quiet)[id] : own[id];
    // A person row in another chapter than the catalog's also counts.
    for (const [num, b] of mine) person.set(num, WORST.includes(level(b)) ? level(b) : 'not-evaluated');
    const rows = proposed.map((p) => {
      const b = mine.get(p.num);
      if (!b) {
        if (id !== FPC_ID && p.num !== '4.1.1' && level(p) === 'supports') automated++;
        return p;
      }
      mine.delete(p.num);
      if (!WORST.includes(level(b))) conflicts.push(`base row ${p.num}: unknown level ${level(b) ?? '(none)'}`);
      // WORST order: a higher index is a better level.
      // A row with no automated check behind it has nothing to say.
      if (WORST.indexOf(level(b)) > WORST.indexOf(level(p)) && !quiet.has(p.num)) {
        conflicts.push(`base row ${p.num}: ${level(b)}; new evidence: ${level(p)}`);
      }
      return b;
    });
    rows.push(...mine.values());
    if (id.endsWith('_a') || id.endsWith('_aa')) pending += rows.filter((r) => level(r) === 'not-evaluated').length;
    chapters[id] = { ...report.chapters?.[id], criteria: strNums(rows) };
  }
  for (const [id, chapter] of Object.entries(report.chapters || {})) {
    chapters[id] ??= Array.isArray(chapter?.criteria) ? { ...chapter, criteria: strNums(chapter.criteria) } : chapter;
  }
  report.chapters = chapters;
  return { report, conflicts, pending, automated };
}

export const dump = (report) => yaml.dump(report, { lineWidth: 80, noRefs: true });
