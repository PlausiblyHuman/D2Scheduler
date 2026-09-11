# Planner fixtures

Behaviour tests for `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`,
the browser planner. They run the real file in jsdom, so they test what a PM's
browser actually executes rather than a copy of the logic.

```
npm install jsdom          # once, anywhere on the path
node fixtures/planner/determinism.js
node fixtures/planner/roundtrip.js
node fixtures/planner/empty.js
node fixtures/planner/workcalendar.js
node fixtures/planner/schedulecheck.js
node fixtures/planner/startdate.js
node oracle-test.js         # the original 16-invariant harness (repo root)
```

| File | What it pins |
|---|---|
| `determinism.js` | Auto-Schedule is idempotent from a settled state. Before the 2026-09-11 patch, 4 of 138 crew picks oscillated on every re-run. Seeds 3 pools itself (the planner ships with none) so the comparison is over 138 real assignments rather than the 0 it silently ran on between 2026-09-11 and the fix round below. |
| `roundtrip.js` | `Load from D2` merges a SharePoint export correctly: live pools update, local-only pools survive, sign-offs lock against Auto-Schedule, task text stays local. |
| `empty.js` | A first-run browser seeds no phantom pools and still renders. |
| `live-export.js` | The real `sharepoint/export-to-planner.js` run against **captured live payloads**, then imported into the real planner. Pins the whole pipeline: 138 assignments, 885 tasks, 47 sign-offs, 398 ticks, nothing dropped. |
| `workcalendar.js` | The planner's spans match SharePoint's. Before the fix, 2 of 138 live assignments rendered a day short, both crossing Columbus Day 2026-10-12. |
| `schedulecheck.js` | Schedule Check no longer warns on PM sign-off, which `PMSignOff` never gets set by anything real. Installer sign-off is still checked. |
| `startdate.js` | Auto-Schedule is anchored on real work, not a drifted `Jobs.StartDate`. `D2 - Reschedule Pool` rewrites Assignments dates and never writes the Jobs row back, so the field can sit months after a pool's first sub-phase; `jobStart()` uses the earliest of the two everywhere `autoSchedule` orders pools or seeds a cursor. Covers the sort comparator and the cursor seed as two isolated scenarios (a two-pool tie-break contest, and a single unlocked-first-row pool), on top of the original single-pool locked-row case, so a revert of either `autoSchedule` call site fails on its own. |

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
