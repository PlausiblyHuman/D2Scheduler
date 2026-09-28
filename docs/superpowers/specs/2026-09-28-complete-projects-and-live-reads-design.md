# Scale piece 5 and the read half of piece 4: completing projects, and reading only live ones

**Status: written 2026-09-28, awaiting Shane's review.** Spec A of two. Spec B (Board speed: folded
phases, row-local updates, storage-full handling) follows.

**One naming call to confirm.** Shane decided "marked Closed, stays in place". `Jobs.Status` already
carries a `Complete` choice (Planned, Active, On Hold, Complete), unused since Phase A and read by
nothing. This spec uses it rather than adding `Closed`: no schema change, and it is a word already in
D2's own list. Controls are named after the state they produce, as Activate was: **Mark complete**,
**Completed projects**, **Reopen**. Say so if it should read Closed instead; the change is the value
string and four labels.

## Why

D2 builds about 60 pools a year and a pool runs about four months, so about 20 are live at once.
Measured on 2026-09-28:

- Graph returns 500 Tasks rows in about 1.1 s, read one page after another. The planner reads every
  Task on every Refresh, so a Refresh grows with **every project ever built**: about 15 s of network
  at 20 live projects today, and about 45 s after a year if nothing is ever completed.
- One connector read in a flow is capped at 5,000 rows by D2's licence. **Counter Reconciliation
  reads every Task**, passes 5,000 at about 17 projects in the list (early 2027 at this rate), and is
  now guarded to fail rather than write wrong counters. It needs a real fix.
- Crew Trade Check, Conflict Flag and Reschedule Pool also read every Assignment ever written.

Completing projects and reading only live ones fixes all of this at the source: the working set stays
at about 20 projects however long D2 uses the system.

## Decisions this rests on (Shane, 2026-09-28)

1. A project is completed by a person pressing a button on the Jobs tab, offered only when every
   sub-phase is installer-signed or not applicable.
2. Completed means `Jobs.Status = Complete`. Rows stay where they are.
3. Completed projects are hidden from the planner, with a Completed projects list on the Jobs tab
   that opens one read-only on demand.
4. A completed project can be reopened.
5. Warranty is not managed in this tool. No retention rule, no warranty features.

## 1. Mark complete and Reopen (planner, Jobs tab)

**Eligible to complete:** `Status = Active`, the project is not still building, and every sub-phase
is installer-signed (`s.inst`) or not applicable (`s.skip`). PM sign-off does not count: nothing
reads it, as recorded under Schedule Check.

- An eligible project shows a **Ready to complete** chip and a **Mark complete** button beside
  Back to planning.
- A banner above the Jobs table names the eligible projects when there are any, so nobody has to hunt
  for them: "2 projects are ready to complete: 26-2101, 26-2104."
- **Mark complete** opens a dialog in the house style: it names the project, says it leaves the Board,
  the dispatch, the calendar (at the next 04:30 sweep, as Back to planning does) and the summaries,
  and that it can be reopened from Completed projects. **It writes straight away**, through
  `doSetPoolStatus(jobId,'Active','Complete')`, which already re-reads the live Status and refuses
  if it is no longer Active. After writing it Refreshes, and the project drops off the screen.
- **Not eligible, but a PM wants it gone anyway** (a cancelled job): not offered here. Back to
  planning, then Delete Pool Requests, which already handles that case. Keeps "complete" meaning
  complete.

**Completed projects** is a collapsed section under the Jobs table, listing job number, name, PM and
the date it was completed, newest first. That date is the Jobs row's `Modified`, so a later edit to a
completed row moves it; acceptable, since completed rows are not edited in normal use. Each row has:

- **Open** loads that one project's Assignments and Tasks and shows it on the Board read-only:
  banner "Completed project, read only", no inline controls, no drawer edits, sign-off boxes
  disabled, excluded from every Save set, from Auto-Schedule and from Schedule Check. It stays until
  the next Refresh.
- **Reopen** writes `doSetPoolStatus(jobId,'Complete','Active')` straight away, then Refreshes.

**The record of who completed or reopened it, and when, is the Jobs list's version history.** No new
column. The dialog says nothing about it; it is there if anyone asks.

## 2. The planner reads only live projects

`loadFromD2ViaGraph` today iterates every key in `D2_GRAPH.lists` and pages each list to the end.
It becomes:

1. Read **Jobs** (all rows; about 60 a year, one page for years), **Work Calendar**, **New Pool
   Requests** and **Sign-off Comments** as now.
2. Split jobs into **live** (Status not `Complete`) and **completed**.
3. For each live job, **in parallel**:
   - Assignments: `$filter=fields/JobLookupId eq '<id>'` (Job is indexed as of 2026-09-28).
   - Then Tasks for that job's assignments: `$filter` on `fields/AssignmentLookupId` with an `or`
     chain of that job's assignment ids (46 terms; `Assignment` is indexed). If a chain that long is
     refused, fall back to chunks of 15.
4. Hand the mapper the same arrays it takes today, holding live projects only, plus
   `completedJobs` for the Completed list.

**Capture first.** Graph `$filter` on a lookup id over `fields/` is a shape this project has not
used. Before writing the mapping, fire each query once against the live tenant and save the result as
`fixtures/planner/live-payloads-graph-filtered.json`; the tests run against that capture, never a
hand-written one. Record whether Graph needs the `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly`
header (it should not, on indexed columns).

**Merge semantics on import.** Today a job in the browser that is missing from a payload is "a pool
that exists only in this browser" and is left alone. A project that has just been completed would
therefore linger forever. The payload carries `completedJobNumbers`, and the import **removes**
those from `S.jobs` (they have a baseline, so they came from SharePoint). A true local sketch, with
no baseline, is still left alone.

**Save reads only what it writes.** `pushChangeSet`, `pushSignoffs` and `pushRejections` re-read the
whole Assignments or Tasks list before writing (compare-before-write needs a fresh read). They move
to the same per-job filtered reads, for the jobs in the change set only. `pushJobStarts` and
`doSetPoolStatus` read Jobs, which stays small.

**File mode** (`file://`, the console export and applier) is unchanged. It is a fallback and is not
used by anyone today.

## 3. Flows skip completed projects

Every alerting and reporting flow already filters `Status eq 'Active'`, so Complete drops out of
dispatch, the summaries and the alerts with no change. Calendar Sync's 04:30 sweep removes a
completed project's events as orphans, the same way Back to planning's are removed.

The four whole-list readers learn to skip Complete, using the existing
`Get_active_jobs` / `Select_active_job_ids` / `Compose_active_job_clause` idiom with the jobs
filter `Status ne 'Complete'` (Status is indexed):

| Flow | Change |
|---|---|
| Crew Trade Check | `Get_assignments` adds the live-job clause |
| Conflict Flag | `Get_assignments` adds the live-job clause |
| Reschedule Pool | `Get_all_assignments` adds the live-job clause (a filter string only, no new container, so the depth-8 walk is untouched) |
| **Counter Reconciliation** | **rewritten**, below |

**Counter Reconciliation, rewritten per live project.** Today: read every Task, read every
Assignment, recount. New shape:

1. `Get_live_jobs`: Jobs, `Status ne 'Complete'`.
2. `For_each_job` (concurrency 1): `Get_job_assignments` (`JobId eq <id>`), then
   `Get_job_tasks` (`AssignmentId eq a or ...` over that job's assignments), then the existing
   recount and MERGE-only-if-drifted, unchanged.
3. The existing `Guard_read_complete` becomes per job: 5,000 rows for one job is impossible, so a
   capped read there still means something is wrong and still stops before writing.

This removes the 5,000-row problem for good: the largest read is one project's 295 tasks. About 40
reads a night at 20 live projects, well inside the daily request allowance.

All four go through the Dataverse `clientdata` PATCH and `PublishXml` route, because `edit_flow`
cannot save these flows reliably (2026-09-28). Nesting stays within 3 containers.

## 4. What does not change

- Business rules, the Save allowlist, compare-before-write, sign-off attribution.
- The SharePoint views. `All Items` on Jobs will show Complete projects; a `Completed` view is not
  added unless asked.
- `D2 - New Pool`'s duplicate guard still sees a completed job number, so a number is never reused.
- Delete Pool works on a completed project as on any other.

## 5. Testing and verification

**Harness** (`fixtures/planner/complete.js`, real page, Graph stubbed from the captured payload):
eligibility in each direction (one unsigned sub-phase blocks it; N/A counts as done; a building or
Planned project is never eligible); the banner lists exactly the eligible projects; Mark complete and
Reopen send one PATCH with the right from/to and refuse on a live mismatch; Refresh requests
Assignments and Tasks per live job and **never** for a completed one; the import drops a newly
completed project and keeps a local sketch; a read-only project refuses edits and appears in no Save
set. Every rule gets a mutation in `complete.mutations.json`, watched red.

**Live, on a throwaway project owned by D2 Bot:** build it with default crews off, sign every
sub-phase or mark it N/A through the planner, Mark complete, confirm it leaves the Board and appears
in Completed projects, Open it read-only, Reopen it, confirm it returns. Measure a real Refresh
before and after completing it. Each flow: one normal run (live projects unchanged), and Counter
Reconciliation shown both ways: a counter drifted by hand on a live project is repaired, and one
drifted on a completed project is left alone. Delete the throwaway and its request rows afterwards.

**Client guide:** a "Completing a project" section in the next reissue.

## 6. Estimate

About one and a half sessions. Planner work is effort-bound. The flows are the discovery risk, as
always; the `clientdata` route was proven on four flows on 2026-09-28, which takes much of it out.
