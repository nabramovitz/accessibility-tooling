// Purpose of fields and regions (1.3.6, AAA) and media counts (the 1.2.x
// and 1.4.2 rows). One script in the page reads the autocomplete
// attributes, input types and element counts; the findings are proposals
// for a person, never fails. Media counts go in model.media and, when the
// page has any, a run note; acr.js writes the run-wide line.
import { addProposal } from './proposals.js';

// Hosts of embedded players. An iframe from one of these is media.
export const MEDIA_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'wistia.com', 'wistia.net', 'soundcloud.com', 'spotify.com', 'twitch.tv'];

const MARK = 'data-reader-path-purpose';

// Runs in the page. Marks the fields and regions it reports with MARK =
// their index in the list it returns (fields first, then regions).
const READ = `((mark, hosts) => {
  const clean = (s) => String(s || '').toLowerCase().replace(/[_.\\-*:]+/g, ' ').replace(/\\s+/g, ' ').trim();
  // What the field is for: [kind, autocomplete token]. A type decides first,
  // then the label, name, id, placeholder. "name" alone, or with first,
  // last, full, your, is a person's name; "Application name" is not.
  const purpose = (e) => {
    const type = (e.getAttribute('type') || 'text').toLowerCase();
    if (type === 'email') return ['email', 'email'];
    if (type === 'tel') return ['phone', 'tel'];
    if (type === 'password') return ['password', 'current-password'];
    if (e.tagName === 'SELECT' || !['text', 'search', 'url', ''].includes(type)) return null;
    const said = [...(e.labels || [])].map((l) => l.textContent).concat(e.getAttribute('aria-label'), e.getAttribute('placeholder'), e.name, e.id).map(clean).filter(Boolean);
    const has = (re) => said.some((s) => re.test(s));
    if (has(/\\b(user ?name|username|user id|login)\\b/)) return ['user name', 'username'];
    if (has(/\\be ?mail\\b/)) return ['email', 'email'];
    if (has(/\\b(phone|telephone|mobile)\\b/)) return ['phone', 'tel'];
    if (has(/\\b(first|given) name\\b/)) return ['first name', 'given-name'];
    if (has(/\\b(last|family|sur) name\\b/)) return ['last name', 'family-name'];
    if (has(/^(your |full )?name$/)) return ['name', 'name'];
    return null;
  };
  const out = [];
  for (const e of document.querySelectorAll('input, textarea, select')) {
    const type = (e.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || e.disabled) continue;
    const ac = (e.getAttribute('autocomplete') || '').trim().toLowerCase();
    if (ac && ac !== 'off') continue;
    const p = purpose(e);
    if (!p) continue;
    const label = [...(e.labels || [])].map((l) => l.textContent.trim()).join(' ') || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.name || e.id || '';
    out.push({ kind: 'field', what: p[0], token: p[1], label: label.slice(0, 60) });
    e.setAttribute(mark, String(out.length - 1));
  }
  // A div with no role whose class or id is the name of a landmark
  // (header, nav, sidebar, footer, search, main), outside any landmark.
  const NAME = /^((site|page|top|side|main)-)?(header|footer|nav|navbar|navigation|sidebar|search|banner)$|^main(-content)?$|^(sidenav|topnav|mainnav)$/;
  const LM = 'header, nav, main, aside, footer, form, search, [role=banner], [role=navigation], [role=main], [role=complementary], [role=contentinfo], [role=region], [role=search], [role=form]';
  const hit = (e) => e.tagName === 'DIV' && !e.hasAttribute('role') && [...e.classList, e.id].some((t) => NAME.test(String(t).toLowerCase()));
  for (const e of document.body.querySelectorAll('div')) {
    if (!hit(e) || e.parentElement.closest(LM)) continue;
    let up = false;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (hit(p)) up = true;
    if (up) continue;
    const t = [...e.classList, e.id].find((x) => NAME.test(String(x).toLowerCase()));
    out.push({ kind: 'region', what: 'div' + (e.id === t ? '#' : '.') + t, label: '' });
    e.setAttribute(mark, String(out.length - 1));
  }
  const host = (src) => { try { return new URL(src, location.href).hostname.toLowerCase(); } catch { return ''; } };
  const media = {
    video: document.querySelectorAll('video').length,
    audio: document.querySelectorAll('audio').length,
    object: document.querySelectorAll('object').length,
    embed: document.querySelectorAll('embed').length,
    iframe: [...document.querySelectorAll('iframe')].filter((f) => { const h = host(f.getAttribute('src') || ''); return hosts.some((x) => h === x || h.endsWith('.' + x)); }).length,
    autoplay: document.querySelectorAll('video[autoplay], audio[autoplay]').length,
  };
  return { found: out, media };
})`;

// The kept node of the element with mark i, and the mark removed.
async function take(cdp, nearestKept, i) {
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const e = document.querySelector('[${MARK}="${i}"]'); if (e) e.removeAttribute('${MARK}'); return e; })()`,
    objectGroup: 'purpose',
  });
  if (!result.objectId) return undefined;
  const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
  return nearestKept(node.backendNodeId);
}

// The words of a media count, for a note and the row line.
export const mediaWords = (m) => [
  m.video && `${m.video} video`, m.audio && `${m.audio} audio`, m.object && `${m.object} object`,
  m.embed && `${m.embed} embed`, m.iframe && `${m.iframe} media iframe`, m.autoplay && `${m.autoplay} autoplay`,
].filter(Boolean).join(', ');

export async function textPurpose(page, cdp, nearestKept, root, model, notes) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `${READ}(${JSON.stringify(MARK)}, ${JSON.stringify(MEDIA_HOSTS)})`, returnByValue: true });
  const { found = [], media } = result.value || {};
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    const node = (await take(cdp, nearestKept, i)) ?? root;
    if (f.kind === 'field') {
      addProposal(model, node, {
        sc: '1.3.6', rule: 'text-purpose-field', text: f.what,
        say: `Field "${f.label}" asks for a person's own data (${f.what}) and has no autocomplete`,
        propose: `autocomplete="${f.token}"`,
      });
    } else {
      addProposal(model, node, {
        sc: '1.3.6', rule: 'text-purpose-region', text: f.what,
        say: `${f.what} is named like a landmark but has no landmark role`,
        propose: 'Use the landmark element or a role',
      });
    }
  }
  if (media) {
    model.media = media;
    const words = mediaWords(media);
    if (words) notes.push(`Media elements: ${words}`);
  }
}
