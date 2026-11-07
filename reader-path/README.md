# reader-path

Opens one web page in headless Chromium and writes a model of what a
screen reader user gets from it. It also writes a review page that shows
the model.

The model comes from the browser's accessibility tree (roles, accessible
names, descriptions, states, headings, landmarks), the Tab order, and the
axe-core rules (gaps and color contrast values). Each gap has a WCAG 2.2
success criterion and its level.

## Install

With Bun (1.4.4 is the tested version):

```
bun install
bunx playwright install chromium
```

Or with Node.js 22 or later and npm:

```
npm install
npx playwright install chromium
```

`.tool-versions` at the top of the repository names the tested versions
of Bun and Node.js for asdf.

It works on Linux, macOS and Windows, with no POSIX shell needed. The
same commands work in sh, cmd and PowerShell. The workflow in
`.github/workflows/reader-path.yml` runs the tests on all three, with
Bun and with Node.js alone. In PowerShell, if the execution policy
stops `npm` or `npx`, run `npm.cmd` and `npx.cmd`.

## Use

In this directory, with Bun:

```
bun cli.js <url> [--out <dir>] [--storage-state <file>]
  [--ignore-https-errors] [--wait-for <selector>] [--settle <ms>]
```

Or with Node.js: `node cli.js <url> ...`. Under Node.js the command
runs itself again with Bun when `bun --version` works, and goes on
with Node.js when it does not. `bun cli.js` always runs with Bun. On
Windows, Bun is looked for in the current directory before the PATH.

On Linux and macOS, `./cli.js <url> ...` also works (it starts with
Node.js). On Windows, `.\cli.js` does not run on its own: use
`bun cli.js` or `node cli.js`, or the `reader-path` command that
`npm install -g .` or `npm link` puts on the PATH.

It writes `<dir>/model.json` and `<dir>/index.html`. Open `index.html`
in a browser. A path to a local file also works for `<url>`, also a
Windows path such as `C:\pages\page.html`.

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
query, no fragment, no user name and no password, as a redirect can
carry a sign-in token there.
When the final URL is not the requested one (query and fragment left
out), a run note says so. A sign-in page in place of the page you asked for shows up there.

Run notes also say when axe-core could not be added to a frame or did
not run; the tree and the Tab order are still written.

## OpenACR draft

```
bun cli.js acr <model.json>... [--base <yaml>] --out <file.yaml>
```

This reads the `model.json` of one or more pages (made by this
version or later: it needs the `checks` table) and writes a draft
OpenACR report in YAML, with one row for each WCAG 2.2 criterion and
each Section 508 chapter 3 provision (302.1 to 302.9). Only the `web`
component (`none` for chapter 3) is written. The rows come from the
catalog in `catalog/`, a copy of the GSA/openacr catalog (see
`catalog/NOTICE`).

The tool writes three levels. It never proposes a level that its
checks do not support; when in doubt it writes `not-evaluated`.

- `supports`: a check passed, every page has a result for the row (a
  pass, or a rule with nothing to check), and no check failed or needs
  review on any page. 4.1.1 is always `supports`; the note links the
  W3C texts that say why.
- `partially-supports`: a check failed on at least one page. The note
  names the page and the gap.
- `not-evaluated`: anything else. The note says what a person must
  look at, after `Needs a person:`: no automated check covers the row;
  a page has no result for it (for example, axe-core did not run
  there); axe-core could not decide (also when other rules passed); or
  the rules found nothing to check, so a person says if the row is not
  applicable.

The tool never writes `does-not-support` (whether a gap hits "the
majority of product functionality" is for a person to say) and never
writes `not-applicable` (an axe-core rule with nothing to check does
not show that the criterion does not apply).

A chapter 3 row (302.x) takes the worst level of its related WCAG rows,
in this order: `does-not-support`, `partially-supports`,
`not-evaluated`, `supports`, `not-applicable`. The related rows are the
ones in the report, base rows included, so a chapter 3 row can be
`does-not-support` or `not-applicable` only when a person wrote that
for its WCAG rows.

Notes are Markdown, as OpenACR renders them: each line is a paragraph,
and Markdown punctuation in a title from the page is escaped. A local
page (a `file:` URL) is named by its file name only.

A person confirms every row before the report is published. A report
cannot be published with `not-evaluated` at level A or AA; the command
prints how many such rows remain, how many rows it proposed as
`supports` from automated rules only, and each model file where
axe-core did not run on all of the page.

- `--out <file.yaml>`: required.
- `--base <yaml>`: a report that a person owns. Its rows and its
  top-level fields are kept as they are, except `catalog` and
  `report_date`, which the tool always sets. The tool only fills the
  rows the base does not have. The base is read as plain YAML (an
  unquoted date stays text), and every `num` is written as a string.
  When a base row says `supports` or
  `not-applicable` and the new evidence says `partially-supports`, the
  command prints that row number and both levels. Chapters that the
  tool does not write (hardware, software, support documentation) are
  kept from the base.

Without `--base`, `title`, `product.name` and `author.email` are
placeholders to fill in.

## Tests

```
bun run test
```

Or `npm test`. Both run `test/run.mjs`, which runs the tests with
`bun test` when `bun --version` works, else with `node --test`. A
plain `bun test` also works, but stops a test after 5 seconds;
`bun run test` gives each test 30.

## Limits

- One page for each run.
- Chromium only. No other browser and no screen reader is used.
- No actions: nothing is clicked or typed, so content that appears after
  an action is not in the model.
- No events in time: live region messages are not recorded.
- No frames: the content of an iframe is not read. A run note says so.
- The Tab walk stops at 500 Tab stops; a run note says so. Focus that
  does not move, or that goes round a loop without coming back to the
  start, is a 2.1.2 gap. A walk that stops at 500, or that passes an
  iframe whose Tab stops it does not read, puts 2.1.2 in review.
- Gaps come from the axe-core rules only. A rule cannot judge whether a
  name or a text is a good one.
- The results need a person to confirm them.
