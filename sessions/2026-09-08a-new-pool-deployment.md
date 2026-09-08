# 2026-09-08a — New Pool deployment, end to end

**Session goal:** close the biggest remaining hole in the system. A PM had no way to create a
pool; the only route into SharePoint was a Stratirus engineer running scripts by hand.

Started the evening of 09-07 and ran into the morning of 09-08. Nine planned tasks, a final
whole-branch review, and a fix wave, all executed subagent-driven with a review after every task.

## What D2 can now do

A project manager adds one item to a SharePoint list and gets a complete pool: the Job, 46
sub-phase Assignments with chained work-day dates that skip Sundays and Work Calendar holidays,
and 295 Tasks. A second flow deletes a pool behind four guards.

Proven by a real 6m47s production run, not asserted: 46 assignments, 295 tasks, zero count
mismatches, no Sunday endpoints, 12 distinct real crews. Then deleted by the delete flow itself,
returning the tenant to exact baseline.

## The design changed twice, both times for the better

**Shane's redirect collapsed the build.** CLAUDE.md framed this as porting `add_pool.py`'s
scheduling logic into Power Automate. Shane's point was that the checklist is fixed: *"a simple
template with all of them that get copied by the PjM with start-dates updated should be
sufficient."* That removed the expensive half. The flow does not plan anything. It copies a
template and walks dates forward. No busy map, no qualified-crew search, no 46-step constraint
solve in a language bad at all three.

**Hosting the browser tool in SharePoint is closed off, on policy not capability.** An HTML page
in a document library IS the custom-script mechanism, modern sites block it by default, and any
change back reverts within 24 hours. Microsoft's own docs, found before spending a browser session
on it.

## Built

- Four lists: `New Pool Requests`, `Delete Pool Requests`, `Sub-phase Template` (46 rows),
  `Task Template` (295 rows). The template is DATA, so Don can edit the checklist and the 46
  placeholder durations without anyone touching a flow.
- `tools/gen-template-seed.py` — extracts the template from the browser tool, resolves default
  crews from the LIVE `Crew-Trades` list rather than the stale HTML.
- `sharepoint/provision-pool-lists.js`, `sharepoint/seed-templates.js` — idempotent, committed.
- `D2 - New Pool` and `D2 - Delete Pool`, both published, exported, and started.
- Launchpad links, flow exports, CLAUDE.md and spec updated.

## What the process caught that testing could not

- **A 2-row sample produced a confident, wrong conclusion** that `Sub-phase Template` had no
  `Trade` column. Both sampled rows were pseudo-skill rows with no trade, and the connector OMITS
  null-valued fields rather than emitting null. Caught by controller verification, not by the
  implementer. That would have broken three later tasks.
- **The final whole-branch review found a Critical no per-task review could see**: `D2 - New Pool`
  had no failure path at all. The same defect had been found and fixed TWICE on the delete flow
  and never carried back across the task boundary. A mid-run failure would have stranded a partial
  pool with the request stuck at `Building` and no email to anyone.
- **Hardening a guard introduced a fresh instance of the bug being hardened against.** The
  truncation check added 46 sequential reads upstream of the failure handler.
- The delete flow's guards **worked by luck of current data**, not by design: blank-vs-blank passed
  the confirmation test on `'' == ''`, and reads capped at 200 rows with no pagination. Neither was
  reachable with today's data, so no test could have found them.

## Decisions

- **`ProjectManager` is REQUIRED on New Pool Requests** (Shane). The flow had been silently
  defaulting a blank PM to the D2 Bot service account, reproducing the Harrison placeholder defect.
  Leaving it null breaks Flow 3's alert routing. Both fail silently, so neither was acceptable.
- **Delete Pool exists at all** (Shane, reversing my out-of-scope call). A PM who can create 342
  rows needs a way to undo it.
- **Flow 3 stays running** during bulk inserts. Stopping it risks it being left disabled, which
  silently removes the only real-time safety net for business rule 2. A real pool costs ~92
  reconciliation runs (46 inserts plus 46 counter MERGEs), which quota does not care about.

Sixteen rulings are recorded in full in the SDD ledger.

## Open

- **A narrow gap in the new failure handler.** Nine variable initialisations sit outside the
  protective Scope because Logic Apps forbids them inside a container. If one fails the request
  sticks at `Building` with no email. Low probability; parked deliberately rather than make a
  second structural change to a just-proven flow.
- **Something other than this session is writing to the production tenant.** A `Jobs` row was
  created and removed unexplained, and two protected Assignments rows were modified outside any
  of this session's activity. No harm done and every count reconciles, but CLAUDE.md's warning
  about concurrent sessions should be taken literally.
- Calendar / Gantt visualisation is still untouched. It was the other task queued on 09-07.

## Next action

Fresh session on calendar / schedule visualisation. Cheapest real option is to surface the
browser tool, which already IS a Gantt and simply is not reachable from SharePoint.
