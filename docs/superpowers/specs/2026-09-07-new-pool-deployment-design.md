# New Pool deployment — design

**Date:** 2026-09-07
**Status:** approved in chat, pending implementation plan
**Phase:** D (readiness) / G overlap. Closes the largest remaining hole in the system.

---

## The problem

There is no way for a PM to create a pool. Shane asked it plainly: *"Where does a
user go to generate a new pool build without entering task-per-task and assigning
it?"* The answer today is nowhere.

Two half-pieces exist and neither is usable by D2:

- `tools/add_pool.py` plans a complete pool and writes nothing.
- `tools/write-pool.js` applies a plan, but only from a browser console, signed in
  as `stratirus@d2pools.com`, with two flows manually stopped first.

Both are Stratirus tooling. A PM cannot run either. Since there is no
browser-tool to Lists sync either (descoped from the pilot 2026-09-05), the only
route a pool has into SharePoint today is one of us doing it by hand.

## What changed the design

The original framing in CLAUDE.md was to port `add_pool.py`'s planning logic into
Power Automate. That was rejected, for two separate reasons found during
brainstorming.

**The checklist is fixed.** Shane: *"The plan almost never changes. The checklist
needs to be done (with the exception of N/A's), so a simple template with all of
them that get copied by the PjM with start-dates updated should be sufficient."*
That is right, and it removes the expensive half of the work. The flow does not
need to solve a scheduling problem. It needs to copy a template and walk dates
forward. No busy map, no qualified-crew search, no 46-step constraint solve in a
language that is bad at all three.

**Hosting the browser tool in SharePoint is not available.** An earlier option was
to put `pool-scheduler.html` in a document library so it could write direct,
same-origin. Microsoft's docs rule it out on policy rather than capability. An
HTML page in a document library is itself the custom-script mechanism, named
directly in the security guidance: *"Every script that runs in a SharePoint page
(whether it's an HTML page in a document library or a JavaScript in a Script
Editor Web Part)."* Modern team and communication sites block custom script by
default, and any change back reverts on its own: *"Changes to allow custom scripts
are overridden to Not allowed within 24 hours."* The supported workaround is a
daily scheduled task re-running `Set-SPOSite -DenyAddAndCustomizePages 0`. A
production feature that depends on a security setting the platform switches off
every day is not a feature, so this route is closed.

Sources:
- https://learn.microsoft.com/sharepoint/allow-or-prevent-custom-script
- https://learn.microsoft.com/sharepoint/security-considerations-of-allowing-custom-script

## Alternatives considered and rejected

| Option | Why not |
|---|---|
| Port `add_pool.py` planning into Power Automate | Rebuilds a planner that already exists, in WDL. Unnecessary once the template is data. |
| Host the tool in SharePoint, write direct | Custom script blocked by default and auto-reverts every 24 hours. See above. |
| External static host plus an Entra app registration | Works, but adds an app registration, admin consent and a hosting dependency Stratirus then owns, to save one drag-and-drop. |
| `Create list from existing list` | Copies columns, views and formatting. Does not copy items, so it cannot carry a checklist. |
| List or site templates | Schema only, same problem. |
| Planner `Copy plan` | Genuinely clones buckets and tasks and is not premium, but forks the data model. The pool would live in Planner, not the Lists that the canvas app, seven flows and every office view read. |
| Project for the web templates | Closest conceptual fit and is Project Plan 3, the premium per-user cost that ruled out Dataverse. |
| Excel template plus grid paste | Zero build, and it is the fallback if this stalls. Falls down on 295 Tasks that each need a lookup to the right parent Assignment, which grid paste resolves by display text. |

## Consequence to record

**A new pool now originates in SharePoint, not in the browser tool.** CLAUDE.md
currently says the browser tool is the planner and Lists holds execution state.
After this, Lists is the origin for new pools and the browser tool becomes an
optional planner for re-scheduling work that already exists. This makes the
never-built nightly sync less load-bearing rather than more. CLAUDE.md must be
updated when this ships, or the two documents disagree.

---

## Architecture

Four new lists, two new flows. No change to the canvas app, and no change to any
of the seven existing flows as shipped. One possible follow-on change to Flow 3
is described under Known consequence below, deliberately deferred until the first
pool shows whether it is needed.

```
PM  ->  New Pool Requests  (add an item: name, number, address, start date)
              |
              |  trigger: when an item is created
              v
        D2 - New Pool  (flow)
              |
              +-- reads  Sub-phase Template   (46 rows)
              +-- reads  Task Template        (295 rows)
              +-- reads  Work Calendar        (non-work days)
              |
              +-- creates  Jobs         x1
              +-- creates  Assignments  x46   (sequential, dates chain)
              +-- creates  Tasks        x295
              |
              v
        Status = Done, Result summary, email to the PM


PM  ->  Delete Pool Requests  (job number, typed again to confirm, reason)
              |
              v
        D2 - Delete Pool  (flow)
              |
              +-- guard: confirmation matches
              +-- guard: nothing signed off, unless overridden
              |
              +-- deletes  Tasks, then Assignments, then the Job
              |
              v
        Status = Done, counts in Result, email the record
```

### List: `New Pool Requests`

This is the entire user experience. A PM adds an item. Linked from the site
launchpad. It also gives a permanent record of who created which pool and when,
which nothing currently has.

| Column | Type | Required | Notes |
|---|---|---|---|
| `Title` | Text | yes | Pool name, e.g. `Harrison Residence` |
| `JobNumber` | Text | yes | e.g. `D2-1002` |
| `Address` | Text | no | |
| `City` | Text | no | |
| `StartDate` | DateTime, DateOnly | yes | First work day. Advanced forward if it is not one. |
| `ProjectManager` | User | **yes** | Written to `Jobs.ProjectManager` and receives the result email. `UserSelectionScope=0`, tenant members only, matching the Jobs column. **Required deliberately**: the two alternatives are both silent failures. Left empty, the Job has no PM and Flow 3's alert cannot resolve a recipient; defaulted to the service account, every PM-less pool is mis-attributed to D2 Bot, which is the same placeholder defect CLAUDE.md records against Harrison. Requiring it makes a PM-less pool impossible rather than wrong, and it forces the Person-field write onto the tested path. |
| `AssignDefaultCrews` | Boolean | yes | Default Yes. No means every Assignment gets `unassigned`. |
| `Status` | Choice | yes | `Requested` / `Building` / `Done` / `Failed`. Default `Requested`. |
| `Result` | Note | no | Written back by the flow. Counts on success, the reason on failure. |

### List: `Sub-phase Template` (46 rows)

| Column | Type | Notes |
|---|---|---|
| `Title` | Text | Sub-phase name, e.g. `Steel Installation and Forms` |
| `SubPhaseNumber` | Text | `2.2` |
| `Sequence` | Number | 1..46, the order the pool runs in |
| `Trade` | Lookup to Trades | mirrors `Assignments.Trade` |
| `DefaultCrew` | Text | a `CrewID` such as `devon`. Never a `Crews.Title`. |
| `DurationDays` | Number | **work days**, never an inclusive calendar span |

### List: `Task Template` (295 rows)

| Column | Type | Notes |
|---|---|---|
| `Title` | Text | Task name, e.g. `Verify Suction Lines` |
| `SubPhase` | Lookup to Sub-phase Template | |
| `Sequence` | Number | order within the sub-phase |

Both template lists use lookups rather than text joins on purpose. This project
has lost time four separate times to joining on a display label instead of a key,
and a lookup makes an orphan task impossible to create. It also lets Don edit the
checklist with a picker instead of retyping a code.

### Seeding the templates

Seeded once from the browser tool's `SEED_TEMPLATE`, using the array extractor
`add_pool.py` already has. Verified counts: **46 sub-phases, 295 tasks**, matching
the numbers CLAUDE.md carries.

`DefaultCrew` comes from the template's `skill` field against `SEED_CREWS`:

- 24 sub-phases carry a pseudo-skill and map by convention: `@office` to `office`,
  `@sub` to `subcon`, `@unassigned` to `unassigned`. All three are `Unlimited`
  buckets, so they are capacity-exempt and can never be double-booked.
- 7 sub-phases have exactly one qualified capacity crew. Unambiguous.
- 15 sub-phases have between 2 and 6 qualified crews and need a pick.

So seeding `DefaultCrew` is 15 judgement calls, not 46. They are seeded with a
first-pass choice and then corrected in the list by whoever knows best, which is
the reason the template is data rather than code.

All 46 `DurationDays` are currently 2, the known placeholder. They will be
replaced from real actuals after the first few pools, and after this ships that
is a list edit rather than a code change.

---

## The flow: `D2 - New Pool`

Trigger: SharePoint **When an item is created** on `New Pool Requests`.

1. Set `Status = Building`.
2. Guard: if `JobNumber` already exists in Jobs, set `Status = Failed` with the
   reason in `Result`, and stop. Creating a duplicate pool is the one
   unrecoverable mistake here, because there is no bulk delete a PM can run.
3. Read once, not per row: `Sub-phase Template` ordered by `Sequence`,
   `Task Template`, and `Work Calendar`.
4. Create the `Jobs` row. `Status = Planned`, `StartDate` as given,
   `ProjectManager` from the request.
5. Walk the 46 sub-phases **sequentially**. Concurrency must be off, because each
   sub-phase starts after the previous one finishes. For each:
   - take `DurationDays` work days from the cursor,
   - create the Assignment,
   - create that sub-phase's tasks,
   - move the cursor to the day after the finish.
6. Set `Status = Done` with counts in `Result`, and email the PM.

### Date rules

A day is a work day when it is not a Sunday **and** not present in `Work
Calendar`. Including Work Calendar is a small extension over `add_pool.py`, which
only skips Sundays, and it costs one read. It means holidays, weather days and
per-crew shutdowns are honoured on creation rather than discovered later.

Only the **endpoints** must be work days. A span that contains a Sunday is
correct: a 2-work-day sub-phase starting Saturday runs Saturday and Monday, and
stores `start = Sat, finish = Mon`.

`DurationDays` on the created Assignment is the work-day count, matching
`generate-seed.py` and the browser tool. It is not the inclusive calendar span.
Two definitions were live in the list at one point and work days is the one that
wins.

### Fields on each created Assignment

| Field | Value |
|---|---|
| `Title` | `<JobNumber> · <SubPhaseNumber> <SubPhaseName>`, matching the existing convention |
| `Job` | lookup to the new Job |
| `SubPhaseNumber`, `SubPhaseName`, `Sequence` | from the template |
| `Trade` | lookup copied from the template |
| `Crew` | template `DefaultCrew`, or `unassigned` when `AssignDefaultCrews` is No or the template cell is blank |
| `ScheduledStart`, `ScheduledFinish` | computed, bare `yyyy-MM-dd` |
| `DurationDays` | template value |
| `Locked`, `NotApplicable`, `PMSignOff`, `InstallerSignOff` | `false` |
| `TasksTotal` | count of template tasks for that sub-phase |
| `TasksComplete` | `0` |

Two of these are load-bearing and come straight from the known-bugs list.

**Dates are written as a bare `yyyy-MM-dd` string, never `...T00:00:00Z`.** The
site is UTC-06:00 Central. An explicit midnight-UTC value is read back by the
SharePoint connector as the previous day. Phase A seeding did exactly that and
silently inverted the work week, so Flow 1 would have dispatched on Sundays and
terminated on Saturdays.

**`Locked`, `NotApplicable`, `PMSignOff` and `DurationDays` are set explicitly on
every row.** They are Required. REST and connector creation bypass required-field
validation but the list form does not, so a row created without them can never
afterwards be edited in the UI at all. Five rows are already in that state in
production.

### Fields on each created Task

`Title` from the template, `Assignment` lookup to the row just created,
`Sequence` from the template, `Complete = false`.

---

## Error handling

The flow is **not** transactional. SharePoint has no multi-list transaction, so a
failure part way through leaves a partial pool.

- Every failure path writes `Status = Failed` and a specific reason into
  `Result`, and emails the PM. Silence is the failure mode this project keeps
  getting bitten by, where a write returns success and the thing renders blank.
- The duplicate-`JobNumber` guard runs before anything is created, because that is
  the failure most likely to happen and the most annoying to clean up.
- On a partial failure the `Result` names the last sub-phase created, so recovery
  is "delete the job and its children, fix the cause, resubmit" rather than a
  hunt. **This was written when giving PMs a delete-pool button was deliberately
  out of scope, for exactly the reason above: it is the most destructive thing
  in the system and should not arrive in the same change as the first thing
  that creates data. Shane reversed that call the same day** (see "Deleting a
  pool" below), so recovery is now a PM action through `D2 - Delete Pool`, not
  a Stratirus job via `cleanup.js`.

## Known consequence: Flow 3 fires 46 times per pool

`D2 - Event-Driven Reconciliation` triggers on created-or-modified, and its
version-history gate deliberately lets brand-new rows through, since a new row
must always reconcile. So 46 Assignment inserts fire 46 runs.

A flow cannot stop another flow without the premium Flow Management connector, so
that is not available. The decision is to **accept it for the first pool** and
watch what the PM actually receives. Quota is not the concern; alert noise is,
and repeated alerts for a conflict someone already knows about train people to
ignore alerts.

If it is noisy, the fix is a `SuppressReconcile` boolean set at creation plus one
clause in Flow 3's gate. That was rejected once before because a flag meant an
extra write to the very list whose writes were the problem. It does not here: the
value is set in the same create call, so there is no extra write and no loop risk.

Note that Flow 4's nightly full sweep catches any real conflict regardless, so
nothing goes undetected either way.

## Volume

342 creates: 1 Job, 46 Assignments sequentially, 295 Tasks in parallel batches.
Minutes rather than seconds, which is why the flow reports through the `Status`
column and an email instead of making anyone wait. If it proves too slow, the
next step is `Send an HTTP request to SharePoint` with a `$batch` body for the
tasks, but start simple.

---

## Testing

Verified by reading the lists back, never by looking at the UI. The UI has misled
this project repeatedly, and a write that returns 201 and renders blank is the
signature failure here.

**Template seeding**
- 46 sub-phase rows, 295 task rows.
- Each sub-phase's task count matches the template's own number. This is the same
  independent cross-check that caught two collisions during the Phase B seed.
- Every `DefaultCrew` value is a real `Crews.CrewID`, never a `Title`.

**First pool, `AssignDefaultCrews = No`**
- 1 Job, 46 Assignments, 295 Tasks created.
- No `ScheduledStart` or `ScheduledFinish` falls on a Sunday or a Work Calendar
  date.
- Sub-phase N+1 starts strictly after sub-phase N finishes.
- Dates read back through the **SharePoint connector** as the intended day, not
  one early. Reading them back through REST alone would not catch the bug this
  test exists for.
- `Locked`, `NotApplicable`, `PMSignOff`, `DurationDays` populated on all 46.
  Confirm by opening one row in the list form and saving an edit.
- Every Task's `Assignment` lookup resolves, and per-assignment task counts match
  `TasksTotal`.
- Every `Crew` is `unassigned`.

**Second pool, `AssignDefaultCrews = Yes`**
- Crews match the template.
- Any double-book against an existing pool produces a Flow 3 alert, which is the
  correct behaviour and worth confirming rather than assuming.

**Failure paths**
- Duplicate `JobNumber` fails before creating anything, and Jobs is unchanged.
- A start date on a Sunday is advanced to Monday rather than rejected.

**Cleanup**
- Both test pools removed through `D2 - Delete Pool` (see "Deleting a pool"
  below), not through `cleanup.js`. `cleanup.js` was never extended to take a
  job number: that plan was correctly dropped once the delete flow existed and
  superseded it. `cleanup.js` still only knows about Jobs/Assignments/Tasks
  seeded by the test-data generator, not `New Pool Requests` or
  `Delete Pool Requests` rows.

---

## Deleting a pool

Decided 2026-09-07 by Shane, after being raised as out of scope. A PM who can
create 342 rows needs a way to undo it, and leaving recovery as a Stratirus job
means every mistyped job number becomes a support call.

The risk is real though, so the warnings have to be protective rather than a
dialog people click through by reflex. Four guards, in order of how much work
they save:

**Type the job number to confirm.** The request carries a `ConfirmJobNumber`
field and the flow refuses unless it matches the target exactly. This is the
pattern GitHub uses for deleting a repository, and it works because it cannot be
done by reflex or by a mis-tap.

**Refuse if anything is signed off.** If any Assignment on the job has
`InstallerSignOff = true`, the flow stops and says so, unless a separate
`OverrideSignedOff` box is ticked. A signed-off pool carries attestation and
warranty value, and `InstallerSignOffBy` is the artifact this whole system exists
to produce. Destroying it should take a deliberate second act, not the same click
as deleting an empty pool created by mistake.

**Delete children first.** Tasks, then Assignments, then the Job. Same order
`cleanup.js` uses. The reverse orphans rows that then appear in views with a
broken lookup.

**Email a record.** Job number, title, and the exact counts removed, to the
requesting PM and to the job's Project Manager. A deletion nobody can see is the
part that hurts three months later.

Deletes do not wake Flow 3, because its trigger is created-or-modified, so there
is no alert-noise problem on this path.

### Surface

A `Delete Pool Requests` list rather than a button on the Job itself. Reasons:
a list gives a permanent record of who deleted what and when, which a button
does not; it keeps the destructive action off the same screen as everyday
editing; and it costs nothing extra since the New Pool flow already establishes
the request-list pattern.

| Column | Type | Required | Notes |
|---|---|---|---|
| `Title` | Text | yes | JobNumber of the pool to delete |
| `ConfirmJobNumber` | Text | yes | must match `Title` exactly or the flow refuses |
| `Reason` | Note | yes | why. Required, and kept after the rows are gone. |
| `OverrideSignedOff` | Boolean | yes | default No. Only route past a signed-off pool. |
| `Status` | Choice | yes | `Requested` / `Deleting` / `Done` / `Refused` |
| `Result` | Note | no | counts removed, or the reason it refused |

Flow `D2 - Delete Pool`, triggered on item created. Guards first, then delete,
then write `Result` and email. Every refusal path names which guard stopped it.

---

## Out of scope

- Editing a pool's schedule after creation. That stays in the browser tool and
  the list views.
- The browser-tool to Lists sync. Still Phase G, and this reduces the need for it.
- Re-running against an existing pool to add newly-added template rows.
- Restoring a deleted pool. SharePoint's recycle bin holds the rows for 93 days,
  which is the recovery path, and it is a site-admin job rather than a PM one.
