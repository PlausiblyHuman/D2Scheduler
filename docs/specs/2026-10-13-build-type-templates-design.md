# Build type: Gunite and Fiberglass templates — design

Date: 2026-10-13. Status: approved in conversation; written spec for review.
Requested by Don Borgeson (ranking of his 2026-10-10 asks, relayed by Shane 2026-10-13): pick Gunite
or Fiberglass when creating a project, and see either template in the planner.

## 1. Goal and scope

A project has one **build type**, chosen when it is requested and never changed. Two templates
exist, one per type. `D2 - New Pool` builds a project from the template of its type. The planner
lays each project out from the template of its type, shows both templates on the Phase Template
tab with a switch, and marks Fiberglass projects.

In scope:

- A `BuildType` choice on four SharePoint lists, and the Fiberglass template rows.
- `D2 - New Pool` builds by type.
- The planner: a type on `+ Job`, templates read from SharePoint, a per-type layout, the tab
  switch, a Fiberglass chip.
- One adjacent defect fixed in passing (section 7).

Out of scope, on the record:

- Changing a project's type after creation.
- Don's Rev3 Gunite revision. The Gunite template stays the 46-sub-phase August master.
- Pavilion and Pool House. A third choice value plus a seed, no code.
- The 34 live projects. They are stamped Gunite and otherwise untouched.
- Guide v9 (deferred 2026-10-11). This adds two items to its list.

## 2. Decisions taken from the Fiberglass sheet

Source: `Fiberglass Build Phase_Rev1_091726 (2).xlsx` from Don's email, saved as
`D2-Build-Scheduler/D2-Build-Scheduler/source/Fiberglass Build Phase_Rev1_091726.tsv` (Task Name,
Phase, Section, Row Type; the other columns were empty). 45 sub-phases, 248 tasks.

1. **The two Phase 7s merge.** The sheet numbers both Equipment Installation (7.1 to 7.3) and
   Startup and Trim Out (7.1 to 7.4) as Phase 7, because Don inserted a new Phase 2 for the shell
   set and did not renumber Startup. They become one phase, *Equipment Installation, Startup and
   Trim Out*, sub-phases 7.1 to 7.7. Four of Don's numbers change (Startup 7.1 to 7.4 become 7.4
   to 7.7); Phases 8 and 9 keep his numbers.
2. **Phase names** come from the sheet's `PHASE N.` heading rows in title case, using the Task
   Name column where the two columns disagree: 0 Pre Construction/Sales, 1 Preconstruction Back
   Office Admin, 2 Base Preparation and Shell Set, 3 Plumbing Rough-In, 4 Electrical Rough-In,
   5 Backfill and Water Fill, 6 Coping and Decking, 7 (merged, above), 8 Site Restoration and Final
   Grade, 9 Post Construction Completion Phase.
3. **Sub-phase numbers** are the Task Name column (Don's newer numbering), not the Section column,
   which still carries the pre-insert numbers for phases 4 to 7.
4. **Rows kept and dropped.** Every row typed Task is a task, including the "(yes or no)" items;
   N/A exists for the ones a project does not get. The two rows under 8.5 with their own section
   text (Fence Pool safety Barrior; Pool, Door and Window Alarms) are tasks of 8.5 Landscaping
   Restoration. The untyped row "Ability to add multipal single line items to the schedule" is
   Don's punch-list note, not a task, and is left out.
5. **Text is verbatim**, including Don's spellings, as the Gunite seed was. He recognises his own
   wording; corrections are a one-line edit later.
6. **Durations** are 2 work days on every row, as the Gunite 46 started.
7. **Trade and crew** by name match against the Gunite 46, with two office exceptions:

   | Fiberglass | takes trade and crew of Gunite |
   |---|---|
   | 0.0, 1.0, 1.1, 1.2, 3.1, 3.3 | the same number and name |
   | 1.4, 1.5, 1.6, 1.7 | 1.3, 1.4, 1.5, 1.6 (shifted by the new 1.3) |
   | 3.2 Plumbing Installation | 3.2 Underground Plumbing Installation |
   | 4.1, 4.2, 4.3, 4.4 | 3.4, 3.5, 3.6, 3.7 |
   | 6.1 Bond Beam/Collar Preparation | 2.3 Bond Beam Preparation |
   | 6.2, 6.3, 6.4, 6.5, 6.6, 6.7 | 5.4, 5.3, 5.5, 5.6, 5.7, 5.8 |
   | 7.1, 7.2, 7.3 | 6.2, 6.1, 6.3 |
   | 7.5, 7.6 | 6.6, 6.7 |
   | 9.0, 9.1 | 6.8, 7.0 |
   | 0.1 Procurement Planning, 1.3 Order/Procure Site Materials | Main Office (exception: plainly office work) |
   | 2.1, 2.2, 2.3, 5.1, 5.2, 5.3, 7.4, 7.7, 8.1 to 8.6 | none: Unassigned |

   29 by name, 2 by exception, 20 Unassigned (the 14 Fiberglass-only rows plus the 6 whose Gunite match is itself Unassigned). Don adjusts in the planner as he schedules; 8.3
   Final Grade is the likely first adjustment (the `finishgrade` trade exists).
8. **Sequence** is the position in the template, 1 to 45, which is what the live Gunite rows
   carry (1 to 46, from `tools/template-seed.json`; the phase-hundreds scheme in
   `sub-phase-template.csv` was documentation and was never seeded). Sequence values overlap
   between types; every read is filtered by type first.

## 3. Data model

One new column, `BuildType`, Choice [Gunite, Fiberglass], required, default Gunite, on:

| List | Existing rows | New rows |
|---|---|---|
| `Sub-phase Template` (`453e7cd5-…`) | 46 stamped Gunite | 45 Fiberglass |
| `Task Template` (`61824add-…`) | 295 stamped Gunite | 248 Fiberglass, each hung off its Fiberglass sub-phase by the `SubPhase` lookup |
| `New Pool Requests` (`13331a5e-…`) | stamped Gunite (history reads honestly) | written by the planner; the SharePoint New form shows it as a dropdown defaulting to Gunite |
| `Jobs` (`ee0ecabf-…`) | all live and complete rows stamped Gunite | written by `D2 - New Pool` |

One more column on `Sub-phase Template`: `PhaseName`, Text, stamped on all 91 rows (Gunite from
`phase-template.csv`, Fiberglass from section 2). The planner needs the phase heading and the list
has never carried it; the planner's baked copy was the only place it lived.

Creation uses the existing idempotent pattern (`provision-pool-lists.js`: check `InternalName`,
then `CreateFieldAsXml` with the Choice XML and `<Default>`, sequential). Stamping existing rows is
a MERGE per row; the Crew Choice conversion's `SchemaXml` trap (it wiped `ValidationFormula`) does
not apply because these are new columns, not conversions. The list form shows `BuildType` on the
New form for `New Pool Requests` and hides it on `Jobs` (flow-owned; same `ShowInNewForm` MERGE as
`Status`).

Views: `Gunite` and `Fiberglass` views on both template lists for Don and David, filtered by
`BuildType`, ordered by `Sequence`.

Seed tooling:

- `tools/gen-template-seed.py` gains `--template <json> --build-type <type>`; default is today's
  behaviour (SEED_TEMPLATE from `web/index.html`, Gunite). The Fiberglass template JSON is built
  from the TSV by a new `tools/fiberglass-template.py` that applies section 2 (renumbering, phase
  names, kept and dropped rows, the trade and crew table) and writes
  `D2-Build-Scheduler/D2-Build-Scheduler/data/fiberglass-template.json` in SEED_TEMPLATE shape,
  plus `fiberglass-sub-phase-template.csv` and `fiberglass-task-template.csv` mirroring the Gunite
  CSVs. Default crews are picked the same way as Gunite's (least-loaded qualified crew from the
  live `Crew-Trades`; `office`, `subcon`, `unassigned` for the pseudo-trades). Output
  `tools/template-seed-fiberglass.json` carries `buildType` and `phaseName` on every sub-phase.
- `sharepoint/seed-templates.js` matches on `BuildType` and `SubPhaseNumber` (today
  `SubPhaseNumber` alone, which would collide: 1.1 exists in both types), writes `BuildType` and
  `PhaseName` on sub-phases and `BuildType` on tasks, and takes the seed file name as a parameter.
- A new `sharepoint/stamp-build-type.js` stamps Gunite on existing rows of all four lists and
  `PhaseName` on the Gunite 46, and reads back counts per type.

Read-back after seeding, from the site: Sub-phase Template 46 Gunite + 45 Fiberglass; Task
Template 295 + 248; every Fiberglass task's `SubPhase` lookup points at a Fiberglass sub-phase; no
row on any of the four lists with a blank `BuildType`.

## 4. `D2 - New Pool`

Source of truth is `flows/exports/D2-New-Pool-2026-10-03.json` checked against a fresh
`get_flow`; `flows/definitions/` is historical. Changes:

- Read the type once: `Compose_build_type` =
  `coalesce(triggerOutputs()?['body/BuildType']?['Value'], 'Gunite')`. The trigger delivers a
  Choice as `{Id, Value}`; the shape is confirmed on the first throwaway run before anything else
  is trusted, per the capture-not-author rule.
- `Get_subphase_template`: `$filter` `BuildType eq '<type>'`, `$orderby Sequence asc`, `$top` 100.
- `Get_task_template`: `$filter` `BuildType eq '<type>'`, `$top` 1000. Without the filter the list
  now holds 543 rows and the old `$top` 500 would silently truncate Gunite's own tasks.
- Fail before writing when a read hits its cap, the same guard the 2026-09-28 scale work put on
  four other flows: after the two template reads, if the sub-phase count is 100 or the task count
  is 1000, set the request `Failed` with a `ReadAtCap` result and terminate before `Create_job`.
  A truncated template must never become a half-built project.
- `Create_job`: adds `"BuildType": "<type>"`.
- `Filter_tasks_for_subphase` is unchanged: it joins by the `SubPhase` lookup id, which already
  keeps each type's tasks with its own sub-phases.
- Result and failure emails name the type. The counts already come from the rows read.

Push: FlowAgent `preview_update` → `update_flow` with the token → Dataverse `PublishXml` on
`workflowEntityId d782ee70-2fab-f111-aaab-6045bd0196b3`, tenant pinned per `m365-tenant-guard`.
Export to `flows/exports/D2-New-Pool-2026-10-13.json` once green.

## 5. Planner

### 5.1 Creating a project

`addJob()` gains a Build type control (two radio buttons, Gunite preselected) above the start
date. The form copy that says "46 sub-phases and 295 tasks" and "all 46 sub-phases unassigned"
reads the counts from the chosen type's template. The `S.pendingCreates` entry carries
`buildType`; `buildPendingCreates()` passes it (and `pmId`, `pmName`: section 7);
`planCreates()` in `writeback-core.js` keeps it; `createBody()` in `graph-writeback.js` sends
`BuildType`; `sharepoint/apply-planner-changes.js` sends it on the console path and includes it in
its post-write verification select. The pending-requests card on the Jobs tab shows the type.

### 5.2 Templates from SharePoint

`D2_GRAPH.lists` gains `spt` (Sub-phase Template) and `tpt` (Task Template), and `trades`
(`05038f7f-…`) for the lookup join. `loadFromD2ViaGraph` reads all three whole (`$top=500`, paged
by `graphPageAll`; the per-project reads are unchanged). `graph-to-planner.js` adds
`templates: {Gunite: [...], Fiberglass: [...]}` to the payload, in SEED_TEMPLATE shape: phases from
`PhaseName` grouped by the integer part of `SubPhaseNumber`, sections ordered by `Sequence` with
`num`, `name`, `days` (`DurationDays`), `skill` (the Trade's `TradeCode` via `TradeLookupId`, or
`@office` / `@sub` / `@unassigned` from `DefaultCrew` when there is no trade), and `tasks` (Task
Template rows by `SubPhaseLookupId`, ordered by `Sequence`, titles). Each job carries
`buildType: jf.BuildType || 'Gunite'`. The REST export (`sharepoint/export-to-planner.js`)
produces the same two fields so `graph-read.js` stays an equivalence test.

The planner keeps `S.templates` (by type) and `S.templatesFrom` (the Refresh timestamp).
`templateFor(type)` returns `S.templates[type]`, falling back to `mkTemplate()` (SEED_TEMPLATE,
Gunite) for a browser that has never refreshed. On first load after this deploys, a stored
`S.template` migrates to `S.templates.Gunite` and `S.template` is deleted. `newJob(...)` takes a
type; `mkJobGroups(templateFor(j.buildType))`. `importFromD2Payload` sets `j.buildType` from the
payload on every job and stores `d.templates` before it builds any new job. Section matching by
`num` and task matching by name then position are unchanged; a section that matches nothing is
still reported.

### 5.3 Phase Template tab

Title "Build phases". A Gunite / Fiberglass switch (`UI.tplType`, default Gunite). A read-only
table: number, sub-phase, required trade, days, task count; phase rows roll up. Hint: "From
SharePoint, as of <Refresh time>. Don and David change the templates there; ask them for a
permanent change." Before the first Refresh: "Built-in copy of the Gunite template. Press Refresh
to load both templates from SharePoint." Removed, with their buttons and functions: `setGrp`,
`setSec`, `moveSec`, `delSec`, `delGrp`, `addSection`, `addPhase`, `setAllDays`, `applyTemplate`.
The Crews tab's Skill Coverage table lists sub-phases from both templates, labelled by type.

### 5.4 Display

`jobBadge` draws a `Fiberglass` chip when `j.buildType === 'Fiberglass'`; Gunite is unmarked. The
chip therefore appears on the Jobs tab, the Job Board row title and the schedule card heading.
No type filter.

### 5.5 Not touched

Save, sign-off, Reject, comments, Mark complete, Reopen, Activate, Reschedule, and the row
identity in `writeback-core.js` (job number plus sub-phase number, unique within a project). The
fourteen flows other than New Pool read assignment rows and never see the type.

## 6. Harnesses and verification

Payload first: after section 3 is live, recapture `fixtures/planner/live-payloads-graph.json`
(and the filtered one) with `capture-graph.js` extended to the three new lists, so every harness
runs on real shapes. Then:

- New `fixtures/planner/build-type.js` with `build-type.mutations.json`: the radio defaults to
  Gunite; the pending entry, `buildPendingCreates`, `planCreates` and `createBody` all carry it;
  a Fiberglass job lays out from the Fiberglass template and reports no unmatched sections; a
  Gunite job is unchanged; the tab switch renders the right template and the read-only table has
  no inputs; the never-refreshed fallback is Gunite; the migration of a stored `S.template`; the
  chip; the Skill Coverage union.
- Updated: `honest-copy.js` (the two removed dialogs), `empty.js` (`templateFor`), `office-views.js`
  (stub serves the three lists; `+ Job` PM reaches the POST body), `graph-write.js` (`createBody`
  includes `BuildType`), `writeback-core.js` (`planCreates` keeps `buildType`), `writeback.js`
  (`+ Job`), `graph-read.js` (templates and type on both paths), the `g2p-mutations` for
  `graph-to-planner.js`.
- `npm test` gains `build-type.js`. The shakedown's `phases` tab still renders and throws nothing.

Live, in this order, each step read back before the next. **The order is load-bearing:** the live
flow reads both template lists whole, so if the Fiberglass rows landed before the filter did, a
Gunite request raised in that window would be built with 91 sub-phases, and the task read would
sit 43 rows over its cap. Stopping the flow for the window is not an answer either, because the
SharePoint created-item trigger does not pick up rows created while the flow was off.

1. Columns on all four lists, every existing row stamped Gunite, `PhaseName` on the Gunite 46,
   views. Additive; nothing live reads the column yet. A throwaway Gunite request (`TEST-9902`)
   proves the unchanged flow still builds 46 and 295 with the column present.
2. Flow, with the filters, the raised cap and the guard. The same throwaway Gunite request shape
   again, read back as 46 and 295 with `Jobs.BuildType = Gunite`.
3. Fiberglass seed: 45 sub-phases and 248 tasks. A throwaway Fiberglass request (`TEST-9901`)
   read back as 45 assignments and 248 tasks with the expected crews and `BuildType =
   Fiberglass`; one more Gunite request to prove the filter keeps the types apart. All throwaway
   projects deleted through `Delete Pool Requests`. Flow 3 (Event-Driven Reconciliation) is
   stopped for the builds as the seed-data rule requires, then restarted.
4. Planner. Harnesses green, shakedown green, deploy to Static Web Apps, tag
   `deploy/2026-10-xx`, wall checks. Refresh in a real browser shows both templates on the tab and
   `TEST-9901` (built before deletion, or rebuilt) with a Fiberglass chip and no unmatched alert.

Rollback: the columns stay (harmless); the flow restores from the 10-03 export; the planner
redeploys the previous tag.

## 7. Fixed in passing

`buildPendingCreates()` maps a pending create to six keys and drops `pmId` and `pmName`, so the
project manager picked on `+ Job` never reaches `pushCreates`, which falls back to the signed-in
user. `planCreates` and `createBody` already carry a PM id. The fix is the two keys in
`buildPendingCreates`, pinned by a `build-type.js` assertion that the chosen PM reaches the POST
body.

## 8. Documentation

- CLAUDE.md: a dated section; the deployed-state rows for the four lists; the New Pool flow row;
  the "46 sub-phases" claims at lines 233, 1167 and 1533 become "per the project's build type".
- Guide v9 list: choose Gunite or Fiberglass on `+ Job`; the Phase Template tab shows SharePoint's
  templates and no longer edits anything.
- For Don: the four Startup numbers that changed, and the 20 Unassigned sub-phases.

## 9. Size

About 7 to 8 hours: seed tooling and schema 2, flow 1, planner 3 to 4, live proof and deploy 1.
Two throwaway builds at 10 to 15 minutes each.
