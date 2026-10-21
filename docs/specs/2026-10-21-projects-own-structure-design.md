# Spec: projects own their structure (B) + optional features and change orders (C)

On approval this file is copied to `docs/specs/2026-10-21-projects-own-structure-design.md` and
committed before any build starts.

## Context

At the 2026-10-21 status meeting Don asked to: add gas phases to both templates; insert phases in
the middle of a template with numbering that follows; pick optional features (fire, water feature,
infinity edge, accent lights) when a project is created; add or remove features on a live project
as change orders (Traditions); and pull new template phases into existing projects. Scope note:
`docs/2026-10-21-flexible-templates-scope.md`.

None of it is safe today because the planner lays every SharePoint project out from the template
and attaches SharePoint rows to template lines **by sub-phase number** (`importFromD2Payload`,
`web/index.html` ~L2283; `bySec` L2204). Rows with no template match are dropped (`unmatched`),
template lines with no row show as empty, and a renumbered template attaches an old row to the
wrong line, where `titleMatches` (`web/writeback-core.js:89`) still passes because the number
matches. So:

- **B**: a SharePoint project's layout is built from its own Assignments and Tasks rows. The
  template is only the starting point for new projects.
- **C**: optional features on the template (named groups, ticked on `+ Job`, default N/A otherwise),
  toggled on a live project as a change order, and an opt-in **Update from template** action that
  creates missing sub-phases on one project.

Decided 2026-10-21 (Shane): named feature groups; propagation is opt-in per project.

Out of scope: the template editor (D), Gunite Rev3, the gas rows themselves (data, entered after B
lands), Dataverse, sub-phase deletion (removal is N/A).

## Data model

New columns. All optional, so existing writers keep working.

| List | Column | Type | Purpose |
|---|---|---|---|
| Sub-phase Template | `Skill` | Text | trade code or `@office`/`@sub`/`@unassigned`; today derived from Trade + `DefaultCrew` (`PSEUDO_BY_CREW`, `web/graph-to-planner.js:135`) |
| Sub-phase Template | `Optional` | Yes/No, default No | optional line, created N/A unless its feature is picked |
| Sub-phase Template | `Feature` | Text | feature group name; optional lines sharing it toggle together. Blank + Optional = its own name (`SubPhaseName`) |
| Assignments | `PhaseName` | Text | phase heading, copied from the template at creation |
| Assignments | `Skill` | Text | copied from template |
| Assignments | `TemplateItemId` | Number | the Sub-phase Template row it came from; the key for Update from template |
| Assignments | `Feature` | Text | copied from template when Optional, so a live project knows its feature groups |
| New Pool Requests | `Features` | Note | picked feature names, `;`-separated |

Provisioned with a `sharepoint/provision-structure.js` script on the `provision-build-type.js`
pattern (CreateFieldAsXml, sequential, skip-if-exists, `D2_DRY`), hidden from New/Edit forms like
the other machine-owned fields. Template `Skill` backfilled from `tools/template-seed*.json`.

**Backfill the 34 live projects** (`sharepoint/stamp-structure.js`, on the `stamp-build-type.js`
pattern): set `PhaseName`, `Skill`, `TemplateItemId` on all 1,564 Assignments by matching
`SubPhaseNumber` against that project's build-type template. This must run **before anyone edits
the template**, because the number match is only valid against today's template. Each MERGE
carries `SuppressReconcileUntil`, and Flow 3 is stopped for the run. Dry run first; read back a
count of rows still blank.

`Sequence` stays the ordering key. Inserted rows take a decimal between neighbours (the column has
no `Decimals` setting, so it stores floats). No mass renumbering of existing rows.

## B. Planner builds projects from their own rows

`web/graph-to-planner.js` `toPlannerPayload` (~L250-286):
- Read and emit per section `phase` (PhaseName), `skill` (Skill), `templateItemId`, `feature`, plus
  `tradeCode` from `TradeLookupId` as a fallback.
- Fallback for rows missing the new columns (fixtures, REST path, any row the backfill missed): look
  the row's `SubPhaseNumber` up in the project's build-type template for phase name and skill. Flag
  it, so tests can count fallback rows.
- `sharepoint/export-to-planner.js` (file:// path): add the same fields to `$select`.

`web/index.html`:
- New `groupsFromPayload(inj, tpl)`: sections in `Sequence` order, grouped into phases by consecutive
  phase number (`num.split('.')[0]`) and named by `phase`. Section `{sid, num, name: is.name, skill,
  days, ..., tasks}` with tasks built **1:1 from the row's own Tasks** (`{t: title, done, na, note,
  spId: id}`), in task `Sequence` order.
- `importFromD2Payload`: for every job in the payload, **replace `j.groups` with
  `groupsFromPayload`** on every Refresh, then apply the existing overlay of crew, dates, flags,
  sign-off, rejection and `s.base`. The by-number `bySec` match and the name-then-position task
  matching go away for SharePoint projects; `unmatched` can no longer happen. Refresh already warns
  that unsaved edits are overwritten, so rebuilding structure loses nothing new.
- `newJob` + `mkJobGroups(templateFor(...))` stay for local sketches only.
- Everything that walks `allSecs`/`j.groups` (Auto-Schedule, `reflowFrom`, `conflicts`, Schedule
  Check, sign-off, Board, Sign-offs, Dispatch, drawer, `readyToComplete`) keeps working unchanged,
  because the shapes are the same. Check each against a project whose layout differs from the
  template.
- `readyToComplete` gets correct behaviour for free: template lines a project never had no longer
  block completion.

## C. Optional features and change orders

**`D2 - New Pool`** (builder `flows/scripts/new_pool_features.py`, driver
`2026-10-2x-new-pool-features.py`, test `test_new_pool_features.py`, same pattern as
`new_pool_build_type.py`):
- `Compose_features`: the request's `Features`, split, trimmed, lowercased.
- Per sub-phase: `Compose_is_na` = `Optional` and the feature name (`coalesce(Feature, Title)`, lowercased) not in
  the picked list.
- If N/A: skip the work-day span walk, write `ScheduledStart`/`ScheduledFinish` null, and do not
  advance the cursor. An unpicked feature must not stretch the schedule.
- `Create_assignment` adds `NotApplicable: Compose_is_na`, `PhaseName`, `Skill`, `TemplateItemId`,
  `Feature`. Tasks are still created for N/A rows, so turning the feature on later needs no creates.

**`D2 - Reschedule Pool`**: add `NotApplicable` to `Condition_skip_row`, so N/A rows take no days.
The planner's `reflowFrom` already skips them (L685); the flow did not.

**`D2 - Counter Reconciliation`**: chunk the per-job task `or` chain at 46 ids (one
`Get_job_tasks` per chunk, results unioned). Optional rows take projects past 46 sub-phases, and
46 is the only chain length proven against the connector.

**Planner `+ Job`** (`addJob` ~L1822, `confirmNewPoolRequest` ~L1877, `createBody` in
`web/graph-writeback.js:116`): a Features checklist built from the chosen build type's optional
template lines, grouped by feature name, all unticked by default. It reloads when the build-type
radio changes. The picks ride on the pending create as `features` and are sent as `Features`.
`planCreates` (`writeback-core.js:190`) keeps the field.

**Features on a live project** (drawer section on the Jobs tab or the Board project row): list the
project's feature groups (rows with a `feature`), each with a switch.
- On: clear `skip` on its rows, then `reflowFrom` the first of them.
- Off: set `skip`. Refused if any row in the group is installer-signed.
- Both go through the existing Save allowlist (`NotApplicable`, `ScheduledStart`, `DurationDays`) and
  compare-before-write. No new write path.

**Update from template** (one project, on the Jobs tab):
1. Read the build type's template from `S.templates`. List template lines whose `TemplateItemId` is
   not on the project. For rows without the key, fall back to number plus name.
2. The PM ticks what to add, and for each chooses Applicable or N/A. Optional lines default to N/A.
3. Guards: `stopForUnsaved` and `frozen(j)` refuse first, as Activate does.
4. Creates go over Graph, in a new `planStructureCreates` (`writeback-core.js`, pure) and
   `applyStructureCreates` (`graph-writeback.js`):
   - POST one Assignments item with these fields:
     - `Title` `<job> · <num> <name>`, `JobLookupId`
     - `SubPhaseNumber`, `SubPhaseName`, `PhaseName`, `Skill`, `TemplateItemId`, `Feature`
     - `Sequence` as the decimal midpoint after the last project row whose template sequence is lower
     - `TradeLookupId` when there is one
     - `Crew` `unassigned`, `DurationDays` from the template
     - `Locked`, `PMSignOff` and `InstallerSignOff` false, `NotApplicable` as chosen
     - `TasksTotal` = task count, `TasksComplete` 0
     - `SuppressReconcileUntil` +10 min
   - Then POST each Tasks item: `Title`, `AssignmentLookupId`, `Sequence`, `Complete` false.
5. Afterwards, re-read that project only (`readAsgForJobs`), then `reflowFrom` the first
   applicable new row and tell the PM to Save.
6. Partial failure: if an Assignment exists but some Tasks failed, report each failed task by name.
   The next Update from template shows the sub-phase as present, so nothing duplicates.
   Counter Reconciliation corrects `TasksTotal` that night.
7. **Capture rule**: before writing `applyStructureCreates`, create one Assignment and one Task by
   Graph on a throwaway project and read the stored shape back (lookup ids as strings, Choice as
   plain string, DateOnly). Write the bodies from that capture, never by hand.

**Not done here**: a "push to all live projects" bulk action. Opt-in per project was the ruling.

## Files

- `web/graph-to-planner.js`: new section fields and the template fallback.
- `web/index.html`:
  - `groupsFromPayload` and the import rebuild
  - the `+ Job` features checklist
  - the Features panel
  - Update from template
- `web/writeback-core.js`: `planStructureCreates`, carrying `features` through `planCreates`.
- `web/graph-writeback.js`: `applyStructureCreates`, `Features` in `createBody`.
- `sharepoint/export-to-planner.js`: `$select`.
- New: `sharepoint/provision-structure.js`, `sharepoint/stamp-structure.js`.
- `tools/gen-template-seed.py` and the two seed JSONs: emit `Skill`, `Optional` and `Feature` (all
  false or blank today).
- `flows/scripts/`:
  - `new_pool_features.py`, `reschedule_skip_na.py`, `counter_recon_chunk.py`
  - drivers and tests on the existing pattern
  - fresh exports to `flows/exports/`

## Verification

- **Harnesses** (each with a mutations file, every new assertion watched red under
  `fixtures/planner/mutate.py`):
  - New `fixtures/planner/project-structure.js`, which checks that:
    - a project whose rows differ from the template (an extra row, a missing row, a renumbered
      template) lays out from its rows
    - no unmatched rows appear, and no empty template lines
    - a tick writes to the right row id
    - the fallback is used only for rows missing the columns
  - New `features.js` (`+ Job` checklist to `Features`; toggle on reflows; toggle off is refused on
    signed rows).
  - New `structure-create.js` (create bodies against the captured shape; partial failure; no
    duplicate on re-run).
  - Re-run the existing 26 harnesses. Expect `build-type.js` (empty Fiberglass layout) and the
    task-matching cases in `signoff-push.js` to change; update them deliberately, not to make them
    pass.
- **Flow tests**: `python flows/scripts/test_new_pool_features.py` and the two others, offline, as
  for the earlier New Pool changes.
- **Shakedown**: `tools/planner-shakedown.js` with `--window-size=1600,1000`, 48+ checks green.
- **Live, on throwaway Planned projects owned by D2 Bot (default crews off), rows read back after
  every step**:
  1. Provision the columns; dry-run then run the backfill; confirm 0 rows blank. Refresh shows all 34
     projects identically to before (compare the Board for 3 projects before and after).
  2. Add one test optional line to the Gunite template (Feature `TEST feature`). Raise `TEST-99xx`
     with the feature unpicked: the row exists N/A with null dates and the schedule is no longer
     than 46 lines. Raise a second with it picked: it is applicable and dated.
  3. Toggle the feature on the first project: dates appear, Save writes them.
  4. Add a second template line, then run Update from template on `TEST-99xx`: one Assignment plus
     its Tasks are created, ordered correctly, and a tick on a new task lands on its row.
  5. Reflow via Reschedule Requests skips N/A rows. Counter Reconciliation runs clean on a project
     of more than 46 lines.
  6. Delete the throwaways through Delete Pool Requests and remove the test template lines. Read the
     tenant back to 34 / 1,564 / 10,030 plus template counts 91 / 543.
- Deploy the planner with a `deploy/yyyy-mm-dd` tag, then re-run the anonymous wall checks.

## Effort and order

Effort-bound, about 4 working sessions:
1. Columns + backfill.
2. B in the planner.
3. New Pool / Reschedule / Counter Reconciliation flow changes.
4. `+ Job` features, the Features panel, and Update from template.

The backfill (step 1) must land before anyone edits a template.
