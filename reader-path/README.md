# reader-path

Opens one web page in headless Chromium and writes a model of what a
screen reader user gets from it. It also writes a review page that shows
the model.

The model comes from the browser's accessibility tree (roles, accessible
names, descriptions, states, headings, landmarks), the Tab order, and the
axe-core rules (gaps and color contrast values). Each gap has a WCAG 2.2
success criterion and its level.

## Install

```
npm install
npx playwright install chromium
```

## Use

```
npx reader-path <url> [--out <dir>] [--storage-state <file>]
```

It writes `<dir>/model.json` and `<dir>/index.html` (default directory:
`reader-path-out`). Open `index.html` in a browser. A path to a local
file also works for `<url>`. `--storage-state` is a Playwright storage
state file, for a page that needs a sign-in.

`npm test` runs the tests.

## Limits

- One page for each run.
- Chromium only. No other browser and no screen reader is used.
- No actions: nothing is clicked or typed, so content that appears after
  an action is not in the model.
- No events in time: live region messages are not recorded.
- No frames: the content of an iframe is not read. A run note says so.
- Gaps come from the axe-core rules only. A rule cannot judge whether a
  name or a text is a good one.
- The results need a person to confirm them.
