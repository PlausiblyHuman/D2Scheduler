# 2026-10-27a: signed-tick hotfix, Calendar Sync off, Don's asks scoped

**Session goal:** build Shane's 23 October rule change (tick tasks under a signed sub-phase without
reopening) and ship it as a hotfix; then design the ghost calendar fix and scope Don's other asks.
All three done; the calendar design was recorded rather than built, because the calendar is not in
use and was switched off instead.

**Time:** 09:12–14:05 local, 1.25 h billable (D2). One gap 09:54–13:43 left unreviewed for Shane;
the evidence points to away (another contract active 77 min, "what's next?" on return).

**Files touched:**
- `web/writeback-core.js` (`isPlainTick`; `planTaskTicks` lets a plain tick through under a sign-off)
- `web/index.html` (drawer `lockedTick` and `checklistLocked`, the lock hint, "all" offered not "none",
  `unsavedWhere` counts a plain tick under a sign-off, Save results copy)
- `fixtures/planner/writeback-core.js`, `writeback-core.mutations.json` (+4), `signoff-push.js`,
  `signoff-push.mutations.json` (new, 11), `save-first.js`, `save-first.mutations.json` (13),
  `rejections.js`, `README.md`
- `docs/2026-10-27-don-asks-scope.md` (new)
- `CLAUDE.md`, this log

**Commits:**
- cc4d3c8 A plain tick lands under a signed sub-phase without a reopen
- 07a5d10 save-first harness: name its tasks after template lines so it runs on the live branch too
- 2b91a85, 93dc65e CLAUDE.md: hotfix shipped and the served build read back through the wall
- d844eeb CLAUDE.md: Calendar Sync switched off; ghost-event design recorded, not built
- 01a8d66 Scope note on Don's 10 October asks
- On `hotfix/signed-tick` (from `deploy/2026-10-23`): 259e217 (the cherry-pick), 8e350c8 (harness
  fix), tag `deploy/2026-10-27`; both pushed to origin and github

**Done:**
- Only a plain tick (to do to Done, task not N/A) passes under a sign-off; an untick or an N/A change
  still needs a reopen. One predicate, `isPlainTick`, shared by the write path, the drawer and the
  Save-first guard. Don's untick-tick-retick sequence now stops Activate with "Save first" and a Save
  clears it, which is correct. 4 core, 11 drawer and 13 save-first mutations all red.
- Shane ran the deploy (the permission classifier refuses production deploys through Desktop
  Commander too). Wall checks held; the served build was read back through the wall from the
  browser pane: `lockedTick`, `isPlainTick`, the new hint and results copy present, step 2 absent.
- `D2 - Calendar Sync` is `Stopped` (FlowAgent `disable_flow`, tenant asserted first, read back).
  Nobody at D2 opens the group calendar; Don works entirely in the planner. The ghost-event
  self-heal is designed in full under Phase G in CLAUDE.md (full sweep only, `categories` stamp,
  ceiling of 100, capture `categories` on a probe first) and deliberately not built.
- `docs/2026-10-27-don-asks-scope.md`: where each of Don's 10 October asks stands, the shape and
  size of delete/rename, notes per task, punch list (recommend items as one-day sub-phases through
  the existing create path) and PM-addable trades, the order, and five questions for Don.

**Decisions made:**
- A plain tick passes under a sign-off; unticks and N/A changes do not (Shane's 23 Oct rule, settled
  in the build). The canvas app keeps locking the whole checklist until crew leads come on.
- Calendar Sync off until a user asks for the calendar; ghost fix deferred with the design recorded.
- The scope note lives in the repo (`docs/`), the same home as the 21 October one.

**Open questions / blocked on:**
- Shane: tell Don the hotfix is live (draft in chat: reload the planner; tick under a signed
  sub-phase directly; unticking a saved task or changing N/A still needs the Installer un-tick and a
  save). Confirm the 09:54–13:43 gap as away, then post 1.25 h to TimeTrack (drafted below, not
  posted).
- Don: the five questions in the scope note, plus the standing ones (feature list, gas placement,
  trade mapping, Fiberglass crews, which jobs are Fiberglass, Harrison and Campos).
- The planner's Activate, Back to planning and Mark complete dialogs still mention the shared
  calendar; copy fix with the next deploy.

**TimeTrack draft (not posted):**
- Client notes: "Project managers can now tick checklist items under a signed-off sub-phase
  without reopening it; the fix is live. The shared calendar feed is paused until it is wanted, and
  the next round of requests is scoped with questions ready for Don."
- Internal: Session 7a0e072b · D2Scheduler · canvas-app-handoff · sessions/2026-10-27a-signed-tick-hotfix-calendar-off.md ·
  Commits cc4d3c8 07a5d10 2b91a85 93dc65e d844eeb 01a8d66 · Shipped deploy/2026-10-27 (hotfix/signed-tick) ·
  Tenant: D2 - Calendar Sync stopped · Decisions: plain tick only; calendar off · Blocked/next: Don's
  feature list, then steps 2 and 4 deploy · Time: 1.01 h Claude + 0 gap + 0 manual = 1.01 raw → 1.25 h
  in 2 blocks · Tokens: 2,546 in / 37,030,382 cached / 107,223 out · fable-5-1, opus-5-5 · subagents 0

**Next action:**
Get Don's optional-feature list and his answers to the scope note's five questions; then deploy steps
2 and 4 and start delete/rename.
