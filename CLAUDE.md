# CLAUDE.md — D2Scheduler

Durable orientation for any Claude session working in this repo.

---

## What this is

Pool construction scheduling and field sign-off system for D2 Pools. SharePoint Lists + Power Automate + Teams + a Power Apps canvas app for crew-lead task-tick, running entirely on D2's existing M365 subscription with zero incremental licensing. Replaces a browser-based prototype (`D2-Build-Scheduler/app/pool-scheduler.html`) originally built by Ryan Meyer under his Tennetech brand; Stratirus took over full delivery ownership.

Client-facing name: **D2 Build Scheduler**.

Site URL: `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler` (site created 2026-08-22; lists NOT yet provisioned — see Known bugs).

## Owner / stakeholders

- **Stratirus owner:** Shane Talbot (stalbot@stratirus.com)
- **Client owners at D2:** David Taylor (david@d2pools.com), Don Borgeson (don@d2pools.com) — both on Business Premium
- **Client office/PM:** Amy Stevens, Carolyn Morris, Cody Campbell, Daniel Morris, Emon Alexander, Tyler Huisman — all on Business Standard
- **Field crew leads (~10):** currently unlicensed. Canvas app requires Business Basic ($6/user/mo) added for them, OR Forms-fallback UX with existing licensing.
- **Prior builder:** Ryan Meyer (Tennetech). Ryan owns both Tennetech and Stratirus — this handoff is an internal brand reshuffle, not a vendor transition. Ryan is effectively out of day-to-day going forward.

## Architecture

**Definitive spec:** `D2-Option-A-Lists-Deployment-Plan-RevD.docx` in repo root. That is the current authoritative design. This section summarizes; the docx has the details.

**Stack:**
- **SharePoint Lists** — data model, six lists per Rev D §04. MVP demo uses three (Jobs, Assignments, Tasks); full build adds Trades + Crew-Trades intersect + Work Calendar
- **Power Automate flows (5)** — Daily Dispatch + Reminders, Event-Driven Reconciliation (with sign-off trigger-condition), Sign-off Intake, Nightly Reconciliation, Daily + Weekly PDF Summary
- **Power Apps canvas app** — crew-lead sign-off + task-tick, mobile-first, standard M365 rights only
- **Microsoft Forms** — fallback sign-off surface if canvas app is blocked (planned as backup only)
- **Teams channels** — `Field Dispatch` and `Ownership` for artifact posting
- **Browser scheduler** — `D2-Build-Scheduler/app/pool-scheduler.html`, permanent PM-side planner role (not being retired; committed schedule flows to Lists nightly)

**Environment split:**
- SharePoint site at tenant level (netorgft15040037.sharepoint.com)
- Canvas app + flows live in Power Platform env **D2 Automation** (also home to a separate estimator engine — coexisting workloads, no interference expected)

**Rev D §16 traceability table** documents every design change from Rev A→B→C→D with source. When making architectural changes, extend that table.

## Business rules

The four load-bearing invariants (enforced by the design, not by a database primary key — SharePoint Lists has no composite alternate key equivalent):

1. **A crew is only assigned to a sub-phase whose required trade it actually holds.** Verified via the Crew-Trades intersect list.
2. **A field crew is never on two pools the same day.** Detection is post-hoc within one Power Automate polling interval (event-driven flow scoped to touched Crew + date range), with a nightly full-sweep safety net. This is "acceptable degradation, not equivalence" vs. the Dataverse alternate-key approach — see Rev D §07 for honest framing.
3. **Sub-phases run in order — one cannot start before the one before it ends.** Enforced by the browser tool's Auto-Schedule; re-enforced by the conflicts checker.
4. **Mon–Sat are work days. Sunday is not.** Extended in the Lists path to include Work Calendar entries (Holidays, Weather days, per-crew shutdowns).

**Additional rules confirmed by David/Don:**

- **Internet connection required.** No offline mode. Mobile devices and laptops always online.
- **Task-level ticks required** — Don wants each of the ~6 tasks per sub-phase individually ticked. 295 tasks per pool preserved.
- **Weekly + daily PDFs by email** are acceptable for ownership visibility (no Power BI dashboards needed).
- **Four subcontractor crews** (George, Armondo, STL Shotcrete, Brothers) modeled as `Unlimited = Yes` capacity-exempt buckets. No roster, no M365 seat, cannot be double-booked.
- **Sign-off happens on connected devices** — David confirmed no signal-required scenarios.

## Staging / integration contracts

**Between the browser tool and Lists:**
- Browser tool is the planner. PM lays out schedules in the HTML tool as before.
- A nightly Power Automate flow reads the browser tool's JSON backup (dropped to a watched SharePoint folder) and upserts Jobs + Sub-phase Assignments into Lists.
- Lists is the source of truth for execution state (sign-off, task completion, timestamps). Never edit sign-off in the browser tool.

**Between canvas app and flows:**
- Canvas app writes task completion directly to the Tasks list (SharePoint connector, standard rights).
- Canvas app calls the **Sign-off Intake** flow (PowerApps V2 trigger) with `{ AssignmentID, WorkDate, Notes, TasksTotal, TasksComplete }`. Flow writes InstallerSignOff = true, By, On, WorkDate, Notes, task counts onto the Assignment.
- **CRITICAL:** The Event-Driven Reconciliation flow's trigger condition MUST skip sign-off-only edits, or Sign-off Intake writes re-fire it and burn quota. See Rev D §06 for the trigger-condition expression.

**Between the four subcontractor crews and Assignments:**
- Their CrewID stays as the browser tool's short code (`george`, `armondo`, `stl`, `brothers`)
- `Unlimited = Yes` flag on their Crews row means they never contribute to busy-map or double-book detection
- Assigning them zero-in on scheduling logic — they schedule like any other crew but don't consume capacity

**Auth to SharePoint from scripts:** unsolved for headless PS. Working pattern is Claude Chrome + REST-from-page — see below.

## Known bugs and gotchas

**RESOLVED — SharePoint provisioning via Claude Chrome + REST-from-page.** All PnP and m365 CLI auth attempts fail on a fresh box:
- PnP.PowerShell `-Interactive` / `-DeviceLogin` (both v2.4.0 pinned and latest) → not-supported / threading bug / unable-to-connect
- m365 CLI v11 → requires BYO Entra appId at first login (chicken-and-egg)

The pattern that actually works, and provisioned all 7 lists in this repo:
1. Open Claude Chrome (`switch_browser`, pick the right browser profile — profile hop is a common gotcha)
2. `navigate` to `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler` — Shane signs in interactively as `stratirus@d2pools.com` on that tab
3. Fire SharePoint REST from the authenticated page context via `javascript_tool`. Get the digest from `/_api/contextinfo`, then POST to `/_api/web/lists`, `/_api/web/lists/GetByTitle('X')/fields/CreateFieldAsXml`, `/_api/web/lists/GetByTitle('X')/items`. No PnP, no m365 CLI, no BYO Entra app.

Load-bearing details for future runs:
- **Fresh tab groups need a fresh sign-in.** Each new MCP tab group has its own cookie context. The first tab in a session survives; subsequent tab groups land back on the sign-in wall.
- **CDP calls time out at ~45s** — split scripts so no single JS call is above that. Batch 60+ REST calls across two or three `javascript_tool` calls.
- **Parallel field creates on the same list contend and 500** with "requires a newer version" (schema lock). Field creates must be sequential; item creates can be parallel in chunks of 8.
- **Hyphenated or spaced list names** get sanitized entity type names (`SP.Data.Crew_x002d_TradesListItem`, `SP.Data.Work_x0020_CalendarListItem`). Don't hand-write these — read `ListItemEntityTypeFullName` off the list metadata and use that string verbatim.
- **`D2-Provision-Lists.ps1` is obsolete.** Keep for archaeology but do not run — the whole PnP path is blocked.

**Chrome MCP tab isolation.** Claude Chrome creates tab groups in an isolated cookie context. Fresh tabs land on sign-in walls even when the user's regular browser tabs are already signed in as the same account. Confirmed deterministic — switching browsers or reconnecting does not resolve. Workaround: user drives their own signed-in browser tabs; agent guides via chat.

**Desktop Commander `Start-Process pwsh.exe` MAY still inherit stdio.** The m365-interactive-auth skill flags this class of issue for Graph SDK. In practice, launching pwsh via `cmd /c start` from a DC-spawned shell has the same failure mode as `Start-Process` directly. When Microsoft auth writers matter, have the user open pwsh manually.

**Path length discipline.** Windows still enforces 260 chars in many cases even with `LongPathsEnabled = 1`. This repo lives at `C:\src\D2Scheduler\` (short). Do not add deeply-nested source generators or copy this repo into OneDrive-synced folders.

**PM assignment on Harrison Residence D2-1001 is a placeholder.** `Jobs.ProjectManager` was added to schema 2026-09-01 (User/Person, Group D2, UserSelectionScope=0 — tenant-members only, no external UPNs). Harrison row seeded with stratirus@d2pools.com (display name "D2 Bot" — external PMs like stalbot@stratirus.com are rejected by the scope=0 constraint). Needs to be updated to the real D2 PM before live-fire testing. Every future new Job row must also have PM set at creation or the reconciliation flow's DM step won't resolve.

**Data gaps still open (from Rev D §15 / original plan §09):**
- **10 trades unmapped to any sub-phase:** Retaining Walls, Veneer/Stone, CMU, Brick/Masonry, Landscaping, Pavers, Forms, Water Line Install, Material Runs, Grading. Don owes a mapping decision. George Crew is scheduled zero days until this lands.
- **11 field-supervision sub-phases sit in Unassigned.** Don owes: shared PM bucket, or specific-person ownership?
- Finish Grade skill on Saul & Guillermo — confirmed by Don (yes, they are qualified). No action.
- Four crews without roster (George, Armondo, STL, Brothers) — resolved as subcontractors, Unlimited=Yes.
- 46 durations still at 2-day placeholder — deferred; will be replaced from real actuals after first few pools.

## How to run it

**Week 1 complete — all 7 SharePoint lists provisioned and seeded on the D2 tenant** as of 2026-08-25. Rev D week-by-week runbooks are in repo root (`D2-Week-1-Build-Runbook.md` through `D2-Week-5-Cutover-Runbook.md`).

**Deployed state (D2BuildScheduler site):**

| List | Rows | GUID |
|---|---|---|
| Jobs | 1 (Harrison Residence D2-1001) | `ee0ecabf-2f11-458d-a9ea-641f76d10cc3` |
| Assignments | 5 (D2-1001 sub-phases; 22 fields incl full Week 1 schema) | `49ef7006-d3fe-40a7-a52f-c4c18545bd35` |
| Tasks | 30 (6 × 5 assignments) | `22c45847-ff0d-417a-b53e-1ea018fbb6d3` |
| Trades | 26 | `05038f7f-a6cb-4f57-b1a1-3ff9c7126ba5` |
| Crews | 14 (subcontractor patch applied) | `45e9ff1f-bf36-4ab5-929d-25ab9a80d460` |
| Crew-Trades | 51 | (see viewlsts.aspx) |
| Work Calendar | 62 (52 Sundays + 10 US federal holidays) | (see viewlsts.aspx) |

**Immediate next action:** Continue Week 2 flows. Sign-off Intake is DONE and end-to-end verified. Remaining 4 flows: Daily Dispatch, Event-Driven Reconciliation, Nightly Reconciliation, Daily+Weekly PDF Summary. Build via Claude Chrome UI-driving (not solution ZIP). Export each to `flows/exports/` after it tests green.

**Load-bearing pattern for write-back flows (from Sign-off Intake win):** use "Send an HTTP request to SharePoint" action with SP MERGE, NOT the Update item action. PA's Update item requires binding every required field on the target list (Assignments has 7 required → 14+ dynamic-content bindings per action). Send-HTTP-to-SP with `X-HTTP-Method: MERGE` header does partial updates, only touching fields in the body. ~15 clicks total vs 100+. See sessions/2026-08-25-week2-flow-start.md for the body/headers template.

**PA Expression syntax — two forms, not interchangeable:**

- **Inside `@{...}` template strings** (fields treated as a template with mixed literals + expressions): the `body('ActionName')?['fieldPath']` shorthand works. PA rewrites it during template evaluation.
- **In the bare Expression tab** (fields where the whole value IS a raw expression — Init variable Value, Compose Inputs, condition operands): shorthand is rejected as "expression is invalid". Use full path: `outputs('ActionName')?['body/fieldPath']`.

Same rule for every connector's outputs — never `body('X')?[...]` in a bare Expression, always `outputs('X')?['body/...']`. Discovered on Compose 2 Inputs fix in Daily Dispatch; see sessions/2026-08-28b-compose2-fix.md.

**Flow definition export — ZIP button is gone; use Get-AdminFlow:** The PA cloud-flow toolbar no longer surfaces Package (.zip) export as of 2026 — the Export dropdown holds only "Learn how" and "Get flow identifier", overflow menu has nothing useful. For version-control artifacts, use `Get-AdminFlow` from `Microsoft.PowerApps.Administration.PowerShell`. The returned object's `Internal.properties.definition` holds the full trigger + actions JSON.

Two auth gotchas that will bite hard if missed:

1. **Add-PowerAppsAccount silently uses cached tenant.** Without `-TenantID`, it picks up whichever tenant last authed (Tennetech LLC in Shane's case). `Get-AdminFlow` then returns count=0 with no error because the D2 Automation env is invisible from that tenant. Always pin: `Add-PowerAppsAccount -TenantID 'f24d9b39-6a71-4f4e-a376-03b6f61c97e4'`.
2. **Popup account matters.** Sign in as `stratirus@d2pools.com` — the PP Admin identity in the D2 tenant. `D2PAdmin` popped up during Shane's first attempt and returned zero flows too; unclear if it lacks the PP Admin role or if it was a stale-cache side effect. Stratirus works, keep it that way.

Working pattern lives in `flows/exports/`; re-run against any env by swapping the env GUID.

**Flow authoring pattern — FlowAgent, not `api.flow.microsoft.com` REST (2026-09-01b):**

D2 Automation is Dataverse-backed. `api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/{env}/flows/{id}` is the RUNTIME management surface — GET/list/start/stop. It is NOT the definition-mutation surface for solution-aware Dataverse flows. Attempts against it fail deterministically:

- `PUT` new flow → 404 "No HTTP resource" (route doesn't exist for CREATE)
- `PATCH` existing flow → either 400 "Entity 'workflow' Does Not Exist" (on fresh stubs where Callback Registration hasn't written) or 200-OK-but-silently-ignored (definition lands in draft, not published, and there's no working `/publish` endpoint on this route)
- `POST /publish` → 404 "No HTTP resource" (not real)

The correct paths are all Dataverse-side:

1. **FlowAgent** (preferred) — Microsoft-published open-source MCP server in `microsoft/power-platform-skills`. Runs in Claude Code. Read/edit/validate/publish flows + read run outputs for self-diagnosis. Requires Node.js + Azure CLI + Power Platform CLI + Claude Code + `az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4`.
2. **PAC solution ALM** (fallback for FlowAgent's ~5KB payload cap on big edits) — `pac solution export/unpack/pack/import` + edit `workflow.json`'s `clientdata` locally between unpack and pack.
3. **Direct Dataverse Web API** (only when FlowAgent+PAC both blocked) — `PATCH https://<orgurl>/api/data/v9.2/workflows({id})` with `{"clientdata":"<escaped-JSON>"}`, followed by `POST /api/data/v9.2/PublishXml`. Audience token = the org URL, not flow.

Artifacts from the failed REST attempt live under `flows/scripts/` (Import-Flow.ps1, Patch-Flow.ps1, Publish-Flow.ps1) — keep as archaeology for what NOT to try. The definition JSON authoring itself validated (correct expressions, connection refs, list GUIDs) — it's the delivery mechanism that was wrong. Reuse `flows/definitions/*.json` verbatim with FlowAgent.

**Flow scope discipline:** solution-aware flows (which is all cloud flows on Dataverse-backed envs by default) do NOT appear in the standard flow list — they only show inside their solution. Address by flow ID (from the URL after Save) or from within the solution view.

**After Week 2 flows:**
1. Build the canvas app per `D2-Week-3-Canvas-App-Spec.md`
2. Pilot one live pool per `D2-Week-4-Pilot-Runbook.md`
3. Cutover per `D2-Week-5-Cutover-Runbook.md`

**Companion tools already in place:**
- `patched-tool/pool-scheduler.html` — browser scheduler with the two-line Auto-Schedule determinism fix applied (see `patched-tool/README.md` and `patched-tool/determinism-fix.diff`). Verified with `oracle-test.js` — 14 of 16 automated invariant checks pass, two remaining fails are documented data gaps not bugs.
- `Subcontractor-Crew-Patch.md` — separate diff flipping the four subcontractor crews to `Unlimited=Yes` in the browser tool's SEED_CREWS. Apply alongside the determinism fix.
- `seed-data/*.csv` — Trades, Crews (with subcontractor patch), Crew-Trades intersect, Work Calendar — ready for SharePoint Grid-paste when provisioning lands.

## Fixture corpus

**None yet.** When the scheduling logic gets ported to Power Automate (the "reset load baseline + secondary sort key" determinism fix needs to move into the flow's candidate-sort per Rev D §14), wire behavior fixtures at that point — fixed inputs, expected outputs, run against both the browser tool and the flow to catch divergence.

Fixture location when created: `fixtures/` at repo root (already scaffolded, README stubbed).

## Session workflow

Standard: end each session with `sessions/YYYY-MM-DD-topic.md`, commit + push via `sync "msg"`.

Migration session: see `sessions/2026-08-24-migration-from-scratchpad.md` for the initial-migration handoff notes.

## Non-goals

- **Not a general scheduling engine.** Purpose-built for D2's pool construction workflow (46 sub-phases, 295 tasks, specific crew qualifications).
- **Not offline-capable.** David confirmed internet required. If that ever changes, upgrade path is Dataverse (see Rev D §14 extension paths).
- **Not Dataverse.** Dataverse migration is either-or with the Lists path per Rev D §14, not a stepping stone. Named triggers only.
- **Not a replacement for the browser tool.** The HTML tool remains the PM's planner. Lists holds execution state.
- **Not multi-tenant.** Single tenant only. If D2 acquires another pool company, migrate to Dataverse.
