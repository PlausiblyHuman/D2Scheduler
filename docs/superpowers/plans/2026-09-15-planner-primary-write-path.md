# Planner Primary Write Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hosted planner able to push schedule edits, commit a pool, and request a new pool directly over Microsoft Graph, so a PM never has to open SharePoint for day-to-day work.

**Architecture:** A pure-function decision core (`web/writeback-core.js`) holds the five safety properties and is testable without a tenant. A separate Graph I/O layer (`web/graph-writeback.js`) holds everything surface-shaped: URLs, PATCH/POST bodies, and site-user resolution. `web/index.html` wires them behind the Save preview that already exists. The console applier is frozen and guarded by a parity test.

**Tech Stack:** Vanilla ES5-compatible browser JS with a UMD wrapper (same pattern as `web/graph-to-planner.js`), Node 24 + jsdom for harnesses, Microsoft Graph v1.0, MSAL browser 2.38.3 (vendored, do not upgrade).

**Spec:** `docs/superpowers/specs/2026-09-15-planner-as-primary-write-path-design.md`

## Global Constraints

- **The write allowlist is exactly five Assignments columns:** `Crew`, `ScheduledStart`, `DurationDays`, `Locked`, `NotApplicable`. `ScheduledFinish` is derived and is NEVER sent. No Tasks-list field and no sign-off field may become reachable from any code path in this plan.
- **Graph endpoint for an item write:** `PATCH https://graph.microsoft.com/v1.0/sites/{siteId}/lists/{listId}/items/{id}/fields`.
- **Graph field shapes, verified on the live tenant 2026-09-15:** Choice takes a plain string; DateOnly takes a bare `yyyy-MM-dd` and stores site-local midnight; Number and Boolean pass through; DateTime takes an ISO 8601 string.
- **Never `new Date()` a SharePoint DateOnly value.** Use `String(v).slice(0, 10)`. This project fixed a one-day-early bug across every list once already.
- **Normalise both sides of every join with `String()`.** Graph returns lookup ids and item ids as strings; REST returns numbers.
- **Identity comes from the MSAL account object** (`pca.getActiveAccount().username`), never from `/me`. The token is scoped to `Sites.ReadWrite.All` only and cannot call `/me`.
- **Site-user resolution matches on the User Information List's `Name` claims string**, never `EMail`, and must produce exactly one match or refuse.
- **No new runtime dependency.** No CDN. Everything ships from `web/`.
- **Every new assertion must be watched failing before it is trusted.** Mutate the production code, confirm red, revert, confirm green. This repo has shipped four vacuous harnesses.
- **Site and list ids** are already in `D2_GRAPH` in `web/index.html`. Do not retype them as a second source of truth.
- **Copy rule:** user-facing strings never name D2 as the other party. Say "SharePoint" where a referent is genuinely needed.

---

## File Structure

| File | Responsibility |
|---|---|
| `web/writeback-core.js` (create) | Pure decisions: allowlist, per-field compare, row identity, suppression stamp, edit and create planners. No I/O. |
| `web/graph-writeback.js` (create) | Graph I/O only: read rows, PATCH fields, POST an item, resolve a site-user id. |
| `web/index.html` (modify) | Load both scripts; Push behind the Save preview; results dialog; staleness warning; Commit control; `+ Job` create. |
| `fixtures/planner/writeback-core.js` (create) | The five safety properties as pure-function tests. |
| `fixtures/planner/graph-write.js` (create) | Exact URLs and bodies produced from a change-set plus the captured Graph payload. |
| `fixtures/planner/writeback-parity.js` (create) | Allowlist agreement across planner, core, and the frozen console applier. |
| `fixtures/planner/README.md` (modify) | Add the three new harnesses to the run list. |

---

### Task 1: The decision core

**Files:**
- Create: `web/writeback-core.js`
- Test: `fixtures/planner/writeback-core.js`

**Interfaces:**
- Consumes: nothing.
- Produces, on `window.D2WritebackCore` in a browser and `module.exports` in Node:
  - `ALLOWLIST` — `['Crew','ScheduledStart','DurationDays','Locked','NotApplicable']`
  - `FIELD_DEFS` — `{ [col]: { read(liveRow), eq(a,b), write(v) } }`
  - `titleMatches(title, jobno, num) -> boolean`
  - `jobKey(v) -> string`
  - `suppressUntil(nowMs, minutes) -> string` (ISO)
  - `planEdits(pools, liveById, opts) -> { writes, refusals, errors }` where
    `writes` is `[{ id, jobno, num, title, fields, suppressUntil }]`,
    `refusals` is `[{ id, jobno, num, col, loaded, nowLive, wanted, reason }]`,
    `errors` is `[{ id, jobno, num, reason }]`,
    `opts` is `{ nowMs, suppressMinutes }`
  - `planCreates(creates, liveJobNumbers, pendingJobNumbers) -> { creates, refusals }`

- [ ] **Step 1: Write the failing test**

Create `fixtures/planner/writeback-core.js`:

```js
/* The five safety properties of the write path, as pure functions.
 * These are the assertions that do not need a tenant, which is exactly why
 * the decisions were pulled out of the I/O layer in the first place. */
const path = require('path');
const C = require(path.resolve(__dirname, '../../web/writeback-core.js'));

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

// A live row as Graph returns it (ids are STRINGS on that surface).
const live = (over) => Object.assign({
  id: '384', Title: 'D2-1044 · 3.5 Bonding Grid Completion', Crew: 'subcon',
  ScheduledStart: '2026-09-22T05:00:00Z', ScheduledFinish: '2026-09-23T05:00:00Z',
  DurationDays: 2, Locked: false, NotApplicable: false
}, over || {});

const pool = (fields, over) => [{
  jobno: 'D2-1044', name: 'Salcedo Residence',
  sections: [Object.assign({ id: '384', seq: 19, num: '3.5', name: 'Bonding Grid Completion', fields }, over || {})]
}];

const OPTS = { nowMs: Date.parse('2026-09-15T12:00:00Z'), suppressMinutes: 10 };

// ---- 1. allowlist ----
ok('allowlist is exactly the five owned columns',
   C.ALLOWLIST.join(',') === 'Crew,ScheduledStart,DurationDays,Locked,NotApplicable',
   C.ALLOWLIST.join(','));
ok('ScheduledFinish is not writable', C.ALLOWLIST.indexOf('ScheduledFinish') === -1);
{
  const r = C.planEdits(pool({ InstallerSignOff: { from: false, to: true } }), { '384': live() }, OPTS);
  ok('a sign-off field in a hostile change-set is refused, never written',
     r.writes.length === 0 && r.refusals.some(x => x.reason === 'not-allowlisted'),
     JSON.stringify(r.refusals));
}

// ---- 2. compare-before-write, PER FIELD ----
{
  const r = C.planEdits(
    pool({ Crew: { from: 'subcon', to: 'saul' }, DurationDays: { from: 2, to: 3 } }),
    { '384': live({ DurationDays: 4 }) },   // somebody else moved the duration
    OPTS);
  ok('a field whose live value diverged from the baseline is refused',
     r.refusals.length === 1 && r.refusals[0].col === 'DurationDays', JSON.stringify(r.refusals));
  ok('...and the refusal reports loaded, nowLive and wanted',
     r.refusals[0].loaded === 2 && r.refusals[0].nowLive === 4 && r.refusals[0].wanted === 3);
  ok('...while the OTHER changed field on the SAME row still lands',
     r.writes.length === 1 && r.writes[0].fields.Crew === 'saul' &&
     !('DurationDays' in r.writes[0].fields), JSON.stringify(r.writes));
}

// ---- 3. row identity, token-anchored ----
{
  const r = C.planEdits(pool({ Crew: { from: 'subcon', to: 'saul' } }, { num: '3.5' }),
                        { '384': live({ Title: 'D2-1044 · 3.50 Something Else' }) }, OPTS);
  ok('a 3.5 edit does NOT match a 3.50 row (substring match would)',
     r.writes.length === 0 && r.errors.some(e => e.reason === 'identity-mismatch'),
     JSON.stringify(r.errors));
}
ok('titleMatches accepts the real row', C.titleMatches('D2-1044 · 3.5 Bonding Grid', 'D2-1044', '3.5'));
ok('titleMatches rejects a different job', !C.titleMatches('D2-1042 · 3.5 Bonding Grid', 'D2-1044', '3.5'));
{
  const r = C.planEdits(pool({ Crew: { from: 'subcon', to: 'saul' } }), {}, OPTS);
  ok('a row that is no longer live is an error, not a silent skip',
     r.writes.length === 0 && r.errors.some(e => e.reason === 'row-missing'));
}

// ---- 4. suppression, in the SAME write ----
{
  const r = C.planEdits(pool({ Crew: { from: 'subcon', to: 'saul' } }), { '384': live() }, OPTS);
  ok('every write carries a suppression stamp',
     r.writes.length === 1 && !!r.writes[0].suppressUntil, JSON.stringify(r.writes[0]));
  ok('...set ahead of now, not behind it',
     Date.parse(r.writes[0].suppressUntil) > OPTS.nowMs, r.writes[0].suppressUntil);
  ok('...by exactly the requested window',
     Date.parse(r.writes[0].suppressUntil) === OPTS.nowMs + 10 * 60000);
}

// ---- date normalisation, both sides ----
{
  const r = C.planEdits(pool({ ScheduledStart: { from: '2026-09-22', to: '2026-10-01' } }),
                        { '384': live() }, OPTS);
  ok('a live DateOnly is compared on its DATE PART, so an unchanged date is not a false divergence',
     r.writes.length === 1, JSON.stringify(r.refusals));
  ok('...and the written value is a bare yyyy-MM-dd, never an ISO timestamp',
     r.writes[0].fields.ScheduledStart === '2026-10-01', r.writes[0].fields.ScheduledStart);
}

// ---- 5. creates: refuse rather than guess ----
{
  const r = C.planCreates([{ jobno: 'D2-1042', name: 'X', start: '2026-10-01' }], ['D2-1042'], []);
  ok('a job number that already exists live is refused',
     r.creates.length === 0 && r.refusals.length === 1, JSON.stringify(r.refusals));
}
{
  const r = C.planCreates([{ jobno: 'D2-1099', name: 'X', start: '2026-10-01' }], [], ['d2-1099']);
  ok('a job number already queued in New Pool Requests is refused (re-run safety)',
     r.creates.length === 0 && r.refusals.length === 1);
}
{
  const r = C.planCreates([{ jobno: ' d2-1042 ', name: 'X', start: '2026-10-01' }], ['D2-1042'], []);
  ok('the duplicate check is case- and whitespace-insensitive, as SharePoint\'s own filter is',
     r.creates.length === 0, JSON.stringify(r.creates));
}
{
  const r = C.planCreates([{ jobno: 'D2-1099', name: '', start: '2026-10-01' }], [], []);
  ok('a create missing a required field is refused before any request is sent',
     r.creates.length === 0 && r.refusals.length === 1);
}
{
  const r = C.planCreates([{ jobno: 'D2-1099', name: 'X', start: '2026-10-01', assignDefaultCrews: true }], [], []);
  ok('a valid create survives and carries assignDefaultCrews explicitly',
     r.creates.length === 1 && r.creates[0].assignDefaultCrews === true);
}

process.exit(fail);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node fixtures/planner/writeback-core.js`
Expected: FAIL — `Cannot find module '.../web/writeback-core.js'`

- [ ] **Step 3: Write the implementation**

Create `web/writeback-core.js`:

```js
/* Surface-independent decisions for the planner write-back.
 *
 * WHY THIS IS SEPARATE FROM web/graph-writeback.js: everything here is a
 * decision about DATA -- may this field be written, has it diverged, is this
 * the right row -- and none of it depends on whether the bytes travel over
 * Graph, over SharePoint REST, or over a connector. The surface-shaped half
 * lives next door and is tested against a captured payload, because Graph is
 * a THIRD field-shape surface and this project has lost six cycles to
 * assuming one surface's shape carries to another.
 *
 * Pure functions only. Nothing here calls fetch, reads the DOM, or knows what
 * a site id is. That is what makes the five safety properties testable
 * without a tenant.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.D2WritebackCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // SharePoint DateOnly lands at site-local midnight, so the first 10
  // characters are already the intended day. Never new Date() this -- that
  // reintroduces the 2026-09-03 off-by-one that had to be fixed across every
  // list once already.
  function day(v) { return v ? String(v).slice(0, 10) : null; }

  // Comparison key for a job number only. SharePoint's own $filter on a Text
  // column is case-insensitive while a JS Set is not, so without this a
  // lower-cased duplicate sails past our check and is refused by the flow ten
  // minutes later. Never used for the value actually written.
  function jobKey(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

  // THE ALLOWLIST. The only Assignments columns this system will ever write.
  // ScheduledFinish is derived from start + duration and is never sent.
  var ALLOWLIST = ['Crew', 'ScheduledStart', 'DurationDays', 'Locked', 'NotApplicable'];

  var FIELD_DEFS = {
    Crew:           { read: function (r) { return r.Crew || null; },
                      eq: function (a, b) { return (a || null) === (b || null); } },
    ScheduledStart: { read: function (r) { return day(r.ScheduledStart); },
                      eq: function (a, b) { return (a || null) === (b || null); },
                      write: day },
    DurationDays:   { read: function (r) { return r.DurationDays == null ? null : r.DurationDays; },
                      eq: function (a, b) { return (a == null ? null : a) === (b == null ? null : b); } },
    Locked:         { read: function (r) { return !!r.Locked; },
                      eq: function (a, b) { return !!a === !!b; } },
    NotApplicable:  { read: function (r) { return !!r.NotApplicable; },
                      eq: function (a, b) { return !!a === !!b; } }
  };

  function writeVal(col, v) {
    return FIELD_DEFS[col].write ? FIELD_DEFS[col].write(v) : v;
  }

  /* Row identity. TOKEN-ANCHORED, not a substring test: a plain indexOf lets
   * a "2.1" edit land on a "2.10" row. Dormant only because the current
   * template tops out at 7.0, and proven by exploit test. */
  function titleMatches(title, jobno, num) {
    var t = String(title == null ? '' : title);
    if (jobKey(t).indexOf(jobKey(jobno)) !== 0) return false;
    var toks = t.split(/[^0-9.]+/).filter(Boolean);
    return toks.indexOf(String(num)) !== -1;
  }

  function suppressUntil(nowMs, minutes) {
    return new Date(nowMs + minutes * 60000).toISOString();
  }

  /* Turn a change-set plus the live rows into what may be written.
   * Compare-before-write is per FIELD, not per row: a row with two changed
   * fields can have one refused and the other land. */
  function planEdits(pools, liveById, opts) {
    opts = opts || {};
    var nowMs = opts.nowMs == null ? Date.now() : opts.nowMs;
    var mins = opts.suppressMinutes == null ? 10 : opts.suppressMinutes;
    var stamp = suppressUntil(nowMs, mins);
    var writes = [], refusals = [], errors = [];

    (pools || []).forEach(function (p) {
      (p.sections || []).forEach(function (sec) {
        var id = String(sec.id);
        var where = { id: id, jobno: p.jobno, num: sec.num };
        var liveRow = liveById && liveById[id];
        if (!liveRow) { errors.push(Object.assign({}, where, { reason: 'row-missing' })); return; }
        if (!titleMatches(liveRow.Title, p.jobno, sec.num)) {
          errors.push(Object.assign({}, where, { reason: 'identity-mismatch', liveTitle: liveRow.Title }));
          return;
        }
        var fields = {};
        Object.keys(sec.fields || {}).forEach(function (col) {
          var d = sec.fields[col];
          if (ALLOWLIST.indexOf(col) === -1) {
            refusals.push(Object.assign({}, where, { col: col, reason: 'not-allowlisted',
              loaded: d && d.from, nowLive: null, wanted: d && d.to }));
            return;
          }
          var def = FIELD_DEFS[col];
          var nowLive = def.read(liveRow);
          if (!def.eq(nowLive, d.from)) {
            refusals.push(Object.assign({}, where, { col: col, reason: 'diverged',
              loaded: d.from, nowLive: nowLive, wanted: d.to }));
            return;
          }
          fields[col] = writeVal(col, d.to);
        });
        if (Object.keys(fields).length) {
          writes.push({ id: id, jobno: p.jobno, num: sec.num, title: liveRow.Title,
                        fields: fields, suppressUntil: stamp });
        }
      });
    });
    return { writes: writes, refusals: refusals, errors: errors };
  }

  var REQUIRED_CREATE = ['jobno', 'name', 'start'];

  /* A create is never a partial update of arbitrary fields, so there is no
   * FIELD_DEFS equivalent here. The duplicate check spans live Jobs AND
   * pending requests: the documented run instructions train a re-run, because
   * a request sits at "Building" for a quarter of an hour and looks stuck,
   * and two requests in one trigger batch yields 92 assignments. */
  function planCreates(creates, liveJobNumbers, pendingJobNumbers) {
    var taken = {};
    (liveJobNumbers || []).concat(pendingJobNumbers || []).forEach(function (n) { taken[jobKey(n)] = true; });
    var out = [], refusals = [];
    (creates || []).forEach(function (c) {
      var missing = REQUIRED_CREATE.filter(function (k) { return !String(c[k] == null ? '' : c[k]).trim(); });
      if (missing.length) {
        refusals.push({ jobno: c.jobno, reason: 'missing-required', missing: missing });
        return;
      }
      if (taken[jobKey(c.jobno)]) {
        refusals.push({ jobno: c.jobno, reason: 'duplicate-job-number' });
        return;
      }
      taken[jobKey(c.jobno)] = true;   // guard duplicates WITHIN one batch too
      out.push({ jobno: String(c.jobno).trim(), name: c.name, addr: c.addr || '',
                 city: c.city || '', start: day(c.start),
                 assignDefaultCrews: !!c.assignDefaultCrews });
    });
    return { creates: out, refusals: refusals };
  }

  return { ALLOWLIST: ALLOWLIST, FIELD_DEFS: FIELD_DEFS, titleMatches: titleMatches,
           jobKey: jobKey, suppressUntil: suppressUntil, planEdits: planEdits,
           planCreates: planCreates, day: day };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node fixtures/planner/writeback-core.js`
Expected: every line PASS, exit 0.

- [ ] **Step 5: Prove the assertions are not vacuous**

For each mutation below, apply it to `web/writeback-core.js`, run the harness, confirm a FAIL naming the right assertion, then revert and confirm green again.

1. In `planEdits`, delete the `if (ALLOWLIST.indexOf(col) === -1)` block. Expect the sign-off assertion to fail.
2. In `planEdits`, change `if (!def.eq(nowLive, d.from))` to `if (false)`. Expect the divergence assertions to fail.
3. In `titleMatches`, replace the token test with `return t.indexOf(String(num)) !== -1;`. Expect the 3.50 assertion to fail.
4. In `suppressUntil`, change `+ minutes * 60000` to `- minutes * 60000`. Expect the suppression-ahead-of-now assertion to fail.
5. In `FIELD_DEFS.ScheduledStart`, delete the `write: day` property. Expect the bare-date assertion to fail.
6. In `planCreates`, delete the `taken[jobKey(c.jobno)] = true;` line inside the loop. Expect no failure from the current tests — **this is a real gap**, so add an assertion that two creates of the same job number in ONE batch produce one create and one refusal, then re-run the mutation and confirm it now fails.

- [ ] **Step 6: Commit**

```bash
git add web/writeback-core.js fixtures/planner/writeback-core.js
git commit -m "Add the write-back decision core, with the five safety properties as pure functions"
```

---

### Task 2: Allowlist parity across the three copies

**Files:**
- Create: `fixtures/planner/writeback-parity.js`

**Interfaces:**
- Consumes: `ALLOWLIST` from Task 1.
- Produces: nothing consumed by later tasks.

The allowlist now lives in three places: `WRITEBACK_FIELDS` in `web/index.html`, `ALLOWLIST` in the core, and `FIELD_DEFS` in the frozen `sharepoint/apply-planner-changes.js`. The applier is a pasted file and cannot `require` the core, so agreement is asserted instead of shared.

- [ ] **Step 1: Write the failing test**

Create `fixtures/planner/writeback-parity.js`:

```js
/* The write allowlist lives in three files and cannot be shared with the
 * console applier, which is pasted into a browser console and cannot require
 * anything. So agreement is ASSERTED. This is the drift that actually
 * matters: a field added to one copy and not another means the same push is
 * safe from one surface and not the other. */
const fs = require('fs');
const path = require('path');
const C = require(path.resolve(__dirname, '../../web/writeback-core.js'));

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const read = p => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

// --- the planner's own WRITEBACK_FIELDS, parsed out of the col: entries ---
const planner = read('web/index.html');
const block = planner.slice(planner.indexOf('const WRITEBACK_FIELDS='));
const plannerCols = (block.slice(0, block.indexOf('];')).match(/col:\s*'([^']+)'/g) || [])
  .map(s => s.replace(/.*'([^']+)'.*/, '$1'));

// --- the console applier's FIELD_DEFS keys ---
const applier = read('sharepoint/apply-planner-changes.js');
const fd = applier.slice(applier.indexOf('const FIELD_DEFS = {'));
const applierCols = (fd.slice(0, fd.indexOf('\n  };')).match(/^\s{4}(\w+):\s*\{/gm) || [])
  .map(s => s.trim().replace(/:.*/, ''));

ok('the planner names five write-back columns', plannerCols.length === 5, plannerCols.join(','));
ok('the applier names five write-back columns', applierCols.length === 5, applierCols.join(','));
ok('planner and core agree on the allowlist',
   plannerCols.slice().sort().join(',') === C.ALLOWLIST.slice().sort().join(','),
   plannerCols.join(',') + ' vs ' + C.ALLOWLIST.join(','));
ok('applier and core agree on the allowlist',
   applierCols.slice().sort().join(',') === C.ALLOWLIST.slice().sort().join(','),
   applierCols.join(',') + ' vs ' + C.ALLOWLIST.join(','));
ok('no sign-off column appears in any copy',
   ![].concat(plannerCols, applierCols, C.ALLOWLIST).some(c => /SignOff|Notes|Complete/i.test(c)));
ok('ScheduledFinish appears in no copy -- it is derived',
   ![].concat(plannerCols, applierCols, C.ALLOWLIST).includes('ScheduledFinish'));

process.exit(fail);
```

- [ ] **Step 2: Run it**

Run: `node fixtures/planner/writeback-parity.js`
Expected: all PASS. If the parse produces an empty list, fix the parse before continuing — an empty-versus-empty comparison passes vacuously, which is the exact failure this repo has recorded.

- [ ] **Step 3: Prove it is not vacuous**

Temporarily add `'ScheduledFinish'` to `ALLOWLIST` in `web/writeback-core.js`. Run the harness. Expect the agreement assertions AND the ScheduledFinish assertion to fail. Revert, confirm green.

- [ ] **Step 4: Commit**

```bash
git add fixtures/planner/writeback-parity.js
git commit -m "Assert the write allowlist agrees across planner, core and the frozen applier"
```

---

### Task 3: The Graph I/O layer

**Files:**
- Create: `web/graph-writeback.js`
- Test: `fixtures/planner/graph-write.js`

**Interfaces:**
- Consumes: `D2WritebackCore` from Task 1.
- Produces, on `window.D2GraphWriteback` / `module.exports`:
  - `urls(siteId, lists)` -> `{ item(listId, id), fields(listId, id), items(listId), userInfo }`
  - `resolveSiteUserId(rows, upn) -> { id, matches, ambiguous }` (pure; `rows` are `fields` objects)
  - `patchBody(write) -> object` (the exact PATCH body for one `planEdits` write)
  - `createBody(create, projectManagerLookupId) -> object` (the exact POST body)
  - `statusBody(status) -> object`
  - `applyWrites(ctx, writes)` -> `Promise<{ written, failed }>` where `ctx` is `{ token, siteId, listId, fetchImpl }`

- [ ] **Step 1: Write the failing test**

Create `fixtures/planner/graph-write.js`:

```js
/* The Graph-shaped half. Everything asserted here was read off the live
 * tenant on 2026-09-15, never assumed -- see section 3 of the spec.
 * A REST probe does not validate a Graph expression and vice versa. */
const path = require('path');
const G = require(path.resolve(__dirname, '../../web/graph-writeback.js'));

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };

const SITE = 'netorgft15040037.sharepoint.com,1a90e0a0,14d022b7';
const LISTS = { asg: 'ASG-GUID', jobs: 'JOBS-GUID', req: 'REQ-GUID' };
const U = G.urls(SITE, LISTS);

ok('an item field write targets /items/{id}/fields',
   U.fields(LISTS.asg, '384') ===
   'https://graph.microsoft.com/v1.0/sites/' + SITE + '/lists/ASG-GUID/items/384/fields',
   U.fields(LISTS.asg, '384'));
ok('the User Information List is addressed by name',
   U.userInfo.indexOf("/lists/User Information List/items") !== -1, U.userInfo);

// ---- PATCH body ----
{
  const b = G.patchBody({ id: '384', fields: { Crew: 'saul', ScheduledStart: '2026-10-01' },
                          suppressUntil: '2026-09-15T12:10:00.000Z' });
  ok('the PATCH body carries the changed fields verbatim',
     b.Crew === 'saul' && b.ScheduledStart === '2026-10-01', JSON.stringify(b));
  ok('...and the suppression stamp in the SAME body, never a second write',
     b.SuppressReconcileUntil === '2026-09-15T12:10:00.000Z', JSON.stringify(b));
  ok('...and nothing else at all',
     Object.keys(b).sort().join(',') === 'Crew,ScheduledStart,SuppressReconcileUntil',
     Object.keys(b).join(','));
  ok('ScheduledFinish is never in a PATCH body', !('ScheduledFinish' in b));
}

// ---- site-user resolution ----
const uilRows = [
  { id: '3',  Title: 'D2 Build Scheduler Owners', Name: 'D2 Build Scheduler Owners' },
  { id: '5',  Title: 'D2 Build Scheduler Members', Name: 'D2 Build Scheduler Members' },
  { id: '7',  Title: 'D2 Bot', Name: 'i:0#.f|membership|stratirus@d2pools.com', EMail: 'd2bot@d2pools.com' },
  { id: '13', Title: 'David Taylor', Name: 'i:0#.f|membership|david@d2pools.com', EMail: 'david@d2pools.com' }
];
ok('resolves a real user from the claims Name',
   G.resolveSiteUserId(uilRows, 'david@d2pools.com').id === '13');
ok('resolves the service account whose EMail DIFFERS from its UPN',
   G.resolveSiteUserId(uilRows, 'stratirus@d2pools.com').id === '7',
   JSON.stringify(G.resolveSiteUserId(uilRows, 'stratirus@d2pools.com')));
ok('an unknown user resolves to nothing, never to a group',
   G.resolveSiteUserId(uilRows, 'nobody@d2pools.com').id === null);
ok('an EMPTY upn resolves to nothing -- it must never match a group with no EMail',
   G.resolveSiteUserId(uilRows, '').id === null,
   JSON.stringify(G.resolveSiteUserId(uilRows, '')));
ok('a SharePoint group is never a candidate',
   uilRows.filter(r => G.resolveSiteUserId([r], 'david@d2pools.com').id).length === 1);

// ---- create body ----
{
  const b = G.createBody({ jobno: 'D2-1046', name: 'Ortiz Residence', addr: '1 Main',
                           city: 'Westlake Village', start: '2026-10-05', assignDefaultCrews: true }, '13');
  ok('the create body sets the Person column by lookup id',
     b.ProjectManagerLookupId === '13', JSON.stringify(b));
  ok('...sends AssignDefaultCrews EXPLICITLY, never relying on the list default',
     b.AssignDefaultCrews === true, JSON.stringify(b));
  ok('...and never sets Status or Result, which are flow-owned',
     !('Status' in b) && !('Result' in b), Object.keys(b).join(','));
  ok('...with the job number in Title as well, since the flow reads both',
     b.Title === 'D2-1046' || b.JobNumber === 'D2-1046', JSON.stringify(b));
}
{
  let threw = false;
  try { G.createBody({ jobno: 'D2-1046', name: 'X', start: '2026-10-05' }, null); } catch (e) { threw = true; }
  ok('a create with no resolved PM THROWS rather than sending a blank Person column',
     threw, 'a blank PM lands 201 and then fails 16 minutes later inside the flow');
}

// ---- status body ----
ok('committing a pool writes only Status', JSON.stringify(G.statusBody('Active')) === '{"Status":"Active"}');

// ---- applyWrites uses a per-row PATCH and reports failures individually ----
(async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    return { ok: !url.includes('/999/'), status: url.includes('/999/') ? 403 : 200,
             json: async () => ({}) };
  };
  const r = await G.applyWrites(
    { token: 't', siteId: SITE, listId: LISTS.asg, fetchImpl },
    [{ id: '384', fields: { Crew: 'saul' }, suppressUntil: 'S', jobno: 'J', num: '3.5' },
     { id: '999', fields: { Crew: 'saul' }, suppressUntil: 'S', jobno: 'J', num: '9.9' }]);
  ok('each write is its own PATCH', calls.length === 2 && calls.every(c => c.method === 'PATCH'));
  ok('a failing row does not abort the batch',
     r.written.length === 1 && r.failed.length === 1, JSON.stringify(r));
  ok('...and the failure names the row and the status',
     r.failed[0].id === '999' && r.failed[0].status === 403, JSON.stringify(r.failed));
  process.exit(fail);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node fixtures/planner/graph-write.js`
Expected: FAIL — cannot find `web/graph-writeback.js`.

- [ ] **Step 3: Write the implementation**

Create `web/graph-writeback.js`:

```js
/* Graph-shaped I/O for the planner write-back. THE ONLY file that knows what
 * a Graph URL or body looks like.
 *
 * Every shape below was read off the live tenant on 2026-09-15, not assumed:
 * a Choice column takes a plain string, a DateOnly column takes a bare
 * yyyy-MM-dd and stores site-local midnight exactly as raw REST does, and a
 * Person column is set by {Field}LookupId. Graph is a THIRD field-shape
 * surface alongside raw REST and the Power Automate connector; a probe on one
 * validates nothing about another.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.D2GraphWriteback = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'https://graph.microsoft.com/v1.0';

  function urls(siteId, lists) {
    var site = BASE + '/sites/' + siteId;
    return {
      items: function (listId) { return site + '/lists/' + listId + '/items'; },
      item: function (listId, id) { return site + '/lists/' + listId + '/items/' + id; },
      fields: function (listId, id) { return site + '/lists/' + listId + '/items/' + id + '/fields'; },
      userInfo: site + '/lists/User Information List/items'
        + '?$expand=fields($select=id,Title,Name,EMail)&$top=500'
    };
  }

  /* Resolve a UPN to a SharePoint site-user id.
   *
   * MATCH ON `Name`, NEVER ON `EMail`. Name is the claims string
   * `i:0#.f|membership|<upn>`, i.e. the actual sign-in identity. The service
   * account proves why it matters: D2 Bot's EMail is d2bot@d2pools.com while
   * its UPN is stratirus@d2pools.com, so an EMail match works for every PM
   * and fails for exactly one user.
   *
   * AND NEVER MATCH ON EMPTY. This list holds SharePoint groups and system
   * principals as well as people; groups carry no EMail, so a naive
   * `'' === ''` silently resolves to a group and looks confident. The first
   * version of this resolver returned "D2 Build Scheduler Owners". */
  function resolveSiteUserId(rows, upn) {
    var want = String(upn == null ? '' : upn).trim().toLowerCase();
    if (!want) return { id: null, matches: [], ambiguous: false };
    var hits = (rows || []).filter(function (f) {
      var name = String(f && f.Name || '').trim().toLowerCase();
      if (!name) return false;
      return name.indexOf('|' + want) === name.length - want.length - 1 && name.length > want.length;
    });
    return { id: hits.length === 1 ? String(hits[0].id) : null,
             matches: hits.map(function (h) { return { id: String(h.id), title: h.Title }; }),
             ambiguous: hits.length > 1 };
  }

  /* The suppression stamp rides in the SAME body as the data. A second write
   * would re-trigger the very flow it is suppressing. */
  function patchBody(write) {
    var b = {};
    Object.keys(write.fields).forEach(function (k) { b[k] = write.fields[k]; });
    b.SuppressReconcileUntil = write.suppressUntil;
    return b;
  }

  function createBody(create, projectManagerLookupId) {
    if (!projectManagerLookupId) {
      throw new Error('Refusing to create a pool request with no Project Manager. '
        + 'A blank Person column is accepted on write and then fails inside D2 - New Pool '
        + 'about sixteen minutes later.');
    }
    return {
      Title: create.jobno,
      JobNumber: create.jobno,
      PoolName: create.name,
      Address: create.addr || '',
      City: create.city || '',
      StartDate: create.start,
      ProjectManagerLookupId: String(projectManagerLookupId),
      // Boolean, Required, list default 1. Sent EXPLICITLY because a REST/Graph
      // create is NOT the list form and is not proven to supply defaults; if it
      // arrives falsy all 46 sub-phases land `unassigned` and the tool looks
      // broken rather than configured.
      AssignDefaultCrews: !!create.assignDefaultCrews
    };
  }

  function statusBody(status) { return { Status: status }; }

  function headers(token) {
    return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  }

  /* One PATCH per row. A failing row is recorded and the batch continues:
   * a single row's failure must not silently discard the rest. */
  async function applyWrites(ctx, writes) {
    var f = ctx.fetchImpl || fetch;
    var U = urls(ctx.siteId, {});
    var written = [], failed = [];
    for (var i = 0; i < writes.length; i++) {
      var w = writes[i];
      var r = await f(U.fields(ctx.listId, w.id),
        { method: 'PATCH', headers: headers(ctx.token), body: JSON.stringify(patchBody(w)) });
      if (r.ok) written.push({ id: w.id, jobno: w.jobno, num: w.num, fields: Object.keys(w.fields) });
      else {
        var detail = null;
        try { detail = await r.json(); } catch (e) {}
        failed.push({ id: w.id, jobno: w.jobno, num: w.num, status: r.status, detail: detail });
      }
    }
    return { written: written, failed: failed };
  }

  return { urls: urls, resolveSiteUserId: resolveSiteUserId, patchBody: patchBody,
           createBody: createBody, statusBody: statusBody, applyWrites: applyWrites,
           headers: headers };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node fixtures/planner/graph-write.js`
Expected: every line PASS.

**Note on `createBody` field names:** `PoolName`, `Address` and `City` are asserted loosely by the test (it accepts `Title` or `JobNumber` carrying the job number) because the exact internal names on `New Pool Requests` must be confirmed against the live list before Task 6 sends one. Confirm with a read of that list's columns and correct this function if they differ. Do not guess.

- [ ] **Step 5: Prove the assertions are not vacuous**

1. In `patchBody`, delete the `b.SuppressReconcileUntil = ...` line. Expect the suppression assertion to fail.
2. In `resolveSiteUserId`, delete the `if (!want) return ...` guard. Expect the empty-UPN assertion to fail.
3. In `resolveSiteUserId`, add `|| String(f.EMail||'').toLowerCase() === want` to the filter. Expect no failure — then add an assertion that a row whose `EMail` matches but whose `Name` does not is NOT resolved, and confirm the mutation now fails.
4. In `createBody`, remove the `if (!projectManagerLookupId) throw`. Expect the throw assertion to fail.
5. In `applyWrites`, change the loop to `return` on first failure. Expect the batch-continues assertion to fail.

- [ ] **Step 6: Commit**

```bash
git add web/graph-writeback.js fixtures/planner/graph-write.js
git commit -m "Add the Graph write layer, shapes read off the live tenant"
```

---

### Task 4: Push from the Save preview

**Files:**
- Modify: `web/index.html` (script tags near the existing `graph-to-planner.js` tag; `openSavePreview`; `confirmSaveChangeSet`)
- Test: `fixtures/planner/writeback.js` (extend)

**Interfaces:**
- Consumes: `D2WritebackCore.planEdits`, `D2GraphWriteback.applyWrites`, and the existing `graphToken()`, `D2_GRAPH`, `loadFromD2ViaGraph()`.
- Produces: `pushChangeSet()` on the page; `saveStaleness(nowMs)` returning `{ stale, hours, loadedAt }`.

- [ ] **Step 1: Add the script tags**

Alongside the existing `graph-to-planner.js` tag in `web/index.html`, add:

```html
<script src="writeback-core.js"></script>
<script src="graph-writeback.js"></script>
```

A jsdom harness cannot catch a broken `<script src>` because jsdom does not fetch external scripts. Verify these load in a real browser over HTTP before trusting them.

- [ ] **Step 2: Write the failing test for staleness**

Append to `fixtures/planner/writeback.js` (inside its existing jsdom window, following the file's own `ok(...)` convention):

```js
  // ---- staleness warning -------------------------------------------------
  // A PM diffing against a baseline loaded yesterday generates refusals that
  // look like failures. Warn instead of silently producing them.
  win.S.settings.loadedAt = new Date(Date.parse('2026-09-15T09:00:00Z')).toISOString();
  let st = win.saveStaleness(Date.parse('2026-09-15T12:00:00Z'));
  ok('a baseline loaded 3 hours ago is not stale', st.stale === false, JSON.stringify(st));
  st = win.saveStaleness(Date.parse('2026-09-15T14:30:00Z'));
  ok('a baseline loaded 5.5 hours ago IS stale', st.stale === true, JSON.stringify(st));
  st = win.saveStaleness(Date.parse('2026-09-16T10:00:00Z'));
  ok('a baseline loaded on an earlier day is stale regardless of the hour gap',
     st.stale === true, JSON.stringify(st));
  win.S.settings.loadedAt = null;
  ok('no baseline at all is not reported as stale (Save is already disabled then)',
     win.saveStaleness(Date.now()).stale === false);
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node fixtures/planner/writeback.js`
Expected: FAIL — `win.saveStaleness is not a function`.

- [ ] **Step 4: Implement `saveStaleness` and `pushChangeSet`**

In `web/index.html`, near `openSavePreview`:

```js
/* Is the baseline we are about to diff against old enough to be worth
   stopping for? Deliberately generous: loading in the morning and pushing
   after lunch is normal and must not nag, while a baseline from yesterday is
   worth a warning, because every field somebody else changed since will come
   back as a refusal that reads like a failure. */
const STALE_HOURS = 4;
function saveStaleness(nowMs){
  const at = S.settings && S.settings.loadedAt;
  if(!at) return {stale:false, hours:null, loadedAt:null};
  const t = Date.parse(at);
  const hours = (nowMs - t) / 3600000;
  const earlierDay = new Date(t).toDateString() !== new Date(nowMs).toDateString();
  return {stale: hours > STALE_HOURS || earlierDay, hours, loadedAt: at};
}

/* Push the confirmed change-set straight to SharePoint over Graph.
   The preview the PM just confirmed is unchanged -- it is itself a safety
   property, showing loaded value beside new value per field. */
async function pushChangeSet(pools){
  const tok = await graphToken();
  const G = window.D2GraphWriteback, C = window.D2WritebackCore;
  const siteResp = await fetch('https://graph.microsoft.com/v1.0/sites/'
    + D2_GRAPH.siteHost + ':' + D2_GRAPH.sitePath, {headers:{Authorization:'Bearer '+tok}});
  if(!siteResp.ok) throw new Error('Site lookup failed: '+siteResp.status);
  const siteId = (await siteResp.json()).id;

  // Re-read the rows we are about to touch, immediately before writing.
  // Compare-before-write is only as good as the freshness of this read.
  const rows = await graphPageAll(G.urls(siteId,{}).items(D2_GRAPH.lists.asg)
    + '?$expand=fields&$top=500', tok);
  const liveById = {};
  rows.forEach(r => { liveById[String(r.fields.id)] = r.fields; });

  const plan = C.planEdits(pools, liveById, {nowMs: Date.now(), suppressMinutes: 10});
  const res = await G.applyWrites({token: tok, siteId, listId: D2_GRAPH.lists.asg}, plan.writes);
  return {plan, res};
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node fixtures/planner/writeback.js`
Expected: the four staleness assertions PASS along with the file's existing ones.

- [ ] **Step 6: Wire the preview button and the results dialog**

In `openSavePreview`, when `graphModeAvailable()` is true, render the staleness warning above the tables and make the footer button read Push:

```js
  const st = saveStaleness(Date.now());
  const staleHtml = st.stale
    ? `<div class="hint" style="padding:0 0 11px;color:#a84a18">
         <strong>This schedule was loaded ${freshStamp(st.loadedAt)}.</strong>
         Anything changed in SharePoint since then will be refused rather than
         overwritten. Refresh first if you want to be sure you are working from
         the current schedule.</div>`
    : '';
```

and in the footer:

```js
  const pushable = graphModeAvailable();
  document.getElementById('dFoot').innerHTML =
    `<button class="btn p" onclick="confirmSaveChangeSet()">`
      + (pushable ? `Push ${totalSecs} edit${totalSecs===1?'':'s'} to SharePoint`
                  : `Download change-set (${totalSecs} edit${totalSecs===1?'':'s'})`)
      + (creates.length ? ` and request ${creates.length} new pool${creates.length===1?'':'s'}` : '')
      + `</button><button class="btn" onclick="closeDrawer()">Cancel</button>`;
```

Then split `confirmSaveChangeSet` so the download path is unchanged and the push path reports:

```js
async function confirmSaveChangeSet(){
  if(!graphModeAvailable()){ return confirmSaveByDownload(); }   // existing behaviour, untouched
  const pools = PENDING_CHANGESET || [];
  document.getElementById('dFoot').innerHTML = '<span class="hint">Pushing…</span>';
  let out;
  try { out = await pushChangeSet(pools); }
  catch(e){ return showPushResult(null, e); }
  showPushResult(out, null);
  if(out.res.written.length){ await loadFromD2ViaGraph(); }   // resets baselines, picks up flow writes
}

/* A refusal nobody sees is silent data loss, so every one is named with both
   values: what we loaded, what is live now, and what was wanted. */
function showPushResult(out, err){
  const d = document.getElementById('dBody');
  if(err){ d.innerHTML = `<div class="hint" style="color:#a84a18">Nothing was written. ${esc(err.message)}</div>`; }
  else {
    const {plan, res} = out;
    const rows = (list, cls) => list.map(x => `<tr><td class="small">${esc(x.jobno)} ${esc(x.num)}</td>
      <td class="small ${cls}">${esc(x.col || (x.fields||[]).join(', ') || x.reason)}</td>
      <td class="small muted">${x.reason==='diverged'
        ? 'loaded '+esc(String(x.loaded))+', now '+esc(String(x.nowLive))+', wanted '+esc(String(x.wanted))
        : esc(x.reason || '')}</td></tr>`).join('');
    d.innerHTML =
      `<div class="fld"><label>Written (${res.written.length})</label><table><tbody>${rows(res.written,'')}</tbody></table></div>`
    + (plan.refusals.length ? `<div class="fld"><label>Refused (${plan.refusals.length}) — changed in SharePoint since you loaded</label><table><tbody>${rows(plan.refusals,'')}</tbody></table></div>`:'')
    + (plan.errors.length ? `<div class="fld"><label>Skipped (${plan.errors.length})</label><table><tbody>${rows(plan.errors,'')}</tbody></table></div>`:'')
    + (res.failed.length ? `<div class="fld"><label>Failed (${res.failed.length})</label><table><tbody>${rows(res.failed,'')}</tbody></table></div>`:'');
  }
  document.getElementById('dTitle').textContent = 'Save results';
  document.getElementById('dFoot').innerHTML = '<button class="btn p" onclick="closeDrawer()">Close</button>';
}
```

- [ ] **Step 7: Run the whole suite**

Run each harness listed in `fixtures/planner/README.md` plus the three new ones. All must pass.

- [ ] **Step 8: Commit**

```bash
git add web/index.html fixtures/planner/writeback.js
git commit -m "Push schedule edits from the planner straight to SharePoint over Graph"
```

---

### Task 5: Commit a pool from the Jobs tab

**Files:**
- Modify: `web/index.html` (`vJobs`, plus a new `commitPool`)

**Interfaces:**
- Consumes: `D2GraphWriteback.statusBody`, `graphToken`, `D2_GRAPH`, and the existing `conflicts()`.
- Produces: `commitPool(jobId)`.

Committing is the act that starts dispatch and alerting. `D2 - New Pool` assigns template default crews with no awareness of other pools, so **every new pool should be expected to arrive with conflicts** — the planner already knows them and SharePoint does not, which is why the count belongs on this dialog.

- [ ] **Step 1: Add the control to `vJobs`**

In the Jobs table row, after the sub-phase count cell:

```js
    <td class="small">${j.status === 'Planned'
      ? `<button class="btn sm p" onclick="commitPool('${j.id}')">Commit</button>`
      : `<span class="muted">${esc(j.status || 'Active')}</span>`}</td>
```

Add a matching `<th style="width:92px">Status</th>` to the header row so the columns stay aligned.

- [ ] **Step 2: Implement `commitPool`**

```js
/* Planned -> Active. Nothing dispatches and nothing alerts until this
   happens, which is why it is a deliberate act with its own confirmation
   rather than an inline status dropdown. The conflict count is shown because
   D2 - New Pool assigns template default crews with no awareness of other
   pools, so a fresh pool routinely arrives double-booked, and committing one
   unexamined is how that reaches a crew. */
function commitPool(jobId){
  const j = S.jobs.find(x => x.id === jobId);
  if(!j) return;
  const mine = conflicts().filter(c => c.jobno === j.jobno);
  document.getElementById('dTitle').textContent = 'Commit ' + (j.jobno || j.name);
  document.getElementById('dBody').innerHTML =
    `<div class="hint" style="padding:0 0 11px">
       Committing moves <strong>${esc(j.jobno)} ${esc(j.name)}</strong> from Planned to Active.
       From then on it appears in the daily dispatch, in the summary emails and on the
       group calendar, and conflict alerts for it start going to its project manager.
     </div>`
    + (mine.length
        ? `<div class="fld"><label style="color:#a84a18">${mine.length} unresolved conflict${mine.length===1?'':'s'} on this pool</label>
             <div class="hint" style="padding:0 0 6px">These do not block the commit, but they are live once it is Active.</div>
             <table><tbody>${mine.slice(0,12).map(c=>`<tr><td class="small">${esc(c.ref||'')}</td><td class="small muted">${esc(c.msg||'')}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="fld"><label>No conflicts detected on this pool</label></div>`);
  document.getElementById('dFoot').innerHTML =
    `<button class="btn p" onclick="doCommitPool('${jobId}')">Commit to Active</button>
     <button class="btn" onclick="closeDrawer()">Cancel</button>`;
  document.getElementById('drawer').classList.add('open');
}

async function doCommitPool(jobId){
  const j = S.jobs.find(x => x.id === jobId);
  document.getElementById('dFoot').innerHTML = '<span class="hint">Committing…</span>';
  try{
    const tok = await graphToken();
    const G = window.D2GraphWriteback;
    const siteResp = await fetch('https://graph.microsoft.com/v1.0/sites/'
      + D2_GRAPH.siteHost + ':' + D2_GRAPH.sitePath, {headers:{Authorization:'Bearer '+tok}});
    const siteId = (await siteResp.json()).id;
    const rows = await graphPageAll(G.urls(siteId,{}).items(D2_GRAPH.lists.jobs)
      + '?$expand=fields&$top=500', tok);
    const row = rows.find(r => String(r.fields.JobNumber) === String(j.jobno));
    if(!row) throw new Error('That pool is not in SharePoint yet. Refresh and try again.');
    if(row.fields.Status !== 'Planned')
      throw new Error('This pool is already ' + row.fields.Status + ' in SharePoint. Nothing changed.');
    const r = await fetch(G.urls(siteId,{}).fields(D2_GRAPH.lists.jobs, row.fields.id),
      {method:'PATCH', headers:G.headers(tok), body:JSON.stringify(G.statusBody('Active'))});
    if(!r.ok) throw new Error('SharePoint refused the change (' + r.status + ').');
    closeDrawer();
    await loadFromD2ViaGraph();
  }catch(e){
    document.getElementById('dBody').innerHTML =
      `<div class="hint" style="color:#a84a18">${esc(e.message)}</div>`;
    document.getElementById('dFoot').innerHTML = '<button class="btn" onclick="closeDrawer()">Close</button>';
  }
}
```

Note the re-read of `Status` immediately before the PATCH: that is compare-before-write for this one field, and it stops two PMs both committing.

- [ ] **Step 3: Verify in a real browser, not jsdom**

Load the hosted planner, Refresh, and confirm the Jobs tab shows Commit only on Planned pools and the live status otherwise. All four demo pools are Active today, so to see the button you must have a Planned pool. Do not create one just for this — confirm the branch by temporarily setting a local `j.status='Planned'` in the console and re-rendering, then reload.

- [ ] **Step 4: Commit**

```bash
git add web/index.html
git commit -m "Commit a pool from Planned to Active in the planner"
```

---

### Task 6: `+ Job` raises the request row

**Files:**
- Modify: `web/index.html` (`confirmSaveChangeSet` push path)
- Test: `fixtures/planner/graph-write.js` (already covers `createBody` and the PM refusal)

**Interfaces:**
- Consumes: `D2WritebackCore.planCreates`, `D2GraphWriteback.createBody` / `resolveSiteUserId` / `urls`.
- Produces: `pushCreates(siteId, tok, creates)` returning `{ created, refused, failed }`.

- [ ] **Step 1: Confirm the live column names before writing any of this**

Read the `New Pool Requests` columns over Graph and correct `createBody` in Task 3 if the internal names differ from `JobNumber`, `PoolName`, `Address`, `City`, `StartDate`, `ProjectManagerLookupId`, `AssignDefaultCrews`. Do not guess: a wrong internal name is accepted on write and the field simply does not appear.

Run in the browser console on the hosted planner:

```js
(async()=>{const t=await graphToken();
const s=(await(await fetch('https://graph.microsoft.com/v1.0/sites/'+D2_GRAPH.siteHost+':'+D2_GRAPH.sitePath,{headers:{Authorization:'Bearer '+t}})).json()).id;
const l=await(await fetch('https://graph.microsoft.com/v1.0/sites/'+s+"/lists?$filter=displayName eq 'New Pool Requests'",{headers:{Authorization:'Bearer '+t}})).json();
const c=await(await fetch('https://graph.microsoft.com/v1.0/sites/'+s+'/lists/'+l.value[0].id+'/columns',{headers:{Authorization:'Bearer '+t}})).json();
console.table(c.value.map(x=>({name:x.name,display:x.displayName,required:x.required,readOnly:x.readOnly})));})()
```

- [ ] **Step 2: Implement `pushCreates`**

```js
/* Raise a New Pool Requests row per queued create. Separate from the edit
   path entirely: a different list, a different shape, and NOT subject to the
   five-field allowlist, which governs edits to an existing row rather than
   the creation of a new one. */
async function pushCreates(siteId, tok, creates){
  const G = window.D2GraphWriteback, C = window.D2WritebackCore;
  const U = G.urls(siteId, {});

  // Resolve the signed-in user to a site-user id. Exactly one match or refuse:
  // a blank Person column is accepted on write and then fails inside the flow
  // about sixteen minutes later.
  const acct = graphPca().getActiveAccount() || graphPca().getAllAccounts()[0];
  const uil = await graphPageAll(U.userInfo, tok);
  const who = G.resolveSiteUserId(uil.map(r => r.fields), acct && acct.username);
  if(!who.id) throw new Error(who.ambiguous
    ? 'Your account matches more than one SharePoint user, so the project manager cannot be set safely.'
    : 'Could not identify your SharePoint account, so the project manager cannot be set. Nothing was created.');

  // Uniqueness spans live Jobs AND requests still Requested or Building.
  const jobs = await graphPageAll(U.items(D2_GRAPH.lists.jobs) + '?$expand=fields&$top=500', tok);
  const reqs = await graphPageAll(U.items(D2_GRAPH.lists.req) + '?$expand=fields&$top=500', tok);
  const pending = reqs.map(r => r.fields)
    .filter(f => f.Status === 'Requested' || f.Status === 'Building')
    .map(f => f.JobNumber);
  const plan = C.planCreates(creates, jobs.map(r => r.fields.JobNumber), pending);

  const created = [], failed = [];
  for(const c of plan.creates){
    const r = await fetch(U.items(D2_GRAPH.lists.req), {method:'POST', headers:G.headers(tok),
      body: JSON.stringify({fields: G.createBody(c, who.id)})});
    if(r.ok) created.push(c.jobno); else failed.push({jobno:c.jobno, status:r.status});
  }
  return {created, refused: plan.refusals, failed};
}
```

Add `req: '13331a5e-ea8e-4ab2-9276-db5b4f4d46bf'` to `D2_GRAPH.lists` so the request list is addressed by the same single source of truth as the others.

- [ ] **Step 3: Call it from the push path**

In `confirmSaveChangeSet`'s push branch, after the edits are applied:

```js
  if((PENDING_CREATES||[]).length){
    try{ out.creates = await pushCreates(out.siteId, out.tok, PENDING_CREATES); }
    catch(e){ out.createError = e; }
  }
```

`pushChangeSet` must return `siteId` and `tok` alongside `{plan, res}` for this to work. Mark each successfully created request with `requestedAt` exactly as the download path does, so a later Save never re-offers it.

Extend `showPushResult` to render a "Pool requests raised" section that repeats the measured wait:

```
Each request takes about 16 minutes, and one run stalled for six minutes in
the middle. The request sits at Building the whole time and looks stuck.
Do not raise it again. Use Refresh once it finishes.
```

- [ ] **Step 4: Run the harnesses**

Run: `node fixtures/planner/graph-write.js` and `node fixtures/planner/writeback-core.js`
Expected: all PASS.

- [ ] **Step 5: Exercise the refusal path only**

In the hosted planner, queue a `+ Job` using a job number that already exists (`D2-1042`) and push. Expect a refusal, no request row created, and the pool still queued locally. **Do not push a create with a fresh job number** unless a fifth pool is actually wanted: it sets `D2 - New Pool` running for about sixteen minutes and produces a real pool.

- [ ] **Step 6: Commit**

```bash
git add web/index.html fixtures/planner/graph-write.js
git commit -m "Raise New Pool Requests rows from the planner"
```

---

### Task 7: Live verification

**Files:** none. This task produces evidence, not code.

- [ ] **Step 1: Deploy**

```bash
TOKEN=$(az staticwebapp secrets list --name swa-d2-build-scheduler --query "properties.apiKey" -o tsv)
npx -y @azure/static-web-apps-cli deploy ./web --deployment-token "$TOKEN" --env production
```

- [ ] **Step 2: Confirm the new scripts actually load**

In the hosted planner's console: `typeof window.D2WritebackCore` and `typeof window.D2GraphWriteback` must both be `'object'`. A jsdom harness cannot see a broken `<script src>`, and this project has shipped twelve green harnesses while both tags pointed at paths outside the deploy root.

- [ ] **Step 3: Push one field and read the row, not the summary**

Change one crew on a demo pool, Save, Push. Then read that row back over Graph and confirm the value. Verify by opening the result, never by the status code.

- [ ] **Step 4: Prove the refusal path against the tenant**

Load the planner. In SharePoint, change `DurationDays` on a row you have also edited locally. Push. Confirm that field is refused with `loaded / now / wanted` and that a second changed field on the same row still lands.

Provoke divergence on `DurationDays`, never on `Crew`: Flow 3's version gate watches `Crew`, `ScheduledStart` and `ScheduledFinish`, so a duration edit cannot raise a conflict alert, and Salcedo's PM is Don.

- [ ] **Step 5: Prove the suppression window held**

After a push that moves a crew or a date, read Flow 3's run and confirm it reached `Terminate_suppressed` rather than `Send_email_alert`. A short run duration alone does not prove this — read the action list.

```
FlowAgent: get_run_history then get_run_actions on 523d99c0-bc2e-7819-5d96-6faab60734f1
```

- [ ] **Step 6: Record the outcome in CLAUDE.md**

Add the Graph write shapes, the site-user resolution rule, and the new files to the relevant sections. Then commit.

---

## Self-Review

**Spec coverage.** Section 1 scope A is Task 4, B is Task 6, C is Task 5. Section 2's constraint is embodied in Task 3. Section 3's probe findings appear as Global Constraints and in Task 3's comments. Section 3a is Task 3's `resolveSiteUserId` plus Task 6 step 1. Section 4's three files are Tasks 1, 3 and 4. Section 5's five safety properties are Task 1's five test groups plus Task 3's suppression body. Section 6's concurrency mitigations are Task 4 steps 2, 4 and 6. Section 7's three harnesses are Tasks 1, 2 and 3. Section 8's rollout order is Tasks 4, 5, 6. Section 9's known gaps are deliberately not tasked.

**Placeholders.** None. Task 3's note about `New Pool Requests` column names is an explicit verification step in Task 6 step 1, not a deferred decision.

**Type consistency.** `planEdits` returns `{writes, refusals, errors}` in Task 1 and is consumed with those names in Tasks 3 and 4. `applyWrites` returns `{written, failed}` in Task 3 and is rendered with those names in Task 4. `resolveSiteUserId` returns `{id, matches, ambiguous}` in Task 3 and is consumed as `who.id` / `who.ambiguous` in Task 6. `write.suppressUntil` is produced by `planEdits` and read by `patchBody`.
