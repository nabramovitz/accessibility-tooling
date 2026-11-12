// Language and words: parts in another language (3.1.2), reading level
// (3.1.5) and abbreviations with no expansion (3.1.4, with 3.1.3 and 3.1.6
// in the same family). Each is a proposal for a person, never a fail. One
// small script reads the text runs, their lang and the abbr elements;
// the rest runs on that data.
import { walk } from './generate.js';
import { addProposal } from './proposals.js';

const MAX_RUNS = 5000;
const GRADE_LIMIT = 9;
const MIN_WORDS_FOR_GRADE = 100;
const MIN_PART_WORDS = 3;

// The page script reads text, it does not change the page. A run is the
// text a single element holds itself. ctl: inside a control or a link
// (a name, not running text). main: inside the main landmark.
function collect(max) {
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|CODE|PRE|KBD|SAMP|TEXTAREA|SVG)$/;
  const CTL = 'a,button,select,option,label,summary,legend,[role=button],[role=tab],[role=menuitem],[role=link],[role=option]';
  const runs = [];
  const abbrs = [];
  const visit = (el) => {
    if (runs.length >= max || SKIP.test(el.tagName.toUpperCase())) return;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return;
    if (el.getAttribute('aria-hidden') === 'true') return;
    let text = '';
    for (const c of el.childNodes) if (c.nodeType === 3) text += ` ${c.nodeValue}`;
    text = text.replace(/\s+/g, ' ').trim();
    if (el.tagName.toUpperCase() === 'ABBR' && el.getAttribute('title')) abbrs.push({ text, title: el.getAttribute('title') });
    if (text) {
      const l = el.closest('[lang]');
      runs.push({
        text: text.slice(0, 2000),
        lang: l && l !== document.documentElement ? l.getAttribute('lang') : '',
        ctl: !!el.closest(CTL),
        main: !!el.closest('main,[role=main]'),
      });
    }
    for (const c of el.children) visit(c);
    if (el.shadowRoot) for (const c of el.shadowRoot.children) visit(c);
  };
  visit(document.body);
  return { lang: document.documentElement.getAttribute('lang') || '', runs, abbrs };
}

const SCRIPTS = ['Latin', 'Greek', 'Cyrillic', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Arabic', 'Hebrew', 'Devanagari', 'Thai'];
const SCRIPT_RE = Object.fromEntries(SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'u')]));
// Which scripts a page language is written in.
const LANG_SCRIPTS = {
  el: ['Greek'], ru: ['Cyrillic'], uk: ['Cyrillic'], bg: ['Cyrillic'], sr: ['Cyrillic', 'Latin'],
  ja: ['Han', 'Hiragana', 'Katakana'], zh: ['Han'], ko: ['Hangul', 'Han'],
  ar: ['Arabic'], fa: ['Arabic'], ur: ['Arabic'], he: ['Hebrew'], hi: ['Devanagari'], th: ['Thai'],
};

const letters = (text, script) => (text.match(new RegExp(`\\p{Script=${script}}`, 'gu')) || []).length;
const dominantScript = (text) => {
  let best = null;
  let most = 0;
  for (const s of SCRIPTS) { const n = letters(text, s); if (n > most) { best = s; most = n; } }
  return best;
};
// The scripts the page's own language is written in. A page with no lang,
// or one this table does not know, is read as the script most of its
// letters are in.
function pageScripts(lang, runs) {
  const known = LANG_SCRIPTS[String(lang).toLowerCase().split('-')[0]];
  if (known) return known;
  if (/^(en|fr|de|es|it|pt|nl|sv|da|no|nb|pl|cs|tr|fi|ro|hu|id)\b/i.test(lang)) return ['Latin'];
  return [dominantScript(runs.map((r) => r.text).join(' ')) || 'Latin'];
}

const wordCount = (t) => t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

// Stretches of three words or more in a script the page does not use.
// A stretch is the letters of one script with the spaces and marks between.
export function foreignStretches(text, pageScript) {
  const allowed = [].concat(pageScript);
  const out = [];
  for (const s of SCRIPTS) {
    if (allowed.includes(s)) continue;
    const re = new RegExp(`\\p{Script=${s}}[\\p{Script=${s}}\\p{M}\\p{P}\\s]*\\p{Script=${s}}|\\p{Script=${s}}`, 'gu');
    for (const m of text.matchAll(re)) {
      if (wordCount(m[0]) >= MIN_PART_WORDS) out.push({ script: s, text: m[0].trim() });
    }
  }
  return out;
}

// Syllables of an English word by rule: groups of vowels (y counts), less a
// silent final e (not "le") and a final "ed" not after t or d; at
// least one. Irregular words ("area") are off by one; the grade copes.
export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (n > 1 && (/[^aeiouyl]e$/.test(w) || /[^td]ed$/.test(w))) n -= 1;
  return Math.max(1, n);
}

// Flesch-Kincaid grade: 0.39 * words/sentences + 11.8 * syllables/words
// - 15.59. Sentences end at . ! ? (e.g., i.e., etc. do not count). A run
// without an end mark counts as one sentence. Null below 100 words:
// the measure is not steady on less.
export function readingGrade(text) {
  const clean = text.replace(/\b(e\.g|i\.e|etc|vs|approx)\./gi, '$1');
  const words = clean.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  if (words.length < MIN_WORDS_FOR_GRADE) return null;
  const sentences = clean.split(/[.!?]+(?:\s|$)/).filter((s) => /[A-Za-z]/.test(s)).length || 1;
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

// Words that need no expansion: everyone knows them.
const COMMON = new Set(['OK', 'ID', 'AM', 'PM', 'NA']);
const SMALL = new Set(['of', 'the', 'and', 'for', 'to', 'in', 'a', 'an', 'on', 'as', 'by', 'or']);
// Does this phrase spell the acronym? Its first letter is the first
// word's initial, the others follow in order in the words ("Secure
// Shell" for SSH), and there are not many more words than letters.
function spells(a, phrase) {
  const ws = phrase.filter((w) => !SMALL.has(w.toLowerCase()));
  if (ws.length < 2 || ws.length > a.length + 1 || ws[0][0].toLowerCase() !== a[0].toLowerCase()) return false;
  const rest = ws.join('').toLowerCase();
  let at = 0;
  for (const c of a.toLowerCase()) { at = rest.indexOf(c, at); if (at < 0) return false; at += 1; }
  return true;
}
const wordsOf = (s) => s.match(/[A-Za-z][A-Za-z'’-]*/g) || [];

// Words in capitals (2 to 6 letters) with no abbr element and no
// expansion in brackets beside them ("Cloud Foundry (CF)" or "CF (Cloud
// Foundry)"). A run with no lower-case letter is a heading in capitals,
// not a list of abbreviations.
export function acronyms(runs, abbrs) {
  const text = runs.filter((r) => /[a-z]/.test(r.text)).map((r) => r.text).join(' \n ');
  const found = [...new Set(text.match(/\b[A-Z]{2,6}\b/g) || [])].filter((w) => !COMMON.has(w));
  const covered = new Set(abbrs.flatMap((a) => wordsOf(a.text)));
  const expanded = (a) => {
    for (const m of text.matchAll(new RegExp(`\\(${a}\\)`, 'g'))) {
      const before = wordsOf(text.slice(Math.max(0, m.index - 120), m.index)).slice(-10);
      for (let i = 0; i < before.length; i++) if (spells(a, before.slice(i))) return true;
    }
    for (const m of text.matchAll(new RegExp(`\\b${a}\\s*\\(([^)]{3,120})\\)`, 'g'))) {
      if (spells(a, wordsOf(m[1]))) return true;
    }
    return false;
  };
  return found.filter((a) => !covered.has(a) && !expanded(a));
}

export async function textLanguage(page, root, model, notes) {
  let data;
  try {
    data = await page.evaluate(collect, MAX_RUNS);
  } catch (e) {
    notes.push(`Text checks did not run: ${String(e.message).split(/\r?\n/)[0].slice(0, 80)}`);
    return;
  }
  const { lang, runs, abbrs } = data;
  const mainNode = (() => { let m = root; walk(root, (n) => { if (n.lm === 'main' && m === root) m = n; }); return m; })();
  const placeOf = (t) => {
    const head = t.slice(0, 40);
    let at = null;
    walk(root, (n) => { if (!at && n.text && n.text.includes(head)) at = n; });
    return at ?? root;
  };

  // 3.1.2
  const scripts = pageScripts(lang, runs);
  for (const r of runs) {
    if (r.ctl || r.lang) continue;
    for (const s of foreignStretches(r.text, scripts)) {
      const shown = s.text.length > 60 ? `${s.text.slice(0, 57)}...` : s.text;
      addProposal(model, placeOf(r.text), {
        sc: '3.1.2',
        rule: 'text-language-part',
        text: s.text,
        say: `Text in ${s.script} with no lang on it, on a page in ${lang || scripts[0]}: "${shown}"`,
        propose: 'Put lang on the element that holds the text, or mark this fine',
      });
    }
  }

  // 3.1.5: the prose of main (runs of six words or more; not names)
  if (!lang || /^en\b/i.test(lang)) {
    const prose = runs.filter((r) => !r.ctl && r.main && wordCount(r.text) >= 6)
      .map((r) => (/[.!?:;]$/.test(r.text) ? r.text : `${r.text}.`)).join(' ');
    const grade = readingGrade(prose);
    if (grade !== null && grade > GRADE_LIMIT) {
      addProposal(model, mainNode, {
        sc: '3.1.5',
        rule: 'text-reading-level',
        text: '',
        say: `The main text reads at grade ${Math.round(grade)} (Flesch-Kincaid), above lower secondary (grade ${GRADE_LIMIT})`,
        propose: 'Offer a plainer summary, or mark this fine if readers are experts',
      });
    }
  }

  // 3.1.3, 3.1.4, 3.1.6: one proposal for the page
  const words = acronyms(runs, abbrs);
  if (words.length) {
    addProposal(model, mainNode, {
      sc: '3.1.4',
      rule: 'text-abbreviation',
      text: '',
      say: `Abbreviations with no expansion on the page (also unusual words and pronunciation, 3.1.3 and 3.1.6): ${words.join(', ')}`,
      propose: 'Give each its expansion at first use or in an abbr element, or mark this fine',
    });
  }
}
