# Don's 10 October asks: scope

2026-10-27. Sources: Don's email "Scheduler" of 2026-10-10, reviewed in
`docs/2026-10-11-don-template-sheets-review.md`; the 21 October meeting, scoped in
`docs/2026-10-21-flexible-templates-scope.md`; what has shipped since. Sizes are working sessions of
effort-bound build, the kind that has compressed on this project. They are estimates, not quotes, and
the commercial answer for anything over a day is Shane's: on 2026-10-11 the October D2 bucket had
about 7 hours left.

## Where each ask stands

| Ask | Status | What it needs |
|---|---|---|
| Per-project optional sub-phases (fence type, auto cover) | **Built** (step 4, verified live 2026-10-23), not deployed | Don's list of optional features. Without it the `+ Job` checklist and the Features drawer are empty controls |
| 6.4 Equipment Gas hook-up, with renumbering | Mechanism live (steps 1 and 3); renumbering is safe once step 2 deploys | Don's placement of the three gas sub-phases in each template |
| Phase 10 Specialty structures (diving boards, grottos, slides) | Not started | A decision: a feature group on a pool project, which step 4 already handles as optional sub-phases, or a build type of its own. Recommendation: feature group |
| Open and Enclosed Structures sheets (Pavilion, Pool House) | Not started | Don's answer to whether these are separate projects. If so, each is a build type: the `BuildType` mechanism exists, the work is seeding and crews. Large, own spec |
| Delete or rename a project | Not started | Scoped below |
| Notes per checklist item | Not started | Scoped below |
| Punch-list items | Not started | Scoped below |
| PM-addable trades | Not started | Scoped below |
| Archive and warranty tagging | Archive exists: Mark complete, Completed projects, Reopen (shipped 2026-10-01) | Warranty is not managed in this tool (Shane, 2026-09-28). Recommendation: no |

## Delete or rename a project

**Rename the name.** `Jobs.Title` is one field. The Jobs tab already has an editable name box; Save
writes `Jobs.StartDate` back through `pushJobStarts`, compared against the value loaded, and the
name goes through the same path. Small: about 2 hours with the harness.

**Change the job number: not self-service.** The job number is inside all 46 Assignments titles, is
what the write-back's row-identity check matches, sits on the New Pool Requests row, and is what
`D2 - Delete Pool` asks to be typed twice. A planner edit that touched one of those and not the rest
would leave a project that half the system cannot find. Don's existing typos (`26- 2055`,
`25=2029 White Heart`, `26-2055` beside `26- 2055`) are the real want here, and the honest route is a
Stratirus script with compare-before-write that rewrites the Jobs row, the 46 titles and the request
row together, run on request. The 2026-10-11 review sized the clean-up at under an hour.

**Delete.** Today a PM adds a row to Delete Pool Requests on the SharePoint site; the planner's Remove
only hides a project locally until the next Refresh. The consistent design is the one `+ Job` already
uses: a Delete button on the Jobs tab that raises the Delete Pool Requests row over Graph, with the
same two-key confirmation (type the job number), the reason box, and Override signed off where any
sub-phase is signed. The mapper then reads Delete Pool Requests the way it reads New Pool Requests
for the Building guard, so a project being deleted shows as such, is frozen, and drops off on the
next Refresh once the request is Done. About a day, planner and harness.

Two rules I would build in, both Shane's call:

- An Active project goes Back to planning first. It is in the summaries and the conflict alerts, and
  on the calendar if Calendar Sync is ever turned back on; deleting it mid-flight should be a
  deliberate two-step.
- Who may delete. Today anyone with site Edit can add the request row, which is every member. The
  template lists are to be gated to Don and David (decided 2026-09-21, not applied); delete could
  follow the same gate, on the request list's permissions, with the planner reading the result.

The safety net is snapshot-before-delete in `D2 - Delete Pool` (proposed in WP8, not built): the
flow writes the project's rows to Documents > Backups before it removes them. Until then the nightly
snapshot covers a deletion to within a day and the recycle bin holds the rows for 93 days. Half a day
on the flow, done through the Dataverse route and run by Shane.

## Notes per checklist item

**What exists.** `Tasks.Note` holds the N/A reason, and only that: clearing N/A clears it, and the
features mechanism recognises its automatic reason text. A sub-phase has a comment thread (the
Sign-off Comments list, Kind Comment) in the panel, saved on Save.

**Cheapest answer, no build:** a comment on the sub-phase that names the task. Worth asking Don
whether that is enough before building anything.

**If the note must hang on the line:** a new `Tasks.Comment` column (Note type), separate from the
N/A reason so neither can wipe the other; a note icon beside each task in the panel that opens a
prompt; saved on Save through the task write path; allowed under a signed sub-phase, since a note
changes nothing the sign-off attests. Shown in the panel only; the dispatch email and the summaries
do not carry it unless asked. The canvas app would get it with its next batch, if crew leads ever
come on. 3 to 5 hours plus the harness.

## Punch-list items

**What Don's sheets say.** Gunite Rev4 8.7 carries "Creation of Punch List Items / Ability to add
multiple single line items to the schedule"; 9.0 "Punch-list completion" carries the note "need to
manually add and dates". So punch items are per project, typed in by hand, several at a time, and he
wants them on the schedule with dates.

**Three shapes:**

- **A. Checklist lines** under a punch-list sub-phase (a template line such as Rev4's 8.7). The planner
  gets an Add item control that creates one Tasks row over Graph; items tick, go N/A, lock under the
  sign-off and count in the task totals; signing off the sub-phase closes the list. No date or crew per
  item. This is the same create primitive step 4 left uncovered (adding a task to an existing
  sub-phase). About a day.
- **B. Items as sub-phases** under a Punch list phase: each item is an Assignment with one task, its
  own crew and a one-day span, created by an Add punch item control. The Features drawer's create
  path (`planStructureCreates`, `applyStructureCreates`) already creates Assignments with their tasks
  over Graph, so this is a new caller of a proven path. Items show on the Board as bars, dispatch to
  a crew, reflow with the project, and sign off one by one. More rows per project (one Assignment
  and one Task per item). 1 to 2 days.
- **C. A separate Punch Items list** with its own planner tab. Most work, and it puts the items
  outside the schedule, which is the opposite of what the sheet asks for. Rejected unless Don wants
  items that are not scheduled work.

**Recommendation: B**, because "to the schedule, with dates" is what he wrote, and because the create
path exists. The question for Don is whether a punch item needs its own crew and date (B) or is a
line to tick (A).

## PM-addable trades

**What exists.** Trades (26 rows) and Crew-Trades (51) in SharePoint feed the nightly
`D2 - Crew Trade Check`; the planner's Crews tab qualifications live in each browser's localStorage
and only steer that browser's Qualified list and Auto-Schedule. Two copies that can disagree, and the
planner's is the one a PM sees. Since 2026-10-13 Refresh also reads Trades, but only for labels.

**Shape.** Make Crew-Trades the copy the planner reads (Refresh loads it, the Crews tab shows it), and
give the Crews tab an editor that adds a trade and ticks crews against it, writing Trades and
Crew-Trades over Graph. Gate it the way the template lists are to be gated, Don and David through
SharePoint permissions on the two lists, with the planner reading the result. A new trade only
changes scheduling once template lines carry it in `Skill`, so the editor should say so. 1 to 2 days.

**Data first.** Don still owes the trade mapping for the 10 unmapped trades and the 11
field-supervision sub-phases (open since Rev D). Fencing as a trade, from the 10 October list, is an
hour of data today. The editor is worth building after the mapping lands, not instead of it.

## Order

1. Don's feature list, then deploy steps 2 and 4. That ships optional sub-phases and makes gas and
   Phase 10 as a feature group a data task.
2. Delete and rename: the one item where the wrong answer (hand-deleting rows on the site) damages
   data. About 1.5 days with snapshot-before-delete.
3. Punch list, shape B, once Don answers the crew-and-date question. 1 to 2 days.
4. Notes per item, if a sub-phase comment does not satisfy him. Half a day.
5. The trades editor, after the trade mapping. 1 to 2 days.
6. Pavilion and Pool House as build types: own spec after Don says they are separate projects.

## Questions for Don, in one message

1. Punch items: does each need its own crew and date on the schedule, or is a line to tick enough?
2. Notes: on the task line, or is a comment on the sub-phase enough?
3. Delete: who should be able to delete a project, and should an Active one go Back to planning first?
4. Phase 10 Specialty structures: part of a pool project, or a project of its own?
5. Pavilion and Pool House: separate projects?

Still owed from before: the optional-feature list, where the gas sub-phases go, the trade mapping,
crews for the 20 unassigned Fiberglass sub-phases, which existing jobs are Fiberglass, and whether
Harrison and Campos come off.
