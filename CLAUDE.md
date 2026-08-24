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

**Auth to SharePoint from scripts:**
- Currently blocked. See Known bugs.
- Once resolved: scripts should use `-ClientId` with a custom D2-registered Entra app (long-term), NOT `-DeviceLogin` (broken in current PnP) or `-Interactive` without a client ID (needs discontinued PnP Management Shell registration).

## Known bugs and gotchas

**Blocking — SharePoint list provisioning is stuck.** Four PnP.PowerShell auth attempts failed in this session:
1. `Connect-PnPOnline -Interactive` → "Specified method is not supported" (no client ID; PnP Management Shell app registration was discontinued Sept 2024)
2. `Connect-PnPOnline -DeviceLogin` (PnP v2.latest) → "WriteObject and WriteError methods cannot be called from outside the overrides..." (threading bug in modern PnP versions)
3. `Connect-PnPOnline -DeviceLogin` (PnP 2.4.0 pinned) → "Unable to connect using provided arguments"
4. Attempted via Desktop Commander `Start-Process` and `cmd /c start` — same errors as above; stdio inheritance is not the mechanism.

**Resolution path (open, not yet chosen):**
- Option A: Register a custom Entra app in D2 tenant (`Register-PnPEntraIDApp`), use `-ClientId <guid> -Interactive`. Chicken-and-egg on first auth but doable.
- Option B: Skip PnP entirely, click through SharePoint UI (~30 min guided). Removes auth mess but no script for repeatability.
- Option C: Try CLI for Microsoft 365 (m365 CLI) — different auth model, may just work.
- Option D: Use Microsoft Graph SDK PowerShell — different auth path.

**Chrome MCP tab isolation.** Claude Chrome creates tab groups in an isolated cookie context. Fresh tabs land on sign-in walls even when the user's regular browser tabs are already signed in as the same account. Confirmed deterministic — switching browsers or reconnecting does not resolve. Workaround: user drives their own signed-in browser tabs; agent guides via chat.

**Desktop Commander `Start-Process pwsh.exe` MAY still inherit stdio.** The m365-interactive-auth skill flags this class of issue for Graph SDK. In practice, launching pwsh via `cmd /c start` from a DC-spawned shell has the same failure mode as `Start-Process` directly. When Microsoft auth writers matter, have the user open pwsh manually.

**Path length discipline.** Windows still enforces 260 chars in many cases even with `LongPathsEnabled = 1`. This repo lives at `C:\src\D2Scheduler\` (short). Do not add deeply-nested source generators or copy this repo into OneDrive-synced folders.

**Data gaps still open (from Rev D §15 / original plan §09):**
- **10 trades unmapped to any sub-phase:** Retaining Walls, Veneer/Stone, CMU, Brick/Masonry, Landscaping, Pavers, Forms, Water Line Install, Material Runs, Grading. Don owes a mapping decision. George Crew is scheduled zero days until this lands.
- **11 field-supervision sub-phases sit in Unassigned.** Don owes: shared PM bucket, or specific-person ownership?
- Finish Grade skill on Saul & Guillermo — confirmed by Don (yes, they are qualified). No action.
- Four crews without roster (George, Armondo, STL, Brothers) — resolved as subcontractors, Unlimited=Yes.
- 46 durations still at 2-day placeholder — deferred; will be replaced from real actuals after first few pools.

## How to run it

**Nothing is deployed yet.** Rev D week-by-week runbooks are in repo root (`D2-Week-1-Build-Runbook.md` through `D2-Week-5-Cutover-Runbook.md`).

**Immediate next action:** Resolve the PnP auth block (see Known bugs). Then run `D2-Provision-Lists.ps1` to provision the three MVP lists (Jobs, Assignments, Tasks) with seed data.

**After lists exist:**
1. Verify against Rev D §04 data model
2. Build the five Power Automate flows per `D2-Week-2-Automations-Runbook.md`
3. Build the canvas app per `D2-Week-3-Canvas-App-Spec.md`
4. Pilot one live pool per `D2-Week-4-Pilot-Runbook.md`
5. Cutover per `D2-Week-5-Cutover-Runbook.md`

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
