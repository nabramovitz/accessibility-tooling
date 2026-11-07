import { readFileSync } from 'node:fs';

const TEMPLATE = readFileSync(new URL('../review/template.html', import.meta.url), 'utf8');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The whole review page for one model. The JSON sits in a data block;
// every "<" is written as < so page text cannot end the block.
export function render(model) {
  const fill = {
    TITLE: esc(model.title || model.url || 'untitled page'),
    URL: esc(model.url || ''),
    GENERATED: esc(model.generated || ''),
    MODEL: JSON.stringify(model).replace(/</g, '\\u003c'),
  };
  return TEMPLATE.replace(/\{\{(TITLE|URL|GENERATED|MODEL)\}\}/g, (_, k) => fill[k]);
}
