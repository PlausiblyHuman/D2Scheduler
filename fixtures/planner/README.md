# Planner fixtures

Behaviour tests for `web/index.html`,
the browser planner. They run the real file in jsdom, so they test what a PM's
browser actually executes rather than a copy of the logic.

```
npm install jsdom          # once, anywhere on the path
node fixtures/planner/freshness.js
node fixtures/planner/determinism.js
node fixtures/planner/roundtrip.js
node fixtures/planner/empty.js
node fixtures/planner/workcalendar.js
node fixtures/planner/schedulecheck.js
node fixtures/planner/startdate.js
node fixtures/planner/rules.js
node fixtures/planner/writeback.js
node fixtures/planner/graph-read.js
node fixtures/planner/writeback-core.js
node fixtures/planner/writeback-parity.js
node fixtures/planner/graph-write.js
node fixtures/planner/signin.js
node oracle-test.js         # the original 16-invariant harness (repo root)
```

**Watch an assertion fail before trusting it.** `mutate.py` breaks the
production code on purpose and checks the harness goes red:

```
python fixtures/planner/mutate.py fixtures/planner/writeback-core.js web/writeback-core.js
python fixtures/planner/mutate.py fixtures/planner/graph-write.js  web/graph-writeback.js
python fixtures/planner/mutate.py fixtures/planner/signin.js       web/index.html
```

A crash counts as red. A mutation whose anchor text is missing is reported
rather than silently skipped, because a mutation that never lands is worse
than no mutation at all.

| File | What it pins |
|---|---|
| `freshness.js` | The planner says whether what is on screen is the live schedule (D11). A `Refresh` stamps `S.settings.loadedAt`/`exportedOn` and records a per-sub-phase baseline (`s.base`) of exactly the fields SharePoint owns; Auto-Schedule, the drawer save, sign-off and bulk tick all mark the pool `touchedAt`; `divergedSecs(j)` diffs current state against the baseline field-by-field. Confirms a crew or date change is divergence, a task tick is not (sign-off and ticks are deliberately outside the baseline — the planner is never their authority), and the header renders a "Live as of" stamp. |
| `determinism.js` | Auto-Schedule is idempotent from a settled state. Before the 2026-09-11 patch, 4 of 138 crew picks oscillated on every re-run. Seeds 3 pools itself (the planner ships with none) so the comparison is over 138 real assignments rather than the 0 it silently ran on between 2026-09-11 and the fix round below. |
| `roundtrip.js` | `Refresh` merges a SharePoint export correctly: live pools update, local-only pools survive, sign-offs lock against Auto-Schedule, task text stays local. |
| `empty.js` | A first-run browser seeds no phantom pools and still renders. |
| `live-export.js` | The real `sharepoint/export-to-planner.js` run against **captured live payloads**, then imported into the real planner. Pins the whole pipeline: 138 assignments, 885 tasks, 47 sign-offs, 398 ticks, nothing dropped. |
| `workcalendar.js` | The planner's spans match SharePoint's. Before the fix, 2 of 138 live assignments rendered a day short, both crossing Columbus Day 2026-10-12. |
| `schedulecheck.js` | Schedule Check no longer warns on PM sign-off, which `PMSignOff` never gets set by anything real. Installer sign-off is still checked. |
| `startdate.js` | Auto-Schedule is anchored on real work, not a drifted `Jobs.StartDate`. `D2 - Reschedule Pool` rewrites Assignments dates and never writes the Jobs row back, so the field can sit months after a pool's first sub-phase; `jobStart()` uses the earliest of the two everywhere `autoSchedule` orders pools or seeds a cursor. Covers the sort comparator and the cursor seed as two isolated scenarios (a two-pool tie-break contest, and a single unlocked-first-row pool), on top of the original single-pool locked-row case, so a revert of either `autoSchedule` call site fails on its own. |
| `rules.js` | Three business-rule enforcement gaps, confirmed live 2026-09-12, all in the planner only. **Rule 1:** `isQualified()` and `qualified()` disagreed on a FIXED pseudo-trade (`@office`/`@sub`/`@unassigned`) -- `qualified()` offers only the one bucket crew a code names, but `isQualified()` let any capacity-exempt crew through (`\|\| c.unlimited`), so an unlimited crew parked on the wrong bucket sub-phase raised no `conflicts()` error at all. **Rule 2:** `autoSchedule()`'s own busy-seeding loop had no `unlimited` exemption, unlike `busyMap()`, so a subcontractor already locked to one pool on a day could be treated as unavailable for a second pool the same day even though rule 2 says it never is. **Rule 3:** the scheduling `cursor` was set unconditionally to a locked row's own end; a locked row starting earlier than work already placed pulled the cursor backwards and let the next unlocked row land on top of it. Each of the three scenarios is isolated so a revert of any one fix fails only its own assertions. |
| `writeback.js` | Route A of the batch write-back (Save button + `sharepoint/apply-planner-changes.js`), 2026-09-12. PART A runs the real planner and asserts `buildChangeSet()`'s output directly: an unedited pool produces nothing; a single crew change produces exactly one field entry carrying the SharePoint row id and `Sequence`; ticking a task and signing off a sub-phase, then changing a *different* sub-phase's crew, produces a change-set carrying the crew and **nothing else** -- every field key is checked against the five-column allowlist, not merely "sign-off is absent" (a vacuous check, since sign-off was never a candidate key to begin with); a local-only sketch (no `s.base` anywhere) never appears even after every field on it is edited; Save is disabled with nothing to push and enabled once a loaded pool diverges. PART B runs the real `apply-planner-changes.js` in a `vm` sandbox (the same technique `run-export.js` uses) against a mutable fake SharePoint store: asserts the exact MERGE body per row (only the changed columns, `__metadata` from list metadata, `SuppressReconcileUntil` a few minutes ahead, a hostile field rejected before any read); compare-before-write refuses a field that drifted live while still writing a sibling field that did not; the shipped `DRY_RUN = true` default performs no `POST` at all; a row deleted since export is reported as missing rather than thrown; a file of the wrong `kind` (built with real pools/sections so it cannot pass merely because it is empty) is rejected before any network call. Every assertion in this file was proven capable of failing by mutating the production code and watching it go red, then restoring -- see `.superpowers/sdd/writeback-route-a/report.md` for the log. |
| `signin.js` | 2026-09-18. Signing in from the hosted planner. At the 2026-09-17 training four of six people got an error and a file picker on Refresh: the wall's `SameSite=Strict` cookie was withheld when the popup came back from a click on Microsoft's page, and the sign-in code was lost. Pins the fix: the popup lands on `web/auth-redirect.html` (public in `staticwebapp.config.json`, no script, framable by the planner only); the wall's account from `/.auth/me` is sent as `login_hint`; a failed hosted Refresh opens the drawer with a sentence and Try again, never an alert or the file picker; Try again goes straight to the popup; a Graph 403 names the refused account; Save and Activate use the same explanation; a downloaded copy keeps its file picker. Sweep it against `web/index.html`, `web/staticwebapp.config.json` and `web/auth-redirect.html`. |
| `graph-read.js` | 2026-09-13. Equivalence test for `web/graph-to-planner.js`, the mapping that lets a hosted planner read live through Microsoft Graph instead of a console-pasted REST export. Runs the real `export-to-planner.js` against the REST fixture and the real `graph-to-planner.js` against **`live-payloads-graph.json`** (captured separately, from Graph, not derived from the REST fixture), then asserts the two payloads agree pool-for-pool and sub-phase-for-sub-phase: job numbers, section counts, crew codes, dates, durations, flags, task counts, tick counts and `nonWork` length. Graph renames and RETYPES every join field the REST export uses (`JobId` number -> `fields.JobLookupId` string; `AssignmentId` number -> `fields.AssignmentLookupId` string; `Id` number -> `fields.id` string), so the join in `graph-to-planner.js` normalises both sides with `String()` before comparing -- proven load-bearing by breaking the join (wrong field name) and watching every count downstream go to zero with the mismatch named, then restoring. The Graph-derived payload is then imported into the real planner in jsdom and checked the same way `live-export.js` checks the REST one: pool count, sub-phase count, sign-offs, ticks, and that Auto-Schedule still leaves signed work alone. |

`roundtrip.js` builds its payload from the planner's own `SEED_TEMPLATE`, in the
exact shape `sharepoint/export-to-planner.js` emits. `live-export.js` goes further
and runs the export script's real code with `fetch` stubbed to serve
`live-payloads.json`, a 2026-09-11 capture of the three demo pools taken with the
throwaway-probe-flow recipe in CLAUDE.md. Neither touches the D2 tenant and neither
needs credentials. Recapture the fixture if the list schema changes.

**`live-payloads.json` keys**, all captured, never hand-authored:

| Key | Rows | Captured |
|---|---|---|
| `jobs` | 3 | 2026-09-11 |
| `asg` | 138 | 2026-09-11 |
| `tasks` | 885, each carrying `NotApplicable` | 2026-09-11 (re-captured to add the field) |
| `cal` | 210 (175 Sundays, 35 holidays), 2026-08-30 -> 2029-12-30 | 2026-09-11 |

`cal` is the Work Calendar list (`Id`, `Title`, `Date`, `ID` per row), read the same
way as the other three keys: a throwaway `Recurrence`-triggered flow issuing
read-only `GetByTitle(...)/items` requests, never a hand-built date list. A future
session extending the Work Calendar (see CLAUDE.md) should recapture this key
rather than editing it by hand, so a stale row count here is visible against the
live list's own count.

**Why these exist:** the planner sat untouched from 2026-08-13 to 2026-09-11
while everything around it changed, and two patches the repo claimed were applied
were not. Nothing was checking. These are cheap and they run offline.
| `writeback-core.js` | The five safety properties of the write path as pure functions, with no tenant and no jsdom: the five-column allowlist (a sign-off field in a hostile change-set is refused), compare-before-write per FIELD rather than per row (one field refused while another on the same row lands), token-anchored row identity (a `3.5` edit must not land on a `3.10` row), the suppression stamp on every write, and create refusal on a duplicate job number, a missing required field, or a duplicate within one batch. |
| `writeback-parity.js` | The write allowlist agrees across the three files that hold it: `WRITEBACK_FIELDS` in the planner, `ALLOWLIST` in `web/writeback-core.js`, and `FIELD_DEFS` in the frozen console applier, which is pasted into a browser console and cannot require the core. Guards the parse before comparing, because two empty lists compare equal. |
| `graph-write.js` | The Graph-shaped half, against shapes read off the live tenant on 2026-09-15: the PATCH endpoint, the suppression stamp riding in the same body, site-user resolution matching the claims `Name` and never `EMail` (D2 Bot's mail differs from its UPN), refusal on an ambiguous or empty match, the New Pool Requests body (`Title` is the pool name, `JobNumber` the job number, no `PoolName` column exists), and a failed row not aborting the batch. |
