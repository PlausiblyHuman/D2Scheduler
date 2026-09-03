# 2026-09-03a — Week 2 flows complete; three production bugs found and fixed

**Session goal:** apply the staged Flow 1 crew-filter fix and run the Flow 3 exit-gate tests.
The staged fix turned out to be hiding two deeper defects, and the session ended with all
five Week 2 flows built and verified.

## What landed

**All five Week 2 flows are now built and Started.** Flows 4 and 5 (daily + weekly) were
created **fully headless** — no PA designer at any point.

**Flow 1 — two bugs, not one.**

1. The staged `item()?['Crew']?['Value']` fix was applied and published. But the recorded
   failure mode was wrong: `?['Value']` on a string does **not** evaluate to null, it
   **throws** `InvalidTemplate ... Property selection is not supported on values of type
   'String'`. So the flow did not "ship empty tables" — on days with work it **failed and
   sent nothing**; on empty days it succeeded. Run history confirms it: 08-27, 08-28 (x2),
   08-29, 08-31, 09-02 all Failed; 09-01 and 09-03 Succeeded with zero rows.
   The 09-01 "verified in prod" pass passed only because that day had no data.

2. Fixing that revealed the real defect: **the crew join key was wrong.** Three value
   spaces were in play — `Crews.CrewID`='devon', `Crews.Title`='Devon Crew +3',
   `Assignments.Crew`='Devon Crew'. None matched. The browser tool models crews as
   `{id, name}`, so **CrewID is the join key and Title is a display label**. Masked for
   crews without a `+N` suffix: `STL Shotcrete` matched by luck while all seven field crews
   never could.

   Fixed in Flow 1 and Flow 3; all 5 Assignments reseeded to short codes. Flow 3's fix also
   **restored the subcontractor capacity exemption** — with `Get_crew` returning zero rows,
   `Condition_unlimited` could never be true, so `Unlimited=Yes` crews were being
   double-book-checked in violation of business rule 2.

**Flow 1 verified end-to-end for the first time ever** — a populated dispatch email:
`TODAY — Thu 09/03 · Devon Crew +3 / Harrison Residence / 2.2 Steel Installation`.

**Dates were one day early everywhere, and it had inverted the work week.** The columns were
already DateOnly; the *values* were wrong. Week 1 seeded midnight **UTC**, which the SP
connector reads as the previous day in Central. All 62 Work Calendar rows were affected, so
Flow 1 would have **terminated on Saturdays** (no dispatch on a work day) and **dispatched on
Sundays**. Business rule 4 was inverted and nothing surfaced it, because the list UI shows the
intended date. Fixed all 62 calendar rows, 5 assignments and Jobs.StartDate by rewriting as
bare `yyyy-MM-dd` strings, which SharePoint stores at site-local midnight.

**Flow 3 exit gates: one pass, one fail.** Double-book fired a correct High-importance alert.
Sign-off-only edit **also fired** — `GetOnUpdatedItems` emits **no `@odata.oldValue`
properties at all**, so the Rev D §06 trigger condition is a no-op and every edit triggers the
flow. Severity is quota, not corruption: Flow 3 only reads and emails, so there is no loop.

**Flow 4 — Nightly Reconciliation.** Interval-overlap sweep (corrected from the runbook's
`ScheduledStart`-only filter, which misses in-progress work), 30-day window, Unlimited crews
exempt. Both tests passed, then re-verified against 43 rows.

**Flow 5 — two flows, HTML email not PDF.** The only non-premium conversion is OneDrive
`ConvertFile`; SharePoint has none and PDF4me/Encodian are premium. No OneDrive connection
exists. Shane chose a rich HTML body: same content, no new connection, no temp-file lifecycle.

**Test data seeded** — 38 assignments across `TEST-9001`/`TEST-9002`, generated from the real
46 sub-phase template. The generator enforces all four business rules and cross-checks against
the pre-existing rows; it caught two collisions with Assignment 5 on the first pass.

## Corrections to prior guidance

- **No designer Save is needed for a new flow.** `create_flow` (writes to the published row)
  + `PublishXml` (creates the connection bindings) + `publish_flow` is fully headless. The
  intermediate `CannotRunUnpublishedSolutionFlow` error says to use the designer; it is wrong.
- **`az rest` on Windows silently drops non-cp1252 characters** and `PYTHONIOENCODING` does
  not fix it. Rebuilding a definition from such a capture would strip glyphs from production.
  Read with FlowAgent `get_flow`; submit with `ensure_ascii=True`.
- **`authentication` is service-managed on the trigger too**, not just actions.
- **`preview_update` reports containers as changed with `fields: []`** — differ noise.

## Files touched

- `CLAUDE.md` — rewrote the Flow 1 bug entry; new sections on the CrewID join key, the date
  convention, the `az rest` encoding trap, the Flow 3 trigger no-op, Required-but-NULL
  columns, the headless build sequence, and the live test data
- `D2-Week-2-Automations-Runbook.md` — 5 corrections (crew join, the claim that `Crew` holds
  the display name, the Flow 4 Select projection)
- `flows/definitions/` — Flow 1 and Flow 3 synced to production; **new**: Nightly
  Reconciliation, Daily Summary, Weekly Summary
- `flows/testdata/` — **new**: generator, seed plan, ID manifest, cleanup script, rendered
  HTML previews of both summaries

## Decisions made

- **Join on `CrewID` everywhere**; `Title` is display only. Applies to future flows, the
  canvas app, and the nightly sync.
- **DateOnly fields are written as bare `'yyyy-MM-dd'`**, never `...T00:00:00Z`.
- **Flow 5 sends HTML, not PDF** — PDF isn't worth a new connection and an auth.
- **Flow 4 emails now, Teams later** — the planned channels don't exist (only
  `d2pools.com > General`), and creating them is the client's call.
- **All alerts and summaries go to `stratirus@d2pools.com`** until the content is reviewed.
- Test data marked via **Job number**, not a new `IsTestData` column — no permanent schema
  change for a temporary need.

## Open questions / blocked on

- **Flow 3 trigger gating** — the `@odata.oldValue` condition is a proven no-op. Options are
  in CLAUDE.md; low urgency (~1 wasted run per sign-off, no loop).
- **Teams channels don't exist** — `Field Dispatch` / `Ownership` need creating before the
  Teams half of Flow 4 can be wired.
- **Two seed-data issues left deliberately untouched:** Assignment 1 carries a stale
  `"Chrome-driven test"` sign-off, and Assignment 4 (`stl`) is scheduled across Sunday 09-06,
  violating business rule 4 in the seed itself.
- **Test data is live on the client tenant** and must be removed before the pilot.

## Next action

Review the rendered previews in `flows/testdata/`, decide whether to point Flow 5 at Don, then
remove the TEST-900x seed data and re-export all five flows to `flows/exports/`.
