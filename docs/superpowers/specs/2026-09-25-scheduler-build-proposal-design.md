# Scheduler build proposal, from the 24 September status meeting

**Status: revised 2026-09-25 after Shane's answers to the first draft. Nothing here is built.** This decomposes his 25 September
decisions into work packages, gives each a design at the depth it needs, and proposes an order.
Approval of this document approves the bounded packages (WP1, WP2, WP4) for implementation and
approves writing a separate spec for each architectural one (WP3-B, WP5, WP6, WP8). It does not
approve building the architectural ones.

Input: `docs/2026-09-24-status-meeting-scheduler-changes.md` (the review list) and Shane's
answers to it.

## 1. Decisions taken on 25 September

| Item | Decision |
|---|---|
| Board jumps to top on a sign-off click | Fix |
| Skills run together on the Crews tab | Fix |
| B8 guard a project until its build finishes | Fix |
| B5 move an Active project back to Planned | Approved |
| B6 reset the schedule from a new start date, write `Jobs.StartDate` back | Approved |
| B7 zero-day sub-phases | Recommendation approved: allow 0 days where a separate sign-off is wanted; fold checklist-only steps into the parent sub-phase in Don's template revision |
| B9 rename to "project" | Approved as an opportunistic rule: rename in any area being worked on, no dedicated pass |
| B4 calendar views | Reframed: a filtered Job Board, not a calendar tool |
| B3 activation | Don wants to activate at the phase level, because planning the whole project up front is too much and changes later. Think through first; it is an ask |
| B1 and B2 | Read as: managing everything on one board is too much, a per-project view is wanted (Shane's sentence was cut off; confirm) |
| "Two-day increments" | Disregard |
| "Sign-in bug" | Confirmed fixed on 18 September |
| Backups | New: projects in motion, and the solution overall, for rollback after a bad change |

Second round, same day, on the first draft of this document:

| Question | Answer |
|---|---|
| WP3-A, a project picker on the Board and a link from the Jobs tab | Yes |
| WP2, `Jobs.StartDate` as the first Jobs field on the Save path | Yes |
| WP4, filters only or a Week and Month zoom too | Yes to both (read as: zoom too) |
| WP5, who asks Don what an unreleased phase should hold back | Shane sends it; the draft is under WP5 |
| WP8, a custom Dataverse solution | Asked what one looks like and what it costs, with a concern that the system is outgrowing SharePoint and would run faster on Dataverse. Answered under WP8 |
| WP3-B | Not a project table. The ask is that editing a sub-phase on the Board is too heavy for a simple change: put crew, days and date on the Board row so they can be changed in place without the panel |

## 2. Work packages

### WP1. Four bounded fixes (no spec; about a day for all four)

**1a. Board keeps its vertical scroll on re-render.** `.tl` is the scroll container
(`overflow:auto; max-height:74vh`). `render()` rebuilds it and `UI.tlScroll` restores only
`scrollLeft` (`web/index.html` lines 906 to 917), so a sign-off tick on a row far down the board
lands the user back at the top. Store `{left, top}` per tab and restore both; a fresh Refresh still
re-centres on today. Pinned by a shakedown assertion: scroll down, tick a box, `scrollTop` is
unchanged.

**1b. Skill chips on the Crews tab.** Line 1203 renders each skill as `<span class="skill">`
with no `chip` class, so there is no padding or border and the labels run into one block with a
3px margin. The drawer already uses `chip skill` (line 1265). Fix is the class; verified by the
shakedown reading the computed padding on a chip.

**1c. Building guard (B8).** The planner already fetches New Pool Requests on every Refresh and
never reads it. Map rows whose Status is `Requested` or `Building` onto the matching job by
`JobNumber` and set `j.building = true`. While set: the Jobs tab shows a Building badge in place of
Activate, the Board shows the badge on the job row, and Save and the drawer refuse edits on that
project with one sentence ("still being built, usually 10 to 20 minutes"). The guard keys on the
request status, not on the Assignments count, because `D2 - New Pool` creates the Job row first
and the pool is visible in the planner with a partial set of rows for most of the build, which is
the exact failure Don hit on `26- 2055`. Harness: a fixture with one Building request.

**1d. Back to Planned (B5).** The Jobs tab offers "Back to planning" on an Active project, beside
where Activate sits on a Planned one. The dialog says what changes: it leaves the daily dispatch,
the summaries and conflict alerts, and its calendar events are removed on the next 04:30 full sweep
(Calendar Sync only removes orphans on the full run). Same compare-before-write as Activate: the
live Status must still be `Active`, then `PATCH {Status:'Planned'}` and a Refresh. Implemented by
giving `doActivatePool` a target-status parameter rather than a second copy. `On Hold` stays a
SharePoint-only status; no button for it.

### WP2. Reset the schedule from a new start date (B6; one to two days)

Today the Jobs tab Start box is inert once a project has scheduled work. Make it editable for
every project. Changing it opens a confirm: "Reflow the whole schedule from <date>? Locked and
signed-off sub-phases stay where they are, N/A rows are skipped." On confirm the planner calls
`reflowFrom(j.id, 0, 0, newStart)`, which already exists and already honours locks, sign-offs and
the working calendar, sets `j.start`, and marks the project diverged. Save then pushes the moved
dates through the existing allowlist and per-field compare, unchanged.

The new part is writing `Jobs.StartDate` back, which no path does today and which is the D4 drift.
`WRITEBACK_FIELDS` is Assignments-scoped, so add a parallel one-entry list for the Jobs row,
`start -> StartDate`, with the same compare-before-write against the live value (Activate already
reads the live Jobs row the same way). It is written whenever `j.start` diverged from the
baseline, which after this change only happens through the reset. Existing drift on the four demo
pools stays until each is reset; `sharepoint/fix-job-startdates.js` remains the one-off for that.

Tests: `rules.js` gains a reset assertion (every unlocked row moves, locked rows do not, the first
row lands on the first working day on or after the new start); the write-back harness gains the
Jobs `StartDate` compare, with the mutation watched red.

### WP3. Per-project view (B1 and B2)

**A. Project filter on the Board plus a link from the Jobs tab. Approved.** A project picker on
the Board (the same pattern as the Sign-Offs `Show` picker), the choice kept in `UI` so it survives
re-render and a Refresh, and an "Open schedule" link on each Jobs row that switches to the Board
with that project selected. Small; ships in batch 1.

**B. Edit in place on the Board. Redesigned after Shane's answer; bounded, about three days.**
The first draft proposed a separate project table and rejected inline editing because the name
column is crowded. Shane's answer is that the drawer is too heavy for a simple change and the
controls belong on the Board row itself. So:

- Each sub-phase row on the Board carries three controls in the name column, after the name: a
  **crew** `<select>` with the drawer's Qualified / Not qualified split, a **days** number input,
  and a **start** date input with the derived finish shown as text beside it. The sign-off boxes
  stay where they are. The name still opens the drawer for everything else (lock, N/A, notes,
  comments, reject).
- **A change to days or start reflows that project from that row**, the same as the drawer's
  `Save + reflow`, on the input's `change` event rather than per keystroke. Don said a duration
  change should shift what follows, and a days field that leaves the next row's start where it was
  would put the two out of step on screen. Locked and signed-off rows stay put, exactly as
  `reflowFrom` already does. A crew change reflows nothing.
- Edits mark the project diverged and count on the Save button; Save pushes them through the
  existing allowlist and per-field compare. Nothing new is written and no new column is involved.
- Locked, signed-off, N/A and Building-guarded rows render their values as text, not controls.
- **The controls are behind an "Edit in place" toggle on the Board, off by default and remembered
  per browser.** With the toggle off the Board reads as it does today. With it on, the name column
  widens (`--nmw` goes from 516px to roughly 720px) and the controls appear on every editable row.
  The toggle keeps the Board readable for people who only look, and one click gives Don the fast
  path for a whole project. If Shane would rather have the controls always visible, that is one
  constant.
- Tests: the shakedown ticks INST on a row with the toggle on (the name click and the sign-off
  click must not be swallowed by the controls), changes days on one row and asserts the following
  unlocked rows moved and a locked one did not, and asserts Save counts the edit; `rules.js` pins
  the reflow; the escaping harness puts its `<svg>` probe through the crew select, because crew
  names now go into `<option>` text.

**Adding a phase to a live project stays deferred.** There is no write path for it: the allowlist
edits five fields on existing Assignments rows and nothing creates an Assignments row or its Tasks
rows over Graph. When it is wanted, the pattern this system already uses for anything that creates
rows is a request list plus a small flow. Until then new phases come through Don's template
revision (item 7).

### WP4. Board filters and zoom (B4 reframed; one to two days)

A segmented control on the Board and the Crew Board: **Live** (Active projects), **Planned**,
**Both** (the default, which is today's behaviour), kept in `UI` next to the project picker from
WP3-A. That gives Don a planned-only view and a merged view without a calendar tool. Schedule
Check keeps checking every project regardless of the filter, so a conflict between a Planned and a
Live project is still reported.

**Zoom: Day, Week, Month.** The Board stays a day-accurate grid; the zoom changes the day cell
width and the header labels. Day is today's width with day labels; Week narrows the cells so a
week reads as one block and the header shows week-commencing Mondays; Month narrows further and
labels months. Bars keep their exact day span at every level, so nothing is re-laid-out and no
second timeline engine exists. `positionTimeline` already anchors on the `th.today` cell, so
"open on today" survives the zoom. The choice is remembered per browser.

### WP5. Phase-level release (B3; think through first, then its own spec)

Don's ask: a project can go live phase by phase, because planning all 46 sub-phases before any
work starts is too much and changes later. Activating should not notify anyone; notifications go
out as phases are released and crews assigned. Both phased release and all-at-once must work.

What Activate does today: Daily Dispatch emails each field crew with work that day, Calendar Sync
writes every sub-phase to the group calendar, both summaries start counting the project, and
Event-Driven and Nightly Reconciliation raise conflict alerts to the PM.

- **Option A. Convention: unassigned until ready.** Dispatch already skips `unassigned` (an
  `Unlimited` pseudo-crew, outside the crew loop), and Don himself said to leave later work
  unassigned until it is ready. Nothing to build but guide copy. Covers crew emails only: the
  calendar, the summaries and the conflict checks still see every row, and a past-dated unassigned
  sub-phase counts as finished-but-unsigned in the compliance figure (the documented `office`
  asymmetry, widened to every project).
- **Option B. A `Released` flag on Assignments.** Boolean, default No, seeded No by `D2 - New Pool`.
  A sub-phase is dispatched, put on the calendar, counted in the summaries and conflict-alerted only
  when its project is Active **and** it is Released. The project table (WP3-B) gets Release per
  phase and per sub-phase; the Activate dialog gets a choice: release everything now, or release
  nothing and pick phases. `released` joins the allowlist like `locked`. Six flows gain a
  `Released eq 1` clause (Dispatch, Calendar Sync, Daily and Weekly Summary, Event-Driven and
  Nightly Reconciliation); Conflict Flag and Crew Trade Check keep covering everything, since they
  annotate rather than alert. Reflow is unaffected: unreleased rows still carry dates so the plan
  is visible. Large.
- **Option C. A Phases list with its own status.** Rejected: a new list and two lookups for what a
  boolean on the existing row gives.

**Recommendation: B, sequenced after WP3-B, and one question to Don first:** on an unreleased
phase, what should stop? Only the crew emails, or the calendar, the summaries and the alerts too?
If the answer is "only the crew emails", Option A already does it and B is not worth six flow
edits. Until that is answered this package stays a design note.

**Draft for Shane to send to Don** (Shane's call; written 2026-09-25):

> Hi Don,
>
> Quick one on activating a project phase by phase. Before I build it I want to be sure it holds
> back the right things.
>
> Today, once a project is Active, four things happen for every phase on it: the crew gets the
> morning dispatch email on the day, the phase shows on the shared calendar, it counts in the daily
> and weekly summary, and a double-booking sends an alert to the PM. One thing is already true: a
> phase with no crew assigned never gets a dispatch email.
>
> 1. What an unreleased phase should hold back
> Just the crew's morning email? Or the calendar, the summary counts and the double-booking alerts
> as well?
>
> 2. Release by phase or by sub-phase
> Would you release a whole phase at once, say all of 3.0 Plumbing, or individual sub-phases?
>
> 3. Everything at once
> On a straightforward project, do you still want one button that releases the whole thing, as
> today?
>
> If the answer to 1 is "just the email", we're most of the way there already: leave the crew
> blank until the phase is ready and it stays quiet. If it's the whole set, that's a bigger change
> and worth doing properly.
>
> Shane

### WP6. Zero-day sub-phases (B7; Medium, after Don's template revision)

**The rule:** `DurationDays = 0` means "on the same day as the previous scheduled sub-phase
finishes". Start and finish are both set to the previous row's finish (or to the cursor date when
there is no earlier scheduled row), and the cursor does not advance. Checklist, sign-off, dispatch
and the calendar all work as for any other row; the calendar event is one day because Calendar Sync
already writes end = finish + 1. A null duration still means "logged, not guessed", as now.

Planner: drop the `Math.max(1, ...)` clamp on sub-phase days (five sites; the crew size clamp
stays), `min="0"` on the inputs, `reflowFrom` and `autoSchedule` place a 0-day row at the previous
finish without advancing, Schedule Check stops treating 0 as a bad duration, and the Board draws
the row as a marker rather than a bar. Flows: `D2 - New Pool` and `D2 - Reschedule Pool` both walk
an `Until daysTaken >= DurationDays` loop that runs at least once, so a 0-day row would take a day;
each gets a condition before the loop that sets start = finish = the last finish and skips the
loop, and Reschedule's `Condition_skip_row` changes from "non-positive" to "null or negative". The
Sub-phase Template accepts 0 so Don can mark the QC steps that keep their own sign-off; the ones
that do not are folded into the parent sub-phase's task list in the same revision.

Sequenced after Don's revised phase list arrives, so the change lands with real rows to test on a
throwaway project. Verified both directions in each flow, the way the cursor fix was.

### WP7. "Project" wording (B9; no package)

A standing rule rather than a task: any file touched by WP1 to WP6 has its user-facing copy moved
to "project" in the same change, after grepping `fixtures/` and `sharepoint/` for pinned strings.
Flow email copy changes when a flow is next edited (WP5 or WP6). The client guide changes on its
next reissue. SharePoint list titles stay as they are; `sharepoint/*.js` and the console applier
address lists by title.

### WP8. Backups and rollback (new; Medium, plus one decision)

Two layers, because the two failure modes are different: a bad Save or a bad flow run damages
**data on live projects**, and a bad edit to the planner, a flow or a list damages **the solution**.

**Layer 1, projects in motion.**

1. **Versioning on every list, verified not assumed.** Assignments is known to be on (50
   versions); Jobs, Tasks, Sign-off Comments and the template lists have never been checked. Turn
   it on where it is off and raise the limit to 100 on Assignments and Tasks. Item version
   history gives a per-row rollback with nothing else built, and the reflow flow already depends
   on it.
2. **A nightly snapshot flow, `D2 - Snapshot`.** 03:00 Central, ahead of the morning run order.
   Reads Jobs, Assignments, Tasks and Sign-off Comments through Send an HTTP request to SharePoint
   and writes one JSON file per list into `Backups/yyyy-MM-dd/` in the site's Documents library;
   once a week it also snapshots the reference lists (Crews, Crew-Trades, Trades, Work Calendar,
   Sub-phase Template, Task Template). A day's snapshot is about a megabyte at today's size. The
   flow deletes folders older than 90 days.
3. **A per-project restore script**, `sharepoint/restore-project.js`, built on the console
   applier's pattern with `DRY_RUN` defaulting true. It takes a snapshot and a job number and
   re-applies the allowlisted fields, the sign-off fields, task ticks and counters to the live rows
   by row id with the title match, prints the diff, and refuses if the row counts differ. A second
   mode restores one project to a timestamp from Assignments version history, for the "a Save ten
   minutes ago wrecked this project" case without waiting for a snapshot.
4. **Snapshot before delete.** `D2 - Delete Pool` writes the project's rows to the Backups folder
   before it removes anything. The one destructive flow gets its own undo.
5. Deferred: an "Undo last Save" in the planner. It already holds every `was` value it wrote, so a
   reverse change-set is cheap, but the versioning and the restore script cover the case and it
   adds a second write path to the planner.

**Layer 2, the solution.**

1. **Code**: already in git on Azure DevOps. Add a `deploy/yyyy-mm-dd` tag at every Static Web
   App deploy so a rollback is `git checkout <tag>` plus the one deploy command;
   `planner-stage1-verified` is the precedent.
2. **Flows**: `flows/scripts/export-flows.py` exists and verifies by content. Run it at every flow
   change and weekly, and write the restore half into `flows/README.md` as a tested procedure:
   `create_flow` or `update_flow` from an export, then `PublishXml`. **Decision for Shane:** put
   the 14 flows and the canvas app into a custom Dataverse solution, `D2 Build Scheduler`, and
   export it weekly with `pac solution export`. That is the platform-native backup and an
   importable rollback, and it is the structural ALM change `flows/README.md` warns about. It is a
   one-time move of existing components, low risk, and it makes a future environment rebuild
   possible.
3. **SharePoint schema**: the `sharepoint/*.js` scripts provision most of it but were written
   incrementally. Add `sharepoint/capture-schema.js` that dumps every list's fields, views with
   their CAML and formatters, and the form formatter into `sharepoint/schema-live/`, committed to
   git; `canvas-app/mirror-provision.js` does this for the original seven lists and is the start.
4. **Reference data** (templates, crews, calendar): covered by the weekly snapshot, and committed to
   the repo weekly because it is small and hand-built.
5. **A restore runbook**, `docs/restore-runbook.md`, with the exact commands for each layer, and
   **a rehearsal**: restore one throwaway project from a snapshot and one flow from its export, and
   record both. This repo already recorded what an unrehearsed export is worth (the `D2 - New
   Pool` export that would have deleted its own failure path).

Not covered, deliberately: the group calendar (Calendar Sync's full sweep rebuilds it), Power
Platform connections (re-created by consent), the Entra app and Static Web App (documented in
CLAUDE.md with every id; recreating them is an hour, not a backup problem).

**Dataverse: the solution container and the data store are two different things.** Shane
asked what a Dataverse solution looks like and what it costs, with a concern that the system is
outgrowing SharePoint and would run faster on Dataverse.

*The solution container.* A Dataverse solution is a named package that holds flows, apps,
connection references and environment variables. D2 Automation is already Dataverse-backed, which
is why the flows are "solution-aware" and sit in the Default solution today. Creating a custom
solution named `D2 Build Scheduler` and adding the fourteen flows and the canvas app to it is a
one-time "Add existing" in the maker portal, moves nothing, changes no data, and has **no licence
cost**. What it gives is `pac solution export`, a zip of every flow and the app that can be
imported back into this environment or a fresh one. That is the rollback WP8 layer 2 wants.
**Recommendation: do it in batch 2.** The caveat in `flows/README.md` is about the Default
solution being unexportable, and this is the fix for it.

*Moving the data.* The lists themselves (Jobs, Assignments, Tasks and the rest) becoming
Dataverse tables is the migration Rev D §14 named as the either-or upgrade path. It is a rebuild
of the data layer: fourteen flows rewritten from the SharePoint connector to the Dataverse
connector, the planner's Graph read and write layers rewritten against the Dataverse Web API (a
fourth field-shape surface), the canvas app rebound, and the SharePoint views, forms and home page
retired or left hollow. Weeks of work. The licence position, from the figures CLAUDE.md records as
sound: every person who reads or writes Dataverse through a custom app needs a premium Power Apps
licence at about $20 per user per month at list, and the account running the flows needs Power
Automate premium at about $15. For the office users on the system today that is roughly $2,000 a
year at list before crews are added, and up to about $5,000 if the crew leads come on. Price with
D2's Microsoft rep; these predate the GoDaddy exit.

*Is the system outgrowing SharePoint?* Not yet, measured against the two limits that matter.
The data today is 5 projects, 230 assignments and 1,475 tasks. SharePoint's list view threshold is
5,000 items for a query on an unindexed column; the Tasks list reaches it at about 17 projects
(295 tasks each). The planner's Refresh reads every Tasks row in pages of 500, so at 50 projects
that is about 15,000 rows in 30 requests. No Refresh time has been measured at any scale, so the
performance claim is unverified either way. Three things keep SharePoint comfortable well past
where D2 will be for a year, and all three are cheaper than a migration:

1. **Index the columns every filter uses**: `Job` on Assignments, `Assignment` on Tasks, `Status`
   on Jobs. Indexed columns are exempt from the 5,000 threshold. One script.
2. **Close and archive finished projects** (priorities item 16), so the active lists hold current
   work only. This is the item that decides the scale, and it was already on the list.
3. **Lazy task reads in the planner**: read Tasks for a project when its checklist is opened, not
   all of them on every Refresh. A Refresh then reads a few hundred rows however many projects
   exist.

A measurement belongs in batch 2 before any of the three: the shakedown injects its own payload,
so scaling that to 20 and 50 projects and timing render and Refresh costs an hour and replaces a
guess with a number.

*When to revisit Dataverse.* When any of these is true: active Tasks approach 5,000 rows with
archiving in place; Refresh stays above about five seconds after lazy reads; or a requirement
needs what only a relational store gives, which is enforcement of the business rules at the
database rather than by nightly flows (Rev D §07), row-level security, or the accounting feed Don
described (percentage-of-completion invoicing from checked-off milestones). That last one is the
strongest candidate: a transactional link to QuickBooks wants a relational store behind it. If the
estimator work goes that way, evaluate Dataverse for both systems together rather than migrating
the scheduler on its own.

**One decision left for Shane on WP8:** whether the Backups folder sits in the site's Documents
library, where Members can see it, or in a folder with inheritance broken to Owners only. The data
is the same data PMs already see, so the default is the plain folder.

## 3. Proposed order

| Batch | Packages | Size | Gate |
|---|---|---|---|
| 1 | WP1 (four fixes), WP4 (filters and zoom), WP3-A, WP2 | about five days, one deploy | approved 2026-09-25 |
| 1b | WP3-B edit in place on the Board | about three days, one deploy | approval of the WP3-B design above |
| 2 | WP8 layer 1 (versioning, snapshot flow, restore script, delete snapshot, rehearsal), the runbook, the custom solution, the scale measurement and the indexes | four to five days | approved in principle; Backups folder placement open |
| 3 | WP6 zero-day | Medium, when Don's phase list arrives | its own spec |
| 4 | WP5 phase-level release | Large, after Don's answer | its own spec |

WP7 rides along with every batch. Batch 1 ends with one Static Web App deploy, the wall checks and
the shakedown, and a note to the four PMs that the Board keeps its place now. Backups (batch 2)
can move ahead of 1b if Shane would rather have the safety net before the next round of live
edits.

## 4. What is still open

Questions 1 to 5 of the first draft were answered on 2026-09-25 (see the second table in section
1). Left:

1. WP3-B: is the design above right, and should the controls sit behind an "Edit in place" toggle
   or be always visible?
2. WP8: Backups folder plain or Owners-only?
3. Order: batch 1b before batch 2, or the safety net first?
