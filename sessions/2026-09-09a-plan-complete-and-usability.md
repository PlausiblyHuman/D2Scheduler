# 2026-09-09a — Pool lifecycle plan finished, then a usability round

**Session goal:** finish Task 9 and the whole-branch review, then respond to what Shane found by
actually using the site with real volume in it.

Continues directly from `2026-09-08c`, same conversation.

## Part 1 — the plan is complete

All 9 tasks done, final whole-branch review clean: 0 Critical, every Important closed.

**Task 9** documented the lifecycle and verified the whole loop on the live tenant with a real
`TEST-9100` pool: arrived `Planned`, dispatched nothing, raised no alerts, reflowed from sequence
1, committed to `Active`, appeared in the dispatch email (confirmed by reading the sent body, not
the run status), then deleted back to exact baseline.

**The final review found five things no per-task review could see.** All closed:

- The reflow walk was the only variable-mutating loop of ten across twelve flows without pinned
  concurrency, and the one where iteration order is the algorithm.
- Flow 3 alerted PMs about collisions with uncommitted `Planned` pools, while the documentation
  written the same day claimed the opposite.
- All four edited `flows/definitions/*.json` were stale in exactly the actions this branch added,
  while CLAUDE.md told the next session to reuse them verbatim.
- The launchpad lacked both surfaces the rewritten runbooks depend on.
- Three of four emails in the new flow lacked the null-recipient fallback the fourth had.

**One pattern, seen twice, worth carrying:** a fix that copies a good idiom into a new context
inherits assumptions the original context guaranteed. Task 8's alert decoupling fixed a design
flaw and an incidental `runAfter` recreated the outcome. The fix wave's null-recipient fallback
was copied from a path where `Get_job` had always succeeded into one where it may not have, so
`first(null)` threw and the failure email broke on the one path it exists for. Both were correct
in isolation and wrong in place.

Eleven rulings are recorded in the plan file's Progress section, which is the durable record now
that the SDD workspace is deleted.

## Part 2 — three demonstration pools

Shane asked to see a fully populated site before the cleanup gate. Three pools raised at once:
`D2-1042` Reyes Residence, `D2-1043` Whitfield Estate, `D2-1044` Salcedo Residence. Site went from
43 assignments and 282 tasks to **181 and 1,167**.

**Concurrent generation is faster than sequential, which nobody had measured.** Three pools built
together took about 13 minutes, against 17 for a single pool the night before. So the multi-minute
stalls seen during Task 9 are a per-run pacing limit, not a tenant-wide ceiling, and two PMs
raising pools in the same hour is fine.

All three arrived `Planned`, so three heavily overlapping pools sharing default crews produced no
alerts at all. That is Part 1 of the spec doing its job.

They use realistic job numbers deliberately, so the views look real. The cost is that
`cleanup.js` will not auto-remove them, by design, so `flows/testdata/demo-pools-manifest.json` is
the removal record.

## Part 3 — usability, from Shane using it

Five changes, all from his own observations rather than a backlog.

- **The Assignments edit form** showed about 25 fields flat. Now 13, in the order the job runs.
  The `Locked` / `NotApplicable` / `PMSignOff` Required trap is gone.
- **The home page hero** was `Today by Crew`, the right lens at one pool and the wrong one at six.
  Now a new `This Week by Job` view, grouped by pool.
- **The summary emails** had an over-escaped quote in the daily flow, found by pulling the actual
  sent body rather than reading the definition. Fixed, plus 16 deep links so a reader can click
  from "oldest outstanding" straight to the row.
- **`Crew` is a free-text join key**, which Shane spotted on the edit form. A wrong value does not
  error, it matches nothing. Now guarded by a validation formula, and the guard turned out to be
  enforced on REST writes as well as the form: writing `Devon Crew +3`, the exact mistake that
  already cost this project a session, returns `SPListDataValidationException` with the value
  unchanged.
- **Crew conflicts are now visible in SharePoint**, not only in email. New `ConflictWith` column,
  new flow `D2 - Conflict Flag` (nightly 05:00 Central), a `Conflicts` view, and a launchpad link.

## Files touched

- `docs/superpowers/plans/2026-09-08-pool-lifecycle-and-reflow.md` — Progress rewritten as the
  completion record: 11 rulings, 8 deviations, deferred items
- `flows/definitions/D2-Reschedule-Pool.json`, `flows/exports/*` — the reflow flow and re-exports
- `D2-Phase-F-Cutover-Runbook.md` — a refused delete shows plain `Refused`; the reason is in `Result`
- `sharepoint/guard-crew-values.js` — new
- `sharepoint/format-views.js`, `build-home-page.js`, `provision-views.js` — hero, new views, formatters
- `flows/testdata/demo-pools-manifest.json` — new
- `flows/testdata/daily-summary-preview.html`, `weekly-summary-preview.html` — regenerated from live sends
- `CLAUDE.md` — five platform findings, the flow table, the `office` compliance asymmetry

## Commits

`f6969b0` through `df10380`. All pushed to `canvas-app-handoff`.

## Decisions

- **PM-proxy sign-off only to start.** Crew-lead licensing deferred; decide later whether to add
  seats. The app already supports this with no rebuild, since the proxy picker had to exist anyway
  for the four subcontractor crews.
- **Shane runs the first real pool himself**, as stage one of two. He will validate mechanics; a
  real D2 PM is still needed for domain fit, because whether 46 sub-phases in that order at those
  durations matches how D2 builds a pool is not something he can answer.
- **The conflict annotator is a separate flow from the nightly sweep.** One alerts, one annotates,
  and the annotator covers `Planned` pools so a PM can see collisions while choosing dates.
- **`Crew` gets a validation guard now, a dropdown later.** Converting it to Choice would give a
  real picker but breaks all nine in-memory `?['Crew']` reads across five published flows plus the
  canvas app, which is its own considered change.
- **Machine-owned fields are hidden from the display form too**, accepted rather than reverted.
  SharePoint shares one visibility set across New, Edit and Display on this list, established by
  A/B test. The emails already carry the sign-off status and task counts the form now omits.

## Corrections worth keeping

- I told Shane the three demo pools had **34 crew-day collisions**. The real figure is **10**. My
  count included the seven `Unlimited` buckets, which are capacity-exempt by design and can never
  conflict. The implementer built its own oracle, got 10, and flagged the discrepancy rather than
  matching my number.
- I told the Task 9 implementer its throttling diagnosis was wrong, based on the fast phase of a
  run. It was right. The generation loop pauses and resumes rather than degrading smoothly.
- `D2 - Conflict Flag`'s ids were reported as one value. They are two: flowId
  `972c139d-e55f-6743-a76c-fbd2f08eeb45`, workflowEntityId `f0dd9a1d-8bac-f111-aaab-002248043e80`.
  Fourth instance of this labelling mistake on this project.

## Open

- **The cleanup gate has not been run.** Harrison, both TEST pools and the three demo pools are
  all still live. `cleanup.js` handles the first three; the demo pools need the manifest.
- **Dispatch will mail seven `[no lead email]` emails every morning** while no crew lead has a
  mailbox. Decide whether to point it at the PM for the pilot.
- Every template duration is still a 2-day placeholder, so every generated pool is the same length
  regardless of size. Most visible now that three sit side by side.
- `flows/exports/` still keeps multiple dated generations per flow. Pre-pilot housekeeping.
- Seven deferred minors from the whole-branch review, listed in the plan's Progress section.

## Next action

Run the cleanup gate when Shane has finished looking at the populated site, then set up his first
real pool.
