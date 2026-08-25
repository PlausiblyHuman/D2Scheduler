# 2026-08-25 · Week 2 kickoff — Sign-off Intake flow started

## Session goal

Start Week 2 automations. Sign-off Intake first (smaller walking-skeleton per prior recommendation) via Claude Chrome UI-driving in Power Automate.

## What landed

**Flow created + partially built** in D2 Automation env:

- Name: `D2 - Sign-off Intake`
- Type: Instant cloud flow
- Flow ID: `3e619659-850d-1b98-d552-93a63148e50d`
- URL: `https://make.powerautomate.com/environments/2710a01b-6cfa-e820-b338-2286f2649300/flows/3e619659-850d-1b98-d552-93a63148e50d?v3=true`
- Status: Saved. "Your flow is ready to go" banner shown.

**Configured:**
- Trigger: `When Power Apps calls a flow (V2)` with 5 inputs — all internal keys verified via Code view:
  - `number` (title: AssignmentID)
  - `date` (title: WorkDate)
  - `text` (title: Notes)
  - `number_1` (title: TasksTotal)
  - `number_2` (title: TasksComplete)
- Action 1: `SharePoint Get item`
  - Site Address: D2 Build Scheduler (`https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`)
  - List Name: Assignments
  - Id: dynamic content — AssignmentID from trigger
- SharePoint connection reference created and available in env (owner: stratirus@d2pools.com)

**Deferred (not yet built):**
- `SharePoint Update item` — Assignments has 7 required fields (Title, SubPhaseNumber, SubPhaseName, Locked, NotApplicable, PMSignOff, DurationDays) that must be preserved by binding to Get item outputs, plus 7 sign-off fields to set. 14 dynamic-content bindings × 5-10 clicks each = ~100 clicks. UI-drive economic call: hand off.
- `Respond to a PowerApp or flow` — Status + AssignmentTitle outputs.

## Decisions made

- **Update item pattern for D2:** every required field must be re-passed as-is from Get item outputs, or SP rejects with "field is required." Set required fields via `outputs('Get_item')?['body/<FieldInternalName>']`, then override the sign-off fields with trigger inputs + `utcNow()`. Documented for future flow builds against Assignments.
- **UI-drive economics threshold:** ~10 dynamic bindings is the point where click-driving Power Automate becomes economic. Beyond that, hand off to human keyboard-driven completion. Confirmed today.
- **Popup-blocker gotcha resolved.** Initial OAuth popup for SharePoint connection warns "browser has blocked the popup" but the connection actually establishes anyway (see the "Connected to SharePoint" indicator at the bottom of the connection panel). Ignore the warning; proceed.

## Gotchas discovered

- **PA v3 designer Update item exposes ALL list required fields** as parameters — every one must be filled or Save is greyed out. Not obvious to first-time flow authors.
- **Click drift** — Power Automate re-renders panels after every field change, shifting element positions by a few pixels. Screenshot-then-click-once-with-fresh-coords is the only reliable pattern; batched clicks that assume prior layout fail intermittently.
- **Chrome MCP popup blocker** is deterministic for OAuth connector auth flows. The popup opens outside the Chrome extension's tab-group scope. Symptom: red "Failed to create OAuth connection" banner. But — the connection often lands anyway despite the warning. Verify via "Connected to SharePoint" indicator instead of trusting the banner.

## Open items / blocked on

- **Finish Sign-off Intake in Shane's own browser** — the click-driven build cost is too high beyond this point. See exact field bindings below in Next action.
- **Test** manually via Test → I'll perform trigger action → AssignmentID=1, WorkDate=2026-08-31, Notes="test", TasksTotal=6, TasksComplete=6 → verify Assignment 1 gets `InstallerSignOff=Yes`.
- **Export** flow to `flows/exports/D2-SignoffIntake.zip` via Portal → Package (.zip) after test passes.

## Next action

Open the flow in Shane's regular browser (already signed in as stratirus@d2pools.com):
`https://make.powerautomate.com/environments/2710a01b-6cfa-e820-b338-2286f2649300/flows/3e619659-850d-1b98-d552-93a63148e50d?v3=true`

Add these two actions after Get item:

**Action 2 — SharePoint Update item:**
- Site Address: D2 Build Scheduler
- List Name: Assignments
- Id: `outputs('Get_item')?['body/ID']` (or dynamic content → Get item → ID)
- Title: `outputs('Get_item')?['body/Title']`
- SubPhaseNumber: `outputs('Get_item')?['body/SubPhaseNumber']`
- SubPhaseName: `outputs('Get_item')?['body/SubPhaseName']`
- Locked: `outputs('Get_item')?['body/Locked']`
- NotApplicable: `outputs('Get_item')?['body/NotApplicable']`
- PMSignOff: `outputs('Get_item')?['body/PMSignOff']`
- DurationDays: `outputs('Get_item')?['body/DurationDays']`
- Then Show all → set:
  - InstallerSignOff: `Yes` (true)
  - InstallerSignOffOn: `utcNow()` (expression)
  - WorkDate: `triggerBody()?['date']` (dynamic content → WorkDate)
  - SignOffNotes: `triggerBody()?['text']` (dynamic → Notes)
  - TasksTotal: `triggerBody()?['number_1']` (dynamic → TasksTotal)
  - TasksComplete: `triggerBody()?['number_2']` (dynamic → TasksComplete)

**Action 3 — Respond to a PowerApp or flow:**
- Add output: Text — Name: `Status`, Value: `Success`
- Add output: Text — Name: `AssignmentTitle`, Value: `outputs('Get_item')?['body/Title']`

Save. Test. Export.

## Files touched

- `sessions/2026-08-25-week2-flow-start.md` (this file) + `sessions/latest.md` (copy).
- No code files touched — flow lives in Power Automate cloud, not in repo yet. Will land in `flows/exports/` after test passes.
