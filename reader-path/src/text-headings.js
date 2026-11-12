// Text pass: headings and labels (2.4.6) and the gaps of the tool's own
// rule (the rule of comparable information, reported under 302.1, the
// row it belongs to). Every finding is a proposal for a person (see
// proposals.js), never a fail. It reads the built tree, plus one script
// in the page for what the tree lacks: whether text sits in an icon-font
// element, tabindex, the title, a card's parts.
import { walk } from './generate.js';
import { addProposal } from './proposals.js';

const OUR_RULE = '302.1';
const FIELDS = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'checkbox', 'switch', 'listbox']);
const LABELS = new Set(['heading', 'LabelText', ...FIELDS]);
const MAX_FOUND = 3000;

// Runs in the page. Returns { els, facts }: facts[i] describes els[i].
// An icon is a visible element whose own text is one lowercase word
// (a ligature name: home, more_vert) in an icon font, found by its
// computed font family (it is the declared stack, so it is there when
// the font file is not) or by the Material icon class. It is skipped
// when an aria-hidden or aria-label sits between it and the control,
// heading or label it is in: its word is not read then.
const FIND = `(() => {
  const els = [], facts = [];
  const ICON_FONT = /material (icons|symbols)|\\bicons?\\b|awesome|glyphicons|symbols/i;
  const ICON_CLASS = /(^|\\s)(material-icons[\\w-]*|material-symbols[\\w-]*|mat-icon)(\\s|$)/;
  const STOP = 'button,a,h1,h2,h3,h4,h5,h6,label,[role],input,select,textarea,summary';
  const NATIVE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|DETAILS|IFRAME|AUDIO|VIDEO)$/;
  const SECTIONS = 'section,article,li,form,mat-card,[class*=card],main,body';
  const BARE_ROLE = /^(ARTICLE|SECTION|LI|FORM|FIELDSET|FIGURE|DETAILS|DIALOG|ASIDE|NAV|MAIN|HEADER|FOOTER)$/;
  const short = (s, n = 60) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const heading = (e) => {
    const h = e.closest(SECTIONS)?.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]');
    return short(h && h !== e && !e.contains(h) ? h.textContent : '');
  };
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const named = (e) => e.hasAttribute('aria-label') || e.hasAttribute('aria-labelledby');
  const all = [];
  const collect = (root) => {
    for (const e of root.querySelectorAll('*')) {
      all.push(e);
      if (e.shadowRoot) collect(e.shadowRoot);
    }
  };
  collect(document);
  for (const e of all) {
    if (els.length >= ${MAX_FOUND}) break;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(e.tagName)) continue;
    const text = own(e);
    if (/^[a-z][a-z0-9_]*$/.test(text) && text.length <= 40 && !e.children.length
        && (ICON_CLASS.test(e.className || '') || ICON_FONT.test(getComputedStyle(e).fontFamily)) && shown(e)) {
      let stop = e, hidden = false;
      for (let x = e; x; x = x.parentElement) {
        if (x.getAttribute('aria-hidden') === 'true' || named(x)) hidden = true;
        if (x !== e && x.matches(STOP)) { stop = x; break; }
        stop = x;
      }
      if (!hidden) { els.push(e); facts.push({ kind: 'icon', word: text, title: short(stop.getAttribute('title')), heading: heading(stop) }); }
      continue;
    }
    if (e.hasAttribute('tabindex') && parseInt(e.getAttribute('tabindex'), 10) >= 0 && !e.hasAttribute('role')
        && !NATIVE.test(e.tagName) && !e.isContentEditable && !named(e) && shown(e)) {
      els.push(e); facts.push({ kind: 'box', title: short(e.getAttribute('title')), heading: heading(e), text: short(e.innerText, 40) });
      continue;
    }
    const isCard = e.tagName === 'MAT-CARD' || (e.classList && (e.classList.contains('card') || e.classList.contains('mat-card')));
    if (isCard && !e.hasAttribute('role') && !named(e) && !BARE_ROLE.test(e.tagName) && !e.parentElement?.closest('.card,.mat-card,mat-card') && shown(e)) {
      const parts = [...e.querySelectorAll('*')].filter((x) => own(x) || x.matches('a[href],button,input,select,textarea')).length;
      if (parts >= 2) {
        const h = e.querySelector('h1,h2,h3,h4,h5,h6,[role=heading]');
        els.push(e); facts.push({ kind: 'card', heading: short(h && h.textContent), text: short(e.innerText, 40) });
      }
    }
  }
  return { els, facts };
})()`;

// The page's facts for each element, with the nearest kept node of it.
async function found(cdp, nearestKept) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: FIND, objectGroup: 'text-headings' });
  if (!result.objectId) return [];
  try {
    const get = (name) => cdp.send('Runtime.callFunctionOn', {
      objectId: result.objectId, functionDeclaration: `function () { return this.${name}; }`,
      ...(name === 'facts' ? { returnByValue: true } : {}), objectGroup: 'text-headings',
    });
    const facts = (await get('facts')).result.value;
    const { result: els } = await get('els');
    const { result: props } = await cdp.send('Runtime.getProperties', { objectId: els.objectId, ownProperties: true });
    const out = [];
    for (const p of props.filter((q) => /^\d+$/.test(q.name))) {
      const { node } = await cdp.send('DOM.describeNode', { objectId: p.value.objectId });
      out.push({ ...facts[Number(p.name)], backend: node.backendNodeId, node: nearestKept(node.backendNodeId) });
    }
    return out;
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'text-headings' });
  }
}

const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quote = (s) => `"${s}"`;

export async function textHeadings(page, cdp, nearestKept, root, model, notes) {
  let facts = [];
  try {
    facts = await found(cdp, nearestKept);
  } catch (e) {
    notes.push(`Text pass could not read the page: ${String(e.message).split(/\r?\n/)[0]}`);
  }

  // Icon words read in a name: a heading or label is 2.4.6, any other
  // name is our rule.
  const seen = new Set();
  for (const f of facts.filter((x) => x.kind === 'icon' && x.node)) {
    const n = f.node;
    const mark = `${n.id}|${f.word}`;
    if (seen.has(mark) || !new RegExp(`(^|\\s)${rx(f.word)}(\\s|$)`).test(n.name)) continue;
    const rest = n.name.replace(new RegExp(`(^|\\s)${rx(f.word)}(?=\\s|$)`, 'g'), ' ').replace(/\s+/g, ' ').trim();
    // A name that is only a plain word ("delete") reads well enough.
    if (!rest && !f.word.includes('_')) continue;
    seen.add(mark);
    const label = LABELS.has(n.role);
    addProposal(model, n, {
      sc: label ? '2.4.6' : OUR_RULE,
      rule: label ? 'text-icon-label' : 'text-icon-name',
      text: '',
      say: `The ${n.role} name ${quote(n.name)} includes the icon word ${quote(f.word)}, which a screen reader reads aloud`,
      propose: rest ? `Name it ${quote(rest)} and hide the icon (aria-hidden="true")`
        : f.title ? `Name it ${quote(f.title)}`
        : f.heading ? `Name it from the nearby heading ${quote(f.heading)}` : null,
    });
  }

  // A focusable box (tabindex, no role) with no name.
  for (const f of facts.filter((x) => x.kind === 'box')) {
    const n = f.node;
    if (!n || n.id !== `n${f.backend}` || n.role !== 'generic' || n.name) continue;
    addProposal(model, n, {
      sc: OUR_RULE,
      rule: 'text-focus-nameless',
      text: f.title || f.text || '',
      say: 'A box that takes focus has no name: a screen reader reads it as plain text with no role',
      propose: f.title ? `Name it ${quote(f.title)}`
        : f.text ? `Name it ${quote(f.text)} (the visible text)`
        : f.heading ? `Name it from the nearby heading ${quote(f.heading)}` : null,
    });
  }

  // A card read part by part, with no name for the whole.
  for (const f of facts.filter((x) => x.kind === 'card' && x.node)) {
    addProposal(model, f.node, {
      sc: OUR_RULE,
      rule: 'text-card-group',
      text: '',
      say: 'A card is read part by part with no name for the whole: a screen reader user does not hear where it starts or what it is',
      propose: `Make it a group named from its ${f.heading ? `heading (role="group", aria-labelledby the heading; for example ${quote(f.heading)})` : `text (role="group", aria-label)`}`,
    });
  }

  // Empty headings, repeated labels in one form, a main with no heading.
  walk(root, (n) => {
    if (n.role === 'heading' && !n.name && !n.text) {
      addProposal(model, n, {
        sc: '2.4.6', rule: 'text-empty-heading', text: `level ${n.h ?? ''}`,
        say: `A level ${n.h ?? '?'} heading has no words: a screen reader announces it and reads nothing`,
        propose: 'Put the section title in it, or remove it',
      });
    }
    if (n.role === 'form') {
      const groups = new Map();
      const collect = (x) => {
        for (const c of x.c) {
          if (c.role === 'form') continue;
          if (FIELDS.has(c.role) && c.name) {
            const k = c.name.toLowerCase().replace(/\s+/g, ' ');
            (groups.get(k) ?? groups.set(k, []).get(k)).push(c);
          }
          collect(c);
        }
      };
      collect(n);
      for (const same of groups.values()) {
        if (same.length < 2) continue;
        for (const c of same) {
          addProposal(model, c, {
            sc: '2.4.6', rule: 'text-label-same', text: '',
            say: `Fields in one form share the label ${quote(c.name)}: a screen reader user cannot tell them apart`,
            propose: `Give each a label that tells it apart from the others (for example with the group or section it is in)`,
          });
        }
      }
    }
  });
  let main;
  walk(root, (n) => { if (!main && n.lm === 'main') main = n; });
  if (main && (main.c.length || main.text)) {
    let heading = false;
    walk(main, (n) => { if (n.role === 'heading') heading = true; });
    if (!heading) {
      const title = await page.title().catch(() => '');
      addProposal(model, main, {
        sc: '2.4.6', rule: 'text-main-no-heading', text: '',
        say: 'The main area has no heading: a screen reader user cannot jump to it by heading or learn what it is about',
        propose: title ? `Add a heading with the page title, ${quote(title)}` : 'Add a heading that names the page',
      });
    }
  }
}
