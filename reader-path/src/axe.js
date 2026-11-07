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
