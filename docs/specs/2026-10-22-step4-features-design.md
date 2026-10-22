# Spec: step 4, optional features on new and live projects, and Update from template

Extends `docs/specs/2026-10-21-projects-own-structure-design.md` (the parent spec, approved
2026-10-21). Steps 1 and 3 of that spec are live; step 2 (each SharePoint project lays out from its
own rows) is built and not deployed. This spec replaces the parent's step 4 section ("Planner
`+ Job`", "Features on a live project", "Update from template") where the two differ, and adds
task-level features. Steps 2 and 4 deploy together.

## Why

D2 wants optional work on a project: an auto cover, a water feature, a spa, gas/fire, an infinity
edge, or anything else Don defines in a template. Fire is one example; nothing in the code is
specific to any feature. A feature can be picked when a project is created, and added or removed at
any point after that, while the project is Planned or Active and under construction. That second
case is the change order (Traditions was the example in the 2026-10-21 meeting).

Amy's Gunite Rev4 workbook (2026-10-21) shows that a feature is not only whole sub-phases. Auto
cover has a sub-phase of its own (6.4 Auto Cover Rough In) and also single tasks inside about eight
standard sub-phases (1.1, 1.4, 1.7, 4.1, 5.1, 5.3, 6.5, 7.3, 8.3). Water features and spa follow the
same pattern. If a feature covered only whole sub-phases, a crew lead on a pool with no auto cover
would have to mark each stray auto cover task N/A with a reason before signing off. Business rule
2026-09-07 exists to stop exactly that kind of reflex marking, so a feature must cover tasks too.

## Goals

1. Template authors (Don and David, in SharePoint) can tag optional work at two levels: a whole
   sub-phase (`Optional` + `Feature`, already provisioned) and a single task inside any sub-phase
   (new `Task Template.Feature`).
2. `+ Job` offers the build type's features as checkboxes. Unpicked features arrive N/A: optional
   sub-phases N/A and undated (already live in `D2 - New Pool`), and tagged tasks N/A with an
   automatic reason (new).
3. A live project's Features panel switches a feature on or off at any time, for sub-phases and
   tasks together. Turning a feature on for a project that has none of its sub-phases creates them.
4. Update from template adds template sub-phases a project is missing, by template row id.
5. Each change order leaves a dated, attributed comment on the sub-phases it touched.

## Non-goals

- Loading Rev4 (or any template revision) into SharePoint. That is data work after Amy answers her
  questions. The mapping of Rev4 to today's template is in `docs/2026-10-22-gunite-rev4-mapping.md`.
- A template editor in the planner (option D in the scope note).
- Adding missing **tasks** to existing sub-phases of a project. A project built before a template
  gained a tagged task does not get that task. (Its untagged tasks are already applicable, so
  nothing is hidden from it; it simply lacks the new task.)
- Deleting rows. Removal is always N/A.
- Per-feature quantities (two fire bowls). A feature is on or off.
- A "push to all live projects" action. Opt-in per project was the 2026-10-21 ruling.
- Single ad hoc line items (Amy's punch-list note). Noted as a follow-up; it would reuse the create
  path built here.

## Anti-goals (would be a failure even if it works)

- A feature change silently rewrites attested work. Signed-off sub-phases and the tasks under them
  never change state because of a feature switch.
- A PM's own N/A reason is overwritten. Only the automatic feature reason is ever cleared.
- An unpicked feature stretches the schedule.
- Update from template offers lines a project already has, or creates a duplicate on a re-run.

## Data model

New columns, provisioned on the `provision-structure.js` pattern (sequential `CreateFieldAsXml`,
skip-if-exists, `D2_DRY`, hidden from New/Edit forms on Tasks):

| List | Column | Type | Purpose |
|---|---|---|---|
| Task Template | `Feature` | Text | non-blank = this task belongs to that feature and is optional |
| Tasks | `Feature` | Text | copied from Task Template at creation |

Existing, from step 1: `Sub-phase Template.Optional`, `.Feature`, `Assignments.Feature`,
`.TemplateItemId`, `New Pool Requests.Features`.

**A feature is identified by its name**, compared trimmed and case-insensitively. A sub-phase's
feature name is `Feature`, or its `Title` when `Optional` is true and `Feature` is blank (as
`D2 - New Pool` already does). A task's feature name is its `Feature`; a task with no `Feature` is
never optional. One feature can span optional sub-phases and tagged tasks.

**The automatic N/A reason** is the text `<Feature> not on this project`. It is what marks a task
as feature-N/A rather than PM-N/A. Exact string, written by the flow and the planner alike.

## `D2 - New Pool` (flow change)

Builder `flows/scripts/new_pool_task_features.py`, driver
`flows/scripts/2026-10-2x-new-pool-task-features.py`, offline test
`test_new_pool_task_features.py`, on the pattern of `new_pool_features.py`.

- In `Apply_to_each_task`, a `Compose_task_is_na` = the task's `Feature` is non-blank and its
  lowercased trimmed value is not among `Select_features`' picks.
- `Create_task` adds `"Feature"` (escaped as the other strings are), `"NotApplicable"` from
  `Compose_task_is_na`, and `"Note"`: the automatic reason when N/A, otherwise omitted or empty.
- `Get_task_template` (a connector `GetItems`, no `$select`) returns `Feature` once the column
  exists, but the connector leaves null fields out of its output, so every read of it is
  `coalesce(items('Apply_to_each_task')?['Feature'], '')`.
- Nothing else changes. `Merge_task_total` still counts every task; `TasksComplete` still counts
  Done only, so an N/A task reads as not complete, which is the existing honest-count rule.

## Planner

### Template data (`web/graph-to-planner.js` `templatesFrom`, `web/index.html` `tplFromPayload`)

Keep, per template sub-phase: row `id`, `Sequence`, `Optional`, `Feature` (resolved feature name),
`TradeLookupId`, `DurationDays`; per template task: `Sequence`, `Feature`. Today these are dropped.
`S.templates` carries them; local sketches (`mkJobGroups`) ignore them.

### Project data

Tasks gain `feature` (from `Tasks.Feature`) in both payload producers (`graph-to-planner.js`,
`sharepoint/export-to-planner.js`) and in `groupsFromPayload`. Sections already carry `feature`
and `templateItemId`.

### `+ Job`

- A Features fieldset under the build-type radio, rebuilt in `ncTypeChanged`: one checkbox per
  feature name found in that build type's template (optional sub-phases and tagged tasks), sorted
  by name, all unticked. Each label shows what it covers ("2 sub-phases, 9 tasks").
- With no features in the template the fieldset says "No optional features in the <type>
  template yet" and nothing else.
- Picks ride the pending create as `features` (array of names) through `confirmNewPoolRequest`,
  `buildPendingCreates`, `planCreates` (`web/writeback-core.js`), `createBody`
  (`web/graph-writeback.js`, sent as `Features` joined with `;`). The Pending table shows them.
  Each of the three hand-offs gets a test that the picks survive it.

### Hosted only

Feature picks on `+ Job` and the Features drawer exist only in the hosted planner. The `file://`
copy and the frozen console applier (`sharepoint/apply-planner-changes.js`) are not changed; in
file mode the Features fieldset says features can be picked in the hosted planner, and the
Features button is not shown, like Activate. (My call.)

### Features panel (live project)

Any PM may switch features, like any other schedule edit (Shane, 2026-10-22). No role gate.

A **Features** button on each SharePoint project row of the Jobs tab opens a drawer. Refused first
by `frozen(j)` and `stopForUnsaved`, as Activate is. (My call: Jobs tab only, not the Board.)

The drawer lists every feature in the project's build-type template plus any feature found on the
project's own rows that the template no longer has. For each:

| State | Meaning |
|---|---|
| On | at least one of its rows or tasks on the project is applicable |
| Off | the project has its rows or tasks and all are N/A |
| Not on this project yet | the project has none of its sub-phases and none of its tasks |

Each row shows what the feature covers on this project, and a switch.

**Turning a feature on:**
1. Sub-phases of the feature on the project: clear `skip`.
2. Tasks of the feature on the project whose note is the automatic reason: clear `na` and the note.
   A task N/A for any other reason stays N/A.
3. Template sub-phases of the feature the project lacks (by `TemplateItemId`): created over Graph
   as applicable rows, with their tasks (see Creates). Tasks of the new rows carrying a different,
   unpicked feature are created N/A with that feature's automatic reason.
4. Reflow, by the feature reflow rule below.

**Turning a feature off:**
1. Sub-phases of the feature: set `skip`.
2. Open tasks of the feature: set `na` with the automatic reason. Tasks already Done stay Done.
3. Reflow, by the feature reflow rule below, so the removed days come out of the schedule.

**A sub-phase with any Done task is not switched off.** Like signed work, it is left applicable
and reported ("6.4 has work done; mark it N/A by hand if it is not wanted"). Completed work does not
drop out of the schedule and the completion check because of a switch. (My call.)

**The switch confirms before it applies.** The drawer lists every sub-phase and task the switch
would change, each with a tick, all ticked. The PM can untick any of them. This protects a
sub-phase a PM marked N/A on purpose: sub-phases have no reason column, so the planner cannot tell
a deliberate N/A from a feature N/A on its own. (My call.)

**The feature reflow rule** (my call). Only sub-phase changes move dates: a sub-phase switched on,
created or switched off. Task changes never reflow. The walk starts at the first changed sub-phase
in `Sequence` order and runs `reflowFrom` with two additions:
- the cursor never starts before the next working day after today, so added work never lands in
  the past;
- any row that has already started (its start is before the next working day) is pinned like a
  locked row, whether or not it is signed. Work already under way or in the past is history and is
  not restacked.

So a feature added late runs from tomorrow, and only work that has not started yet shifts after it.
If the added sub-phase belongs earlier in the sequence than work already under way, it runs out of
order; Schedule Check reports that as it would any out-of-order row, which is accurate. Rows before
the first changed sub-phase are never touched.

**Signed work is never changed.** A sub-phase that SharePoint holds as installer-signed, and every
task under it, is left as it is. The drawer lists what it left and why ("4.1 is signed off; reopen
it to change its tasks"). The parent spec refused the whole switch in this case; this spec applies
what it can and reports the rest, because a late change order on a project well under construction
will nearly always meet some signed work. (My call.) A feature left partly applied shows as
**Partly on**.

**Writes go through the existing paths.** Sub-phase `skip` and dates go through the Save
allowlist and compare-before-write. Task `na` and note go through the sign-off/tick path
(`planTaskTicks`), which already writes `NotApplicable` and `Note` and already refuses task writes
under a signed sub-phase. **`planTaskTicks` compares only `Complete` and `NotApplicable` today**
(`writeback-core.js` ~L577); it gains a `Note` compare for N/A clears, so a write that clears the
automatic reason is refused if the live note is no longer that reason (a PM typed one on the site
since the last Refresh). Creates happen immediately in the drawer (they cannot wait for Save,
because Save matches by row id); everything else waits for Save, like any other edit.

**Change-order comment.** For each sub-phase whose row or tasks changed, the switch queues a
comment through the existing comment queue: `Change order: <Feature> added` or `removed`, sent on
Save, so it carries the PM's name and date like any comment. (My call; it replaces my earlier idea
of appending to `SignOffNotes`, which is not on any write path today.)

### Update from template

A section of the same drawer, **New in the template**: template sub-phases of the project's build
type whose row id is not among the project's `TemplateItemId`s, excluding optional sub-phases
(those are the Features section's job). Matching is by `TemplateItemId` only. The parent spec's
number-plus-name fallback is dropped: every live row was backfilled with `TemplateItemId` on
2026-10-21 and `D2 - New Pool` writes it since, and a number fallback would misfire against a
renumbered template such as Rev4.

The PM ticks lines to add; each is created applicable. Then the same reflow rule as turning a
feature on.

### Creates (`planStructureCreates` in `writeback-core.js`, `applyStructureCreates` in `graph-writeback.js`)

As in the parent spec, step 4 of "Update from template", with these settled:

- **Order:** `Sequence` is the midpoint between the project row before and after the line's place,
  where place is found by template `Sequence` among the project's rows that have a template id. A
  line past the last row gets last row + 1. If two creates fall between the same pair, they split
  the gap in template order.
- **Body:** `Title` `<job> · <num> <name>`, `JobLookupId`, `SubPhaseNumber`, `SubPhaseName`,
  `PhaseName`, `Skill`, `TemplateItemId`, `Feature` (optional rows only), `Sequence`,
  `TradeLookupId` when present, `Crew` `unassigned`, `DurationDays` from the template,
  `Locked`/`PMSignOff`/`InstallerSignOff` false, `NotApplicable` false, `TasksTotal` = task count,
  `TasksComplete` 0, `SuppressReconcileUntil` +10 min. Each task: `Title`, `AssignmentLookupId`,
  `Sequence`, `Complete` false, `Feature`, and `NotApplicable` + `Note` when it belongs to a feature
  that is off on this project.
- **Capture rule:** before writing the bodies, create one Assignment and one Task over Graph on a
  throwaway project and read the stored shape back (lookup ids, Choice, DateOnly, Number). Write the
  bodies from that capture into a fixture, never by hand.
- **After:** re-read that project only and rebuild it. `readAsgForJobs` returns Assignments only
  and `importFromD2Payload` works on a whole payload (it confirms unless `silent`, and replaces
  `S.templates` and the calendar when present), so a single-project path is new work: read the
  project's Assignments, its Tasks (by the existing chunked `taskUrls`) and its comments, build a
  one-job payload with `toPlannerPayload`, and run the per-job part of `importFromD2Payload`
  (factored out) against that job only, leaving templates, calendar and other projects alone. Then
  apply the reflow and any pending switch changes, and tell the PM to Save.
- **Retries:** each POST retries a 429 or 503 twice, honouring `Retry-After`, as `graphPageAll`
  does. A lost response that left a row behind is caught by the re-read, which shows the row.
- **Partial failure:** an Assignment created with some Tasks failed is reported by task name, with
  the note that they must be added on the SharePoint site (adding missing tasks is out of scope). The
  next open of the drawer shows the sub-phase as present, so nothing duplicates. Counter
  Reconciliation corrects `TasksTotal` overnight.

## Verification

- Harnesses, each assertion watched red under `fixtures/planner/mutate.py`, all added to
  `package.json` `npm test`:
  - `features.js`: the `+ Job` checklist from template data; picks reach the request body through
    each of the four hand-offs; the three states; on/off for sub-phases and tasks; the automatic
    reason is the only N/A cleared; Done tasks stay Done; signed work untouched and reported; the
    reflow never starts before the next working day; the comment queued per touched sub-phase.
  - `structure-create.js`: bodies equal the captured shape; Sequence placement including two
    creates in one gap; partial failure reported; a re-open after creation offers nothing again.
  - Template mapping: `templatesFrom` keeps the new fields (extend `graph-read.js` or
    `build-type.js`).
  - Re-run the full suite, the oracle and the shakedown (`--window-size=1600,1000`).
- Flow: `python flows/scripts/test_new_pool_task_features.py`, offline.
- Live, on throwaway Planned projects owned by D2 Bot, default crews off, rows read back after each
  step:
  1. Provision the two columns; read them back.
  2. Add a test feature `TEST feature` to the Gunite template: one optional sub-phase and one tagged
     task inside a standard sub-phase. Add one non-optional test line for Update from template.
  3. Raise `TEST-99xx` unpicked: the optional row is N/A and undated, the tagged task is N/A with
     the automatic reason. Raise a second with it picked: both applicable.
  4. On the first project: Features on, Save. Rows and the task read back applicable, dates set,
     one comment per touched sub-phase. Off again, Save: back to N/A with the reason.
  5. On a project created before the test lines (another throwaway created first): Features on
     creates the sub-phase and its tasks, placed in order; a tick on a new task lands on its row.
     Update from template creates the non-optional line; re-opening the drawer offers nothing.
  6. Remove the throwaways through Delete Pool Requests and the test template lines; read the
     tenant back to its starting counts.
- Deploy steps 2 and 4 with a `deploy/yyyy-mm-dd` tag and re-run the anonymous wall checks.

## Left to the builder

Drawer layout and wording beyond what is stated; how the Features button looks on the row; how
the coverage counts are phrased; harness structure; the order of the build tasks.
