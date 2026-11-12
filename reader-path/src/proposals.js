// Proposals: findings the tool cannot decide, which a person marks
// "defect" or "fine". A proposal is model.proposals[]:
// { key, sc, rule, node, say, propose, n? }. The decisions live in a
// file, { version: 1, decided: [{ page, key, verdict, note, by, date }] },
// where page is a page shape, or null for every page.
import { walk } from './generate.js';
import { addCheck } from './axe.js';

// Numbers become # (a count in a name changes from run to run); node ids
// are not in the key for the same reason.
const norm = (s) => String(s ?? '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
export const proposalKey = ({ rule, role, name, text }) => [rule, role, norm(name), norm(text).slice(0, 80)].join('|');

// A second proposal with the same key on one page adds to its count.
export function addProposal(model, node, { sc, rule, text, say, propose = null }) {
  const key = proposalKey({ rule, role: node.role, name: node.name, text });
  const list = (model.proposals ||= []);
  const same = list.find((p) => p.key === key);
  if (same) same.n = (same.n ?? 1) + 1;
  else list.push({ key, sc, rule, node: node.id, say, propose });
}

export function readDecisions(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('not a decisions file (not JSON)'); }
  const bad = (why) => new Error(`not a decisions file (${why})`);
  if (!d || typeof d !== 'object' || d.version !== 1) throw bad('not version 1');
  if (!Array.isArray(d.decided)) throw bad('no decided list');
  for (const e of d.decided) {
    if (!e || typeof e.key !== 'string') throw bad('a decision has no key');
    if (!['defect', 'fine'].includes(e.verdict)) throw bad('a verdict is not defect or fine');
    if (e.page != null && typeof e.page !== 'string') throw bad('a page is not a shape or null');
  }
  return d.decided;
}

// Copies the models and applies the decisions. Per page and rule: a
// defect is a fail (its say becomes a gap on its node), else an open
// proposal is review, else (all fine) a pass. A page decision wins over
// a null one. Stale: decisions that matched nothing, for null or a page
// in this run.
export function settle(models, decided = []) {
  const used = new Set();
  const shapes = new Set(models.map((m) => m.shape ?? null));
  const out = models.map((given) => {
    if (!given.proposals?.length) return given;
    const m = structuredClone(given);
    const page = m.shape ?? null;
    const lists = new Map();
    for (const p of m.proposals) {
      const d = (page !== null && decided.find((e) => e.key === p.key && e.page === page)) || decided.find((e) => e.key === p.key && e.page == null);
      if (d) { used.add(d); Object.assign(p, { verdict: d.verdict, by: d.by, date: d.date }); }
      const k = `${p.sc}\u0000${p.rule}`;
      const was = lists.get(k);
      const now = p.verdict === 'defect' ? 'fail' : p.verdict === 'fine' ? 'pass' : 'review';
      if (!was || ['fail', 'review', 'pass'].indexOf(now) < ['fail', 'review', 'pass'].indexOf(was)) lists.set(k, now);
      if (p.verdict === 'defect') {
        let node = m.root;
        if (p.node != null) walk(m.root, (n) => { if (n.id === p.node) node = n; });
        const who = [p.by, p.date].filter(Boolean).join(', ');
        (node.gaps ||= []).push([`${p.say}${who ? ` (a defect: ${who})` : ''}`, p.sc, p.propose ?? 'A person decided this is a defect']);
      }
    }
    for (const [k, list] of lists) {
      const [sc, rule] = k.split('\u0000');
      m.checks ||= {};
      addCheck(m.checks, sc, list, rule);
    }
    return m;
  });
  const stale = decided.filter((d) => !used.has(d) && (d.page == null || shapes.has(d.page)));
  return { models: out, stale };
}

// The note lines of a row with proposals.
export function proposalLines(models, sc) {
  const ps = models.flatMap((m) => (m.proposals ?? []).filter((p) => p.sc === sc));
  if (!ps.length) return [];
  const k = (v) => ps.filter((p) => p.verdict === v).length;
  const open = ps.length - k('defect') - k('fine');
  const by = [...new Set(ps.map((p) => p.by).filter(Boolean))];
  return [
    `${ps.length} proposal${ps.length === 1 ? '' : 's'} for a person (${k('defect')} decided defect, ${k('fine')} fine, ${open} open)`,
    ...(by.length ? [`Decided by: ${by.join(', ')}`] : []),
  ];
}
