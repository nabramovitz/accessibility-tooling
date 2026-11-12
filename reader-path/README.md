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
  [--ignore-https-errors] [--wait-for <selector>] [--idle <ms>]
  [--settle <ms>] [--no-views]
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
- `--idle <ms>`: after the load event (and `--wait-for`), wait until
  the page has had no request in flight for this many milliseconds.
  The default is 500, so a page that gets its content by requests is
  read after they end. `--idle 0` reads the page at the load event.
  After 30 seconds the page is read as it is, with the note
  `Page still loading`. Streams (EventSource, WebSocket) do not count.
- `--settle <ms>`: after that, wait this many milliseconds more. For
  content that comes by a timer, not by a request.
- `--no-views`: read the page in the default view only, with no focus
  measures (see "Views" and "Focus measures").

The model has the requested `url`, the `finalUrl` after redirects and
scripts, and the HTTP `status` of the main response. `finalUrl` has no
query, no fragment, no user name and no password, as a redirect can
carry a sign-in token there.
When the final URL is not the requested one (query and fragment left
out), a run note says so. A sign-in page in place of the page you asked for shows up there.

Run notes also say when axe-core could not be added to a frame or did
not run; the tree and the Tab order are still written. A `main`
landmark with no content after the settle time gets the note
`Page content empty`: an empty route, a page behind a gate, or a page
that draws its content late (see `--wait-for` and `--settle`).

The model records `axeVersion`, the axe-core version that read the
page. The report names the axe-core version of every model; a model
written before this field existed is named with the installed version.

Each command takes only its own options: the page command the ones
above, `crawl` those and `--max`, `--urls`, `--add` and `--jobs`, and `acr`
`--out` and `--base`. An option from another command stops the
command with a usage error.

## Viewer

`viewer/index.html` is the review page with no model in it. Open it
in a browser (from a file or from a web server), choose a `model.json`
that reader-path wrote, or drop it on the box. The page shows the
model the same way the generated `index.html` does. Nothing is
uploaded: the file is read in the browser and the page makes no
requests. To refresh, run reader-path again and choose the new file.

The viewer is published at
https://nabramovitz.github.io/accessibility-tooling/ from `main`.

Until a file is chosen the page says "No model loaded". A file that
is not a reader path model gets a plain message, and the page stays
open for another file.

`viewer/index.html` is built from `review/template.html`, the same
template as the generated page. After a change to the template, run
`node src/render.js` and commit the new file; a test fails when the
two differ.

## Views

After the tree, the axe-core rules and the Tab walk, the page is
measured in five more views, on the same load:

- `narrow`: a window 320 px wide (1.4.10 Reflow).
- `zoom`: a window 640 px wide, the layout of the default window
  (1280 px) at 200 % zoom (1.4.4 Resize Text).
- `spacing`: the WCAG text spacing (line height 1.5, paragraph spacing
  2 em, letter spacing 0.12 em, word spacing 0.16 em) (1.4.12).
- `dark`: the dark colour scheme asked (`prefers-color-scheme: dark`) at
  the default window (1.4.3 and 1.4.6 contrast). Only the axe-core rules
  `color-contrast` and `color-contrast-enhanced` run, and their result
  is the check `view-dark` of both rows. A gap says "In dark mode:" and
  then the colours and the ratio as axe-core gives them. A page whose
  colours (text, background and border of the root, the body and the
  first 200 elements) do not change in dark mode has no dark mode: a run
  note says "The page has no dark mode" and there is no check. The
  colour scheme is put back after the view. axe-core's
  `color-contrast-enhanced` passes text under 4.5 : 1 (it leaves that
  text to `color-contrast`), so the report makes a 1.4.3 contrast fail,
  in this view or the default one, a 1.4.6 fail too.
- `motion`: reduced motion asked (`prefers-reduced-motion: reduce`)
  (2.3.3). A run note counts the animations that run in the default
  view and those that still run, and names up to 10 of them. Nothing is
  pressed, so animation from an interaction is not checked: the row is
  always for a person.

In each view, text in a box that cuts it (`overflow: hidden` or `clip`)
is a gap when it is not cut in the default view; text that is always
cut (an ellipsis) is not a finding of these rows. The gap says "Text is
clipped" when the box holds the text itself, and "This box cuts off its
content" when the text is in its children (a container, such as a page
area with `overflow: hidden`). In the narrow view,
a document that scrolls sideways is a gap on the content that is wider
than the window, unless that content is a table, a grid, preformatted
text, an image, a canvas, an SVG or a video (then a person looks).

In each view, text that overlaps other text is also a gap when it does
not overlap in the default view. The boxes are the lines of each text
node (as the browser lays them out), cut to the boxes that scroll or clip
them. Hidden text, text scrolled out of its box, lines of the same text,
and text in the same element are left out. The overlap is a gap when it
is at least a quarter of the smaller box ("Text overlaps other text
(div.card)"); a box of a line reaches above the capitals and below the
descenders, so a smaller overlap often does not touch a glyph. It is a
run note instead ("Text overlaps a little ..."), and the row is for a
person. Text in a fixed or sticky box (a header, a bottom panel) over
other text is not a gap either: the text under it can scroll into view.
A run note names the pair ("Text under a fixed or sticky box ...") and
the row is for a person. A page with more than 10000 text boxes is not
compared (a note).

A view with no finding, no content that may scroll sideways, no small
overlap and no text under a fixed or sticky box is a pass of its row. The model lists the views in `views`. The
page is not loaded again for a view, so a page that picks its layout only
at load is measured in its wide layout. Content inside a shadow root is
not measured.

## Focus measures

At each Tab stop of the Tab walk, with focus put there by the Tab key:

- 2.4.7 Focus Visible: a shot of the control and 8 px around it with
  focus, and one after focus has moved away. When no pixel differs, the
  control has a gap. Animations stand still and the text caret is
  hidden in both shots, so a text field whose only change is the caret
  is for a person, not a gap.
- 2.4.11 and 2.4.12 Focus Not Obscured: the centre and the four corners
  of the focused control are tested for an element on top that is
  fixed or sticky (a header, a footer bar). All points covered is a
  2.4.11 gap; any point covered is a 2.4.12 gap.
- 2.5.5 Target Size (Enhanced): a control narrower or lower than 44 px
  is a gap. A small link in a line of text, the browser's own control
  (a checkbox, radio, range, colour, file input or select that is not
  restyled) and a control with a label (the label can be a part of the
  target) are for a person; a run note names them. A larger control for
  the same function (an exception of 2.5.5) is not looked for, so a gap
  can be false for that reason.
- 2.4.13 Focus Appearance (AAA): the same two shots are decoded by a
  canvas in the page, with no image library. The pixels that change by
  3 : 1 or more between the shot with focus and the one without are
  counted, and their area is compared with the area of a 2 px
  perimeter of the control. The perimeter follows the control's
  rounded corners (`border-radius`), so a 2 px ring drawn inside a
  rounded control is the whole perimeter. Both numbers are measures of a picture, so
  there is a margin of error: a gap only when clearly under, that is
  when even the pixels at 2.5 : 1 cover less than three quarters of
  the perimeter. Between that and the full area, or for a text field
  whose only change is the caret, the stop is for a person; a run note
  names it. 2.5 : 1 allows for anti-aliasing, a box on a fractional
  pixel and colour management, which lighten an edge by about that
  much; three quarters allows for the same blur at the ends of a ring.
  Only the 8 px around the control is seen: an indicator further out
  is not counted.
  When the outline would reach past an edge of the window that the page
  cannot scroll past, or past an ancestor that scrolls or clips its
  content, and the measure is not a
  pass, the stop is a gap that names what cuts the outline off: "The
  focus outline is cut off by the left edge of the window: 1024 of
  1200 px² show. Draw it inside the control (a negative
  outline-offset)." The cause is known, so it is not left to a person.
- 1.4.11 Non-text Contrast (AA): the shot without focus of a field (a
  text input, textarea or select) and of an icon button or link (a
  button or link with no text). The edge of a field is compared with the background 6 to
  7 px outside it; the best line from 3 px outside to 3 px inside the
  edge counts, so a border, a fill or a shadow all serve. An icon
  button or link also counts its strongest pixel against its own fill. Under
  2.5 : 1 is a gap (the same margin as above); 2.5 to 3 is for a
  person. A background that is not one colour (an image) or a side at
  the edge of the shot is not read. The row is never a pass: other
  graphics (a chart, a state, an icon that is not a Tab stop) are not
  measured, and only Tab stops are looked at.

A stop whose page or box scrolled between the two shots, or that
stayed beside the focus for three more Tab presses, is not compared; a run note names such stops and 2.4.7 goes to a person.
With no scroll, the second shot is of the same area of the screen, so
a control that moves or appears only with focus (a skip link) is
compared as any other. A layout change by other content at the same
moment also counts as a change. The
measures stop after 150 Tab stops, with a run note. No shot is written
to disk. The rule ids are `focus-visible`, `focus-obscured`,
`focus-target`, `focus-appearance` and `focus-contrast`.

## Lists for a person

Three rows are for a person to decide, so the tool lists evidence and
writes neither a pass nor a fail: each gets review. The lists are
measured in the default layout, after the Tab walk and before the
views; `--no-views` turns them off with the other measures. Each
measure is one run note that starts with its row, for example
`1.4.8 line height under 1.5: 4 text blocks: p.cell ×3 (line height
1.2), p#one (line height 1.3)`, or ends in `none`. The elements are grouped by name, the
largest group first (up to 10 groups), each with its measured value:
characters a line, line height, or image size.

- 1.4.8 Visual Presentation (AAA), for each block of text: lines over
  80 characters, line height under 1.5, justified text. The line
  length is an estimate (the width of the box over the mean width of a
  letter in its font), for blocks with more than 80 characters of
  their own text. A line height of `normal` counts as 1.2. Line height
  and justified text count only for text on two lines or more.
- 1.4.5 Images of Text (AA) and 1.4.9 Images of Text (No Exception)
  (AAA): raster images more than 3 times as wide as high, often
  banners with text, and elements with a CSS background image and no
  text of their own.

Content inside a shadow root is not measured. The rule ids are
`list-text` (1.4.8) and `list-images` (1.4.5, 1.4.9).

## Crawl: a run over a site

```
bun cli.js crawl <url> [--out <dir>] [--max <n>] [--urls <file>] [--add <file>] [--jobs <n>] [page options]
```

This finds the pages of a site from `<url>` by their links, breadth
first, and reads each one as above. It follows links only (`a[href]`
on the same site): it never presses a button or sends a form, so a
page reached only that way (a stepper, a dialog) is not in the run
unless `--urls` or `--add` names it. Paths with `login` or `logout` are skipped,
and a sign-in page in place of a page stops the crawl with a note.

One page stands for each route shape: a path segment that is a UUID
or all digits counts as `id`, so `/apps/<guid>/routes` is read once.
To find the pages, the crawl opens up to two instances of a shape and
follows the links of both; the run keeps the instance with more links
to the same site (the first, if they are equal). An empty first
instance thus does not hide the pages below it. If the first two
instances are both empty, name the pages with `--urls`.
The page options (`--storage-state`, `--ignore-https-errors`,
`--wait-for`, `--idle`, `--settle`, `--no-views`) apply to every page, when the
crawl looks for links and when it reads the page. An element named by
`--wait-for` must be on every page of the site.

- `--out <dir>`: the run directory. The default is `reader-path-run`.
  Each page goes to `<dir>/pages/<shape>/` (`model.json` and
  `index.html`; `<shape>` is the path with `/` as `_` and ids as `id`),
  and `<dir>/run.json` lists the pages, the pages dropped because they
  moved to another page of the run (a default tab), and the URLs
  skipped. The same care as for `--out` above: the models hold the
  signed-in content.

  A page whose tree shows a progress bar, a status or alert that says
  "Loading", or a busy element gets the run note `Page shows a loading
  sign`: it was probably read before its content came, so its numbers
  are wrong. `run.json` lists these pages under `loading`, and the
  command prints how many. Pages where link discovery still had a
  request open when its wait gave up are listed under
  `discoverStillLoading`, with a printed line: links on them may have
  been missed.
- `--max <n>`: the most pages to read. The default is 100.
- `--urls <file>`: one URL a line; the crawl reads these and finds no
  others.
- `--add <file>`: one URL a line; the crawl finds pages as usual and
  reads these as well. Use it for pages no link reaches: a page a
  button opens, or a tab that shows only on some items (an app that
  uses the autoscaler). A listed page stands for its shape, in place
  of the page the crawl found for it. Its links are not followed.
- `--jobs <n>`: read this many pages at the same time, each in its own
  browser. The default is 1. The pages in `run.json` keep the order in
  which they were found. More jobs put more load on the computer and
  on the site, so a page can seem done while it still loads: look in
  the models for a "Loading" status before you use the numbers. When a
  page fails, no new page starts.

Then `bun cli.js acr <dir>/pages/*/model.json --out <file.yaml>`
writes the report for the run.

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
  names the page and the gap. A gap (the same role, name and text)
  on at least half of the pages, and on two or more, is one line,
  `On 48 of 48 pages: Collapse sidebar: ...`, before the per-page
  lines; its per-page lines are left out. A control whose name changes
  from page to page stays a per-page line.
With two or more models, the tool also runs its own checks over the
whole run, beside the axe-core rules, the Tab walk (`tab-walk`,
2.1.2), the views (`view-narrow`, `view-zoom`, `view-spacing`,
`view-motion`), the focus measures (`focus-visible`,
`focus-obscured`, `focus-target`, `focus-appearance`,
`focus-contrast`) and the lists (`list-text`,
`list-images`): `run-title` (2.4.2: the same title on every page is a fail),
`run-navigation` (3.2.3: the navigation items and their order),
`run-identification` (3.2.4: a component that appears once on a page
with different names on different pages goes to review), `run-help`
(3.2.6: a help or documentation link on every page, some pages, or
none), `run-ways` (2.4.5: navigation plus a search on every page, else
review), and `run-media` (1.2.1 to 1.2.9 and 1.4.7: audio and video
elements counted; none found is evidence for the person, never a level).

- `not-evaluated`: anything else. The note says what a person must
  look at, after `Needs a person:`: no automated check covers the row;
  a page has no result for it (for example, axe-core did not run
  there, or did not check a frame of the page); axe-core could not
  decide (also when other rules passed); or
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
for its WCAG rows. A base level that is not an OpenACR level counts as
`not-evaluated`, and the command prints the row. 302.1 and 302.9 also
have a part that no WCAG row covers (the rule of comparable
information, the reading level), so they are never `supports`. A
chapter 3 row built with a level from a person's row ends with "from
automated checks and the base file".

Notes are Markdown, as OpenACR renders them: each line is a paragraph,
and Markdown punctuation in a title from the page is escaped. A local
page (a `file:` URL) is named by its file name only.

A person confirms every row before the report is published. A report
cannot be published with `not-evaluated` at level A or AA; the command
prints how many such rows remain, how many rows it proposed as
`supports` from automated rules only, and each model file where
axe-core did not run, or did not check a frame.

- `--out <file.yaml>`: required.
- `--base <yaml>`: a report that a person owns, for example an earlier
  draft that a person edited. Its top-level fields are kept as they
  are, except `catalog` and `report_date`, which the tool always sets,
  and `evaluation_methods_used`, which the tool writes again while it
  still starts with the tool's own text. The base is read as plain
  YAML (an unquoted date stays text), and every `num` is written as a
  string. Chapters that the tool does not write (hardware, software,
  support documentation) are kept from the base.

  A row is the person's once its note no longer ends with the
  "Proposed by reader-path ..." line. To take a row as your own,
  change the level and delete that line. A person's row is kept as it
  is. Rows that still end with that line are the tool's, and they are
  proposed again on every run, from the new evidence. When a person's
  row has a better level than the new evidence (in the order above),
  the command prints the row number and both levels, for example
  `base row 1.4.3: supports; new evidence: not-evaluated`. The line
  is printed only when the new evidence has something to say: a
  failing rule, a rule that needs review, a page with no result for
  the row, or an unchecked frame. A row that no rule covers prints
  nothing.

Without `--base`, `title`, `product.name` and `author.email` are
placeholders to fill in.

## Tests

```
bun run test
```

Or `npm test`. Both run `test/run.mjs`, which runs the tests with
`bun test` when `bun --version` works, else with `node --test`. Both
run the test files in parallel. A plain `bun test` also works, but
runs the files one after another and stops a test after 5 seconds;
`bun run test` gives each test 2 minutes.

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
- Gaps come from the axe-core rules, the views and the focus measures.
  A rule cannot judge whether a name or a text is a good one.
- The results need a person to confirm them.
