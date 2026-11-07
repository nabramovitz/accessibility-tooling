export const RUN_ONLY = {
  type: 'tag',
  values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'wcag2aaa', 'wcag21aaa'],
};

const LEVEL = {
  wcag2a: 'A', wcag21a: 'A',
  wcag2aa: 'AA', wcag21aa: 'AA', wcag22aa: 'AA',
  wcag2aaa: 'AAA', wcag21aaa: 'AAA',
};

const ROW = {
  'button-name': 'name', 'link-name': 'name', 'image-alt': 'name', 'input-button-name': 'name',
  label: 'name', 'aria-input-field-name': 'name', 'aria-toggle-field-name': 'name',
  'document-title': 'name', 'aria-roles': 'role', 'aria-allowed-role': 'role',
  'aria-valid-attr-value': 'state',
};

export function axeToGaps(results) {
  const gaps = [];
  for (const rule of results.violations || []) {
    const level = rule.tags.map((t) => LEVEL[t]).find(Boolean);
    const scs = rule.tags.map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t)).filter(Boolean)
      .map((m) => `${m[1]}.${m[2]}.${m[3]}`);
    for (const node of rule.nodes) {
      for (const sc of scs) {
        const gap = { target: node.target, sc, level, why: node.failureSummary, goal: rule.help };
        if (ROW[rule.id]) gap.row = ROW[rule.id];
        gaps.push(gap);
      }
    }
  }
  return gaps;
}

// The rule ids of each criterion, by result. A rule with no criterion tag is
// left out; a rule with two criterion tags is in both.
export function axeToChecks(results) {
  const checks = {};
  const lists = { passes: 'pass', violations: 'fail', incomplete: 'review', inapplicable: 'na' };
  for (const [key, list] of Object.entries(lists)) {
    for (const rule of results[key] || []) {
      for (const t of rule.tags) {
        const m = /^wcag(\d)(\d)(\d+)$/.exec(t);
        if (m) addCheck(checks, `${m[1]}.${m[2]}.${m[3]}`, list, rule.id);
      }
    }
  }
  return checks;
}

// Adds a rule id to a list of a criterion, once.
export function addCheck(checks, sc, list, id) {
  const entry = (checks[sc] ||= { pass: [], fail: [], review: [], na: [] });
  if (!entry[list].includes(id)) entry[list].push(id);
}

export function axeContrast(results) {
  const out = [];
  for (const list of [results.violations, results.passes, results.incomplete]) {
    for (const rule of list || []) {
      if (rule.id !== 'color-contrast') continue;
      for (const node of rule.nodes) {
        const check = (node.any || []).find((c) => c.data) || node.any?.[0] || {};
        const d = check.data || {};
        if (typeof d.contrastRatio === 'number') {
          out.push({ target: node.target, ratio: d.contrastRatio, fg: d.fgColor, bg: d.bgColor });
        } else {
          out.push({ target: node.target, ratio: null, note: check.message });
        }
      }
    }
  }
  return out;
}
