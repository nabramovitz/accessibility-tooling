// Link purpose (2.4.4 A, 2.4.9 AAA): proposals for a person, never a
// fail. Reads the tree already built; a link node carries its target
// in `href`. Each finding is proposed for both rows: 2.4.4 (the name
// with its context) and 2.4.9 (the name alone, under the rule id plus
// "-alone").
import { walk } from './generate.js';
import { addProposal } from './proposals.js';

const VAGUE = new Set(['click here', 'click', 'here', 'more', 'read more', 'learn more', 'link', 'this link']);
const URL_NAME = /^(?:https?:\/\/|ftp:\/\/|www\.)\S+$/i;

// Lower case, spaces collapsed, no punctuation, arrows or ellipsis at the ends.
export const linkName = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ')
  .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// A target without its fragment and a trailing slash, so two spellings
// of one page are one target.
export function target(href) {
  try {
    const u = new URL(href);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch { return href; }
}

const some = (list) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} and ${list.length - 3} more` : list.join(', '));

// One finding, proposed for 2.4.4 and, with the name read alone, 2.4.9.
export function proposeLink(model, node, rule, say, propose) {
  addProposal(model, node, { sc: '2.4.4', rule, text: '', say, propose });
  addProposal(model, node, { sc: '2.4.9', rule: `${rule}-alone`, text: '', say: `${say} (read on its own, without its context)`, propose });
}

export function textLinks(model, root) {
  const links = [];
  walk(root, (n) => { if (n.role === 'link' && n.name) links.push(n); });

  const groups = new Map();
  for (const n of links) {
    const name = linkName(n.name);
    if (n.href && name) (groups.get(name) || groups.set(name, []).get(name)).push(n);
  }
  for (const [, list] of groups) {
    const targets = [...new Set(list.map((n) => target(n.href)))];
    if (targets.length > 1) {
      proposeLink(model, list[0], 'text-link-same-name', `${list.length} links named "${list[0].name}" go to ${targets.length} different pages: ${some(targets)}`, 'Name each link for where it goes');
    }
  }

  for (const n of links) {
    const name = linkName(n.name);
    if (VAGUE.has(name)) proposeLink(model, n, 'text-link-vague', `The link name "${n.name}" does not say where the link goes`, 'Name the link for where it goes');
    else if (URL_NAME.test(n.name.trim())) proposeLink(model, n, 'text-link-url', `The link name is only a URL: ${n.name.trim()}`, 'Use words that say where the link goes, or keep the URL if the URL is the purpose');
  }
}
