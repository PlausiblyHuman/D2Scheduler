# 2026-09-08c — D2 - Reschedule Pool, built through Task 8

**Session goal:** recover from a VS Code crash that lost the previous session's context, then
carry the pool-lifecycle plan forward. Ended with Tasks 6, 7 and 8 done and the new flow live.

Stopped deliberately after Task 8 at Shane's call. Task 9 and the whole-branch review are the
only work left.

## Recovery

The crash cost conversation context, not work. The tree was clean and everything through 16:03
was committed. Tasks 1-5 were recoverable because the previous controller had committed a
Progress section into the plan file itself, which is the only artifact that survived: the SDD
workspace is gitignored scratch and this plan's ledger was gone. That practice is why the session
resumed in minutes rather than by re-deriving state from eleven flow exports.

The 09-08a session log was two workstreams stale. It has been superseded by `2026-09-08b` and
this log.

## Built

`D2 - Reschedule Pool` is live and Started. A PM raises a **Reschedule Requests** row and a pool's
date chain is recomputed from any sub-phase forward: working days only, Sundays and Work Calendar
holidays skipped, `Locked` and signed-off rows pinned where they are, nothing written when nothing
moved. A ten-minute `SuppressReconcileUntil` window stops a 19-row reflow firing a conflict check
per row, and a single end-of-run sweep reports collisions to the requester whatever the pool's
status while alerting the job's PM only when it is `Active`.

- flowId `2f2cde97-e0fd-5c5c-934a-02f09a1d83a5`, workflowEntityId `210f1d70-e2ab-f111-aaab-6045bd0196b3`
- Task 6: trigger, both guards, failure path. Built first, deliberately, because `D2 - New Pool`
  shipped without one and a reflow that dies midway leaves a half-reordered schedule.
- Task 7: the working-day walk and pinning.
- Task 8: suppression and the conflict sweep.

## What review caught that testing could not

Three defects, none of which a passing test would have surfaced:

1. **A guard trip could have reported `Status = Done` after doing nothing.** Found in the
   pre-flight scan, before any code existed: the plan put `Set_status_done` on the scope's
   `Succeeded` route while the guards deliberately do not fail the scope.
2. **A genuine failure showed as a `Succeeded` run.** `Handle_failure` had no `Terminate`, so the
   failure was visible only in the SharePoint row and the email. That is the same invisibility
   that hid the Daily Dispatch outage for days. Settled by reading `D2 - New Pool`'s real payload:
   it terminates `Succeeded` for expected guard trips and `Failed` for genuine failures.
3. **The walk dropped a write-safety guard from the pattern it was told to copy.** The loop was
   copied faithfully but `Condition_span_incomplete`, which sits immediately after it in
   `D2 - New Pool`, was not. An `Until` exits on its condition or its iteration cap and the two
   are indistinguishable, so a corrupt `DurationDays` would have MERGEd a partial span — a write
   that returns 204 and silently corrupts dates.

## The Choice-column bug, and why the tests were blind to it

Task 8 first shipped the conflict alert as a conditionally-styled completion email rather than a
separate email to the PM. The spec rules against that: an alert goes to the PM, a report goes to
the requester, and those are routinely different people. Left merged, the suppression that stops
Flow 3 raising 19 alerts would also have been the reason the PM got none at all.

Splitting it exposed a latent bug nothing else would have. **`Jobs.Status` from the connector's
`GetItems` is a Choice object `{Id, Value}`, not a string**, so the flow's Active-check had always
evaluated false. Under the merged design that check only controlled subject styling, so no test
could see it.

Both test pools also have a null ProjectManager, which meant an alert addressed to the PM and an
alert never sent were indistinguishable. The implementer's "both readings pass every test" was
accurate, and that is exactly why it was not evidence. The spec had to decide.

Cross-checked the same defect against Tasks 2-5, since all four added Active-job filters and a
shared wrong assumption would have been a plan-wide defect sitting in production. All four are
safe: Dispatch, Nightly and both Summaries filter server-side, and Flow 3 reads via raw REST with
`odata=nometadata`, which returns a plain string.

## Files touched

- `flows/definitions/D2-Reschedule-Pool.json` — new
- `flows/exports/D2-Reschedule-Pool-2026-09-09.json` — new; the stale `-2026-09-08.json` was
  deleted, see below
- `docs/superpowers/plans/2026-09-08-pool-lifecycle-and-reflow.md` — Progress section rewritten
  for Tasks 6-8, the eight deviations, and the five findings Task 9 must write into CLAUDE.md
- `sessions/2026-09-08b-audit-and-reflow.md` — the missing log for the prior session

## Commits

`f6969b0` through `80f88c9`. Seven commits on the flow plus the session log and plan update.

## Decisions

- **The conflict alert is a separate email to the job's PM**, falling back PM -> requester ->
  `stratirus@d2pools.com` with a visible marker, rather than a styled completion email. The
  distinction the spec draws is about who gets interrupted.
- **The sweep's comparison set stays tenant-wide**, so an Active pool can be alerted about
  colliding with a `Planned` one. The spec wants a PM choosing dates to learn about collisions
  with existing pools, and one alert per reflow is bounded. It does create an asymmetry worth
  documenting: every other conflict surface here considers Active jobs only.
- **Task 7's two skip conditions were merged into one.** Logic Apps rejects nesting depth 9 and
  the walk sits at exactly 8, so the plan's literal structure is unbuildable. Review verified both
  cursor behaviours survived the merge.

## Adjacent defects fixed past scope

- **`Sequence` was null on all 38 test assignment rows.** Backfilled from the Sub-phase Template.
  It blocked Task 6's own guard test and would have blocked Tasks 7 and 8, which order by it.
  A production data change with no git diff, verified independently against the template map.
- **A stale duplicate export.** The UTC date rollover left two files for the same flow. Compared
  by content, the `2026-09-08` one was a pre-Task-8 snapshot missing the entire conflict sweep.
  Deleted. This is the same trap the pre-pilot audit found on `D2 - New Pool`, where restoring
  from a committed export would have silently deleted a fix.

## Open

- **Task 9 not started:** CLAUDE.md, both runbooks, the starter guide, and one end-to-end pass
  (raise `TEST-9100`, reflow it, commit it to Active, confirm dispatch, delete it).
- **The whole-branch review has not run.** Seven deferred minors are listed in the plan's Progress
  section for it to triage, including that `cleanup.js` does not cover `Reschedule Requests`.
- **Five platform findings are still undocumented** and are the highest-value part of Task 9: the
  self-referencing `SetVariable` error, the depth-8 ceiling, the Choice-column shape, `edit_flow`'s
  synchronous validation, and `get_run_history` returning stale snapshots.
- The unexplained writes to the tenant remain unexplained. The peer session running tonight was
  ruled out as a candidate.

## Next action

Task 9: documentation, runbooks and the end-to-end pass, then the whole-branch review. The plan's
Progress section carries everything needed to resume cold.
