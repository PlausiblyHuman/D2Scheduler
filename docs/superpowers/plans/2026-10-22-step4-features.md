# Step 4: optional features and Update from template, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PMs pick optional features on `+ Job`, switch them on or off on a live project at any
time (sub-phases and tagged tasks together, creating missing sub-phases), and add new template
sub-phases to a project by template row id.

**Architecture:** Pure decision logic in a new UMD module `web/features-core.js` (no DOM, no I/O),
create planning in `web/writeback-core.js`, Graph POSTs in `web/graph-writeback.js`, UI and
orchestration in `web/index.html`. One flow change in `D2 - New Pool` for task-level features.
Sub-phase and task state changes reuse the existing Save paths; only creates write immediately.

**Tech Stack:** vanilla JS single page (`web/index.html`), Microsoft Graph, SharePoint REST from the
browser console, Power Automate (Dataverse `clientdata` PATCH + `PublishXml`), Node + jsdom
harnesses, Python builders for flows.

**Spec:** `docs/specs/2026-10-22-step4-features-design.md` (extends
`docs/specs/2026-10-21-projects-own-structure-design.md`). Read both.

## Global Constraints

- Automatic N/A reason, exact text: `` `${featureName} not on this project` `` (featureName as
  written in the template). The only N/A note any code path may clear.
- Change-order comment text, exact: `Change order: <featureName> added` / `Change order: <featureName> removed`.
- Feature identity: `name.trim().toLowerCase()`. Sub-phase feature name = `Feature` if non-blank,
  else `Title` when `Optional` is true; else none. Task feature name = `Feature` if non-blank; else none.
- New columns: `Task Template.Feature`, `Tasks.Feature` (Text, 255, not required). Nothing else.
- Hosted only: no feature UI when `graphModeAvailable()` is false. `sharepoint/apply-planner-changes.js` is not edited.
- Every Assignments create carries `SuppressReconcileUntil` = now + 10 min; Tasks and comments never do.
- Signed work (SharePoint `InstallerSignOff` true) and every task under it never change because of a switch.
- Live tests only on throwaway Planned projects owned by D2 Bot (site user 7), default crews off;
  never on Don's 37 projects. Assert tenant `f24d9b39-…` / `stratirus@d2pools.com` before any write.
- No em dashes in code comments, copy, docs or commit messages. No AI mentions in commits beyond the trailer.
- Every new harness assertion is watched red under `fixtures/planner/mutate.py` with a mutations
  file next to the harness; new harnesses join `package.json` `npm test`.

## Review Focus

1. A feature name differing only in case or spacing between a sub-phase and a task (`Auto Cover` vs
   `auto cover `) must be one feature, not two rows in the drawer. Test in Task 3.
2. A project with an optional sub-phase whose template line has since been deleted: the feature must
   still be listed (from the project's own rows) and switchable. Test in Task 3.
3. Two creates landing in the same gap, and a create past the last row, must get strictly
   increasing `Sequence` values that sit between their neighbours. Test in Task 6.
4. Switching a feature on when the project's previous applicable row has no start date (an undated
   project): the reflow starts at the floor (next working day), never NaN or null. Test in Task 4.
5. A switch applied, then the drawer reopened before Save: the state shown must reflect the pending
   on-screen change (Off after switching off), and switching back must restore the original values
   so nothing is sent. Test in Task 9.

---

### Task 1: Provision the two Feature columns (live)

**Files:**
- Create: `sharepoint/provision-task-feature.js` (copy of `provision-structure.js` pattern, `WANT` = `{'Task Template': [['Feature', text]], 'Tasks': [['Feature', text]]}`, Tasks.Feature hidden on New/Edit as the Assignments columns are)

- [ ] **Step 1:** Write the script; `node --check sharepoint/provision-task-feature.js` exits 0.
- [ ] **Step 2:** Assert the tenant (m365-tenant-guard skill). Run it on the site with `window.D2_DRY=true`: report lists both columns as to-create.
- [ ] **Step 3:** Run for real. Read back `fields?$filter=InternalName eq 'Feature'` on both lists: each returns one Text field; Tasks' field has `ShowInNewForm`/`ShowInEditForm` false in `SchemaXml`.
- [ ] **Step 4:** Commit `sharepoint/provision-task-feature.js` ("Task Template and Tasks Feature columns provisioned").

The route to the site is whatever browser route works this session (chrome-devtools MCP attached to
a signed-in browser, or the built-in browser pane). Check `/_api/web/currentuser` first.

### Task 2: `D2 - New Pool` writes task features

**Files:**
- Create: `flows/scripts/new_pool_task_features.py`, `flows/scripts/test_new_pool_task_features.py`, `flows/scripts/2026-10-22-new-pool-task-features.py`
- Output: `flows/exports/D2-New-Pool-2026-10-22.json`, `flows/exports/backups/D2-New-Pool-pre-task-features.json`

**Interfaces:** builder exposes `apply(definition: dict) -> dict` like `new_pool_features.py`; the driver follows `2026-10-21-structure-flows.py` (build from live clientdata, assert it equals the newest export, back up, PATCH, `PublishXml`, read back and compare).

- [ ] **Step 1: Write the failing test** `test_new_pool_task_features.py` against `flows/exports/D2-New-Pool-2026-10-21.json`:
  - `Apply_to_each_task` contains `Compose_task_is_na` with `runAfter {}` and `Create_task` runs after it.
  - The expression reads `coalesce(items('Apply_to_each_task')?['Feature'], '')`, trims and lowercases it, and tests `contains(body('Select_features'), ...)` (same pick array the sub-phase check uses).
  - Rendering the `Create_task` body template for three cases (no feature; feature picked; feature unpicked named `Auto "Cover"`) and parsing each as JSON gives: `Feature` = the name verbatim (quote escaped then unescaped by the parser), `NotApplicable` false/false/true, and `Note` absent/absent/`Auto "Cover" not on this project`.
  - `apply()` is idempotent (second run changes nothing).
- [ ] **Step 2:** `python flows/scripts/test_new_pool_task_features.py` fails (module missing).
- [ ] **Step 3:** Implement `apply()`. Escape every interpolated string with the existing `replace(replace(x,'\','\\'),'"','\"')` idiom. Write `NotApplicable` as an unquoted `@{if(...,'true','false')}` and `Note` only inside the N/A branch (one body string built with `if()`).
- [ ] **Step 4:** Test passes; the four existing `test_new_pool_*.py` still pass.
- [ ] **Step 5:** After Task 1, run the driver live (tenant asserted, `az` pinned to D2). Read back: published `clientdata` contains `Compose_task_is_na`; export written; drift check vs the export passes.
- [ ] **Step 6:** Commit the three scripts, the export and the backup.

### Task 3: `web/features-core.js`, feature model (pure)

**Files:**
- Create: `web/features-core.js` (UMD as `writeback-core.js`: `module.exports` under Node, `window.D2FeaturesCore` in the page)
- Modify: `web/index.html` (add `<script src="features-core.js"></script>` after `graph-writeback.js`)
- Test: `fixtures/planner/features-core.js`, `fixtures/planner/features-core.mutations.json`

**Interfaces (Produces):**
- `featureKey(name: string): string` (trim, lowercase; `''` for blank)
- `autoReason(name: string): string`
- `secFeatureName(tplSec): string|null` per the Global Constraints rule (`tplSec.optional`, `.feature`, `.name`)
- `templateFeatures(tpl): Feature[]` where `tpl` is the `S.templates[type]` shape after Task 5 and
  `Feature = {key, name, secs: [{tplId, num, name, seq}], tasks: [{tplSecId, secNum, title, seq}]}`, sorted by `name`. The display `name` is the first spelling met in template order.
- `projectFeatures(groups, tpl): ProjectFeature[]`, `ProjectFeature = Feature & {state: 'on'|'off'|'partly'|'absent', rows: [{gi, si}], taskRefs: [{gi, si, ti}]}`. Rows: project sections whose `feature` key matches; taskRefs: tasks whose `feature` key matches. Features present on the project but not in `tpl` are included with empty `secs`/`tasks`.
  - `on`: some row has `!skip` or some task has `!na`, and nothing is in the opposite state; `off`: rows or tasks exist and all are N/A; `partly`: both applicable and N/A among them; `absent`: no rows and no tasks.
- `missingTemplateLines(groups, tpl): [{tplId, num, name, seq}]`: non-optional template sections whose `id` is not among the project's `templateItemId`s.

- [ ] **Step 1: Write the failing tests** (Node, `require('../../web/features-core.js')`), with an inline template of: optional sec `6.4 Auto Cover Rough In` with Feature `Auto Cover`, task `Auto Cover Layout` tagged `auto cover ` in plain sec 1.4, optional sec `6.6 Water Feature and Veneers` with Feature blank (so its feature name is its title), plain new sec `7.4 Gas Line` (id 900):
  - `templateFeatures` returns 2 features: `Auto Cover` (1 sec, 1 task; Review Focus 1) and `Water Feature and Veneers` (1 sec).
  - `projectFeatures` states: all rows/tasks applicable → `on`; all N/A → `off`; mixed → `partly`; none present → `absent`.
  - A project section carrying feature `Fire Pit` with no template line → listed, state from its row (Review Focus 2).
  - `missingTemplateLines` returns `[{tplId:900,...}]` when the project lacks 900 and never returns an optional section.
  - `autoReason('Auto Cover') === 'Auto Cover not on this project'`.
- [ ] **Step 2:** `node fixtures/planner/features-core.js` fails (module missing).
- [ ] **Step 3:** Implement the five functions.
- [ ] **Step 4:** Passes. Mutations file covers: key not lowercased, key not trimmed, task tags ignored, absent features from rows dropped, optional lines leaking into `missingTemplateLines`, `partly` collapsed to `on`. `python fixtures/planner/mutate.py fixtures/planner/features-core.js web/features-core.js` all red.
- [ ] **Step 5:** Commit.

### Task 4: Switch planning and the feature reflow (pure + `reflowFrom` options)

**Files:**
- Modify: `web/features-core.js`, `web/index.html` (`reflowFrom` ~L697)
- Test: `fixtures/planner/features-core.js` (extend), `fixtures/planner/rules.js` (extend), their mutations files

**Interfaces:**
- Consumes: Task 3.
- Produces: `planSwitch(groups, tpl, key, on: boolean): SwitchPlan` with
  `SwitchPlan = {secs: [{gi, si, skip, label}], tasks: [{gi, si, ti, na, note, label}], creates: [{tplId, num, name}], left: [{gi, si, num, reason: 'signed'|'done'|'pm-na'}], firstSec: {gi, si}|null}`.
  Uses `s.base.inst` (SharePoint's signed state, not the on-screen tick) for "signed".
  - On: rows of the feature with `skip` → `skip:false` (unless signed); tasks with `na` whose `note === autoReason(name)` → `na:false, note:''` (unless their section is signed); tasks N/A with any other note → `left` reason `pm-na`; template `secs` whose `tplId` is not on the project → `creates`.
  - Off: applicable rows → `skip:true` unless signed (`left: signed`) or any task `done` (`left: done`); open tasks (`!done && !na`) → `na:true, note:autoReason(name)` unless section signed; done tasks untouched.
  - `firstSec`: the earliest (by `allSecs` order) section in `secs`; null when only tasks changed (task changes never reflow).
- `reflowFrom(jobId, gi, si, fromDate, opts)` gains `opts = {floor?: 'yyyy-MM-dd', pinStarted?: boolean, fromPrev?: boolean}`:
  - `fromPrev`: cursor starts at the working day after the nearest earlier non-skip row that has a start; if none, at `floor` or today.
  - `floor`: cursor = max(cursor, nextWork(floor)).
  - `pinStarted`: any row whose `start` is earlier than `floor` is treated like a locked row (left, but pushes the cursor if it ends later).
  - Existing callers pass no `opts` and behave exactly as before.

- [ ] **Step 1: Failing tests.** `features-core.js`: on/off for a feature spanning one optional row and two tagged tasks; signed row left with reason `signed` and its tasks untouched; row with a done task left `done` on Off; done task untouched on Off; PM-reasoned N/A task left `pm-na` on On; missing template sec in `creates`; `firstSec` null for a tasks-only feature. `rules.js`: with `floor` = 2026-10-23, `pinStarted`, `fromPrev`: a re-enabled row after a row ending 2026-08-10 starts 2026-10-23 (floor wins); a later row with start 2026-09-01 (already started) is not moved; a later row starting 2026-11-30 moves to follow; an undated project starts at 2026-10-23 (Review Focus 4); calling `reflowFrom` without `opts` gives the same result as before on the existing `rules.js` cases.
- [ ] **Step 2:** Run both; new cases fail.
- [ ] **Step 3:** Implement `planSwitch` and the three `reflowFrom` options.
- [ ] **Step 4:** Both pass; mutation sweeps red (signed check reads on-screen `inst`; auto-reason compare dropped; done tasks flipped on Off; floor ignored; pinStarted ignored; fromPrev using the row's own start).
- [ ] **Step 5:** Commit.

### Task 5: Template and task feature data through the read path

**Files:**
- Modify: `web/graph-to-planner.js` (`templatesFrom` L124, project task mapping ~L281), `web/index.html` (`tplFromPayload` L358, `groupsFromPayload` L374, import overlay ~L2321), `sharepoint/export-to-planner.js` (Tasks `$select` add `Feature`; Sub-phase Template `$select` add `Optional,Feature`; Task Template `$select` add `Feature`, and the same template fields in its mapping)
- Test: `fixtures/planner/graph-read.js` + `graph-read.g2p-mutations.json`, `fixtures/planner/project-structure.js` + mutations

**Interfaces (Produces):** template section `{id: number, seq: number, optional: boolean, feature: string|null (resolved feature name), tradeId: string|null, num, name, skill, days, tasks: string[], taskSeq: number[], taskFeature: (string|null)[]}`; `tplFromPayload` copies the new keys; `mkJobGroups` ignores them. Project task `{t, done, na, note, spId, feature: string|null}`.

- [ ] **Step 1: Failing tests.** `graph-read.js`: a synthetic spt/tpt set (one optional row with blank Feature, one with Feature `Spa`, a task with `Feature` and one without) maps to the shape above, `feature` resolved per the rule, `tasks` still plain strings in Sequence order and `taskFeature` aligned. `project-structure.js`: a payload task with `feature:'Spa'` lands as `t.feature==='Spa'`; a template section's `id`/`optional` survive `tplFromPayload`.
- [ ] **Step 2:** Fail. **Step 3:** Implement (connector-style null omission: treat missing `Feature`/`Optional` as blank/false). **Step 4:** Pass; sweeps red; `npm test` green. **Step 5:** Commit.

### Task 6: Structure creates (capture first, then plan and apply)

**Files:**
- Create: `fixtures/planner/structure-capture.json` (captured stored shapes), `fixtures/planner/structure-create.js`, `fixtures/planner/structure-create.mutations.json`
- Modify: `web/writeback-core.js` (`planStructureCreates`), `web/graph-writeback.js` (`applyStructureCreates`)

**Interfaces (Produces):**
- `planStructureCreates({job: {jobno, spId}, rows: [{id, seq, templateItemId}], tplSecs: [{id, seq, num, name, phase, skill, tradeId, days, feature, tasks, taskSeq, taskFeature}], offFeatureKeys: string[], nowMs}) -> {creates: [{asg: fields, tasks: [fields]}], refusals: [{tplId, reason: 'already-present'}]}`.
  - `Sequence`: for each new line, `prev` = the project row with the greatest template seq below the line's template seq, `next` = the following project row; value = midpoint of their `seq`; past the last row, last `seq` + 1; several new lines in one gap divide it evenly in template order (Review Focus 3).
  - `asg` fields exactly as the spec's Creates body, values as captured (lookup ids as strings, `TemplateItemId` number, Choice as plain string); `Feature` only when the template line is optional.
  - task fields: `Title`, `AssignmentLookupId` (filled at apply time), `Sequence`, `Complete:false`, `Feature` when tagged, plus `NotApplicable:true` and `Note: autoReason(name)` when its feature key is in `offFeatureKeys`.
- `applyStructureCreates(plan, {token, siteId, asgListId, tasksListId, fetchImpl, sleep}) -> {created: [{tplId, asgId, taskIds}], failed: [{tplId, stage: 'asg'|'task', title?, status}]}`. POST Assignment, then its tasks in order; a 429/503 retries twice honouring `Retry-After` (seconds; default 2); a failed Assignment skips its tasks; a failed task is recorded and the rest continue.

- [ ] **Step 1: Capture (live, before any body code).** On throwaway `TEST-9920` (Task 10 Step 1 raises it; do that first if not yet done), from the hosted planner page with its own `graphToken()`/`graphSite()`, POST one Assignment and one Task with the candidate bodies, GET both back with `$expand=fields`, save the request bodies and the read-back `fields` (ids redacted to placeholders) to `structure-capture.json`, then DELETE both rows and confirm a 404 on re-read.
- [ ] **Step 2: Failing tests** in `structure-create.js` (Node require of both modules, stub `fetchImpl`): bodies equal the captured request bodies field for field; Sequence placement incl. two-in-one-gap and past-the-end; a `templateItemId` already on the project is refused `already-present`; off-feature task gets N/A + reason; a 429 then 201 succeeds with 2 calls; a task 500 is reported by title while later tasks still post; an Assignment 500 posts no tasks; Assignment POSTs carry `SuppressReconcileUntil`, task POSTs never do.
- [ ] **Step 3:** Fail. **Step 4:** Implement. **Step 5:** Pass; sweep red. **Step 6:** Commit.

### Task 7: `planTaskTicks` compares `Note` on N/A clears

**Files:** Modify `web/writeback-core.js` (~L577); Test `fixtures/planner/writeback-core.js` + its mutations.

- [ ] **Step 1: Failing test:** a task loaded `na:true, note:'Spa not on this project'`, to `na:false`; live row has `NotApplicable:true, Note:'Client deferred'` → refused `diverged` with `nowLive.note`; same with live `Note` equal to the loaded note → written. A done tick on a never-N/A task with a differing live Note still writes (compare applies to N/A clears only).
- [ ] **Step 2:** Fail. **Step 3:** In the compare, when `t.from.na && !t.to.na`, also require `String(live.Note||'') === String(t.from.note||'')`. **Step 4:** Pass; existing `writeback-core.js`, `signoff-push.js` green; sweep red. **Step 5:** Commit.

### Task 8: `+ Job` feature picks

**Files:** Modify `web/index.html` (`addJob` L1846, `ncTypeChanged` L1840, `confirmNewPoolRequest` L1901, `buildPendingCreates` L2448, Pending table in `vJobs` ~L1451), `web/writeback-core.js` (`planCreates` L199), `web/graph-writeback.js` (`createBody` L116); Test `fixtures/planner/build-type.js` + `build-type.mutations.json`.

**Interfaces:** pending create gains `features: string[]` (display names); `planCreates` output gains `features: string[]` (trimmed, blanks dropped, de-duplicated by `featureKey`); `createBody` adds `Features: features.join(';')` only when non-empty.

- [ ] **Step 1: Failing tests:** with a Gunite template carrying two features, `addJob()` renders a `#ncFeatures` fieldset with two unticked checkboxes labelled with name and coverage (`1 sub-phase, 1 task`); switching the radio to Fiberglass (no features) shows `No optional features in the Fiberglass template yet`; ticking one and queuing puts `features:['Auto Cover']` on the pending create; `buildPendingCreates`, `planCreates` and the POST body each carry it (`Features: 'Auto Cover'`); no picks → no `Features` key in the body; in file mode (`graphModeAvailable` false) the fieldset reads `Features can be picked in the hosted planner` and the pending create has `features: []`.
- [ ] **Step 2:** Fail. **Step 3:** Implement using `D2FeaturesCore.templateFeatures(templateFor(type))`. **Step 4:** Pass; sweep red (one mutation per hand-off). **Step 5:** Commit.

### Task 9: Single-project refresh

**Files:** Modify `web/index.html`: factor the per-job body of `importFromD2Payload` (the `plan.forEach(({inj,existing})=>{...})` block, L2273 to ~L2364) into `applyJobPayload(j, inj)` with no behaviour change; add `async refreshOneProject(j)`. Test: `fixtures/planner/features.js` (new, jsdom, boot as `build-type.js` plus inlining `features-core.js`) + `features.mutations.json`.

**Interfaces (Produces):** `refreshOneProject(j: Job): Promise<boolean>`: reads that Jobs row (`/items/{j.spId}?$expand=fields`), its Assignments (`R.asgUrl`), Tasks (`R.taskUrls`, `TASK_CHAIN_MAX`), comments for those assignments, and New Pool Requests (for `building`); builds a one-job payload with `R.toPlannerPayload`; runs `applyJobPayload(j, payload.jobs[0])`; leaves `S.templates`, the work calendar and other jobs untouched; returns false (and leaves `j` as it was) on any read failure.

- [ ] **Step 1: Failing tests:** stubbed Graph with two projects; after a stub adds a row to project A, `refreshOneProject(A)` shows the new section with its task `spId`s, project B and `S.templates` are identical objects to before, and no `confirm` was called. A 500 on the Tasks read returns false and leaves A unchanged. The full suite still passes after the refactor (no behaviour change in `importFromD2Payload`).
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; `npm test` green; sweep red. **Step 5:** Commit.

### Task 10: Features drawer on the Jobs tab

**Files:** Modify `web/index.html` (Jobs row action cell ~L1522: `Features` button for SharePoint projects with a baseline, hosted only, not `frozen`; new `openFeatures(jobId)`, `applyFeatureSwitch(jobId, key, on)`, `addTemplateLines(jobId)`; a `queueEntryFor(j, s, kind, body)` beside `queueEntry` L1680 that `queueEntry` then calls). Test: `fixtures/planner/features.js` + mutations.

**Behaviour (from the spec, nothing new):**
- `openFeatures`: `frozen(j)` and `stopForUnsaved` refuse first. Lists `projectFeatures(j.groups, templateFor(j.buildType))` with state and coverage, a switch per feature, then a **New in the template** list from `missingTemplateLines` with checkboxes.
- Pressing a switch shows the confirm list from `planSwitch`: every sec and task change ticked, `left` items listed with their reason sentence, `creates` listed. Apply runs: creates first (`applyStructureCreates`, then `refreshOneProject`; failures shown by name with "add them on the SharePoint site"), then the ticked sec/task changes on screen, then `reflowFrom(jobId, firstSec.gi, firstSec.si, null, {floor: nextWork(addCal(todayStr(),1)), pinStarted: true, fromPrev: true})` when `firstSec` is set (for creates, the first created section after refresh), then one comment per touched section via `queueEntryFor`, then `touch(j)`, `save()`, `render()`, and a line telling the PM to press Save.
- Reopening the drawer reads the on-screen state, so a pending Off shows Off; switching it back On restores the original values and `divergedSecs`/`buildSignoffSet` send nothing for it (Review Focus 5).
- Comments are not queued twice for the same section in one switch.

- [ ] **Step 1: Failing tests** (stubbed Graph): Off on a feature with one row and two tasks → row `skip`, tasks N/A with the auto reason, `divergedSecs` has `NotApplicable`, `buildSignoffSet` has the two task N/As with the note, two comments queued `Change order: Auto Cover removed`; signed row untouched and its reason shown; On on an absent feature → two POSTs (asg, task), refresh, new section applicable and placed by Sequence, reflow starts no earlier than tomorrow, rows already started unmoved; unticking an item in the confirm list leaves it unchanged; Off then On before Save → no diffs; Update from template on line 900 → one asg POST + its tasks, then the line no longer listed; `Features` button absent when `graphModeAvailable()` is false or the project is `building`.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; full suite, oracle, shakedown (`--window-size=1600,1000`) green; sweep red. **Step 5:** Commit.

### Task 11: Live verification on throwaway projects

All writes through the hosted or local-served planner signed in as D2 Bot, rows read back after each step. Tenant asserted first. Use `http://localhost:8787` serving `web/` for the new code (registered redirect URI), since the hosted site still runs the old build.

- [ ] **Step 1:** Raise `TEST-9920` (Gunite, PM D2 Bot, default crews off, no features) before any test template line exists. Wait for `Done`.
- [ ] **Step 2:** Add to the Gunite template: optional sub-phase `9.8 TEST feature step` (Feature `TEST feature`, Sequence 21.5, 2 tasks), a task tagged `TEST feature` in the template's 3.7 sub-phase, and a plain sub-phase `9.9 TEST plain step` (Sequence 30.5, 1 task). Record their ids.
- [ ] **Step 3:** Raise `TEST-9921` (no features) and `TEST-9922` (`TEST feature` picked). Read back: 9921's 9.8 N/A, undated, its tagged 3.7 task N/A with `TEST feature not on this project`; 9922's both applicable and dated.
- [ ] **Step 4:** On 9921, Features → TEST feature On → Save. Read back: 9.8 applicable and dated no earlier than tomorrow, tagged task applicable with empty Note, comments on 9.8 and 3.7. Then Off → Save: back to N/A with the reason.
- [ ] **Step 5:** On 9920 (predates the lines): TEST feature On creates 9.8 and its tasks (no 3.7 task, by design), placed between its neighbours; tick one new task, Save, it lands on its row. Update from template offers only 9.9; add it; reopen: nothing offered.
- [ ] **Step 6:** Remove all three projects through Delete Pool Requests (`OverrideSignedOff` if needed), delete their request rows, delete the three test template sub-phases and their tasks. Read the tenant back to the starting counts recorded before Step 1 (projects, Assignments, Tasks, template 91/543).
- [ ] **Step 7:** Commit any fixture or script changes the live run forced, with the reason in the message.

### Task 12: Deploy and record

- [ ] **Step 1:** Confirm with Shane before deploying (client-visible). Then deploy `web/` with the SWA CLI (CLAUDE.md "THE PLANNER IS HOSTED"), tag `deploy/2026-10-2x`, push the tag.
- [ ] **Step 2:** Re-run the anonymous wall checks: `/`, `/index.html`, `/features-core.js`, `/robots.txt`, a nonsense path all 302 to `/.auth/login/aad`; `/auth-redirect.html` 200; `/.auth/login/github` 404.
- [ ] **Step 3:** Update CLAUDE.md (step 4 live, the two columns, the flow change, the drawer, what is not covered) and commit.
