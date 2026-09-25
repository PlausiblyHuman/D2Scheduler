# Scheduler changes from the 24 September status meeting

> **Reviewed by Shane 2026-09-25.** His decisions and the resulting build proposal are in
> `docs/superpowers/specs/2026-09-25-scheduler-build-proposal-design.md`. This file is the input.

Review list, prepared 2026-09-25 for Shane, before any development starts. Estimator items are
excluded on purpose; they are in the same Loop rundown and belong to the estimator workload.

**Sources.** The Facilitator's Loop rundown (pasted by Shane, the transcript API is disabled in the
Tennetech tenant), the Facilitator's two mid-meeting chat notes, the "What's new since last
Thursday" page presented in the meeting (`W4LJJdvjm4gYDcLSbthxKm`), and the 18 September priorities
page (`7zqKjJ29r1s5xLfenwq6rQ`). Attendees: Don, Amy, Carolyn (David never signed in; Entra's
sign-in log for the day shows Don only).

Sizes use the priorities page scale: Small about a day, Medium a few days, Large one to two weeks.

---

## A. Decisions recorded in the meeting

| # | Decision | Effect |
|---|---|---|
| A1 | The word is **project**, not job or pool | Closes priorities item 6. Rename scope is B9 below |
| A2 | **STL stays** on the crew list. Harrison and Campos still come off | Closes the STL half of the item 2 question. The six-trade coverage question is still open |
| A3 | Projects stay **Planned until work starts** | Already how it works. What Don expects Activate to do differs from today, see B3 |
| A4 | Don sends the **additional project phases** | Client action. Feeds the shared template (item 7/8) |

## B. New enhancements, not on the 18 September list

### B1. Project planning view (the big one), Large

Don described it twice. Open one project, see its sub-phases as a table, and build the whole
schedule before Activate without opening the drawer on each row: edit days in a column, pick the
crew from a dropdown in the row, add a phase, lock, N/A, then reflow. Template crews stay as the
default and are overridden per project. The Facilitator summarised it as "a faster way to set the
initial schedule instead of editing each item individually", and follow-up #4 is the same thing.

What exists today: the Board shows every project at once and every edit goes through the drawer;
the Jobs tab has no link to a single project's schedule; durations arrive at 2 days everywhere.

Design points to settle first:

- **Adding a phase to a live project has no write path.** The write allowlist is five fields on
  existing Assignments rows (`web/writeback-core.js`); nothing creates an Assignments row or its
  Tasks rows over Graph. `addPhase` and `addSection` exist only on the local template
  (`web/index.html` around line 1653). A new sub-phase means either widening the writer to create
  rows, or a request list plus a flow like Reschedule Requests. Decide whether "add a phase" is in
  the first version.
- Inline crew dropdown must keep the Qualified / Not qualified split the drawer has (line 1268).
- The table is the natural place for B6 (reset from a new start) and B7 (zero-day rows).

### B2. Link from each project to its filtered board, Small to Medium

Follow-up #4 and the Navigation section: from the job listing, open the Board filtered to that one
project. Today the Board has no project filter at all; the only filters are the PM picker on the
Jobs tab (`pmFilter`) and the job picker on Sign-Offs (`soJob`). Build a Board project filter the
same way and put an "Open schedule" link on each Jobs row. This is the first step of B1 and is
worth shipping on its own.

### B3. Activation without notifications, phased go-live, decision needed, then Small or Medium

Don: activating a project should not send work or crew notifications immediately; notifications go
out as crews are assigned to individual phases and the work is ready. He also wants both phased
release and "launch the whole pool at once".

What Activate does today: Daily Dispatch emails each field crew with work scheduled that day (to
`stratirus@` while `Crews.LeadEmail` is blank), Calendar Sync writes all 46 events to the group
calendar, the summaries start counting it, and Event-Driven Reconciliation raises conflict alerts
to the PM.

Two readings:

- **Option A, nothing to build but copy.** Dispatch already skips `unassigned` (it is an
  `Unlimited` pseudo-crew, excluded from the crew loop). Don himself said "leave later work such as
  site preparation unassigned until it is ready to schedule". So the release mechanism already
  exists: assign a crew when the phase is ready. Document it and confirm with Don.
- **Option B.** A per-sub-phase Released flag read by Dispatch and Calendar Sync. Real scope across
  two flows, the planner and the allowlist.

Recommend A first. Ask Don what he means by "notification": crew emails only, or the calendar and
summaries too.

### B4. Calendar views: planned, live, merged; day, week, month, Medium to Large

Don and Shane agreed on daily, weekly and monthly calendar views of projected projects not yet
live, next to the existing live view, plus a merged view. Today the group calendar holds Active
projects only (Calendar Sync scope is `Status eq 'Active'`), the Board is a Gantt with Planned
projects badged, and nothing anywhere draws a day/week/month grid.

Options: (a) a calendar tab in the planner with a Planned / Live / Both toggle; (b) extend Calendar
Sync to Planned projects with a category so Outlook shows both; (c) both. Which surface does Don
want to look at, Outlook or the planner?

### B5. Move an Active project back to Planned, Small

"The scheduler did not yet support moving an active project back to planned status after it was
activated accidentally." Activate is one-way in the planner (Jobs tab, line 1183 onward); the only
way back is editing Status on the SharePoint row. Add "Back to planning" beside Activate with the
same compare-before-write on Status. Note Calendar Sync removes the events only on the 04:30 full
sweep. The `26- 2055` pool Don activated early on the 22nd is the live case.

### B6. Reset the schedule from a new start date, Small to Medium

Shane raised it in the meeting: change a project's start (say to December) and regenerate the
whole schedule rather than reflowing each later phase. Today the Jobs tab Start box is inert once
a project has scheduled work; `Save + reflow` in the drawer walks from one sub-phase; a Reschedule
Requests row with `FromSequence` 1 and `NewStartDate` does the full reset but only from SharePoint.

Build: make Start editable on the Jobs tab (or in B1), confirm, run `reflowFrom` from sequence 1
locally, push on Save. Also write `Jobs.StartDate` back when the reset starts at sequence 1, which
closes the D4 drift; that needs the allowlist widened to one Jobs field.

### B7. Zero-day sub-phases for same-day checklist work, decision needed, then Medium

Open question in the notes. Example: the plumbing pressure test is a QC step on the last day of
plumbing, not a day of its own. The planner clamps days to a minimum of 1 in five places
(lines 1239, 1271, 1408, 1644, 1663), `D2 - Reschedule Pool` skips rows with a non-positive
duration, and an all-day calendar event needs end = start + 1.

Options: (a) allow 0 days, meaning start = finish = the previous sub-phase's finish and the cursor
does not advance; (b) fold those tasks into the parent sub-phase's checklist when Don sends the
template revision and drop the separate sub-phase; (c) a "checklist" sub-phase type. Recommend (b)
wherever a separate sign-off is not wanted, (a) where it is. Touches the planner, two flows and
Calendar Sync, so decide before touching any of them.

### B8. Guard a project until its build finishes, Small

Shane: the initial pool entry hit backend errors, possibly because it was edited before population
finished. The Facilitator wrote it as "validating project population before edits are made". The
planner already reads New Pool Requests on every Refresh and ignores it. Show a Building badge on
the Jobs tab and the Board, and disable Activate, edits and Save for that project until the request
reads Done. Cheap, and it closes the `26- 2055` failure mode.

### B9. Rename to "project", Small to Medium, mostly copy

From A1. Planner tab names and controls say job (Jobs, + Job, Job Board) and some dialogs say pool;
the flow emails say pool; the client guide and run sheet say job. Recommend renaming the planner
copy, the email copy and the guide now, and leaving SharePoint list titles alone: `sharepoint/*.js`
and the console applier address lists by `GetByTitle`, and the "Rename Load from D2" pass showed
four harness assertions pin copy strings. Grep `fixtures/` and `sharepoint/` before changing any
string.

## C. Bugs and small fixes from the follow-up list

| # | Item | What I found | Size |
|---|---|---|---|
| C1 | Board jumps to the top when a sign-off box is clicked | Confirmed mechanism. `render()` rebuilds the DOM and only the horizontal scroll is preserved (`UI.tlScroll`, lines 906 to 917). Preserve vertical scroll too | Small |
| C2 | Skills run together with no separator | Crews tab renders skill chips joined with nothing and a 3px margin (line 1203). The crew board already joins with a comma (line 1022). Confirm which screen Don saw | Small |
| C3 | "Reset the operating templates to two-day increments across the board" | Ambiguous. The SharePoint Sub-phase Template already reads 2 days on all 46 rows. Either a browser's local Phase Template drifted (the Set all durations hazard), or a live project's durations did. Needs a sentence from Shane on what was seen | unknown |
| C4 | "Fix the scheduler sign-in bug" | Entra's sign-in log for 09-24 shows only Don, two sign-ins, both successful. The fix shipped 09-18. Nothing to build unless someone reports a new failure | none |

## D. Carried from the 18 September list, no change

- **One shared crew list** (item 2): Harrison and Campos off, STL stays, add Tyler and the office
  people, machine qualifiers. Still needs who covers plumbing, shotcrete, steel and rebar,
  equipment electrical, pool school, demolition.
- **Own job numbers** (item 4), written in the notes as "separate job-number lists". Still needs
  the format.
- **Template editing limited to Don and David** (item 7). Decided, not built.
- **Fiberglass, gunite and construction templates** (item 8; the notes say "goodnight").
- **Jurisdiction and permit numbers, inspections, closing and archiving** (items 14 to 16).
- **Real durations** (item 9): Don says templates give baselines and each project is edited. That
  is B1.

Noted, not scheduler work now: Don wants a checked-off contractual milestone (electrical rough-in)
to send completion to accounting for percentage-of-completion invoicing. That is a future hook on
sign-off for the estimator and accounting work, not this list.

## E. Questions before development

1. **Order.** Suggested: B2, then the small live fixes (C1, C2, B8, B5), then B1, B6, B4, B3, B7.
2. **B3.** What does Don count as a notification, and is "unassigned until ready" acceptable as
   the release mechanism?
3. **B4.** Planner calendar tab, Outlook group calendar, or both?
4. **B7.** Zero-day rows, or fold checklist steps into the parent sub-phase?
5. **B9.** Rename the SharePoint list titles too, or planner and emails only?
6. **C3.** What did "two-day increments" refer to?
7. **B1.** Is adding a phase to a live project in the first version? It needs a new write path.

## Client asks still outstanding

Who covers the six trades; Don's additional phases; the job numbering format; fiberglass and
construction phase lists; Amy's inspection list by jurisdiction.
