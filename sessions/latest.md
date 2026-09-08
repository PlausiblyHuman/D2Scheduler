# 2026-09-08b — Pre-pilot audit, then pool lifecycle and reflow

**Session goal:** clear the calendar/Gantt task queued from 09-07, then verify CLAUDE.md against
the live tenant before the pilot makes decisions from it. The audit found enough that the session
turned into a second workstream: making the `Planned` pool state actually mean something.

Ran 09:31 to 16:03. Ended when VS Code crashed, not at a natural close, so this log was written
the following session from git and the plan's own progress record.

## Part 1 — the queued task and the audit

**Gantt is not available at this licensing tier**, so schedule visualisation shipped as a
timeline lane inside the existing views instead. `All Assignments` and `Late-Starting Jobs` now
draw 28 day-cells per row across a fixed `today-7 .. today+21` window, painted in the row's status
colour. Fixed cells rather than absolute positioning, because SharePoint's style allowlist cannot
be trusted to pass `position: absolute`. Verified by reading the rendered DOM: 43 lanes on one
view, 15 on the other, 0 on `Today by Crew`, and every sampled row's painted cells match day
indices computed independently from that row's own displayed dates.

**The pre-pilot reality audit checked every load-bearing claim in CLAUDE.md against the tenant.**
Fourteen checks, mostly green: zero counter drift across all 43 assignments, zero orphan tasks,
zero double-books, zero required-but-NULL rows, all 11 flows started.

Four things it found:

1. **The Work Calendar had run out on 2027-08-22.** The original 62 rows were a rolling year
   seeded once in Phase A, and nothing ever extended them. Sundays are computed in
   `D2 - New Pool`, so they stay correct forever; holidays are read only from the list, so past
   that date every holiday silently becomes a work day. Extended to 210 rows through 2029-12-30.
2. **One audit check was itself defective.** Export freshness compared each export's filename date
   against the flow's live `lastModifiedTime` and reported all current. Re-checked by content,
   four of eleven differed, and `D2 - New Pool`'s export was a pre-hardening snapshot missing the
   entire failure path, 12 actions including both failure emails. Restoring that flow from its
   committed export would have deleted the fix. All 11 regenerated and each verified by re-reading
   the written file.
3. Three flow ids recorded in CLAUDE.md were really Dataverse workflowids.
4. Flow 2's caveat still said `InstallerSignOffBy` had never been exercised. It had; the evidence
   had been consumed by a later reopen test.

**Two conclusions in the audit were wrong on first pass** and caught by looking again. A grep for
`"Work Calendar"` in the New Pool export returned zero and nearly produced "the flow ignores
holidays"; the flow references lists by GUID. Matching the canvas app's flow connections by flow
id reported two of three missing; the app references flows by `workflowEntityId`.

Also in this part: `cleanup.js` extended to cover both request lists, given a `DRY_RUN` flag, and
rehearsed against the live tenant. The dry run reported it would remove 282 Tasks, 43 Assignments
and 3 Jobs with 0 failures, and live counts were unchanged afterwards. The classifier was tested
against 12 synthetic job numbers and fails safe in one direction: every ambiguous input lands on
"keep and report", so a real pool is never deleted by accident.

## Part 2 — pool lifecycle and schedule reflow

Spec and plan written, then Tasks 1 to 5 executed subagent-driven with a review after each.

**Part 1 of the spec is complete.** All four flows that consume assignments now honour job status,
so a `Planned` pool no longer dispatches crews or raises conflict alerts. Task 1 added the
scaffolding: `Assignments.SuppressReconcileUntil`, a `Reschedule Requests` list, and a
`Planned Pools` view.

**Found and fixed en route, outside the plan's scope:** Daily Dispatch had been failing on every
real work day since `Crews.LeadEmail` was cleared on 09-05, with `To: null` and
`400 To Field cannot be null or empty`. Masked because the only intervening days were a Sunday
and Labor Day, which the flow correctly terminates on. `To` now falls back to
`stratirus@d2pools.com` with a `[no lead email]` subject prefix.

## Files touched

- `CLAUDE.md` — audit results, Work Calendar expiry and extension, Juneteenth exclusion, the
  export-by-content rule, tenant-not-yet-live posture
- `sharepoint/format-views.js` — timeline lane, built into the existing formatter rather than a
  second script, since two scripts MERGEing `CustomFormatter` on the same view is last-writer-wins
  with no error
- `sharepoint/provision-reschedule.js` — new, Task 1 scaffolding
- `flows/testdata/cleanup.js` — request lists, `DRY_RUN`, conservative classifier
- `flows/exports/*.json` — all 11 regenerated and content-verified
- `docs/superpowers/specs/2026-09-08-pool-lifecycle-and-reflow-design.md` — new
- `docs/superpowers/plans/2026-09-08-pool-lifecycle-and-reflow.md` — new, plus the progress record
- `D2-Phase-E-Pilot-Runbook.md`, `D2-Phase-F-Cutover-Runbook.md` — training copy still told PMs to
  plan a new pool in the browser tool and have Stratirus load it, which `D2 - New Pool` had made
  false the day before
- `tools/check-env.ps1` — new, Windows readiness check

## Commits

09:31 to 16:03, 17 commits, `66b8c6e` through `c1a7117`.

## Decisions

- **Juneteenth stays excluded from the Work Calendar** (Shane). A row here suppresses dispatch, so
  adding a holiday the crews actually work silently kills a real work day with no error anywhere.
  Absence is the safe default. Do not re-raise it when next extending the calendar.
- **The tenant is not yet operationally live** (Shane): *"I am literally the only person with
  access and getting notifications."* This releases batching purely to avoid tenant churn, and
  hesitation about editing or stopping a published flow. It does not release verification
  discipline, which exists because this platform's failure signature is a write that returns 200
  and does nothing. Revisit at Phase E.
- **`ProjectManager` is required on New Pool Requests.**
- **Flow 3 stays running during bulk inserts**, rather than being stopped and risking it left
  disabled.

**Three deviations from the plan, carried forward into Tasks 6 to 9:** the job filter is applied
server-side as `JobId eq N` clauses rather than an in-memory `Filter array`; flow edits use
`edit_flow` with surgical operations and a dry run rather than full-definition resends; and
`autoResolveConnectionRefs: false` is required, since the default failed Task 4's edit naming a
pre-existing action the edit barely touched.

## Open

- Tasks 6 to 9 not started. Part 2 of the spec, the reflow flow itself, does not exist yet.
- The narrow gap in `D2 - New Pool`'s failure handler is still parked: nine variable
  initialisations sit outside the protective Scope because Logic Apps forbids them inside a
  container, so if one fails the request sticks at `Building` with no email.
- Something other than these sessions is writing to the production tenant. Two Assignments rows
  were modified outside this session's activity and a Jobs row was created and removed.

## Next action

Task 6: `D2 - Reschedule Pool` skeleton, trigger, both guards and the failure path, before the
walk in Task 7. Tenant is at its audited baseline with nothing half-applied.
