# 2026-10-21a: Projects own their structure (steps 1 to 3)

**Session goal:** prepare for the 8:00 status meeting with Don on Fiberglass, then scope and build what
it turned into: templates and projects that Don can shape himself (gas phases, inserted phases,
optional features, change orders on live projects).

**Time:** 07:39 to 15:23 local, 3.00 h billable in 6 blocks (D2): 2.19 h hooks + 0.22 h reviewed gap
(the 08:00 to 08:13 meeting) + 0.00 h manual. Four other gaps reviewed as away. Not yet posted at the
time of writing. Tokens: 726 in / 149,321,655 cached / 2,434,072 cache-write / 190,804 out, 346
messages, claude-opus-5-5, 2 subagents (5,481,726).

**Files touched:**
- `docs/2026-10-21-flexible-templates-scope.md` (scope note: options, effort, band-aid path)
- `docs/specs/2026-10-21-projects-own-structure-design.md` (spec for B + C, approved)
- `sharepoint/provision-structure.js`, `sharepoint/stamp-structure.js` (new columns, backfill)
- `web/index.html`, `web/graph-to-planner.js`, `sharepoint/export-to-planner.js` (layout from a project's own rows)
- `fixtures/planner/project-structure.js` + two mutation files (new); `signoff-push.js`, `build-type.js`,
  `rejections.js`, `build-type.mutations.json`, `README.md` (updated for the new rule)
- `flows/scripts/new_pool_features.py`, `reschedule_skip_na.py`, `counter_recon_chunk.py`, their tests,
  and `2026-10-21-structure-flows.py`; `test_counter_recon_per_job.py`, `test_live_job_clause.py`
  (drift checks now compare the first export carrying their change)
- `flows/exports/*-2026-10-21.json` and `flows/exports/backups/*-pre-*.json`
- `CLAUDE.md`, this log

**Commits:**
- d4dcc7a Spec: projects own their structure, optional features and change orders
- 5908d16 Structure columns provisioned and 37 projects backfilled
- 1afc011 Planner lays SharePoint projects out from their own rows
- 6f4db9d Flows: optional features in New Pool, N/A skip in Reschedule, chunked task reads in Counter Reconciliation
- 317ca38 Flow exports after the 2026-10-21 changes; drift checks compare the first export carrying each change
- 3107645 CLAUDE.md: structure step 3 live and verified; Dataverse via browser session; Azure CLI installed

**Done:**
- Meeting: transcript read from the downloaded `.docx` (Graph transcript access is off in the Tennetech
  tenant; the downloaded recording was a 15-second stub). Don's asks: gas rough-in, inspection and
  hookup on both pool types; insert phases with numbering that follows; optional features picked per
  project; change orders on live projects (Traditions); template changes reaching existing projects.
- Step 1, live: 8 columns provisioned; template `Skill` on 91 rows; `PhaseName`, `Skill`,
  `TemplateItemId` stamped on all 1,701 Assignments of 37 projects, 0 unmatched, 0 mismatches,
  cross-checked by read-back.
- Step 2, built and tested, not deployed: the planner rebuilds each SharePoint project from its own
  rows on every Refresh. Suite 31/31, oracle 15/16, shakedown 48/48, 15 mutations red.
- Step 3, live and verified: New Pool optional features (N/A, undated, schedule unchanged), Reschedule
  skips N/A, Counter Reconciliation reads tasks 46 ids at a time. Verified on TEST-9910/9911 with a
  temporary template line; everything removed and the tenant read back at 37 / 1,701 / 10,868.
- Azure CLI 2.91.0 installed and signed in to D2.

**Decisions made:**
- Fiberglass "up and running" became flexible templates and projects: each project lays out from its
  own rows, optional features are named groups, and template changes reach an existing project only
  when a PM opts in.
- Deploying step 2 waits for step 4, so Don gets one change.
- A bulk write leaves Event-Driven Reconciliation on and carries the suppression stamp; turning a
  polling-triggered flow off only postpones its runs.

**Open questions / blocked on:**
- Budget for step 4: October had about 7 hours left as of 10-11, before today.
- Don: where the three gas phases go, his list of optional features, and the open Fiberglass
  questions (crews, durations, which jobs are Fiberglass, Harrison and Campos).
- Restart the Claude desktop app so FlowAgent can use the Azure CLI.
- The re-anchoring session (eight stale mutation anchors) is still working on branch
  `claude/nifty-lovelace-cd3a91`; not merged here.
- Don must not edit or renumber the templates until step 4 is live.

**Next action:**
Build step 4 (the `+ Job` features checklist, the features panel on a live project, and Update from
template), then deploy steps 2 and 4 together.
