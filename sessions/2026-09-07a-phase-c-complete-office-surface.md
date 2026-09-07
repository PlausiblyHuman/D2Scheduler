# 2026-09-07a — Phase C complete, office surface built, weeks replaced by phases

Spans 2026-09-06 into 09-07. Opened as "continue dev", became the session that finished the
field app, found and built the missing office surface, automated the deploy loop, and retired
week numbering. 25 commits, `2257db3` through the restructure.

## What landed

**Phase C (field app) is complete and verified against live data.** Today's work → open a
sub-phase → tick tasks → save → sign off, with the sign-off attributed to a real person.
Assignment 25 reads `InstallerSignOff=True`, `InstallerSignOffBy="D2 Bot"`,
`WorkDate=2026-09-06`, and its task rows carry `CompletedOn` timestamps matching the flow run to
the second. Also built: sign-off **locking**, a recorded **Reopen** that appends who and when to
`SignOffNotes`, the **PM-proxy crew picker**, and the **Notes** field.

**Flow 2 now writes `InstallerSignOffBy`** — the blocker carried in from 2026-09-06a. Sixth
trigger parameter plus an `ensureuser` lookup, because a Person column cannot be set by email.

**Three new flows**, all created and published headlessly: `D2 - Task Tick Batch`,
`D2 - Reopen Sign-off`, and `D2 - Counter Reconciliation` (nightly, repairs `TasksComplete` drift;
first run fixed 6 rows, second fixed 0).

**The office surface never existed.** Phase A specified seven SharePoint views and its exit gate
was ticked claiming "all views show correct filters". Every list had only `All Items`. Built and
verified by *rendering* each one, since a view accepts invalid CAML at creation and fails only
when opened. Phase F training walks Don and both PMs through those views.

**Don's daily view.** He asked where his crews are and what they are doing. The 06:30 summary now
leads with "Where crews are today", ordered by crew, with site addresses; plus a "Today by Crew"
view for ad-hoc checks.

**The Studio publish is automated.** Deploy → drive Studio → publish → verify now runs with no
human step, proven twice as a full round trip. Shane is out of the publish path.

**Weeks replaced by phases A–G.** ~104 references across 9 documents; zero `Week N` remain.

## Decisions made

- **Sign-off locks the task list; a recorded Reopen is the only way back.** Shane's call, from a
  real case: a PM walk-through finds work signed off that clearly was not done.
- **Batch deploys.** Every publish costs a manual step, so accumulate changes rather than
  deploying per fix. Saved as a standing preference.
- **Prefer CLI/MCP over the browser**, using the browser only where it would otherwise need
  Shane. Large flow edits now go through the Dataverse workflows API with files on disk.
- **Keep A–F on the existing AzDo Epic letters** rather than renumbering; G is additive. Phase D
  widened to hold both orphaned workstreams.
- **Git Integration is ruled out** — it needs Managed Environments, which is premium-only, the
  same wall that killed Dataverse.

## Four wrong conclusions, corrected

Worth recording because three were caught by Shane, not by me.

1. **"Patch() never persists"** — wrong, and I built a flow around it. Three faults were live at
   once (a stale Studio tab reverting deploys, `Classic/*` events not firing, and writes not yet
   consented) and each masked the others. Re-verify a load-bearing negative before building a
   workaround on it.
2. **"The headless loop works"** — verified in Studio, which is the one client that cannot detect
   the bug. The player was serving old screens.
3. **Delegation direction backwards** in formula-review findings 6/7 — `.Value` delegates,
   `.Id` does not.
4. **`AssignmentId`** is the REST field name; the connector returns `Assignment` + `Assignment#Id`.
   The first Counter Reconciliation run reported a confident "43 checked, 0 repaired" that was in
   fact a total mismatch. Fourth instance of assuming a field name instead of reading one.

## Open / blocked on

- **Phase D3 is the critical path and has not been asked for.** ~7 crew-lead identities (none
  exist in the tenant), ~7 Business Basic seats, a real PM on the first pool, 10 unmapped trades,
  11 Unassigned sub-phases. All human-gated, all upstream of the pilot.
- Summary recipients still internal — flip to Don once `TEST-900x` is cleared.
- Event-Driven Reconciliation trigger is a no-op; it is STOPPED and needs a decision before restart.
- Crew picker and reopen wording are published but no human has looked at them.
- The browser tool → Lists sync still does not exist (Phase G).

## Next action

Draft the Phase D3 ask for David and Don — the identities and seats. It is the whole critical
path, it is the one thing Stratirus cannot unblock, and nothing else moves until it starts.
