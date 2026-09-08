# Pool lifecycle and schedule reflow

**Date:** 2026-09-08
**Status:** design, approved in principle by Shane 2026-09-08b, not yet built
**Covers:** the A2 and A3 options from the starter-guide gap review

---

## Why

Two gaps surfaced while writing a client-facing walkthrough of the system.

**A live pool's schedule cannot be maintained.** `D2 - New Pool` chains all 46 sub-phases
forward across working days when it builds a pool, and no flow ever touches the dates again.
When one sub-phase slips, everything after it stays where it was, so the pool now shows work
starting before the work it depends on has finished. Business rule 3 says sub-phases run in
order. The browser tool enforces that rule and the browser tool does not write to SharePoint.
The only remedy today is editing up to 45 rows by hand.

**A new pool goes live the moment it is created.** Pools are built from one template with the
same default crews and no knowledge of who is already busy, so two pools with overlapping dates
put the same crews on the same days. The conflict checker then alerts on each collision. A PM
raising a second pool while a first is running can be sent a burst of alerts before they have had
any chance to set real crews. Repeated alerts about a conflict someone already knows about are
how people learn to ignore alerts.

## What already exists

Verified against the live tenant and the published flow definitions on 2026-09-08, not assumed.
This materially shrinks the work.

- **`Jobs.Status` is a Choice of `Planned` / `Active` / `On Hold` / `Complete`**, required, and
  its column default is `Planned`.
- **`D2 - New Pool` already writes `"Status": "Planned"`** in its `Create_job` body. So pools are
  already born in a draft state.
- **`Assignments.Sequence`** (Number) is populated 1..46 and gives a reliable ordering key. There
  is no need to parse `SubPhaseNumber` strings such as `2.1`.
- **`Assignments.Locked`** (Boolean, Required) exists, is `false` on all 43 rows, and nothing
  reads or writes it. It is almost certainly the browser tool's "pin this date" concept carried
  into the schema and never implemented.
- **`D2 - New Pool` contains a working day-walk** in `Do_until_span_complete`, whose
  `Condition_is_work_day` is:

  ```
  and( not(equals(dayOfWeek(outputs('Compose_current_date')), 0)),
       not(contains(variables('nonWork'), outputs('Compose_current_date'))) )
  ```

  Sundays are computed. Holidays come from Work Calendar
  (`d36758cf-9d27-4342-84e4-817f8dcfa2ba`), which now covers 2026-08-30 to 2029-12-30.

**Nothing consumes `Status`.** That is the whole of the A2 gap:

| Flow | Flow id | Today |
|---|---|---|
| `D2 — Daily Dispatch + Reminders` | `2683f70a-1bed-b842-b26a-7796485c5233` | no status filter, dispatches Planned pools to crews |
| `D2 - Event-Driven Reconciliation` | `523d99c0-bc2e-7819-5d96-6faab60734f1` | no status awareness, conflict-checks Planned pools |
| `D2 - Nightly Reconciliation` | `e51b5571-5062-7eae-9de4-900f2c93d95d` | no status filter on `Get_assignments` |
| `D2 - Daily Summary` | `761279bc-1ea0-8b3a-4737-0b8b313b44d7` | `Get_active_jobs` filters `Status eq 'Active'`, but `Get_today_assignments` does not |
| `D2 - Weekly Summary` | `aefcc38c-f6ff-221c-558c-8e521916a8cf` | same split |

So this design finishes a lifecycle that is half written rather than adding one.

---

## Design

### Part 1 — make `Planned` mean something

A pool with `Status` other than `Active` is invisible to dispatch, to conflict detection, and to
the summary schedule tables. It stays fully visible in the SharePoint views, because the PM is
working on it.

**Each flow resolves the Active job set once per run and filters rows in memory.** The job status
is deliberately NOT denormalised onto Assignments. Denormalising would mean 46 extra writes at
creation and another 46 whenever a pool is committed, and every one of those writes would fire
the reconciliation flow. One extra `Get items` call per run is cheaper and cannot drift.

The two summary flows already do exactly this with `Get_active_jobs`, so this extends an existing
pattern rather than inventing one.

Per flow:

- **Daily Dispatch.** Add `Get_active_jobs` (`Jobs`, `$filter=Status eq 'Active'`) and a
  `Select_active_ids` projecting `ID`. In the existing `Filter_array` and `Filter_array_2`, add a
  clause requiring `contains(body('Select_active_ids'), item()?['Job']?['Id'])`.
- **Event-Driven Reconciliation.** After `Get_touched_assignment`, add `Get_touched_job`
  (`$filter=ID eq <job id>`), then terminate the run when its `Status` is not `Active`. Place this
  after the existing version-history gate so the cheap check still runs first.
- **Nightly Reconciliation.** Same `Get_active_jobs` plus in-memory filter before the conflict
  sweep.
- **Daily and Weekly Summary.** Apply the same in-memory filter to `Get_today_assignments`,
  `Get_week_assignments`, `Get_recent_finished` and `Get_week_finished`, so compliance is scored
  on live pools only.

**Field name discipline.** The SharePoint connector returns a lookup as `Job` (an object with
`Id` and `Value`) plus `Job#Id`. It does not return `JobId`. Read it as `item()?['Job']?['Id']`.
`JobId` is the REST/OData name and is correct in a server-side `$filter`, and only there.

### Part 2 — committing a pool

The PM opens the Jobs row and changes `Status` from `Planned` to `Active`. No new list, no new
flow, one field.

Add a **`Planned Pools`** view on Jobs, filtered `Status eq 'Planned'`, so pools awaiting commit
are findable rather than remembered.

`On Hold` gets the same treatment as `Planned` for free, since the test everywhere is
`Status eq 'Active'`. That gives the office a way to pause a pool without deleting it, which does
not exist today.

### Part 3 — the reflow flow

**New flow: `D2 - Reschedule Pool`.**

**Trigger.** A new list, **`Reschedule Requests`**, matching the pattern PMs already use for New
Pool and Delete Pool.

| Column | Type | Notes |
|---|---|---|
| `Title` | Text, required | free text, what the PM is doing and why |
| `JobNumber` | Text, required | the pool to reschedule |
| `FromSequence` | Number, required | reflow this sub-phase and everything after it |
| `NewStartDate` | Date | optional; when blank, the from-row keeps its current start |
| `Status` | Choice | `Requested` / `Running` / `Done` / `Failed` |
| `Result` | Note | written by the flow |

One mechanism covers both cases in the title of this spec. Scheduling a freshly generated pool is
a reflow from sequence 1 with a new start date. Absorbing a slip on a live pool is a reflow from
the sub-phase that moved.

**Algorithm.**

1. Set `Status = Running`.
2. Resolve the job by `JobNumber`. Not found, or more than one, fails the request.
   Fail the request too when no assignment carries the requested `FromSequence`, rather than
   silently reflowing nothing and reporting success.
3. Read Work Calendar into a `nonWork` array, exactly as `D2 - New Pool` does.
4. Read the job's assignments, `$filter=JobId eq <id>`, `$orderby=Sequence asc`.
5. Set the cursor. `NewStartDate` when supplied, otherwise the `ScheduledStart` of the row at
   `FromSequence`.
6. Walk rows in `Sequence` order where `Sequence >= FromSequence`:
   - **`Locked` is true, or `InstallerSignOff` is true:** leave the row's dates untouched and move
     the cursor to the first working day after its existing `ScheduledFinish`. This is what makes
     `Locked` finally do something. It lets a PM pin a booked inspection or a delivered-materials
     date and reflow everything around it.
   - **`DurationDays` is null, zero or negative:** do not guess. Leave the row alone, count it as
     skipped, and name it in the `Result`. The column is Required and populated everywhere today,
     so this is a guard against future data rather than a known case.
   - **Otherwise:** `start` is the first working day on or after the cursor. `finish` is reached
     by advancing `DurationDays - 1` further working days from `start`. Write the row only when
     either date actually changes. Move the cursor to the first working day after `finish`.
7. Write one `Result` summary: rows moved, rows skipped and why, and the new finish date for the
   pool.
8. **When the job is `Active`**, run a single conflict sweep for it and send at most one email.
   Skip the sweep entirely when the job is `Planned` or `On Hold`, because Part 1 makes those
   pools invisible to conflict detection and sweeping them here would contradict that. A pool
   picks up its first conflict check when the PM commits it.
9. Set `Status = Done`, or `Failed` with the reason, and email the requester either way.

**`DurationDays` is work days, never the inclusive calendar span.** Only the endpoints must be
working days. A two-day sub-phase starting Saturday correctly runs Saturday and Monday and stores
`start = Sat, finish = Mon`.

**Rows before `FromSequence` are never touched.**

**Dates in the past are honoured, not clamped.** If the PM asks for a start date that puts rows
behind today, the flow schedules them there and the result email says how many rows landed in the
past. Silently clamping to today would hand back a different schedule than the one requested,
which is worse than a date the PM can see and correct.

### Part 4 — suppressing the write storm

A reflow can rewrite up to 45 rows. Each write changes `ScheduledStart` or `ScheduledFinish`,
which is exactly what the Event-Driven Reconciliation trigger gate looks for, so each would fire
its own conflict check and potentially its own alert email to the PM.

**Add `Assignments.SuppressReconcileUntil` (DateTime, NOT required).** The reflow sets it to a few
minutes ahead on every row it writes, in the same MERGE as the dates. Event-Driven Reconciliation
gains one clause: terminate when that timestamp is in the future.

**It is a timestamp rather than a boolean deliberately.** A boolean has to be reset, the reset is
another write, and a reset that fails leaves a row permanently invisible to conflict detection.
A timestamp expires on its own and cannot mute a row for longer than its window.

**It must not be Required.** Four Required columns seeded NULL previously made the Assignments
list form refuse to save any hand edit. Optional with no default avoids repeating that.

**Accepted cost:** a genuine PM edit to the same row inside the suppression window is skipped by
the real-time check. The reflow's own end-of-run sweep and the nightly full sweep both still cover
it, so the conflict is detected, just not within seconds.

**Reuse:** setting the same field in `D2 - New Pool`'s `Create_assignment` call would close the
accepted 92-reconciliation-run cost recorded in CLAUDE.md's Phase G list. Worth doing in the same
visit, but not required by this design.

---

## Testing

`TEST-9001` and `TEST-9002` are still in the tenant, which is the reason CLAUDE.md says to keep
them until just before the pilot. They are the test rig.

1. **Status is honoured.** Set `TEST-9001` to `Planned`, leave `TEST-9002` `Active`. Run Daily
   Dispatch manually and confirm `TEST-9001` rows are absent and `TEST-9002` rows are present.
   Repeat for both summaries. Edit a `TEST-9001` date and confirm Event-Driven Reconciliation
   terminates early.
2. **Dispatch still dispatches.** The failure that matters is over-filtering. Confirm on a day
   that genuinely has `Active` work that crews still receive a populated email. A green run on a
   day with no scheduled work proves nothing about this flow, which is the mistake the 2026-09-01
   verification pass made.
3. **Reflow moves the right rows.** On `TEST-9002`, note all dates, reflow from a middle sequence,
   and confirm: earlier rows unchanged, later rows shifted by the expected number of working days,
   no endpoint on a Sunday or on a Work Calendar holiday, and the chain has no overlaps.
4. **Locked is respected.** Set `Locked` on one row, reflow across it, and confirm its dates did
   not move and the rows after it resume from its finish.
5. **Signed-off rows are respected.** Same test against a row with `InstallerSignOff` true.
6. **Suppression works and expires.** Confirm the reflow produced at most one conflict email, then
   confirm that an edit made after the window still triggers reconciliation normally.

---

## Risks

**Four published, working flows are being edited in a live client tenant.** Each edit is a
`clientdata` PATCH followed by `PublishXml`, and each needs re-verification afterwards.

**Daily Dispatch is the dangerous one.** A filter mistake means crews receive no dispatch at all,
and it would fail quietly on any day with no work. Test it against a day with real scheduled work
before trusting it.

**Platform constraints that apply to the new flow**, all previously hit on this project:

- `Terminate` cannot sit inside any loop, `Until` included.
- `runAfter` is container-scoped and cannot reach across a `Scope`, `If` or `Foreach`.
- `InitializeVariable` cannot nest inside any container, including an `If` or a `Scope`. All
  variable initialisation goes at the top level, before the containers that use it.
- The SharePoint `GetItems` operation rejects `$select` outright.
- `select` and `filter` are not valid WDL expression functions. Use `Query` actions.

**The new flow needs its own failure path from the start.** `D2 - New Pool` shipped without one
and it was caught only by a whole-branch review. A reflow that fails midway leaves a pool with
half a reordered schedule, which is worse than one that fails before writing anything. The request
must end at `Failed` with an email in every path.

---

## Out of scope

- **Job completion.** `Complete` already exists as a status choice, and a flow that sets it when
  the last sub-phase is signed is a natural follow-on. It is not needed for A2 or A3.
- **`PMSignOff`.** Still dormant, still needs a decision from Don about whether an office
  verification step is real.
- **Counter Reconciliation's 5,000-row read.** Tracked separately.
- **Real sub-phase durations.** Still 2-day placeholders, deferred until several pools have run.
  Reflow computes from whatever `DurationDays` says, so it improves automatically when they land.

## Open questions

- **Does reflow need to run on `On Hold` pools?** Assumed yes, since a paused pool is exactly the
  one whose dates need moving before it restarts. Nothing in the design prevents it.
- **Should committing a pool to `Active` trigger an automatic conflict sweep?** It would catch
  collisions at the moment they start to matter. Left out for now to keep the commit a plain field
  edit with no side effects.
