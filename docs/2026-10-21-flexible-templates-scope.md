# Flexible templates and project-specific phases: scope

2026-10-21. From the 8:00 status meeting with Don. Estimates are working sessions of effort-bound
build, the kind that has compressed on this project; nothing here is discovery-bound except where
noted.

## What Don asked for

1. Gas rough-in, gas inspection and gas hookup on both pool types.
2. Insert a phase or sub-phase in the middle of a template, with numbering that follows.
3. Template changes reach existing projects, with anything that doesn't apply marked N/A.
4. Optional features (fire, water feature, infinity edge, retaining walls, accent lights) picked
   when a project is created.
5. Change orders on live projects: add or remove a feature after the project is Active
   (Boots / Traditions).
6. Make template edits himself.

## Why this can't be done as template edits today

The planner lays out every project from the template and matches SharePoint's rows to it by
sub-phase number (`importFromD2Payload`, `web/index.html` ~L2283). Three consequences:

- **Renumbering the template mislabels every existing project, and can misdirect writes.** If gas
  goes in at 3.4 and electrical moves to 3.5, an existing project's electrical row (3.4) attaches
  to the new Gas line. Its crew, dates and sign-off display under Gas, and an edit there writes to
  the electrical row. The write-back's row-identity check matches job number and sub-phase number,
  so it passes.
- **Adding a template line shows an empty, unschedulable line on every existing project** in any
  browser that lays the project out fresh.
- **A row added to one project in SharePoint never appears in the planner**, because it has no
  template line to attach to. So there is no way to carry a change order today.

So the fix that unlocks 2 to 6 is the same change: a project's layout comes from its own rows, and
the template is only the starting point for new projects.

## Options

### A. Band-aid, this week (about half a day)

- Add the three gas sub-phases to both templates **without renumbering anything**: new numbers that
  don't collide (placement to confirm with Don). New projects get them; existing projects don't.
- Planner: hide template lines that have no SharePoint row on a project that came from SharePoint,
  so existing projects don't sprout empty gas lines. About an hour, and it is also the first step
  of B.
- Optional features: Don marks them N/A per project, as today. That only covers features already
  in the template.
- Change orders on live projects (Boots / Traditions): not possible in the planner. We would add
  rows for him by script, and they still won't show in the planner until B lands. Honest answer:
  hold until B.

### B. Projects own their structure (about 2 days)

- Planner builds each SharePoint project from its own Assignments and Tasks rows, in `Sequence`
  order. Template is used only for new projects and for the Build phases view.
- Needs each Assignment to carry its trade/skill (pseudo-trades like `@office` are not on the row
  today; add a `Skill` text column, backfill the 34 projects from the template by number).
- Re-proves sign-off, task ticks, reflow, Save and Schedule Check against the new layout; every
  harness that builds jobs from the template changes.
- After this, the template can be renumbered safely.

### C. Features and change orders (about 2 days, after B)

- Template gains `Optional` (Yes/No) on Sub-phase Template. Optional lines are created on every new
  project as N/A unless picked.
- `+ Job` gets feature checkboxes; `D2 - New Pool` writes `NotApplicable` from them.
- Change order, add: un-N/A the feature and schedule it (drawer already has N/A; reflow skips N/A).
- Change order, add something not on the project: "Add from template" in the planner creates the
  Assignment and its Tasks over Graph, positioned by `Sequence`, then reflows.
- Bring an existing project up to date with the template: same action, adds missing lines as N/A.
  Opt-in per project, so a new fire feature never lands on every pool ever built.
- Remove: mark N/A (exists).

### D. Template editing for Don and David (about 1.5 days)

- Build phases tab becomes an editor: insert, move, rename, renumber, set Optional, edit tasks;
  writes to Sub-phase Template and Task Template over Graph.
- Gated to Don and David by SharePoint permissions on the two template lists (the gate decided
  2026-09-21 and not yet applied).
- Cheaper fallback: Don edits the two lists directly in SharePoint, and a "Renumber" action tidies
  `Sequence` and numbers. Works, clunky.

**Total for B to D: about a week of build**, not a month. Gunite Rev3 load fits after D (Don loads
it himself, or we do it once).

## Risks and things that grow

- **Row volume.** Optional lines as N/A rows add rows to every project. A 10-feature catalogue at
  ~5 tasks each is roughly +10 Assignments and +50 Tasks per project. SharePoint handles it with the
  per-project reads already in place, but it adds to the pressure Shane raised in the meeting.
- **`D2 - Counter Reconciliation` reads each project's tasks with one 46-term `or` chain.** A project
  above 46 sub-phases (Rev3 is ~60) needs that read chunked. The planner already chunks at 46.
- **`D2 - New Pool` runtime grows** with more lines per project (about 14 s per sub-phase today).
- **Dataverse.** None of this needs it. It is the either-or migration in Rev D §14, at premium
  licensing, and should be its own decision.
- **Budget.** As of 2026-10-11 the October D2 bucket had about 7 hours left. A week of build needs a
  commercial answer before it starts.

## Still open with Don

- Where gas goes in each template (after plumbing, after electrical, hookup in equipment?).
- Features list for the Optional catalogue.
- Unchanged from before: Fiberglass crews for the 20 unassigned lines, durations, which of the 34
  are Fiberglass, Harrison and Campos.
