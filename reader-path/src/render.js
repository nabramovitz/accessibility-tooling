import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEMPLATE = readFileSync(new URL('../review/template.html', import.meta.url), 'utf8');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LOAD = `<section class="load" aria-labelledby="loadh"><h2 id="loadh">Open a model</h2>
    <p id="loadmsg" role="status">No model loaded. Choose the model.json file that reader-path wrote, or drop it on this box.</p>
    <p><label for="file">Model file (model.json)</label><br><input type="file" id="file" accept=".json,application/json"></p>
    <p class="mut">The file is read in this browser. Nothing is uploaded.</p>
  </section>`;

const fill = (parts) => TEMPLATE.replace(/\{\{(TITLE|META|MODELBLOCK|LOAD)\}\}/g, (_, k) => parts[k]);

// The whole review page for one model. The JSON sits in a data block;
// every "<" is written as < so page text cannot end the block.
export function render(model) {
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  return fill({
    TITLE: esc(model.title || model.url || 'untitled page'),
    META: `${esc(model.url || '')} · generated ${esc(model.generated || '')}`,
    MODELBLOCK: `<script type="application/json" id="model">${json}</script>`,
    LOAD: '',
  });
}

// The same page with no model in it: it waits for a model.json that the
// person chooses or drops, and reads it with FileReader.
export function renderViewer() {
  return fill({ TITLE: 'no model loaded', META: '', MODELBLOCK: '', LOAD });
}

// `node src/render.js` writes viewer/index.html.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../viewer/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('index.html', dir), renderViewer());
}
