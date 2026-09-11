# Phase H Stage 1 — parity divergences and brand repaint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the browser planner tell the truth about live D2 data, and look like D2, so it can
become the office surface.

**Architecture:** The planner stays one vanilla-JS HTML file with no build step and no
dependencies. Five divergences between it and SharePoint are closed by extending
`sharepoint/export-to-planner.js` to carry three fields it currently drops, and teaching the
planner to read them. SharePoint Lists stays the database; nothing here writes back. Every change
is pinned by a jsdom harness that runs the real HTML against real captured payloads.

**Tech Stack:** Vanilla JS in one HTML file; Node + jsdom for tests; SharePoint REST (raw, with
`odata=nometadata`) for the export; Power Automate FlowAgent for the headless fixture capture.

**Spec:** `docs/superpowers/specs/2026-09-11-planner-as-primary-surface-design.md` (sections 1.5,
1.6, 1.7, 1.2)

**Parity map:** `docs/planner-vs-sharepoint-parity.md` (divergences D7, D2, D8, D9, D4, D11)

---

## Global Constraints

- **Never assume a field's shape — read it off a real payload.** This project has lost six cycles
  to it. The export reads **raw SharePoint REST with `Accept: application/json;odata=nometadata`**,
  where `Crew` is a plain string and the Tasks lookup is `AssignmentId`. The Power Automate
  connector's shapes (`{Id,Value}`, `Assignment`+`Assignment#Id`) are a **different surface** and
  do not apply here.
- **Dates are bare `yyyy-MM-dd` strings, always.** Never `new Date()` a SharePoint DateOnly value
  and never write `...T00:00:00Z`. Slice the first 10 characters. This is the Phase A off-by-one
  that inverted the work week once already.
- **Verify by opening the result, never by the status code.** The dominant failure signature in
  this codebase is a write that returns 200/201/204 and renders nothing.
- **No new dependencies in the planner.** It has zero today. The only permitted addition in Stage 1
  is a Google Fonts `<link>`.
- **Nothing in this plan writes to SharePoint** except Task 7, which runs one existing,
  already-reviewed script and is explicitly gated on a human.
- **The planner never writes back.** Do not add a write path, a `fetch` POST, or a "push to D2"
  button. That is Stage 2 and it goes through the request-list flows.
- **Client-visible files carry no internal commentary.** `pool-scheduler.html` and everything under
  `sharepoint/` is deployed into D2's tenant. Technical reasoning belongs in the code comments;
  named attribution, quoted feedback, and judgements about the client's environment do not.
- **Run the four existing harnesses after every task.** They are the regression gate:
  ```bash
  node fixtures/planner/determinism.js
  node fixtures/planner/roundtrip.js
  node fixtures/planner/empty.js
  node fixtures/planner/live-export.js
  node oracle-test.js
  ```
- **Commit after every task.** Branch is `canvas-app-handoff`.

## Baseline, measured 2026-09-11 before any change

Stated so a later reader can tell a regression from a pre-existing condition.

| Harness | Result |
|---|---|
| `determinism.js` | STABLE, 0 crew picks drift |
| `roundtrip.js` | 16/16 PASS |
| `empty.js` | clean, 0 jsdom errors |
| `live-export.js` | 17/17 PASS — 138 assignments, 885 tasks, 47 sign-offs, 398 ticks |
| `oracle-test.js` | **14/16** — invariant 9 (work calendar) and invariant 11 (10 unmapped trades) fail |

**The D7 defect, measured against the live fixture rather than asserted:** of the 138 live
assignments, **2 render a day short** in the planner today — ids 360 (`3.1`) and 410 (`4.6`), both
`2026-10-10 + 2 days`, which SharePoint finishes `2026-10-13` and the planner computes
`2026-10-12`. Both cross **Columbus Day, Monday 2026-10-12**. Task 3's acceptance test is that this
count goes to **0**.

Two honest notes about that number. It is small today because the three demo pools sit in a
holiday-light stretch; there are 35 holidays over the calendar's span and a pool runs about four
months, so it grows. And **Columbus Day is one of the holidays CLAUDE.md flags as never confirmed
against D2's actual practice** — many construction crews work it. This plan makes the planner agree
with SharePoint. If D2 actually works that day then both systems are wrong together, which is a
question for Don about the Work Calendar contents, not a code change.

## Task order and why

Tasks 1 and 2 are plumbing that Tasks 3 and 4 consume, so they come first. Tasks 5, 6, 8 and 9 are
independent of everything and of each other. Task 7 is the only one that touches the live tenant.
Task 10 is repo layout and is deliberately last so it does not churn paths under the other nine.

---

### Task 1: Capture Work Calendar and `Tasks.NotApplicable` into the fixture

The planner cannot honour holidays it has never seen, and `fixtures/planner/live-payloads.json`
holds only Jobs, Assignments and Tasks. Extend it. Capture, never hand-author — a synthesised
holiday list would prove nothing about the real column's shape.

**Files:**
- Modify: `fixtures/planner/live-payloads.json` (add `cal` key; re-capture `tasks` with a new field)
- Modify: `fixtures/planner/README.md` (document the new key)

**Interfaces:**
- Produces: `live-payloads.json` gains a top-level `cal` array whose rows carry at least `Id`,
  `Title` and `Date`; every row of the existing `tasks` array gains a `NotApplicable` boolean.
  Tasks 2, 3 and 4 read both.

**Known facts, so you do not rediscover them:**
- Work Calendar list GUID is `d36758cf-9d27-4342-84e4-817f8dcfa2ba`. `D2 - New Pool` reads it with
  `GetItems, $top: 500` and projects `@formatDateTime(item()?['Date'], 'yyyy-MM-dd')` into a
  `nonWork` array. The list holds **210 rows** — 175 Sundays and 35 holidays, 2026-08-30 to
  2029-12-30. Sundays are in the list as well as being computed.
- `Tasks.NotApplicable` exists — `sharepoint/format-views.js:305-310` renders it as a grey dash and
  a line-through. It is simply absent from the export's `$select`.

- [ ] **Step 1: Confirm `az` is pointed at D2's tenant, not Tennetech's**

The cached-tenant trap has bitten this project on `az`, `pac` and `Add-PowerAppsAccount`.

```bash
az account show
```

Expected: `"tenantId": "f24d9b39-6a71-4f4e-a376-03b6f61c97e4"` and
`"name": "stratirus@d2pools.com"`. If it shows Tennetech, run
`az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4` and sign in as `stratirus@d2pools.com`.

- [ ] **Step 2: Capture with a throwaway probe flow**

Use the recipe in CLAUDE.md under "HEADLESS SHAREPOINT READS WITHOUT A BROWSER". The `az` route
does not work for list data — a SharePoint-resource token returns 401 and the `az` Graph token
carries no `Sites.*` scope. Do not spend time on either.

Create a `Recurrence`-triggered flow, `state: "Stopped"`, with two read-only `HttpRequest` actions
against `shared_sharepointonline`:

```
GET /sites/D2BuildScheduler/_api/web/lists/GetByTitle('Work Calendar')/items
    ?$select=Id,Title,Date&$top=1000&$orderby=Id

GET /sites/D2BuildScheduler/_api/web/lists/GetByTitle('Tasks')/items
    ?$select=Id,AssignmentId,Sequence,Title,Complete,NotApplicable&$top=5000&$orderby=Id
```

Send `Accept: application/json;odata=nometadata` on both, so the shapes match what
`export-to-planner.js` sees in a browser. Then: Dataverse `PublishXml` against the returned
workflowid, `publish_flow`, `run_flow`, read each action's `outputsLink` (SAS-signed, fetch with no
auth header), and `delete_flow`.

Two traps from CLAUDE.md that apply here: `connectionRefs` is **flat**, not nested under
`connection`; and `delete_flow` wants the ProcessSimple id while `create_flow` returns the
Dataverse workflowid.

Tasks is 885 rows and may exceed one page — follow `odata.nextLink` if present, or the fixture will
be silently short.

- [ ] **Step 3: Merge into the fixture, preserving the existing keys**

Write `cal` alongside `jobs`, `asg`, `tasks`. Replace `tasks` wholesale with the re-captured array.
Keep the file's existing formatting so the diff is readable.

- [ ] **Step 4: Verify the capture rather than trusting it**

```bash
node -e "
const d=require('./fixtures/planner/live-payloads.json');
const cal=d.cal||[];
console.log('cal rows:', cal.length);
console.log('cal sample keys:', Object.keys(cal[0]||{}).join(','));
const dates=cal.map(c=>String(c.Date).slice(0,10));
const sun=dates.filter(s=>{const[a,b,c]=s.split('-').map(Number);return new Date(a,b-1,c).getDay()===0;});
console.log('sundays:',sun.length,'non-sundays (holidays):',dates.length-sun.length);
console.log('range:',dates.slice().sort()[0],'->',dates.slice().sort().pop());
console.log('has 2026-10-12 (Columbus Day):', dates.includes('2026-10-12'));
const t=d.tasks||[];
console.log('tasks:',t.length,'carry NotApplicable key:',t.filter(x=>'NotApplicable' in x).length);
console.log('tasks marked N/A:',t.filter(x=>x.NotApplicable).length);
"
```

Expected: 210 cal rows, 175 Sundays and 35 holidays, range `2026-08-30 -> 2029-12-30`,
`has 2026-10-12: true`, 885 tasks all carrying the key.

**If `has 2026-10-12` is false, stop.** The baseline measurement above says exactly two live
assignments straddle that date, so its absence means the capture is wrong or the list is not what
this plan assumes, and Task 3's acceptance test would then pass for the wrong reason.

- [ ] **Step 5: Document the new key in the fixtures README**

Add `cal` to the file's description and note the capture date and row count, so a future reader can
tell a stale fixture from a current one. The README already warns that this repo has been burned by
committed artifacts drifting behind live.

- [ ] **Step 6: Commit**

```bash
git add fixtures/planner/live-payloads.json fixtures/planner/README.md
git commit -m "Capture Work Calendar and Tasks.NotApplicable into the planner fixture"
```

---

### Task 2: Export carries the work calendar and per-task N/A

**Files:**
- Create: `fixtures/planner/run-export.js` (extracted from `live-export.js`)
- Modify: `sharepoint/export-to-planner.js`
- Modify: `fixtures/planner/live-export.js` (use the extracted runner; assert the two new fields)

**Interfaces:**
- Consumes: the `cal` array and `tasks[].NotApplicable` captured in Task 1.
- Produces: `fixtures/planner/run-export.js` exporting `runExport(live) -> Promise<payload>`; and
  the export payload gains a top-level `nonWork` array of `yyyy-MM-dd` strings plus
  `sections[].tasks[].na: boolean`. Tasks 3 and 4 read all three.

- [ ] **Step 1: Extract the export runner so it has ONE fetch stub, not two**

`live-export.js` runs the real export script inside a `vm` sandbox with `fetch` stubbed to serve the
fixture. Its `pick()` maps a URL to a fixture array and **throws `unexpected URL` on anything it does
not recognise**. Task 2 adds a fourth list to the export, so that stub must learn about it or the
harness dies at the first line rather than failing an assertion — and Task 3 needs the same runner
again. Extract it once instead of writing a second copy that can drift.

Create `fixtures/planner/run-export.js`, moving the existing `runExport` out of `live-export.js`
verbatim except for the two changes marked below:

```js
/* Runs the real sharepoint/export-to-planner.js against captured payloads.
 *
 * The export script is browser code: it calls fetch, builds a Blob and clicks an
 * anchor to download. A `vm` sandbox supplying just those four globals is enough,
 * and is cheaper than a full DOM. Shared by live-export.js and workcalendar.js so
 * there is one fetch stub to keep in step with the script's list reads, not two.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.resolve(__dirname, '../../sharepoint/export-to-planner.js');

function runExport(live) {
  return new Promise((resolve, reject) => {
    let captured = null;
    const pick = url =>
      /GetByTitle\('Jobs'\)/.test(url) ? live.jobs :
      /GetByTitle\('Assignments'\)/.test(url) ? live.asg :
      /GetByTitle\('Tasks'\)/.test(url) ? live.tasks :
      // NEW: the export reads the Work Calendar as of Task 2. The list title has a
      // space, so it may arrive percent-encoded depending on how the URL was built.
      /GetByTitle\('Work(%20| )Calendar'\)/.test(url) ? (live.cal || []) : null;

    const sandbox = {
      console: { log: () => {}, warn: () => {} },
      Date,
      Promise,
      Blob: class { constructor(parts) { this.parts = parts; } },
      URL: { createObjectURL: b => { captured = b.parts.join(''); return 'blob:stub'; } },
      document: {
        createElement: () => ({ set href(v) {}, download: '', click() {} })
      },
      fetch: async url => {
        const rows = pick(url);
        if (!rows) throw new Error('unexpected URL: ' + url);
        return { ok: true, status: 200, json: async () => ({ value: rows }) };
      }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const src = fs.readFileSync(SCRIPT, 'utf8');
    try {
      const p = vm.runInContext(src, sandbox);
      Promise.resolve(p).then(() => {
        // the anchor click happens synchronously before the summary
        setTimeout(() => captured ? resolve(JSON.parse(captured)) : reject(new Error('nothing downloaded')), 10);
      }, reject);
    } catch (e) { reject(e); }
  });
}

module.exports = { runExport };
```

Note `pick` returns `live.cal || []` rather than `null` for the calendar, so the harness still runs
against a fixture captured before Task 1 — it just reports an empty calendar instead of throwing.

Then in `live-export.js`, delete the local `runExport` definition and replace it with:

```js
const { runExport } = require('./run-export');
```

changing its one call site to `await runExport(live)`.

- [ ] **Step 2: Confirm the extraction changed nothing**

```bash
node fixtures/planner/live-export.js
```

Expected: the same 17/17 PASS as the baseline. If anything moved, the extraction is wrong — fix it
before adding behaviour on top.

- [ ] **Step 3: Write the failing assertions**

In `fixtures/planner/live-export.js`, after the existing payload assertions, add:

```js
ok('export carries the work calendar', Array.isArray(payload.nonWork) && payload.nonWork.length > 200,
   (payload.nonWork ? payload.nonWork.length : 0) + ' non-work days');
ok('work calendar includes a known holiday', (payload.nonWork || []).includes('2026-10-12'));
ok('work calendar dates are bare yyyy-mm-dd',
   (payload.nonWork || []).every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)));
const allTasks = payload.jobs.flatMap(j => j.sections.flatMap(s => s.tasks));
ok('every exported task carries an N/A flag', allTasks.length > 0 && allTasks.every(t => 'na' in t),
   allTasks.length + ' tasks');
ok('every job carries its SharePoint row id', payload.jobs.every(j => Number.isInteger(j.id)),
   payload.jobs.map(j => j.jobno + '#' + j.id).join(' '));
ok('every sub-phase carries its SharePoint row id',
   payload.jobs.every(j => j.sections.every(s => Number.isInteger(s.id))),
   'ids present');
```

- [ ] **Step 4: Run it to confirm the new assertions fail**

```bash
node fixtures/planner/live-export.js
```

Expected: the four new lines FAIL (`0 non-work days`, no `na` key), the original 17 still PASS. If an
original assertion broke, the Task 1 re-capture changed something it should not have — fix that
before continuing.

- [ ] **Step 5: Read the Work Calendar in the export**

In `sharepoint/export-to-planner.js`, add a fourth list to the existing `Promise.all`:

```js
  const [jobs, asg, tasks, cal] = await Promise.all([
```

and as the fourth entry:

```js
    all("/_api/web/lists/GetByTitle('Work Calendar')/items"
      + "?$select=Id,Title,Date&$top=1000&$orderby=Id")
```

- [ ] **Step 6: Project it into the payload**

Add to the payload object, as a sibling of `jobs` rather than inside it — it is tenant-wide, not
per-pool:

```js
    // Every non-work day the flows know about: 175 Sundays and 35 holidays.
    // `D2 - New Pool` and `D2 - Reschedule Pool` both compute Sunday AND test this
    // set, so the planner has to do the same or its spans disagree with the
    // schedule SharePoint actually built. Sundays are in here as well as being
    // computed, which is harmless and keeps this a faithful mirror of the list.
    nonWork: [...new Set(cal.map(c => day(c.Date)).filter(Boolean))].sort(),
```

`day()` is the existing helper that slices the first 10 characters. Use it — do not `new Date()`
the value.

- [ ] **Step 7: Carry `NotApplicable` on tasks**

Extend the Tasks `$select`:

```js
    all("/_api/web/lists/GetByTitle('Tasks')/items"
      + "?$select=Id,AssignmentId,Sequence,Title,Complete,NotApplicable&$top=5000&$orderby=Id")
```

and the task projection:

```js
            .map(t => ({ seq: t.Sequence, title: t.Title, done: !!t.Complete,
                         na: !!t.NotApplicable }))
```

- [ ] **Step 7b: Carry the SharePoint row ids**

A batch write-back has to address a row to write to it, and the export carries **no ids at all**
today. Adding them is one field each now and a re-capture plus a re-export later. Nothing in this
plan reads them; they exist so the write-back does not start by changing the export again.

In the job projection, as the first key:

```js
      id: j.Id,
```

and in the section projection, as the first key:

```js
          id: a.Id,
```

Do not add an id to the task projection. Tasks are ticked in the field app and the planner has no
business writing them back, which is the same reason sign-off is not a write-back field.

- [ ] **Step 8: Add the two new counts to the console summary**

The summary is how a PM running this in the console knows it worked. In the `out` object:

```js
    nonWorkDays: payload.nonWork.length,
    tasksNA: payload.jobs.reduce((n, j) =>
      n + j.sections.reduce((m, s) => m + s.tasks.filter(t => t.na).length, 0), 0),
```

- [ ] **Step 9: Update the header comment**

The file's header documents every field shape it relies on, and that discipline is the reason it
works. Add a bullet under "FIELD NAMES ARE READ OFF A REAL PAYLOAD":

```
 *   - `Work Calendar.Date` is a DateOnly column stored at site-local midnight, so
 *     the first 10 characters are already the intended day. It holds Sundays as
 *     well as holidays; `D2 - New Pool` reads the same list and computes Sunday
 *     separately, so carrying both is faithful rather than redundant.
```

- [ ] **Step 10: Run the harness and confirm all assertions pass**

```bash
node fixtures/planner/live-export.js
```

Expected: 21/21 PASS, with `export carries the work calendar [210 non-work days]`.

- [ ] **Step 11: Commit**

```bash
git add sharepoint/export-to-planner.js fixtures/planner/live-export.js fixtures/planner/run-export.js
git commit -m "Export the work calendar and per-task N/A to the planner"
```

---

### Task 3: D7 — the planner honours the work calendar

The single divergence that makes the planner produce a **wrong plan** rather than an incomplete
picture. `isWork = d => d.getDay() !== 0` is its entire model.

**Files:**
- Modify: `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html` (date helpers, state
  load, `importFromD2`, `restore`)
- Create: `fixtures/planner/workcalendar.js`

**Interfaces:**
- Consumes: `payload.nonWork` from Task 2.
- Produces: `S.settings.nonWork` (array of `yyyy-MM-dd`), a module-level `NONWORK` Set, and
  `syncNonWork()`. Task 8 reads `S.settings` for its freshness stamp.

**Design note, so the diff is not a surprise.** Extending `isWork` changes the Gantt axis as well
as the spans: `axis()` builds its day columns from `isWork`, so a holiday column stops being drawn,
exactly as Sunday already is. That is consistent with the tool's existing idiom and is the intended
behaviour. Keeping the column and shading it is a larger change and is not in scope.

- [ ] **Step 1: Write the failing test**

Create `fixtures/planner/workcalendar.js`. It runs the real export against the real fixture, imports
into the real planner, and asserts every section's planner-computed finish equals the finish
SharePoint actually stored.

```js
/* D7: the planner's work calendar must agree with the one the flows use.
 *
 * The planner recomputes every end date as workSpan(start, days) rather than
 * reading the exported `finish`, so any sub-phase whose real span stepped over a
 * holiday renders a day short -- and that shortened span then feeds conflicts(),
 * where it can miss a real overlap and invent a sequence error.
 *
 * Measured before the fix: 2 of 138 live assignments were wrong, both crossing
 * Columbus Day 2026-10-12. This pins that at 0.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { runExport } = require('./run-export');

const PLANNER = path.resolve(__dirname, '../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
const FIXTURE = path.join(__dirname, 'live-payloads.json');

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const live = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

(async () => {
  const payload = await runExport(live);

  ok('export carries a work calendar', Array.isArray(payload.nonWork) && payload.nonWork.length > 200,
     (payload.nonWork || []).length + ' days');

  // --- load the real planner and import ---
  const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
    `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.importFromD2=importFromD2;
      window.workSpan=workSpan;window.isWork=isWork;window.parseD=parseD;};</script><script>__x();</script></body>`);
  const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const win = dom.window;
  win.confirm = () => true; win.alert = () => {};
  await new Promise(r => setTimeout(r, 600));

  win.importFromD2(new win.File([JSON.stringify(payload)], 'd2.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 500));

  ok('planner stored the calendar',
     win.S.settings && Array.isArray(win.S.settings.nonWork) && win.S.settings.nonWork.length > 200,
     ((win.S.settings || {}).nonWork || []).length + ' days in state');

  ok('a known holiday is not a work day', win.isWork(win.parseD('2026-10-12')) === false);
  ok('an ordinary Monday is still a work day', win.isWork(win.parseD('2026-10-19')) === true);
  ok('Sunday is still not a work day', win.isWork(win.parseD('2026-10-18')) === false);

  // --- the real assertion: computed finish == the finish SharePoint stored ---
  const wrong = [];
  let checked = 0;
  payload.jobs.forEach(inj => {
    const j = win.S.jobs.find(x => String(x.jobno) === String(inj.jobno));
    if (!j) return;
    const bySec = {};
    win.allSecs(j).forEach(({ s }) => { bySec[s.num] = s; });
    inj.sections.forEach(is => {
      const s = bySec[is.num];
      if (!s || !is.start || !is.finish || !is.days) return;
      checked++;
      const computed = win.workSpan(s.start, s.days).pop();
      if (computed !== is.finish) wrong.push(inj.jobno + ' ' + is.num + ': SharePoint ' + is.finish + ', planner ' + computed);
    });
  });
  ok('every span agrees with SharePoint', wrong.length === 0,
     wrong.length ? wrong.slice(0, 5).join(' | ') : checked + ' spans checked');

  process.exit(fail);
})();
```

Note this reuses `run-export.js` from Task 2 rather than stubbing `fetch` again. The export script is
browser code and its stub is fiddly; two copies would drift the moment the script reads another list.

- [ ] **Step 2: Run it to verify it fails**

```bash
node fixtures/planner/workcalendar.js
```

Expected: `planner stored the calendar` FAILS (state has no `nonWork`), `a known holiday is not a
work day` FAILS, and `every span agrees with SharePoint` FAILS with **2** entries naming `3.1` and
`4.6`.

- [ ] **Step 3: Add the calendar to the planner's date helpers**

In `pool-scheduler.html`, replace the `isWork` line (currently line 219) and raise the `nextWork`
guard. The guard is 10 today, which is ample for Sundays alone; a Sunday followed by a Monday
holiday needs 2, but a longer shutdown entered as consecutive Work Calendar rows could need more.

```js
/* Non-work days come from the SharePoint Work Calendar via Load from D2: 175
   Sundays and 35 holidays. Sunday is ALSO computed, deliberately -- the computed
   rule is correct forever while the list expires 2029-12-30, so a lapsed calendar
   degrades to Sundays-only rather than to every day being a work day. This
   mirrors `D2 - New Pool`, which tests dayOfWeek AND a nonWork set. */
let NONWORK = new Set();
function syncNonWork(){ NONWORK = new Set((S && S.settings && S.settings.nonWork) || []); }
const isWork=d=>d.getDay()!==0 && !NONWORK.has(fmt(d));
function nextWork(s){let d=parseD(s);let g=0;while(!isWork(d)&&g++<30)d.setDate(d.getDate()+1);return fmt(d);}
```

Leave `addCal`, `workSpan`, `todayStr`, `pretty` and `dow` untouched — `workSpan` already routes
through `isWork` and inherits the fix.

- [ ] **Step 4: Rebuild the Set wherever state is replaced**

Four insertion points, and `load()` needs **two of them**. Read `load()` before editing it — it has
an **early return** on the localStorage path:

```js
function load(){
  try{const raw=localStorage.getItem(KEY);if(raw){S=JSON.parse(raw);return;}}catch(e){}
  S={crews:...,template:mkTemplate(),jobs:[],settings:{}};
  ...
  S.jobs=[];
}
```

A single call at the end of the function would run **only on a first visit**. The returning user is
the one who actually has a stored calendar, so holidays would silently stop applying on every visit
after the first. Patch both paths:

```js
  try{const raw=localStorage.getItem(KEY);if(raw){S=JSON.parse(raw);S.settings=S.settings||{};syncNonWork();return;}}catch(e){}
```

and again as the last line of the function body, after `S.jobs=[];`:

```js
  syncNonWork();
```

`syncNonWork()` is idempotent, so calling it on both paths is safe.

In `restore()`, immediately after `S=st; S.settings=S.settings||{};`:

```js
    syncNonWork();
```

In `importFromD2`, **immediately before the `plan.forEach(...)` that writes the sections** — which is
after the `confirm()` has returned true. Position matters in both directions: the spans are
recomputed during render so the calendar must be in place first, and a **cancelled import must
change nothing**, so this cannot sit above the confirm.

```js
    // Take the tenant's work calendar before anything recomputes a span.
    if(Array.isArray(d.nonWork)){ S.settings=S.settings||{}; S.settings.nonWork=d.nonWork; syncNonWork(); }
```

- [ ] **Step 5: Run the new test**

```bash
node fixtures/planner/workcalendar.js
```

Expected: all six PASS, with `every span agrees with SharePoint [138 spans checked]`.

- [ ] **Step 6: Run the full regression set**

```bash
node fixtures/planner/determinism.js && node fixtures/planner/roundtrip.js \
  && node fixtures/planner/empty.js && node fixtures/planner/live-export.js && node oracle-test.js
```

Expected: all still green, and `oracle-test.js` now reports **15/16** — invariant 9
(`Work-calendar support`) flips to PASS. Invariant 11 (10 unmapped trades) stays failing; that is
Don's data decision, not this plan's.

Note invariant 9 is a string grep for `/holiday|nonwork|non-work|workcalendar|weather/` over the
file, so the comment added in Step 3 satisfies it on its own. `workcalendar.js` is the real gate;
treat the oracle flip as a bonus, not as evidence.

- [ ] **Step 7: Register the new harness in the README**

Add a row to the table in `fixtures/planner/README.md`:

```
| `workcalendar.js` | The planner's spans match SharePoint's. Before the fix, 2 of 138 live assignments rendered a day short, both crossing Columbus Day 2026-10-12. |
```

and add `node fixtures/planner/workcalendar.js` to the command block.

- [ ] **Step 8: Commit**

```bash
git add D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html \
        fixtures/planner/workcalendar.js fixtures/planner/README.md
git commit -m "D7: planner honours the SharePoint work calendar, not just Sundays"
```

---

### Task 4: D8 — a third task state, so N/A stops reading as incomplete

An N/A task imports as *not done*, so a sub-phase legitimately signed off at 5 of 6 renders
permanently incomplete. The N/A rule is the most deliberated decision in CLAUDE.md and the planner
has nowhere to put it.

**Files:**
- Modify: `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`
- Modify: `fixtures/planner/live-export.js` (assertions)

**Interfaces:**
- Consumes: `sections[].tasks[].na` from Task 2.
- Produces: task objects gain `na: boolean`; `secDone(s)` now returns the **resolved** fraction;
  new `secCounts(s)` returns `{done, na, n}`. Tasks 8 and 9 do not depend on these.

**The counting rule, taken from CLAUDE.md and not invented here.** `TasksComplete` counts
genuinely Done only, never N/A — a sub-phase signed off with one N/A reads 5/6 forever, which is
honest. So the **label** stays `done/total`. But the **progress bar** must measure
`(done + na) / total`, or a legitimately finished sub-phase sits at 83% forever, which is the exact
complaint being fixed. Show both: `5/6 · 1 N/A` with a full bar.

**One decision to confirm before Step 3.** Should the planner let a user *set* N/A locally, or only
display what SharePoint sent? The planner never writes back, so a locally-set N/A is a fiction that
never reaches the tenant. This plan allows local toggling because `done` already behaves exactly
that way and has shipped, so blocking one while allowing the other is the inconsistent option.
Recorded here rather than buried: if Shane wants imported N/A to be read-only, it is a one-line
guard in `toggleNA`.

- [ ] **Step 1: Write the failing assertions**

Append to `fixtures/planner/live-export.js`, after the existing planner-side assertions:

```js
const naInPayload = payload.jobs.reduce((n, j) =>
  n + j.sections.reduce((m, s) => m + s.tasks.filter(t => t.na).length, 0), 0);
const naInPlanner = win.S.jobs.reduce((n, j) =>
  n + win.allSecs(j).reduce((m, x) => m + x.s.tasks.filter(t => t.na).length, 0), 0);
ok('N/A ticks landed in the planner', naInPlanner === naInPayload, naInPlanner + ' of ' + naInPayload);
ok('an all-resolved sub-phase reads 100%', (() => {
  const s = win.S.jobs.flatMap(j => win.allSecs(j).map(x => x.s))
    .find(s => s.tasks.length && s.tasks.every(t => t.done || t.na) && s.tasks.some(t => t.na));
  return !s || win.secDone(s) === 1;
})(), 'resolved = done + N/A');
```

`live-export.js` injects its planner handles through an `__x()` block that currently exposes
`S`, `importFromD2`, `allSecs` and `autoSchedule`. The second assertion needs one more — add
`window.secDone=secDone;` to that block.

- [ ] **Step 2: Run to verify failure**

```bash
node fixtures/planner/live-export.js
```

Expected: `N/A ticks landed` FAILS (0 of N). If the live tenant happens to have **zero** N/A tasks
today, the count is `0 of 0` and the assertion passes vacuously — check the Task 1 Step 4 output for
`tasks marked N/A`. If it is 0, say so in the commit message and rely on Step 5's synthetic check
instead, because a vacuous pass proves nothing.

- [ ] **Step 3: Carry `na` through the task model**

In `mkJobGroups` (around line 242), give new tasks the field so local pools and imported ones have
the same shape:

```js
      tasks:s.tasks.map(t=>({t,done:false,na:false}))}))}));
```

In `importFromD2`, where task ticks are overlaid:

```js
            if(t){t.done=!!it.done;t.na=!!it.na;}
```

(replacing `if(t)t.done=!!it.done;`)

- [ ] **Step 4: Split "resolved" from "done"**

Replace `secDone` (currently line 349) with two functions. Everything that draws a progress bar
already calls `secDone`, so it inherits the new meaning for free:

```js
/* Resolved, not done. Every task is Done, N/A or still to do; N/A is deliberate
   exclusion carrying a reason on the SharePoint side, so a sub-phase with one N/A
   and five done is FINISHED. The numeric label still reads 5/6, because
   Assignments.TasksComplete counts genuinely-done only and this has to agree
   with it. */
function secCounts(s){const n=s.tasks.length;
  return {n, done:s.tasks.filter(t=>t.done).length, na:s.tasks.filter(t=>t.na&&!t.done).length};}
function secDone(s){const c=secCounts(s);if(!c.n)return 1;return (c.done+c.na)/c.n;}
```

- [ ] **Step 5: Show N/A in the three places a checklist count is rendered**

The drawer label (currently line 704). Hoist the counts to a `const` above the template rather than
calling `secCounts(s)` three times inside it — find the line where the drawer body template begins
and add `const c=secCounts(s);` before it:

```js
    <div class="fld"><label>Checklist — ${c.done}/${c.n}${c.na?` · ${c.na} N/A`:''}
```

The Sign-Offs per-pool roll-up (currently line 583) — add an N/A total beside the done total:

```js
    const tot=secs.reduce((a,x)=>a+x.s.tasks.length,0),
          dn=secs.reduce((a,x)=>a+secCounts(x.s).done,0),
          na=secs.reduce((a,x)=>a+secCounts(x.s).na,0);
```

and in that card's header, after `checklist ${dn}/${tot}`:

```js
${na?` · ${na} N/A`:''}
```

The CSV export (currently line 778) — add an N/A column. In the header row (line 771), insert
`'Checklist N/A'` immediately after `'Checklist total'`, and in the data row:

```js
      secCounts(s).done,s.tasks.length,secCounts(s).na,s.inst?'YES':'',s.pm?'YES':'',bad?'NEEDS ATTENTION':'OK']);
```

- [ ] **Step 6: Make N/A a separate target in the drawer, never a cycle through the tick**

CLAUDE.md is explicit that N/A must be its own tap target so excluding work cannot happen by
mis-tap. Replace the task row template (currently lines 707-708):

```js
      <div id="tasks">${s.tasks.map((t,ti)=>`<div class="tk${t.done?' done':''}${t.na&&!t.done?' na':''}">
        <input type="checkbox" ${t.done?'checked':''} onchange="tick(${ti},this.checked)"><span>${esc(t.t)}</span>
        <a href="#" class="small natog" title="Not applicable on this pool"
           onclick="toggleNA(${ti});return false">${t.na?'N/A ✕':'N/A'}</a></div>`).join('')||'<span class="muted small">No tasks.</span>'}</div></div>`;
```

Add the handler beside `tick`:

```js
function toggleNA(ti){const t=cur().tasks[ti];t.na=!t.na;if(t.na)t.done=false;save();editSec(CUR.jobId,CUR.gi,CUR.si);}
```

Setting N/A clears `done`, because a task cannot be both. `tick` needs the mirror:

```js
function tick(ti,v){const t=cur().tasks[ti];t.done=v;if(v)t.na=false;save();}
```

And `allTasks` must not silently resolve N/A rows — it only touches unresolved ones:

```js
function allTasks(v){cur().tasks.forEach(t=>{if(!t.na)t.done=v;});save();editSec(CUR.jobId,CUR.gi,CUR.si);}
```

- [ ] **Step 7: Style the N/A row**

Add beside the existing `.tk` rules in the `<style>` block:

```css
.tk.na span{text-decoration:line-through;color:var(--muted)}
.tk .natog{margin-left:auto;padding-left:8px;color:var(--muted);text-decoration:none;flex:0 0 auto}
.tk .natog:hover{color:var(--ink)}
.tk.na .natog{color:var(--warn);font-weight:600}
```

`.tk` is already `display:flex;gap:7px;align-items:flex-start`, so `margin-left:auto` pushes the
toggle to the right edge with no change to the existing rule. Verified against the file, not assumed.

This mirrors `sharepoint/format-views.js`, which already renders an N/A task as a grey dash with a
line-through, so the two surfaces read the same.

- [ ] **Step 8: Run the tests**

```bash
node fixtures/planner/live-export.js && node fixtures/planner/workcalendar.js \
  && node fixtures/planner/roundtrip.js && node fixtures/planner/empty.js \
  && node fixtures/planner/determinism.js && node oracle-test.js
```

Expected: all green. `roundtrip.js` builds its own payload with no `na` key, which must still work —
`!!undefined` is `false`, so absent means not-N/A.

- [ ] **Step 9: Commit**

```bash
git add D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html fixtures/planner/live-export.js
git commit -m "D8: N/A is a third task state, so excluded work stops reading as incomplete"
```

---

### Task 5: D2 — stop Schedule Check crying wolf on PM sign-off

`PMSignOff` is written `false` once by `D2 - New Pool` and read by nothing else in the system. The
export carries it faithfully, so Schedule Check fills with "missing PM sign-off" on every finished
sub-phase — 51 rows on current demo data — with no way to clear any of them. A panel full of
unclearable warnings is a panel people stop reading, and Schedule Check carries seven other checks,
two of which exist nowhere else.

**Files:**
- Modify: `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html` (`conflicts()`)
- Create: `fixtures/planner/schedulecheck.js`

**Interfaces:** none consumed or produced. Self-contained.

**Scope:** drop the PM half of the *finished-but-unsigned warning only*. The PM checkboxes, the
phase-level roll-up, the per-pool counts and the CSV column all stay. PM sign-off is a real
intended workflow that is not wired up yet; this stops the planner asserting it is overdue.

- [ ] **Step 1: Write the failing test**

Create `fixtures/planner/schedulecheck.js`:

```js
/* D2: PM sign-off is not a wired-up workflow, so Schedule Check must not warn about it.
 *
 * Assignments.PMSignOff is written false once by `D2 - New Pool` and read by no
 * other flow, no view and not by the canvas app. The export carries it honestly,
 * which filled Schedule Check with one unclearable warning per finished sub-phase
 * -- 51 on the demo pools. Installer sign-off IS real and is still checked.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.conflicts=conflicts;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.confirm = () => true; win.alert = () => {};

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  // One pool, everything finished in the past, installer signed, PM never signed --
  // which is the state every real pool is in, because nothing sets PMSignOff.
  win.document.getElementById('addJobBtn').click();
  await new Promise(r => setTimeout(r, 100));
  const j = S.jobs[0];
  j.start = '2026-01-05';
  win.allSecs(j).forEach(({ s }) => { s.start = '2026-01-05'; s.days = 1; s.inst = true; s.pm = false; s.skip = false; });

  const msgs = win.conflicts().map(c => c.msg);
  ok('no PM sign-off warnings', !msgs.some(m => /PM sign-off/i.test(m)),
     msgs.filter(m => /PM sign-off/i.test(m)).length + ' found');

  // Installer sign-off is real and must still be checked.
  win.allSecs(j).forEach(({ s }) => { s.inst = false; });
  const msgs2 = win.conflicts().map(c => c.msg);
  ok('installer sign-off is still checked', msgs2.some(m => /Installer sign-off/i.test(m)),
     msgs2.filter(m => /Installer sign-off/i.test(m)).length + ' found');

  process.exit(fail);
})();
```

- [ ] **Step 2: Run to verify it fails**

```bash
node fixtures/planner/schedulecheck.js
```

Expected: `no PM sign-off warnings` FAILS with a non-zero count; `installer sign-off is still
checked` PASSES.

- [ ] **Step 3: Narrow the check to installer sign-off**

Replace the finished-but-unsigned line in `conflicts()` (currently line 386):

```js
      /* Installer sign-off only. `Assignments.PMSignOff` is written false once at
         pool creation and read by no flow, no view and not by the field app, so
         warning on it produced one unclearable item per finished sub-phase and
         drowned the checks that are real. The PM checkboxes and counts stay --
         when PM sign-off becomes a workflow, this check comes back with it. */
      if(end<T&&!s.inst)out.push({lvl:'warn',msg:`<b>${ref}</b> — finished ${pretty(end)} but still missing Installer sign-off.`});
```

- [ ] **Step 4: Run the test**

```bash
node fixtures/planner/schedulecheck.js
```

Expected: both PASS.

- [ ] **Step 5: Run the regression set and register the harness**

```bash
node fixtures/planner/determinism.js && node fixtures/planner/roundtrip.js \
  && node fixtures/planner/empty.js && node fixtures/planner/live-export.js \
  && node fixtures/planner/workcalendar.js && node oracle-test.js
```

Add `schedulecheck.js` to the README table and command block.

- [ ] **Step 6: Commit**

```bash
git add D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html \
        fixtures/planner/schedulecheck.js fixtures/planner/README.md
git commit -m "D2: Schedule Check no longer warns on PM sign-off, which nothing sets"
```

---

### Task 6: D9 — badge a pool's status instead of discarding it

`export-to-planner.js` emits `status` and `importFromD2` never reads it, so a `Planned` pool appears
on the Gantt, the Crew Board and Daily Dispatch exactly like a live one, and raises double-book
errors. That inverts the 2026-09-09 `Planned` decision on the one surface a PM uses *while choosing
dates*.

**Badge them, do not hide them.** The reflow's own conflict sweep is deliberately tenant-wide for
exactly this reason: a PM choosing dates for a new pool wants to know it collides with an existing
one. The planner's behaviour is right; only the absence of a label is wrong.

**Files:**
- Modify: `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`
- Modify: `fixtures/planner/live-export.js`

**Interfaces:**
- Consumes: `jobs[].status` (already exported).
- Produces: `j.status` on job objects; `jobBadge(j)` returning an HTML chip or empty string. Task 8
  renders alongside it.

- [ ] **Step 1: Write the failing assertion**

In `fixtures/planner/live-export.js`, after the pool-count assertion:

```js
ok('pool status landed', win.S.jobs.every(j => typeof j.status === 'string' && j.status.length > 0),
   win.S.jobs.map(j => j.jobno + '=' + j.status).join(' '));
```

- [ ] **Step 2: Run to verify failure**

```bash
node fixtures/planner/live-export.js
```

Expected: FAILS with `D2-1044=undefined D2-1042=undefined D2-1043=undefined`.

- [ ] **Step 3: Carry status through the import**

In `importFromD2`, in **both** branches of the job merge. New job, after `j.jobno=inj.jobno;`:

```js
        j.status=inj.status||'Active';
```

Existing job, beside the other field overlays:

```js
        if(inj.status)j.status=inj.status;
```

- [ ] **Step 4: Give locally-sketched pools an honest status**

In `newJob()`, add to the returned object:

```js
    status:null,          // null = exists only in this browser, never raised in D2
```

- [ ] **Step 5: Add the badge helper**

Place it near `fullAddr`, which is the existing job-display helper:

```js
/* A pool's state, from `Jobs.Status` on the SharePoint side. Planned and On Hold
   pools are deliberately still drawn on every board and still raise conflicts --
   a PM choosing dates wants to know a new pool collides with a live one, which is
   why the reflow's own conflict sweep is tenant-wide too. Only the label was
   missing, not the behaviour. */
function jobBadge(j){
  if(!j.status)return '<span class="chip jb local" title="Sketched here, not yet raised in D2">Local only</span>';
  if(j.status==='Active')return '';
  const cls=j.status==='Planned'?'planned':j.status==='On Hold'?'hold':'other';
  return `<span class="chip jb ${cls}" title="Jobs.Status in D2">${esc(j.status)}</span>`;
}
```

- [ ] **Step 6: Style the badges in the D2 palette**

Add to the `<style>` block, beside the other `.chip` rules. Task 9 repaints the rest of the file;
these use literal colours because they are status signals rather than brand surfaces:

```css
.chip.jb{margin-left:6px;text-transform:none;letter-spacing:0}
.chip.jb.planned{background:#fef3c7;color:#92400e;border-color:#fde68a}
.chip.jb.hold{background:#e5e7eb;color:#4b5563;border-color:#d1d5db}
.chip.jb.other{background:#e0e7ff;color:#3730a3;border-color:#c7d2fe}
.chip.jb.local{background:#f1f5f9;color:#64748b;border-color:#e2e8f0}
```

- [ ] **Step 7: Render it on every surface that names a pool**

Three call sites, located by reading the file rather than guessed:

```bash
grep -n 'esc(j.jobno' D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html
```

1. **Job Board timeline row** (currently line 475) — inside `.nmflex`, after
   `<span class="muted small mono">${esc(j.jobno||'')}</span>`, still within the `<span class="t">`.
2. **Sign-Offs card heading** (`vSignoff`, currently line 584) — after
   `<span class="muted mono" style="text-transform:none">${esc(j.jobno||'')}</span>`.
3. **Jobs tab row** (`vJobs`, currently line 622) — **not** the line-614 hit, which is an editable
   `<input>` and would swallow the markup. Put it in the "active" cell instead:
   ```js
    <td class="small">${allSecs(j).filter(x=>!x.s.skip).length} active ${jobBadge(j)}</td>
   ```

Do not add it to the CSV builder.

- [ ] **Step 8: Run the tests**

```bash
node fixtures/planner/live-export.js
```

Expected: `pool status landed [D2-1044=Active D2-1042=Active D2-1043=Active]`.

Then the full set. `roundtrip.js` builds payloads with `status:'Active'` already, so it is unaffected;
`empty.js` renders a first-run browser with no pools, also unaffected.

- [ ] **Step 9: Commit**

```bash
git add D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html fixtures/planner/live-export.js
git commit -m "D9: badge pool status so a Planned pool is distinguishable from a live one"
```

---

### Task 7: D4 — `Jobs.StartDate` drift, and a guard so it cannot silently return

`Jobs.StartDate` is no longer a display field. `autoSchedule` uses it twice: to **order the pools**
and to **seed each pool's cursor**. All three demo pools are adrift because `D2 - Reschedule Pool`
rewrites the Assignments dates and never writes the Jobs row back:

| Pool | `Jobs.StartDate` | First assignment actually starts |
|---|---|---|
| D2-1042 Reyes | 2026-09-14 | 2026-09-08 |
| D2-1043 Whitfield | 2026-09-21 | **2026-06-15** |
| D2-1044 Salcedo | 2026-09-28 | **2026-08-10** |

Auto-Schedule on a Whitfield import produces a plan anchored three months late.

**Files:**
- Modify: `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html` (`autoSchedule`)
- Create: `fixtures/planner/startdate.js`
- Run (human-gated): `sharepoint/fix-job-startdates.js`

**Interfaces:**
- Produces: `jobStart(j)` — the earliest of `j.start` and any scheduled section start.

**This task is beyond the spec's literal text, deliberately.** The spec's D4 fix is "run
`fix-job-startdates.js`, the flow gap stays open and is tracked separately". That corrects today's
three rows and nothing stops it recurring — the flow gap is still open, so the next reflow drifts
them again and Auto-Schedule silently produces a wrong plan a second time. The planner-side guard
below is four lines and makes the recurrence harmless. Both halves are worth doing; the script
corrects what a PM reads on the Jobs list, the guard stops it corrupting a plan.

- [ ] **Step 1: Write the failing test**

Create `fixtures/planner/startdate.js`:

```js
/* D4: Auto-Schedule must not be anchored by a stale Jobs.StartDate.
 *
 * `D2 - Reschedule Pool` rewrites Assignments dates and never writes Jobs.StartDate
 * back, so the field drifts and stays drifted -- Whitfield reads 2026-09-21 on the
 * Jobs list while its first sub-phase started 2026-06-15. autoSchedule() uses that
 * field to ORDER the pools and to SEED each pool's cursor, so a drifted value
 * anchors a whole pool months late.
 *
 * The flow gap is still open. This pins the planner against it.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.autoSchedule=autoSchedule;
    window.jobStart=jobStart;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.confirm = () => true; win.alert = () => {};

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  win.document.getElementById('addJobBtn').click();
  await new Promise(r => setTimeout(r, 100));
  const j = S.jobs[0];

  // Exactly the Whitfield shape: the Jobs row says September, the work started in June
  // and the early sub-phases are locked because they are signed off.
  j.start = '2026-09-21';
  const secs = win.allSecs(j).map(x => x.s);
  secs[0].start = '2026-06-15'; secs[0].days = 2; secs[0].locked = true; secs[0].crewId = 'devon';
  secs[1].start = '2026-06-17'; secs[1].days = 2; secs[1].locked = true; secs[1].crewId = 'devon';

  ok('jobStart uses the earliest real work, not the drifted field',
     win.jobStart(j) === '2026-06-15', win.jobStart(j));

  win.autoSchedule();
  const after = win.allSecs(j).map(x => x.s);
  ok('locked early work was not moved', after[0].start === '2026-06-15' && after[1].start === '2026-06-17',
     after[0].start + ', ' + after[1].start);
  ok('unlocked work follows the locked work, not the drifted field',
     after[2].start < '2026-09-21', after[2].start);

  process.exit(fail);
})();
```

- [ ] **Step 2: Run to verify it fails**

```bash
node fixtures/planner/startdate.js
```

Expected: `jobStart uses the earliest real work` FAILS — the function does not exist yet, so this
throws. That is a legitimate red.

- [ ] **Step 3: Add the guard**

Place `jobStart` beside `spanOf`, which is the existing span helper:

```js
/* The earliest date this pool actually has work on, which is NOT always
   `j.start`. `D2 - Reschedule Pool` rewrites the Assignments dates without
   writing Jobs.StartDate back, so an imported pool's own field can sit months
   after its first sub-phase. autoSchedule() uses this to order pools and to seed
   each pool's cursor, and a drifted value anchors the whole pool late. */
function jobStart(j){
  let a=j.start||null;
  allSecs(j).forEach(({s})=>{if(s.skip||!s.start)return;if(!a||s.start<a)a=s.start;});
  return a||todayStr();
}
```

- [ ] **Step 4: Use it at both call sites in `autoSchedule`**

Replace the sort and the cursor seed:

```js
  [...S.jobs].sort((a,b)=>jobStart(a).localeCompare(jobStart(b))).forEach(j=>{
    let cursor=nextWork(jobStart(j));
```

- [ ] **Step 5: Run the test and the regression set**

```bash
node fixtures/planner/startdate.js && node fixtures/planner/determinism.js \
  && node fixtures/planner/roundtrip.js && node fixtures/planner/empty.js \
  && node fixtures/planner/live-export.js && node fixtures/planner/workcalendar.js \
  && node fixtures/planner/schedulecheck.js && node oracle-test.js
```

`determinism.js` matters most here — it pins that Auto-Schedule is idempotent from a settled state,
and changing the pool ordering key is exactly the kind of change that could reintroduce the drift
that harness was built to catch. It must still report `STABLE` with 0 changed picks.

- [ ] **Step 6: Register the harness in the README, then commit**

```bash
git add D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html \
        fixtures/planner/startdate.js fixtures/planner/README.md
git commit -m "D4: anchor Auto-Schedule on real work, not a drifted Jobs.StartDate"
```

- [ ] **Step 7: HUMAN GATE — run `fix-job-startdates.js` against the live tenant**

**Do not run this unattended.** It writes to D2's production SharePoint. Hand it to Shane with this
summary rather than executing it:

> `sharepoint/fix-job-startdates.js` realigns `Jobs.StartDate` on the three demo pools with each
> pool's first scheduled sub-phase. It has a `DRY_RUN` flag at the top — run it with `DRY_RUN = true`
> first and read the plan, then again with `false`. Idempotent: a second run reports 0 changed.
> Paste into the browser console on the site, signed in as `stratirus@d2pools.com`. The script's own
> header records why this is safe: nothing reads the field after creation, no flow triggers on the
> Jobs list, and `Late-Starting Jobs` filters on `Assignments.ScheduledStart` instead.

Afterwards, re-capture the fixture (Task 1's recipe, `jobs` array only) so `live-payloads.json`
reflects the corrected rows, and note in the commit that the drift is corrected in the tenant while
the flow gap behind it stays open.

---

### Task 8: D11 — say whether what is on screen is live

Four actions rewrite every unlocked row in every pool, and there is no dirty flag, no last-loaded
stamp and no diff view. A PM cannot tell whether the Gantt is the live schedule or something they
reflowed twenty minutes ago. Tolerable in a local scratchpad, not tolerable in a live-data app.

**Files:**
- Modify: `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`
- Create: `fixtures/planner/freshness.js`

**Interfaces:**
- Consumes: `S.settings` (Task 3 established it is always an object); `sections[].id` (Task 2).
- Produces: `S.settings.loadedAt` (ISO string), `S.settings.exportedOn` (the payload's own date),
  `j.touchedAt` per pool, `s.base` per sub-phase (the imported baseline), and `divergedSecs(j)`.

**Scope note, added mid-session.** Shane has asked for a batch write-back — "when finished press
save to batch write back". That is spec Stage 2 and is **not** built here. But it changes the shape
of this task, because a write-back's payload is precisely "what diverged from the last load", and
computing that from a per-pool boolean is impossible. So this task records the baseline **per
sub-phase** and derives the pool-level marker from it. The result is the same badge, over a
structure the write-back can actually read. Cost of being wrong: a small snapshot in `localStorage`
that nothing reads.

- [ ] **Step 1: Write the failing test**

Create `fixtures/planner/freshness.js`:

```js
/* D11: the planner must say whether what is on screen is the live schedule.
 *
 * Auto-Schedule, the drawer save, sign-off and bulk tick all rewrite state with
 * no record that they did, so a PM cannot tell a fresh import from something they
 * reflowed twenty minutes ago.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const PLANNER = path.resolve(__dirname, '../../D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html');
let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const html = fs.readFileSync(PLANNER, 'utf8').replace('</body>',
  `<script>window.__x=()=>{window.S=S;window.allSecs=allSecs;window.importFromD2=importFromD2;
    window.autoSchedule=autoSchedule;window.SEED_TEMPLATE=SEED_TEMPLATE;
    window.divergedSecs=divergedSecs;};</script><script>__x();</script></body>`);
const vc = new VirtualConsole(); vc.on('jsdomError', e => console.log('[jsdom]', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window;
win.confirm = () => true; win.alert = () => {};

(async () => {
  await new Promise(r => setTimeout(r, 600));
  const S = win.S;

  const T = win.SEED_TEMPLATE;
  const secDefs = T.flatMap(g => g.sections.map(s => ({ num: s.num, name: s.name, tasks: s.tasks })));
  const payload = {
    app: 'D2 Pool Build Scheduler', kind: 'd2-sharepoint-export', exported: '2026-09-11',
    site: 'https://example', nonWork: ['2026-10-12'],
    jobs: [{
      id: 19, jobno: 'D2-1042', name: 'Reyes Residence', addr: '', city: '', start: '2026-09-08',
      status: 'Active', pm: 'Cody Campbell',
      sections: secDefs.map((s, i) => ({
        id: 1000 + i, num: s.num, name: s.name, crewId: 'devon',
        start: '2026-09-08', finish: '2026-09-09',
        days: 2, skip: false, locked: false, inst: false, pm: false,
        tasks: s.tasks.map((t, k) => ({ seq: k + 1, title: t, done: false, na: false }))
      }))
    }]
  };

  win.importFromD2(new win.File([JSON.stringify(payload)], 'd2.json', { type: 'application/json' }));
  await new Promise(r => setTimeout(r, 400));

  ok('import stamps when it loaded', !!(S.settings && S.settings.loadedAt), String((S.settings || {}).loadedAt));
  ok('import records the export date', (S.settings || {}).exportedOn === '2026-09-11', String((S.settings || {}).exportedOn));

  const j = S.jobs.find(x => x.jobno === 'D2-1042');
  ok('a freshly imported pool is not marked edited', !j.touchedAt, String(j.touchedAt));

  win.autoSchedule();
  ok('Auto-Schedule marks the pool edited', !!S.jobs.find(x => x.jobno === 'D2-1042').touchedAt,
     String(S.jobs.find(x => x.jobno === 'D2-1042').touchedAt));

  const header = win.document.querySelector('header').textContent;
  ok('the header says how fresh the data is', /Live as of/i.test(header), header.slice(0, 120));

  // --- the baseline, which the batch write-back will diff against (spec Stage 2) ---
  const j2 = S.jobs.find(x => x.jobno === 'D2-1042');
  ok('every imported sub-phase carries a baseline',
     win.allSecs(j2).every(({ s }) => s.base && 'crewId' in s.base),
     win.allSecs(j2).filter(({ s }) => s.base).length + ' of ' + win.allSecs(j2).length);
  ok('the baseline holds the SharePoint row id',
     win.allSecs(j2).every(({ s }) => s.base.id !== undefined));

  // A crew change is divergence; a task tick is not -- the planner is not the
  // authority on sign-off or ticks and must never write them back.
  win.allSecs(j2)[0].s.crewId = 'antonio';
  ok('a crew change shows as divergence', win.divergedSecs(j2).length === 1,
     win.divergedSecs(j2).length + ' diverged');
  win.allSecs(j2)[1].s.tasks[0].done = true;
  ok('a task tick is NOT divergence', win.divergedSecs(j2).length === 1,
     win.divergedSecs(j2).length + ' diverged');

  process.exit(fail);
})();
```

- [ ] **Step 2: Run to verify it fails**

```bash
node fixtures/planner/freshness.js
```

Expected: all five FAIL except `a freshly imported pool is not marked edited`, which passes
vacuously because the field does not exist. That is fine — it is guarding a regression, not driving
the implementation.

- [ ] **Step 3: Stamp the import**

In `importFromD2`, beside the `nonWork` assignment added in Task 3 — same position, after the
`confirm()`, so a cancelled import leaves the stamp alone:

```js
    S.settings=S.settings||{};
    S.settings.exportedOn=d.exported||null;
    S.settings.loadedAt=new Date().toISOString();
```

and, still inside the `(inj.sections||[]).forEach(is=>{ ... })` loop that overlays each section,
record what SharePoint said as the last statement of that loop body:

```js
        /* Baseline: exactly the fields SharePoint owns, as they arrived. Divergence
           is a diff against this rather than a flag, so the same structure answers
           "has this pool been edited here" and "what would a write-back send". */
        s.base={id:is.id??null,crewId:s.crewId??null,start:s.start??null,
                days:s.days??null,locked:!!s.locked,skip:!!s.skip};
```

Then after the `plan.forEach` that writes the sections, clear the edited marker on every pool the
import touched, since it now matches D2 again:

```js
    plan.forEach(({inj})=>{const j=S.jobs.find(x=>String(x.jobno)===String(inj.jobno));if(j)delete j.touchedAt;});
```

Note `s.base` is written **after** the overlay, so it captures the imported values rather than
whatever was in the browser beforehand. A sub-phase the payload did not mention keeps no baseline,
which is correct — SharePoint has never owned it.

- [ ] **Step 4: Mark a pool edited when something rewrites it**

Add two helpers beside `jobStart`:

```js
/* Marks a pool as diverged from the last Load from D2. Everything that rewrites
   schedule or sign-off state calls this, so the header can say plainly whether
   what is on screen is still the live schedule. */
function touch(j){ if(j) j.touchedAt=new Date().toISOString(); }

/* Which sub-phases of this pool no longer match what SharePoint sent. Compares
   only the fields SharePoint owns; sign-off and task ticks are deliberately not
   in the baseline, because the planner has no attribution model for them and must
   never be the authority on either. */
function divergedSecs(j){
  const out=[];
  allSecs(j).forEach(({s})=>{
    const b=s.base; if(!b)return;
    if((s.crewId??null)!==b.crewId || (s.start??null)!==b.start ||
       (s.days??null)!==b.days || !!s.locked!==b.locked || !!s.skip!==b.skip) out.push(s);
  });
  return out;
}
```

Call it from the four mutating paths:

- `autoSchedule` — inside the per-job loop, immediately after `[...S.jobs].sort(...).forEach(j=>{`:
  ```js
    touch(j);
  ```
- `saveSec` — before its `save()`:
  ```js
  touch(S.jobs.find(x=>x.id===CUR.jobId));
  ```
- `sign(jobId, ...)` — before its `save()`:
  ```js
  touch(S.jobs.find(x=>x.id===jobId));
  ```
- `tick` and `toggleNA` and `allTasks` — each already resolves the current section through `cur()`;
  add before their `save()`:
  ```js
  touch(S.jobs.find(x=>x.id===CUR.jobId));
  ```

Locate them with `grep -n 'function autoSchedule\|function saveSec\|function sign\|function tick\|function allTasks\|function toggleNA'`.

- [ ] **Step 5: Show the stamp in the header**

In the `<header>` block, after the existing `Load from D2` button, add a span the renderer fills:

```html
  <span id="freshness" class="small" style="opacity:.75"></span>
```

and update it from `render()` — find the function and add near its top:

```js
  const fz=document.getElementById('freshness');
  if(fz){
    const st=S.settings||{};
    const edited=S.jobs.filter(j=>j.touchedAt).length;
    fz.innerHTML = st.loadedAt
      ? `Live as of ${new Date(st.loadedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`
        + (st.exportedOn?` · export ${st.exportedOn}`:'')
        + (edited?` · <b>${edited} pool${edited===1?'':'s'} edited here since (${S.jobs.reduce((n,j)=>n+divergedSecs(j).length,0)} sub-phases)</b>`:'')
      : 'Not loaded from D2';
  }
```

- [ ] **Step 6: Badge the edited pools**

Extend `jobBadge` from Task 6 so an edited pool is visible on the boards, not only in the header.
Append before its final `return`, and add an early branch:

```js
function jobBadge(j){
  const edited=j.touchedAt?'<span class="chip jb edited" title="Changed here since the last Load from D2">edited here</span>':'';
  if(!j.status)return '<span class="chip jb local" title="Sketched here, not yet raised in D2">Local only</span>'+edited;
  if(j.status==='Active')return edited;
  const cls=j.status==='Planned'?'planned':j.status==='On Hold'?'hold':'other';
  return `<span class="chip jb ${cls}" title="Jobs.Status in D2">${esc(j.status)}</span>`+edited;
}
```

and the style:

```css
.chip.jb.edited{background:#fff7ed;color:#9a3412;border-color:#fed7aa}
```

- [ ] **Step 7: Run the test and the regression set**

```bash
node fixtures/planner/freshness.js && node fixtures/planner/determinism.js \
  && node fixtures/planner/roundtrip.js && node fixtures/planner/empty.js \
  && node fixtures/planner/live-export.js && node fixtures/planner/workcalendar.js \
  && node fixtures/planner/schedulecheck.js && node fixtures/planner/startdate.js && node oracle-test.js
```

- [ ] **Step 8: Register the harness in the README, then commit**

```bash
git add D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html \
        fixtures/planner/freshness.js fixtures/planner/README.md
git commit -m "D11: show how fresh the loaded schedule is and which pools diverge from it"
```

---

### Task 9: Repaint into the D2 palette

The planner is teal `#0f766e` on `#0b1220` with a system font stack, which matches nothing else in
this system. The site theme, the list-view cards, the canvas app and both summary emails already
share the measured D2 palette read from d2pools.com.

**Files:**
- Modify: `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html` (`<style>` block and
  `<head>`)

**Interfaces:** none.

**Palette, measured rather than chosen** — read from d2pools.com computed styles weighted by
painted area: navy `#082544`, green `#0B594B`, cream `#F6F3ED`. Fonts are Poppins (headings) and
Source Sans Pro (body). SharePoint refuses to load them; our own hosting has no such restriction.

**Leave `crewColor()` alone.** Crew bars need to stay mutually distinguishable and are not brand
surfaces. Leave the semantic colours (`--danger`, `--warn`, `--ok`) and the Task 6 status badges
alone for the same reason.

- [ ] **Step 1: Add the fonts**

In `<head>`, before the `<style>` block:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
```

Source Sans Pro is published as **Source Sans 3** on Google Fonts; the old name 404s silently and
you get the fallback with no error. Give both a real fallback stack so a blocked font request
degrades rather than breaks.

- [ ] **Step 2: Repaint the custom properties**

Replace the `:root` block:

```css
:root{
  /* D2 brand, measured from d2pools.com by painted area. The site theme, the
     SharePoint list cards, the field app and both summary emails use these three. */
  --navy:#082544; --green:#0B594B; --cream:#F6F3ED;
  --bg:var(--cream); --panel:#fff; --ink:#111827; --muted:#6b7280; --line:#e3ded4;
  --accent:var(--green); --danger:#b91c1c; --warn:#a84a18; --ok:#0B594B;
  --day:26px; --nmw:400px;
}
```

`--warn` moves to the rust `#a84a18` the summary emails already use as their warning signal, so the
two surfaces agree.

- [ ] **Step 3: Apply the fonts and the navy chrome**

```css
body{margin:0;font:14px/1.45 "Source Sans 3","Source Sans Pro",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{background:var(--navy);color:#fff;padding:9px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:60}
header h1{font-size:14px;margin:0;font-weight:600;font-family:Poppins,"Segoe UI",sans-serif;letter-spacing:.2px}
nav{display:flex;gap:2px;background:rgba(255,255,255,.10);border-radius:8px;padding:3px}
nav button{background:none;border:0;color:#cfd8e4;padding:6px 11px;border-radius:6px;font:inherit;font-size:12.5px;cursor:pointer}
nav button.on{background:#fff;color:var(--navy);font-weight:600}
```

The nav background moves from the hard-coded `#1c2434` to a translucent white so it tracks the navy
automatically instead of needing a second matched colour.

- [ ] **Step 4: Repaint the remaining hard-coded greys**

The primary button's hover is a hand-picked darker teal and must move with the accent:

```css
.btn.p:hover{background:#094539}
```

Card headings pick up Poppins, and the several `#fafafa` panel fills move to a cream tint so the
white cards read against the page rather than blending:

```css
.card > h2{margin:0;font-size:12.5px;padding:9px 13px;border-bottom:1px solid var(--line);background:#fbf9f5;font-weight:600;font-family:Poppins,"Segoe UI",sans-serif;letter-spacing:.3px;text-transform:uppercase;color:var(--navy);display:flex;align-items:center;gap:8px}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);font-weight:600;background:#fbf9f5}
```

Then sweep the rest:

```bash
grep -n '#fafafa\|#0f766e\|#0b1220\|#1c2434\|#c9d2e3' D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html
```

Every remaining `#fafafa` is a panel or sticky-header fill — replace with `#fbf9f5`. There should be
no `#0f766e`, `#0b1220`, `#1c2434` or `#c9d2e3` left after Steps 2 and 3.

- [ ] **Step 5: Verify it renders, because a stylesheet cannot be verified by reading it**

```bash
node fixtures/planner/empty.js
```

Confirms the file still parses and renders under jsdom with no errors. That is a syntax check, not a
visual one — jsdom does not paint.

**Then open the file in a real browser** and look at it. Check: the header is navy not black-blue,
the page ground is cream not grey, primary buttons are green, the Gantt bars are still mutually
distinguishable, and the today marker is still legible against the new ground. This project's
dominant failure signature is a change that reports success and renders wrong, and a palette is the
purest example.

- [ ] **Step 6: Run the full regression set, then commit**

```bash
node fixtures/planner/determinism.js && node fixtures/planner/roundtrip.js \
  && node fixtures/planner/empty.js && node fixtures/planner/live-export.js \
  && node fixtures/planner/workcalendar.js && node fixtures/planner/schedulecheck.js \
  && node fixtures/planner/startdate.js && node fixtures/planner/freshness.js && node oracle-test.js
```

```bash
git add D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html
git commit -m "Repaint the planner into the measured D2 palette"
```

---

### Task 10: Move the planner to `web/` and add the Static Web Apps config

Repo layout for the hosting lane. Deliberately last, so it does not churn paths under the other nine
tasks. **Move, not copy** — this repo has already been burned by a described-but-nonexistent
`patched-tool/` directory and by `flows/definitions/` drifting behind live. One copy is the rule.

**Files:**
- Move: `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html` → `web/index.html`
- Create: `web/staticwebapp.config.json`
- Modify: every file that references the old path

**Interfaces:** none.

- [ ] **Step 1: Find every reference before moving anything**

```bash
grep -rn "pool-scheduler.html" --include="*.js" --include="*.md" --include="*.json" --include="*.py" . \
  | grep -v node_modules
```

Expect hits in: the five `fixtures/planner/*.js` harnesses, `oracle-test.js`, `CLAUDE.md`,
`docs/planner-vs-sharepoint-parity.md`, the Phase H spec, `fixtures/planner/README.md`, and
`sharepoint/build-navigation.js` (a commented-out `download.aspx` link — leave that one alone, it
refers to the SharePoint copy, not the repo path).

- [ ] **Step 2: Move with git so history follows**

```bash
mkdir -p web
git mv D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html web/index.html
```

- [ ] **Step 3: Update every code reference**

In each of `fixtures/planner/determinism.js`, `roundtrip.js`, `empty.js`, `live-export.js`,
`workcalendar.js`, `schedulecheck.js`, `startdate.js`, `freshness.js` and `oracle-test.js`, the path
constant becomes:

```js
path.resolve(__dirname, '../../web/index.html')     // in fixtures/planner/*
path.resolve(__dirname, 'web/index.html')           // in oracle-test.js at the repo root
```

Check each file's actual expression — some use `path.join(ROOT, ...)` with a `ROOT` already
resolved. Do not assume they are identical.

- [ ] **Step 4: Write the Static Web Apps config**

Create `web/staticwebapp.config.json`:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/*.{png,jpg,gif,svg,ico,css,js,json}"]
  },
  "responseOverrides": {
    "404": { "rewrite": "/index.html" }
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "mimeTypes": {
    ".json": "application/json"
  }
}
```

No `auth` or `routes` block yet. Identity comes from MSAL in the browser, which is the auth lane and
is not in this plan. Adding a half-configured `routes` block now would be a guess.

- [ ] **Step 5: Run every harness from the new path**

```bash
node fixtures/planner/determinism.js && node fixtures/planner/roundtrip.js \
  && node fixtures/planner/empty.js && node fixtures/planner/live-export.js \
  && node fixtures/planner/workcalendar.js && node fixtures/planner/schedulecheck.js \
  && node fixtures/planner/startdate.js && node fixtures/planner/freshness.js && node oracle-test.js
```

All must be green. A missed path constant shows up as a thrown `ENOENT`, not a quiet skip — except
`live-export.js`, which has a `SKIP` branch when its fixture is missing. Read its output rather than
its exit code.

- [ ] **Step 6: Update the prose references**

`CLAUDE.md` names the doubled `D2-Build-Scheduler/D2-Build-Scheduler/app/` path in several places,
and the parity map's line numbers are all relative to that file. Update the paths; leave the line
numbers, which are still valid for the same content. Note in `CLAUDE.md` that the old directory no
longer holds the planner, so a future session does not go looking for it — that is precisely the
failure recorded under "Companion tools".

- [ ] **Step 7: Confirm nothing was left behind**

```bash
grep -rn "D2-Build-Scheduler/D2-Build-Scheduler/app" --include="*.js" --include="*.md" --include="*.json" . | grep -v node_modules
ls D2-Build-Scheduler/D2-Build-Scheduler/app/ 2>/dev/null
```

Expected: no code hits (session logs under `sessions/` may still mention it — those are historical
record and are deliberately not rewritten), and the `app/` directory is empty or gone.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Move the planner to web/index.html and add the Static Web Apps config"
```

---

## What this plan does NOT do

Stated so the boundary is explicit and a later reader does not think these were missed.

- **No Graph read layer.** The export stays a console-paste script on SharePoint REST. Moving the
  read to Graph is the auth lane, it needs one Entra app registration, and it must start by
  capturing a real Graph payload into `fixtures/planner/live-payloads-graph.json` — Graph is a
  **third** field-shape surface and the existing REST fixture does not validate it.
- **No hosting.** No Azure subscription, no pipeline, no deploy. Task 10 lays out the repo for it
  and stops there.
- **Nothing from spec §1.8 "What retires."** Restoring the `Planner` nav link under Pools, deleting
  `Shared Documents/pool-scheduler.html` so there is one planner rather than two, and putting the
  planner section back into the PM guide all need a live URL to point at, so they belong to the
  hosting lane. `sharepoint/build-navigation.js` already carries the link commented out with the
  reasoning, and `pull-planner-link.js` removed it deliberately; leave both alone until there is
  somewhere to point.
- **No write-back.** Stage 2, and now an explicit requirement rather than a someday: Shane asked
  mid-session for "some sort of batch write-back — when finished press save to batch write back".
  Two things here exist to serve it and nothing more: Task 2 exports the SharePoint row ids, and
  Task 8 records a per-sub-phase baseline so divergence is a diff rather than a flag. The write-back
  itself needs its own spec, because three questions are open and none has an obvious default — how
  it authenticates (there is no credential from `file://`, so it is gated on the hosting and auth
  lane, or on a companion console script mirroring how the export works today); what happens when
  two PMs push overlapping edits (the spec says ETags with `If-Match` for direct row writes); and
  whether a reflow goes as a `Reschedule Requests` row rather than as direct date writes, which is
  what `D2 - Reschedule Pool` exists for.
  **The field scope is already settled and must not widen:** crew, dates, duration, locked and skip.
  Never sign-off, never task ticks. The planner's `inst`/`pm` are bare booleans with no attribution,
  timestamp or notes, while SharePoint holds `InstallerSignOffBy`/`On` and `SignOffNotes`, so
  writing them back would replace an attested sign-off with a flag. That is the standing reason the
  nightly sync was descoped and it does not change.
- **No fix for D8's other half** — the drawer's `all` / `none` bulk-tick links still offer a
  one-click route around the sign-off gate. Task 4 narrows them so they cannot silently resolve an
  N/A row, but the bulk tick itself stays. It only matters once the planner writes back, which is
  Stage 2.
- **Neither of the planner's two known internal bugs.** `qualified()` and `isQualified()` disagree
  on the `FIXED` pseudo-trade codes, so picking STL Shotcrete for an `@office` sub-phase raises no
  error at all; and `autoSchedule`'s busy map does not exempt `unlimited` crews while `busyMap()`
  does, so a subcontractor can be skipped as busy in violation of rule 2's capacity exemption. Both
  are recorded in the parity map and the spec puts them in Stage 2.
- **Nothing about the six remaining parity divergences** (D1, D3, D5, D6, D10, and the C-bucket
  walls). The spec says six can wait.
- **The `Jobs.StartDate` flow gap stays open.** Task 7 corrects the symptom in two places and the
  reflow still never writes the field back. The product question — should a reflow move the job's
  own start date, and presumably only when `FromSequence` is 1 — is not this plan's to answer.

## Exit criteria

Phase H Stage 1's local half is done when all of the following hold:

| Gate | Expected |
|---|---|
| `node fixtures/planner/workcalendar.js` | 6/6 PASS, 138 spans agree with SharePoint |
| `node fixtures/planner/schedulecheck.js` | 2/2 PASS |
| `node fixtures/planner/startdate.js` | 3/3 PASS |
| `node fixtures/planner/freshness.js` | 5/5 PASS |
| `node fixtures/planner/live-export.js` | all PASS, including the 7 new assertions |
| `node fixtures/planner/roundtrip.js` | 16/16 PASS, unchanged |
| `node fixtures/planner/determinism.js` | STABLE, 0 drifted picks |
| `node fixtures/planner/empty.js` | clean, 0 jsdom errors |
| `node oracle-test.js` | **15/16** — invariant 9 flips, invariant 11 stays (Don's trade mapping) |
| Opened in a real browser | navy header, cream ground, green primaries, Gantt bars still distinguishable |
| `git grep D2-Build-Scheduler/D2-Build-Scheduler/app` | no code hits |

Then the hosting lane can start against a planner that is correct and branded, rather than against
a shell that has to be patched in place.
