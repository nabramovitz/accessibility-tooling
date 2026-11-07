# reader-path

Opens one web page in headless Chromium and writes a model of what a
screen reader user gets from it. It also writes a review page that shows
the model.

The model comes from the browser's accessibility tree (roles, accessible
names, descriptions, states, headings, landmarks), the Tab order, and the
axe-core rules (gaps and color contrast values). Each gap has a WCAG 2.2
success criterion and its level.

## Install

Node.js 22 or later.

```
npm install
npx playwright install chromium
```

## Use

```
npx reader-path <url> [--out <dir>] [--storage-state <file>]
  [--ignore-https-errors] [--wait-for <selector>] [--settle <ms>]
```

It writes `<dir>/model.json` and `<dir>/index.html`. Open `index.html`
in a browser. A path to a local file also works for `<url>`.

- `--out <dir>`: the output directory. The default is `reader-path-out`
  in the current directory. The files hold the page's text, and for a
  signed-in page that is the signed-in content: do not run the command
  inside another repository, or pass `--out` to a directory outside it.
- `--storage-state <file>`: a Playwright storage state file, for a page
  that needs a sign-in.
- `--ignore-https-errors`: accept a certificate that the browser does
  not trust, for example a self-signed one on a development stack. Off
  by default; use it only for a site you know.
- `--wait-for <selector>`: after the load event, wait until an element
  that matches the CSS selector is on the page. For a single-page app
  that draws its content late.
- `--settle <ms>`: after the load event (and `--wait-for`), wait this
  many milliseconds more.

The model has the requested `url`, the `finalUrl` after redirects and
scripts, and the HTTP `status` of the main response. `finalUrl` has no
query and no fragment, as a redirect can carry a sign-in token there.
When the final URL is not the requested one (query and fragment left
out), a run note says so. A sign-in page in place of the page you asked for shows up there.

Run notes also say when axe-core could not be added to a frame or did
not run; the tree and the Tab order are still written.

`npm test` runs the tests.

## Limits

- One page for each run.
- Chromium only. No other browser and no screen reader is used.
- No actions: nothing is clicked or typed, so content that appears after
  an action is not in the model.
- No events in time: live region messages are not recorded.
- No frames: the content of an iframe is not read. A run note says so.
- The Tab walk stops at 500 Tab stops; a run note says so. Focus that
  does not move, or that goes round a loop without coming back to the
  start, is a 2.1.2 gap.
- Gaps come from the axe-core rules only. A rule cannot judge whether a
  name or a text is a good one.
- The results need a person to confirm them.
