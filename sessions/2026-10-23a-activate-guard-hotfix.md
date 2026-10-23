# 2026-10-23a: Activate guard hotfix, hardening, step 4 verified

**Session goal:** pick up step 4 and deploy it. The deploy was held for Don's feature list; the day
went to step 4's live check (done by the parallel "Dev 10/22/26" session), three hardening fixes,
and a hotfix for Don being unable to activate any project.

**Files touched:**
- `web/index.html`: `save()` survives a full localStorage; `unsavedWhere` ignores task changes Save
  can never land
- `fixtures/planner/freshness.js`, `freshness.mutations.json` (new), `save-first.js`,
  `save-first.mutations.json`, `board-controls.mutations.json`, `job-order.mutations.json`,
  `project-structure.mutations.json`
- `flows/scripts/new_pool_escape_jobnumber.py`, its test, driver `2026-10-23-new-pool-escape-jobnumber.py`
- `CLAUDE.md`, this log
- From the parallel session (10-22 evening to 10-23 morning): the whole of step 4, see `afee695`

**Commits (this session):**
- b56741c Re-anchor stale mutation checks so every anchor lands again
- 17a3b53 Planner keeps working when the browser's local storage is full
- 10ea4a2 New Pool: escape the job number and the result messages (builder, test, driver)
- 11a68ed Ticks Save can never land no longer block Activate (branch `hotfix/activate-guard`, tag `deploy/2026-10-23`)
- 4a4699a the same, cherry-picked onto `canvas-app-handoff`
- 17 step 4 commits from 10-22 pushed at the start (they were only on this machine), plus `6f64ba5`
  and `afee695` from the parallel session, pushed later

**Done:**
- Don could not activate `25-2061 F` or `26-2041`: 45 signed sub-phases of 25-2004 carried task
  ticks that Save refuses under a signed row, and the guard counted them on every project. Fixed,
  verified on live data, deployed as a hotfix on the live build. Don told to reload and Refresh.
- Step 4 live check finished by the parallel session; tenant back to 37 jobs, templates 91/543,
  proxy flow deleted.
- FlowAgent now sees the Azure CLI (the restart item is closed).
- `D2 - New Pool` job-number fix published (I ran the driver; the permission check blocks live
  publishes from the session). Export `D2-New-Pool-2026-10-23.json`, no-drift check green.
- GitHub shadow set up: `PlausiblyHuman/D2Scheduler`, remote `github`.
- Fiberglass phases renumbered 0 to 10 (8.x Startup and Trim Out, 9.x Site Restoration, 10.x Post
  Construction): template and both Fiberglass projects, 45 rows, run by me from the planner console
  with `sharepoint/renumber-fiberglass-2026-10-23.js`; generator, data files and seed follow it.
- Don built `25-2061 F` (Fiberglass, his first) and saved 147 sign-offs across four projects today;
  every flow run succeeded.

**Decisions made:**
- October hours over the 20 included are goodwill.
- Steps 2 and 4 deploy when Don's optional-feature list arrives, not before.
- Urgent fixes ship as hotfixes on the live build while held work sits on the branch.
- A PM can tick tasks under a signed sub-phase without reopening it (rule change, not built).
- Fiberglass durations stay 2 days; PMs fix the template later.
- Fiberglass renumbering decided by us rather than waiting on Don: the sheet's split of Electrical
  out of Plumbing was never carried through, so phases follow the sheet's order, 0 to 10.
- The Gunite template target is Amy's Rev4 (not Rev3), loaded once her questions are answered.

**Open questions / blocked on:**
- Don (I'm calling him): optional-feature list; where the three gas phases go; crews for the 20
  unassigned Fiberglass sub-phases; which existing jobs are Fiberglass; Harrison and Campos coming
  off; and the Fiberglass renumbering heads-up.
- Amy: her Rev4 questions are not recorded in the repo; find them or draft them from the mapping.
- Ghost calendar events: has anyone seen one? Needs a short design before any code.
- Don called and we missed each other; nothing found wrong on the system side.
- The idle re-anchor worktree (`nifty-lovelace-cd3a91`) and its session can be archived.

**Next action:**
Build "tick tasks under a signed sub-phase without reopening", then design the ghost calendar fix
and write the scope note on Don's other asks (delete/rename, notes per checklist item, punch lists).
