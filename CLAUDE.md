# CLAUDE.md — D2Scheduler

Durable orientation for any Claude session working in this repo.

---

## What this is

Pool construction scheduling and field sign-off system for D2 Pools. SharePoint Lists + Power Automate + Teams + a Power Apps canvas app for crew-lead task-tick, running on D2's existing M365 subscription with **no premium connectors and no Dataverse** — but see the licensing note below: the canvas app does require Business Basic seats for the ~10 field crew leads, so "zero incremental licensing" is **not** accurate and must not be repeated to the client. Replaces a browser-based prototype (`D2-Build-Scheduler/app/pool-scheduler.html`) originally built by Ryan Meyer under his Tennetech brand; Stratirus took over full delivery ownership.

Client-facing name: **D2 Build Scheduler**.

Site URL: `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler` (site created 2026-08-22; lists NOT yet provisioned — see Known bugs).

## Owner / stakeholders

- **Stratirus owner:** Shane Talbot (stalbot@stratirus.com)
- **Client owners at D2:** David Taylor (david@d2pools.com), Don Borgeson (don@d2pools.com) — both on Business Premium
- **Client PMs (the two who actually run jobs):** **Cody Campbell** and **Emon Alexander** (confirmed by Shane 2026-09-07). Other office staff on Business Standard — Amy Stevens, Carolyn Morris, Daniel Morris, Tyler Huisman — use the system but are not PMs. This matters for `Jobs.ProjectManager`, for who receives double-booking alerts, and for who the office surface is designed around.
- **Field crew leads (~10):** currently unlicensed. **DECIDED 2026-09-04 — canvas app, not Forms.** Shane's call: "MS Forms will not cut it." Requires Business Basic ($6/user/mo, ~$720/yr for 10) added for them. Business Basic also gives them a real D2 mailbox, which `Crews.LeadEmail` and Flow 1's dispatch both depend on — the seats are the price of the crew being on the system at all, not just of one app. See "Crew-lead licensing" under Known bugs for the reasoning and the open procurement question.
- **Prior builder:** Ryan Meyer (Tennetech). **Stratirus is owned by Tennetech**; Ryan owns both companies and both Power Platform environments. This handoff was an internal brand reshuffle, not a vendor transition — so there is no IP, provenance or cross-vendor question about which environment work is built in. **Updated 2026-09-05 — Ryan is OFF the build again; the canvas app stays with Stratirus.** This reverses the 2026-09-04 decision to hand Phase C to him. `D2-Canvas-App-Handoff-Contract.md` is therefore no longer a handoff document: read it as **internal build guidance**, and note that its §6a production-safety rules now bind *us*, not a third party. They are still load-bearing, because the app is still being built in the live client tenant.

## Architecture

**Definitive spec:** `D2-Option-A-Lists-Deployment-Plan-RevD.docx` in repo root. That is the current authoritative design. This section summarizes; the docx has the details.

**Stack:**
- **SharePoint Lists** — data model, six lists per Rev D §04. MVP demo uses three (Jobs, Assignments, Tasks); full build adds Trades + Crew-Trades intersect + Work Calendar
- **Power Automate flows (5)** — Daily Dispatch + Reminders, Event-Driven Reconciliation (with sign-off trigger-condition), Sign-off Intake, Nightly Reconciliation, Daily + Weekly PDF Summary
- **Power Apps canvas app** — crew-lead sign-off + task-tick, mobile-first, standard M365 rights only
- ~~**Microsoft Forms** — fallback sign-off surface~~ **RULED OUT 2026-09-04.** Forms cannot render a question set that varies per respondent at runtime, so "show this crew lead today's 6 tasks" has no native expression. The cheap variant (one generic form, sub-phase-level sign-off + a task count) drops Don's explicit task-level tick requirement; the faithful variant (46 forms, one per sub-phase template, deep-linked with a prefilled assignment ID) costs more than the canvas app and is a maintenance trap. Unlicensed crew leads could only use an anonymous "anyone with the link" form, which degrades `InstallerSignOffBy` from a verified User to a typed name on a forwardable link — an audit-trail regression larger than the one Rev D §02 added `WorkDate` to fix.
- **Teams channels** — `Field Dispatch` and `Ownership` for artifact posting. **DEFERRED to post-pilot, decided 2026-09-05.** Neither channel exists (the tenant has only `d2pools.com > General`). The one case where Teams would have been materially better was delivering dispatch to crew leads on a mailbox-less SKU, and that case evaporated when M365 F1 turned out not to include Power Apps at all — see the licensing correction under Known bugs. With Business Basic as the floor, crew leads get mailboxes anyway, so **Flow 1's email dispatch stays as built and verified**. Everything else Teams would carry (Flow 4 alerts, Don's summaries) is duplicating email that already works, in exchange for a client-gated dependency in a calendar-locked week.
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

- **No sign-off while any task is unresolved. Every task is Done, N/A, or to do. DECIDED 2026-09-07 (Shane, from Don).**
  Don's objection was never the ceremony — it was someone glossing a clean checklist with "yep, all
  done" without really checking. So sign-off is now **blocked** until every task is resolved.

  **A bare block would have made things worse.** If a crew lead cannot close the day at 5 of 6, they
  do not go and do the sixth — they tick it falsely. That converts an honest "5 of 6" into a
  dishonest "6 of 6" *carrying their name*, destroying the very signal Don wants. The gate is only
  fair because **N/A** exists as the honest alternative: materials did not arrive, inspection
  pending, or the task simply does not apply to this pool.

  | State | Meaning |
  |---|---|
  | Done | ticked, timestamped |
  | N/A | deliberately excluded, **reason required** |
  | to do | neither — blocks sign-off |

  **The N/A reason is mandatory, and that is load-bearing.** Without it, "mark everything N/A then
  sign off" is simply a second rubber-stamp route and the gate is worth nothing. N/A is also a
  separate tap target, never a cycle through the row tap, so excluding work cannot happen by
  mis-tap.

  **Per-task attribution is deliberately NOT the point.** Shane: *"who completed the work is
  unimportant for this — who signed off on the completed work is more important."* `CompletedBy`
  stays populated because it is free and the timestamps expose rubber-stamping (six tasks ticked in
  four seconds is visible), but the attestation that matters is `InstallerSignOffBy` at sub-phase
  level. Do not build per-task signature ceremony.

  **`TasksComplete` counts genuinely Done only, not N/A.** A sub-phase signed off with one N/A reads
  5/6 forever, which is honest: five were done, one was excluded, and the exclusion carries a reason.

- **Sign-off LOCKS the task list, and a recorded Reopen is the only way back. DECIDED 2026-09-06 (Shane).**
  Triggered by a real case: a PM walk-through spots something signed off that clearly was not
  done. Without a reopen path the only remedy is silently unticking tasks underneath a
  completed sign-off, which is what the app allowed on first build — the attestation said
  "signed, 5 of 6" while the rows underneath said something else. That is the same
  counter-vs-rows divergence already recorded on Harrison Assignment 1.

  The rule: once `InstallerSignOff` is true the task rows are read-only, and the sign-off
  button becomes **Reopen**. Reopening clears `InstallerSignOff` and **appends who reopened and
  when to `SignOffNotes`**, so a correction is deliberate and attributable rather than a silent
  edit.

  Deliberately kept small to avoid scope creep — no reason dialog, no separate audit list, no
  schema change, no new flow. `SignOffNotes` already exists and is already written at sign-off.

  **Open: anyone can reopen.** Restricting it to PMs needs `Crews.LeadEmail` populated with real
  crew-lead UPNs, which is client-gated. Recording *who* reopened gives accountability now;
  restricting *who may* is a later switch, not a redesign.

## Staging / integration contracts

**Between the browser tool and Lists:**
- Browser tool is the planner. PM lays out schedules in the HTML tool as before.
- A nightly Power Automate flow reads the browser tool's JSON backup (dropped to a watched SharePoint folder) and upserts Jobs + Sub-phase Assignments into Lists.
- Lists is the source of truth for execution state (sign-off, task completion, timestamps). Never edit sign-off in the browser tool.

> **THE NIGHTLY SYNC FLOW DOES NOT EXIST (found 2026-09-05).** The bullet above describes a
> contract with no implementation. It is not one of the five Phase B flows, it is not in
> `flows/definitions/`, and it is not a build step in any of the five week runbooks. Nothing
> anywhere was tracking it. Without it there is **no path for a PM's schedule to reach
> SharePoint except hand-entry**, which is the bottleneck this system exists to remove.
>
> **Decision 2026-09-05: descoped from the pilot, deliberately and on the record.** Phase E
> pilots one pool with its assignments loaded once, by us, via REST. That is a few dozen rows
> and it still tests everything the pilot is actually for: does a crew lead sign off on a
> phone, do the flows fire, does Don's summary land. Build the sync in Phase F or after,
> when the browser tool's real JSON export has been seen in anger rather than assumed.
>
> Phases E and F are calendar-locked. Discovering this during Phase E would have eaten both.

**RESOLVED 2026-09-08: new pools now originate in SharePoint, not the browser tool.** A PM
adds a row to **New Pool Requests** (job number, name, address, start date, project manager) and
**`D2 - New Pool`** reads the 46-row **Sub-phase Template** and 295-row **Task Template** and
generates the whole pool directly into Lists, with no browser-tool JSON export anywhere in the
path. The browser tool remains the visual planner and the only Gantt (it is still where a PM
lays out crew sequencing by eye), but it is no longer where a pool is *born*. See **How to run
it** and the NEXT SESSION section for the flow and list details.

This shrinks, but does not close, the gap the nightly-sync blockquote above describes. The
sync's original job was carrying a *new* pool's schedule into Lists, and that job is now done a
different way. Whether a sync is still worth building for keeping an *existing* pool's schedule
changes in sync, a PM re-sequencing crews on a live pool in the browser tool, is a separate,
still-open question that this change does not answer.

**`DurationDays` means WORK days, never the inclusive calendar span.** Two conflicting
definitions are live in the list right now, and the disagreement only shows on rows that
cross a Sunday:

| Rows | Written by | Definition | Example |
|---|---|---|---|
| Harrison 1-5 | the 2026-09-03 date fix, by hand | inclusive calendar span | — |
| `TEST-900x` | `generate-seed.py` (`'days'`) | work days | `2026-08-22 → 08-24` = **2**, not 3 |

The browser tool is the authority and models sub-phase durations in work days (the "46
durations at 2-day placeholder" are 2 *work* days), so **work days wins** and the Harrison
rows are the wrong ones. That self-disposes when the demo job is deleted, but the canvas app
and the future sync must both write work days or it comes straight back.

Related and easy to get backwards: **a span that contains a Sunday is legitimate.** A
2-work-day sub-phase starting Saturday correctly runs Sat + Mon and stores
`start=Sat, finish=Mon`. Only the **endpoints** must be work days. `generate-seed.py` now
checks both endpoints (it only checked the start before); six of the 38 seeded rows span a
Sunday and all six are correct.

**Between canvas app and flows:**
- Canvas app writes task completion directly to the Tasks list (SharePoint connector, standard rights).
- Canvas app calls the **Sign-off Intake** flow (PowerApps V2 trigger) with `{ AssignmentID, WorkDate, Notes, TasksTotal, TasksComplete }` — all five **required** by the trigger schema, so `Notes` must be sent even when empty.
- **FIXED 2026-09-06 — the flow now writes `InstallerSignOffBy`.** For most of the build it did not: the published MERGE body wrote `InstallerSignOff`, `InstallerSignOffOn`, `WorkDate`, `SignOffNotes`, `TasksTotal`, `TasksComplete` and nothing else, so **every sign-off was anonymous** — which undercut the attestation the system exists to produce and made the crew-lead-vs-PM-proxy distinction unrecordable.

  The fix, published 2026-09-06: a sixth **required** trigger parameter `SignedByEmail` (`text_1`), a new `Ensure_signoff_user` action, and `InstallerSignOffById` added to the MERGE body. A Person column cannot be set by email through REST — it needs the numeric site-user id. The action POSTs to **`_api/web/ensureuser`** with `{"logonName":"i:0#.f|membership|<UPN>"}` and the body reads `@{body('Ensure_signoff_user')?['d']?['Id']}`. `ensureuser` is used rather than `siteusers/getByEmail` because it also provisions a site user who has never visited the site — which every crew lead will be on their first sign-off. Send the **UPN**, not `mail`.

  **The canvas app must now send six parameters, not five.** `SignedByEmail` is required, so an app still sending five will fail at the trigger.

  **NOT YET EXERCISED END TO END.** The definition validated, published and re-exported clean, but FlowAgent cannot inject inputs into a PowerAppV2 trigger (`DirectApiTriggerInputsUnsupported` — the caller lacks the ACL on the flow's Logic Flows connection), and the only past run targets Harrison Assignment 1, so resubmitting it is barred by §6a. **The first real test is the canvas app's sign-off screen calling it against a `TEST-900x` row.** Until then treat the `?['d']?['Id']` accessor as unverified: if the connector returns the body unwrapped, it needs to be `?['Id']`. Assignment **32** (`TEST-9002 · 2.1 Engineering Review by PM`, 6 tasks, 0 complete, unsigned) is the intended target.
- **CRITICAL:** The Event-Driven Reconciliation flow's trigger condition MUST skip sign-off-only edits, or Sign-off Intake writes re-fire it and burn quota. See Rev D §06 for the trigger-condition expression.

**Between the four subcontractor crews and Assignments:**
- Their CrewID stays as the browser tool's short code (`george`, `armondo`, `stl`, `brothers`)
- `Unlimited = Yes` flag on their Crews row means they never contribute to busy-map or double-book detection
- Assigning them zero-in on scheduling logic — they schedule like any other crew but don't consume capacity

**Auth to SharePoint from scripts:** unsolved for headless PS. Working pattern is Claude Chrome + REST-from-page — see below.

## Commercial basis — not in this repo

**The `~$14k build` figure in `D2-Stratirus-Ownership-Plan.md` is WRONG for this project** (corrected 2026-09-04). That SOW covered a **Copilot setup and GoDaddy migration** — a separate engagement that was conflated with this build when the plan was drafted. Anything derived from it is equally void: the "build drops ~$4k" for the Forms fallback in `D2-Pre-Build-Verifications.md`, and the "$14k Lists vs $36k Dataverse" comparison in `Ryan-Handoff-Email.md`.

**Do not quote any of those numbers as this project's budget.** The commercial terms for the D2 Build Scheduler are not recorded anywhere in this repo. If a cost question comes up, ask rather than infer.

Figures that *are* sound, because they come from Microsoft list pricing rather than the SOW: crew-lead licensing at ~$6/user/mo (Business Basic), and Power Apps Premium at ~$20/user/mo for the Dataverse path. **The ~$2.25 M365 F1 figure that used to appear here is void** — F1 does not include Power Apps, so it was never a real option at any price. See the crew-lead licensing entry under Known bugs.

## Phases — the canonical structure

**Phases replaced week numbering on 2026-09-07.** Weeks were abandoned because they measured
elapsed time, which turned out to have almost no relationship to the work, and because two whole
workstreams had no week and were silently lost as a result.

| Phase | Deliverable | Bound by | Status | Runbook |
|---|---|---|---|---|
| **A** | SharePoint foundation — 7 lists, 22-field schema, seed | Effort | **Done** | `D2-Phase-A-Foundation-Runbook.md` |
| **B** | Automation — the flows | **Discovery** | **Done** | `D2-Phase-B-Automations-Runbook.md` |
| **C** | Field app — canvas sign-off | Effort + discovery | **Done** | `D2-Phase-C-Field-App-Spec.md` |
| **D** | Readiness — office surface, client prerequisites, real data | **Human-gated** | **In progress, blocking** | `D2-Phase-D-Readiness-Runbook.md` |
| **E** | Pilot — one real pool, parallel run | **Calendar** | Not started | `D2-Phase-E-Pilot-Runbook.md` |
| **F** | Cutover — training, go-live, support | **Calendar** | Not started | `D2-Phase-F-Cutover-Runbook.md` |
| **G** | Deferred backlog — post-go-live | Effort | Not started | (below) |

**A–F match the AzDo Epic letters**, which is why the letters were preserved rather than
renumbered when G was added.

**Phase D is not sequential.** It runs alongside A–C and **gates E**. Almost all of it moves at
client speed, so it must be tracked separately from work that compresses. The honest status line
today is *"everything buildable is built; we are blocked on the client"* — a sentence the week
model could not express, because it implied we were mid-Phase-C and on schedule.

**Phase G — deferred backlog**, each deferred deliberately and on the record:

- The **browser-tool → Lists nightly sync**. Does not exist, was in no runbook, and nothing was
  tracking it. Descoped from the pilot 2026-09-05. A PM's plan still does not flow automatically
  from the browser tool into SharePoint. **This is now partly superseded.** See "New pool
  deployment" below: a PM can raise a New Pool Requests row and get a fully-scheduled pool
  without any REST work by us. The gap that remains is the browser tool itself never writing
  to Lists; live pools are still edited directly in Lists.
- **Teams channels.** Deferred post-pilot 2026-09-05; every flow delivers by email instead.
- **Photo capture** on a task or sign-off. Raised by Shane 2026-09-07, likely the highest-value
  addition after go-live for a warranty/QC trail. Needs a camera control, image storage, and an
  upload through a flow.
- **New Pool's accepted reconciliation cost.** `D2 - New Pool` does not stop Flow 3 around its own
  46 inserts, so every real pool burns 92 Event-Driven Reconciliation runs (46 from
  `Create_assignment`, 46 more from `Merge_task_total`). The second 46 terminate cheaply at the
  version-history gate, so this is accepted rather than fixed. If alert volume ever makes it worth
  closing, add a `SuppressReconcile` boolean set in the same `Create item` call and one clause in
  Flow 3's gate.

---

## Estimating — measure what bounds the work, not hours

The Rev D plan's per-phase hour estimates were written for human developers and are not reliable.
Observed pace with Claude Code assisting:

| | Estimated | Actual |
|---|---|---|
| Phase A — 7 lists, 22-field schema, 200+ seed rows | 25 hrs / 5 days | **1 session, 1 day** |
| Phase B — the flows | 22 hrs / 5 days | **~11 sessions over 10 days** |
| Phase C — the canvas app | 28 hrs / 5 days | **~2 sessions** once the deploy loop was understood |

Phase A collapsed. Phase B did not — and its time went to **auth dead ends** and **bug
discovery**, not authoring. Phase C looked like Phase B for most of a day and then collapsed once
the platform's behaviour was pinned down. Writing definitions and formulas is consistently the
cheap part.

So classify work by what actually bounds it:

- **Effort-bound** (authoring, schema, scripts, docs) — compresses hard. Estimate as "a session
  or two."
- **Discovery-bound** (auth walls, undocumented platform behaviour, wrong assumptions in the
  spec) — **does not compress.** Buffer, don't estimate. This is where Phase B went, and most of
  Phase C's first day.
- **Human-gated** (crew-lead identities, licensing, Don's trade mapping) — moves at client speed.
  **Currently the critical path**, and the whole reason Phase D exists.
- **Calendar-bound** (the pilot needs a real work week; training needs people in rooms; go-live
  support needs business days) — **irreducible.** Assistance does nothing here.

The practical consequence: compression helps A–D and nothing after. **E and F cost what they
cost**, so slack can only be taken out of the build phases, and there is none left to take.

## Known bugs and gotchas

**THE ONE RULE THIS PROJECT KEEPS RELEARNING: capture platform payloads, never hand-author them.**
Every expensive hour in this build has come from writing a shape the platform accepts only in one
exact form, and getting it slightly wrong. The tell is always the same — the write SUCCEEDS
(200/201/204) and the thing renders blank or does nothing, so the failure surfaces only when a
human opens it. Confirmed instances: canvas control vocabulary (PA2108/PA2109), SharePoint view
CAML, SharePoint JSON formatters, Hero and Quick links web part JSON, and the modern Calendar
view. On 2026-09-07 alone the same mistake was made three times in one session against this
already-written rule.

The working method, in order: **read the shape off a real payload** (a run's action outputs, an
existing working example on the same site, or `get_flow`); if none exists, **create the thing once
in the UI and capture what the platform wrote**; only then script it. And **verify by opening the
result**, never by the status code.

Corollary for automation: when a UI control refuses two attempts at automated input, stop and hand
it to a human rather than trying a third. The Studio icon field cost real time and ended in a
discarded edit.


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

**RESOLVED 2026-09-05 — use the `chrome-devtools` MCP server, NOT the Claude Chrome extension, for authenticated SharePoint REST.** These are two different servers and only one of them works:

| | Tools | Cookie context |
|---|---|---|
| Claude Chrome extension | `switch_browser`, `navigate`, `javascript_tool` | **Isolated tab group.** Lands on the sign-in wall. |
| `chrome-devtools` MCP | `list_pages`, `select_page`, `evaluate_script` | **The user's own live session.** Authenticated. |

`chrome-devtools` **can** attach to Shane's actual running browser — `list_pages` then returns his real open tabs and `evaluate_script` fires REST with his cookies. **But this is not guaranteed.** Observed 2026-09-06: after a browser restart the MCP came back attached to a fresh instance with only `about:blank` and no session, and calls that had worked minutes earlier returned `403 UnauthorizedAccessException`. **Always call `list_pages` and re-confirm identity via `/_api/web/currentuser` after any gap or unexplained 403** — a 403 here means the session changed, not that permissions did. Verified 2026-09-05: `/_api/web/currentuser` returned `i:0#.f|membership|stratirus@d2pools.com`, and a 7-row MERGE against Crews succeeded.

**This removes the "agent guides, user pastes into the console" workaround for the whole class of SharePoint work** — provisioning, seeding, MERGE fixes, `cleanup.js`. Always call `list_pages` first and confirm identity with `/_api/web/currentuser` before any write; the tab has to already be open and signed in, and the account must be `stratirus@d2pools.com`.

**Console paste is a non-issue via this route, and worth knowing anyway:** Chrome's self-XSS guard is not a setting or a menu item. It appears only *after* you attempt a paste into the Console, and it asks you to type the words `allow pasting`. If a human does need to run a script by hand, DevTools → **Sources → Snippets** has no such guard and is the easier path.

**Superseded note (kept for context):** the Claude Chrome extension creates tab groups in an isolated cookie context, so fresh tabs land on sign-in walls even when the user's regular tabs are signed in as the same account. That remains true of *that* extension. It is not true of `chrome-devtools`.

**Desktop Commander `Start-Process pwsh.exe` MAY still inherit stdio.** The m365-interactive-auth skill flags this class of issue for Graph SDK. In practice, launching pwsh via `cmd /c start` from a DC-spawned shell has the same failure mode as `Start-Process` directly. When Microsoft auth writers matter, have the user open pwsh manually.

**Path length discipline.** Windows still enforces 260 chars in many cases even with `LongPathsEnabled = 1`. This repo lives at `C:\src\D2Scheduler\` (short). Do not add deeply-nested source generators or copy this repo into OneDrive-synced folders.

**RESOLVED 2026-09-03 — Daily Dispatch (Flow 1) crew filter. Fix applied and published.** Both `Filter_array` and `Filter_array_2` used:

```
@equals(item()?['Crew']?['Value'], items('Apply_to_each')?['Title'])
```

`Assignments.Crew` is a **Text** column, not a Lookup (there is no `CrewId`). The fix was one token in each action: `item()?['Crew']` directly, no `?['Value']`.

**The failure mode was not what the 2026-09-02 write-up said, and the correction matters.** `?['Value']` on a string does **not** evaluate to null — it throws:

```
InvalidTemplate: The evaluation of 'query' action 'where' expression failed:
property 'Value' cannot be selected. Property selection is not supported on
values of type 'String'.
```

So the flow did **not** ship empty tables. It behaved as a function of whether that day had data:

| Day has assignments? | Behaviour |
|---|---|
| **Yes** | `Filter_array` throws → `Condition_2` fails → **run FAILS, no email sent to anyone** |
| **No** | `from` is `[]`, the `where` is never evaluated → run succeeds, correct "nothing scheduled today" email |

Confirmed empirically in run history: 2026-08-27, 08-28 (×2), 08-29, 08-31 and 09-02 all **Failed**; 09-01 and 09-03 Succeeded with `Get_items` returning zero rows. The 09-02 failure carried exactly one assignment — ID 2, `D2-1001 · 2.2 Steel Installation`, `Crew: 'Devon Crew'` (a bare string).

**This also explains why the 2026-09-01 "verified in prod" pass missed it** — not because delivery was checked instead of content, but because **that day had no scheduled assignments**, so the broken expression was never evaluated. A green run on an empty day proves nothing about this flow. Any future verification must run on a day with at least one assignment covering it.

**Applied via the fully scriptable path** (no designer): `preview_update` → `update_flow` with `previewToken` → Dataverse `PublishXml` against `workflowEntityId` `f4e387a3-86a1-f111-b8dc-6045bd0195dd`. Published row verified: zero `['Crew']?['Value']` occurrences, two corrected `item()?['Crew']` refs, Unicode (`·`, `—`) intact, state `Started`.

**Note on `authentication`:** the definition was submitted with `"authentication": "@parameters('$authentication')"` on all five `OpenApiConnection` actions; the service **stripped it** from the published row. It is service-managed — do not treat its absence in a published export as drift.

**VERIFIED end-to-end 2026-09-03.** A manual run produced a populated dispatch email — the check no prior run had ever passed:

```
TODAY — Thu 09/03 · Devon Crew +3
Harrison Residence
2.2 Steel Installation
Open sub-phase to sign off
```

Exactly one of seven crews matched (the one with work that day); the other six correctly rendered "No sub-phase scheduled today."

**CRITICAL — the crew join key is `CrewID`, not `Title`. Fixed in Flows 1 and 3 on 2026-09-03.** The crew-filter fix above was necessary but *not sufficient*: a second, independent defect sat behind it. Three different value spaces were in play:

| | Devon |
|---|---|
| `Crews.CrewID` | `devon` |
| `Crews.Title` | `Devon Crew +3` |
| `Assignments.Crew` (as seeded) | `Devon Crew` |

None matched, so every crew filter returned zero rows even after the `?['Value']` fix. The browser tool is the authority and models crews as `{id:'devon', name:'Devon Crew +3'}` — **`CrewID` is the join key; `Title` is a display label** carrying a `+N` headcount suffix (headcount also lives in the separate `Size` column).

The bug was masked for crews whose `Title` has no suffix — `STL Shotcrete` matched by luck while all seven `+N` field crews never could. Do not let a passing subcontractor case suggest the join works.

Fixed:
- **Flow 1** `Filter_array` / `Filter_array_2`: `equals(item()?['Crew'], items('Apply_to_each')?['CrewID'])`. `Title` is still used for the email subject and heading — display only.
- **Flow 3** `Get_crew`: `$filter=CrewID eq '@{variables('touchedCrew')}'` (was `Title eq`). This also **restored the subcontractor capacity exemption** — with `Get_crew` returning zero rows, `Condition_unlimited` could never evaluate true, so `Unlimited=Yes` crews were being double-book-checked in violation of business rule 2.
- **Data:** all 5 Assignments rows reseeded to short codes (`devon`, `antonio`, `stl`, `harrison`).

**Any future flow, the canvas app, and the nightly browser-tool→Lists sync must write and join on `CrewID`.** The Flow 4 Select projection in `D2-Phase-B-Automations-Runbook.md` still needs this treatment.

**`az rest` output on Windows silently DROPS characters outside cp1252 — never rebuild a flow definition from an `az rest` capture.** Redirecting `az rest` to a file loses U+26A0 (warning sign), U+2192 (right arrow) and U+2013 (en dash) entirely — they vanish rather than becoming mojibake, and `PYTHONIOENCODING=utf-8` does **not** fix it. Characters that *are* in cp1252 (U+00B7 middle dot, U+2014 em dash) survive, which makes the loss look selective and easy to miss. Writing such a capture back would strip those glyphs from the live flow.

- To read a definition you intend to modify, use FlowAgent `get_flow` (MCP channel, faithful UTF-8). It confirmed Flow 3's glyphs are intact in production.
- To submit a definition, emit it with `json.dumps(..., ensure_ascii=True)` so every non-ASCII character becomes a backslash-u escape — uncorruptible through any console or transport.

**`authentication` is service-managed on the trigger too, not just actions.** The published rows of both flows contain no `"authentication": "@parameters('$authentication')"` anywhere, trigger included. Submitting it produces a spurious "trigger changed" diff. Omit it everywhere; the service owns it.

**FlowAgent `preview_update` reports container actions as changed with `fields: []`.** `If` blocks and the trigger show as "changed" with an empty field list even when byte-identical to live (verified against `get_flow`). Treat `fields: []` as differ noise; only entries with named fields are real changes.

**Assignments has four Required columns seeded NULL — `Locked`, `NotApplicable`, `PMSignOff`, `DurationDays`.** All are genuine Boolean/Number columns (not Choice), but REST item-creation bypassed required-field validation during Phase A seeding while the SharePoint form does not. Consequence: **the list form refuses to save any hand-edit** until all four are populated — you cannot change one date in the UI. Use SP REST `MERGE`, which validates only the fields named in the body. This will also hit the canvas app unless it writes via MERGE.

**RESOLVED 2026-09-03 — DateTime storage convention. All seeded dates were one day early, which silently inverted the work-week.**

The date columns were never the problem: `ScheduledStart`, `ScheduledFinish`, `WorkDate`, `Jobs.StartDate` and `Work Calendar.Date` are all already **DateOnly** (`DisplayFormat=0`). The stored *values* were wrong.

Site regional timezone is **(UTC-06:00) Central Time**. What matters is the wall-clock time a DateOnly value is stored at:

| Stored | SP connector reads it as | |
|---|---|---|
| `2026-09-02T00:00:00Z` — midnight **UTC** (Phase A seeding) | `2026-09-01` | **wrong, one day early** |
| `2026-09-05T05:00:00Z` — midnight **Central** | `2026-09-05` | correct |

**The convention: write DateOnly fields as a bare `'yyyy-MM-dd'` string via REST.** SharePoint interprets it in site-local time and stores local midnight (`05:00Z` under CDT, `06:00Z` under CST). Never write an explicit `...T00:00:00Z` — that is what Phase A seeding did and it is off by one.

**The serious consequence was in Work Calendar.** All 62 rows (52 Sundays + 10 federal holidays) were stored at midnight UTC, so the connector read every one as the *previous* day. Flow 1's `Get_items_4` checks `Date eq today` to skip non-work days, so the flow would have **terminated on Saturdays** (a work day — no dispatch) and **dispatched on Sundays** (not a work day). Business rule 4 was inverted at the boundary and nothing surfaced it, because the list UI displays the intended date.

Fixed 2026-09-03 by rewriting every affected row as a bare date string:
- **Work Calendar** — all 62 rows. Verified: 0 remaining at midnight UTC, and each row's stored date matches the date embedded in its own `Title` (`Sunday · 2026-09-06`), giving an independent cross-check.
- **Assignments** — all 5 rows (`ScheduledStart`, `ScheduledFinish`), plus `DurationDays` computed as the inclusive day span.
- **Jobs** — `StartDate`.

Re-verified end-to-end: Flow 1 now reads Assignment 2 as `2026-09-02..2026-09-05` (previously `2026-09-01`), `Get_items_4` correctly returns 0 rows on a Thursday, and the dispatch email still renders with rows.

**Same pass closed the Required-but-NULL gap:** `Locked`, `NotApplicable`, `PMSignOff` set to `false` and `DurationDays` populated on all 5 Assignments rows, so the SharePoint list form is usable again. Any newly created Assignment must set all four at creation, or the form will refuse to save edits to that row.

**Two seed-data issues found and deliberately left alone** (flagged, not silently changed):
- Assignment **1** carries `InstallerSignOff = true` with note `"Chrome-driven test"` — a leftover from an earlier Sign-off Intake test.
- Assignment **4** (`stl`) is scheduled `2026-09-06 → 09-07`, and 09-06 is a **Sunday**. This violates business rule 4 in the seed data itself; it was invisible while the calendar was off by one.

**RESOLVED 2026-09-07 — Flow 3's trigger condition was a no-op; replaced with version-history
comparison.** The Rev D §06 condition referenced `@odata.oldValue` properties that
`GetOnUpdatedItems` **never emits**, so every clause compared against null, the condition always
passed, and every edit to any Assignments row fired the flow — including every sign-off write, the
exact quota burn the condition existed to prevent.

**The fix reads the row's own version history**, which is the only change-detection option that
adds no writes and therefore cannot re-trigger the flow it guards:

```
GET _api/web/lists/GetByTitle('Assignments')/items(<id>)/versions
    ?$top=2&$select=VersionLabel,Crew,ScheduledStart,ScheduledFinish
```

`/versions` is **newest-first and INCLUDES the current version** — verified against the live list,
not assumed — so `[0]` is what was just written and `[1]` is what it was before. The flow proceeds
only if `Crew`, `ScheduledStart` or `ScheduledFinish` differ, or if fewer than two versions exist
(a brand-new row must always reconcile). Otherwise a `Terminate` ends the run.

Verified both directions on TEST row 25: a notes-only edit skipped at the gate
(`Skip_non_scheduling_edit -> Succeeded`, everything downstream Skipped), and a `ScheduledFinish`
change proceeded through `Get_touched_assignment`.

Options deliberately rejected: a `SkipReconcile` flag and shadow columns both add a write to the
very list whose writes are the problem, and reintroduce loop risk. Plain acceptance was viable on
quota — batching ticks had already cut Assignments writes from ~295 per pool to a handful — but it
does not fix **alert noise**, which is the real cost: the alert goes to the job's PM, and repeated
alerts for a conflict they already know about train people to ignore alerts.

**Dependency worth knowing: this relies on versioning staying enabled** on Assignments (currently
on, 50-version limit). If versioning is turned off, `/versions` returns a single row and the flow
falls back to reconciling every edit — degraded, not broken.

**Flow 3 is now STARTED.** It was stopped throughout the Phase C build.

The stale lookup-shape assumption in `D2-Phase-B-Automations-Runbook.md` has been corrected (L74, L80, the Flow 4 Select projection, and the "Common gotchas" entry that wrongly claimed `Crew` filters need `CrewId eq 3`). `sessions/2026-08-26a-daily-dispatch-handoff.md` (~L143, L151) still carries it and was deliberately left alone — session logs are historical record, not instructions.

Related: `sessions/2026-08-28a-daily-dispatch-test-debug.md` blames the `$orderby Crew/Title` failure on "SP OData can't order by an expanded lookup". That diagnosis is wrong — `Crew` is not a lookup at all, so `Crew/Title` was never a valid path.

**`az login` silently uses the cached tenant — the FlowAgent version of the `Add-PowerAppsAccount` trap.** Without `--tenant`, `az` reuses whichever tenant last authenticated (Tennetech LLC, `20f64e0e-…`, in Shane's case). FlowAgent's `doctor` then reports **all checks passing** and `list_environments` returns exactly one environment — "Tennetech LLC (default)". D2 Automation is invisible, with no error anywhere. Always pin:

```powershell
az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4
```

and confirm with FlowAgent `whoami` that `tokenIdentity.tenantId` is `f24d9b39-…` before trusting any flow listing.

**FlowAgent rejects `authentication` in action inputs, but the live exports all contain it.** `validate_flow` fails any definition carrying `"authentication": "@parameters('$authentication')"` inside an action's `inputs` (rule `extra-authentication`) — the Flow API injects it on create. The service then writes it back, which is why every `OpenApiConnection` action in the Flow 1 and Flow 2 exports has it. Correct at runtime, invalid at authoring time: strip it from actions before importing, leave the trigger's copy alone. Also note FlowAgent takes `definition` / `connectionRefs` / `name` / `state` as four separate arguments — our `flows/definitions/*.json` nest all four under `properties`, so they must be split on the way in. Mapping table is in `flows/README.md`.

**`Harrison Residence` / `D2-1001` is NOT a real pool — it is the browser prototype's hardcoded demo job** (`pool-scheduler.html` L258: `newJob('Harrison Residence','1420 Camino Real','Thousand Oaks','CA','91360')`), carried into SharePoint verbatim during Phase A seeding. Assignments 1-5 hang off it. **D2 production therefore contains no real job data at all** — only this demo job and the `TEST-900x` rows. The first real pool arrives in Phase E. Two things follow: the seed-data "defects" (Assignment 4 spanning Sunday 09-06, Assignment 1's stale sign-off) are demo-data artifacts rather than live scheduling errors, and this is also **why the Phase C spec referenced `Jobs.State` and `Jobs.ZIP`** — the prototype's job model carries them, the SharePoint list does not.

**PM assignment on Harrison Residence D2-1001 is a placeholder.** `Jobs.ProjectManager` was added to schema 2026-09-01 (User/Person, Group D2, UserSelectionScope=0 — tenant-members only, no external UPNs). Harrison row seeded with stratirus@d2pools.com (display name "D2 Bot" — external PMs like stalbot@stratirus.com are rejected by the scope=0 constraint). Needs to be updated to the real D2 PM before live-fire testing. Every future new Job row must also have PM set at creation or the reconciliation flow's DM step won't resolve.

**Tenant licensing — verified from Graph 2026-09-04. Every paid seat is consumed; there is nothing spare to recover.**

| SKU part number | Product | Enabled | Consumed | Free |
|---|---|---|---|---|
| `SPB` | Business Premium | 2 | 2 | **0** |
| `O365_BUSINESS_PREMIUM` | Business **Standard** | 7 | 7 | **0** |
| `MICROSOFT_365_COPILOT_FOR_BUSINESS` | Copilot | 4 | 4 | **0** |
| `O365_BUSINESS_ESSENTIALS` | Business Basic | **0 — Suspended** | 2 | −2 |
| `EXCHANGE_S_ESSENTIALS` | Exchange Online Essentials | **0 — Suspended** | 6 | −6 |

- **`O365_BUSINESS_PREMIUM` is Business STANDARD**, not Premium — legacy Microsoft naming. Business Basic is `O365_BUSINESS_ESSENTIALS`; real Business Premium is `SPB`. Don't misread the seat math.
- **D2 Bot (`stratirus@d2pools.com`) holds Business Standard**, which includes Power Apps for M365 seeded rights. **This licenses the entire Phase C build and most of device testing with no new purchase.**
- The two `Suspended` rows are **dead subscriptions with 8 stale assignments**, not reclaimable capacity — GoDaddy-era leftovers from D2's move to direct Microsoft billing in late July 2026. The Aug 24 "ghost licensing" question is now closed: it frees nothing.
- 19 disabled accounts (gmail, thryv.com, emich.edu, plus typo-duplicate pairs) are the same migration debris. Harmless; tidy when convenient.

**Crew-lead licensing — canvas app confirmed, seats not yet bought (2026-09-04).**

- **There are no crew-lead accounts in the tenant at all.** The dependency is *create ~10 identities + mailboxes*, then licence, then install and sign in per handset — not merely "buy 10 seats." That lead time sits upstream of Phase E and is the item to put in front of David/Don.
- **Business Basic (~$6/user/mo) is the cheapest SKU that works. This is now a verified floor, not a preference.** Standard's premium is desktop Office, which phone-based crew leads never touch, so Standard is overspend.

- **CORRECTED 2026-09-05 — Microsoft 365 F1 does NOT include Power Apps or Power Automate.** The earlier claim here that F1 was "the frontline SKU built for exactly this population, seeded Power Apps + Teams" was **wrong**, and it was about to be taken into a client licensing conversation as a ~$190/yr option. Microsoft's own plan-comparison table is explicit: `Power Apps for Microsoft 365` and `Power Automate for Microsoft 365` are both **No** for M365 F1, and **Yes** for Business Basic, Business Standard and F3. ([Microsoft 365 and Office 365 platform service description](https://learn.microsoft.com/office365/servicedescriptions/office-365-platform-service-description/office-365-platform-service-description#features-available-across-all-plans))

  Consequences that follow, and they simplify the decision rather than complicate it:
  - **F1 is off the table at any price.** A crew lead on F1 could not open the canvas app.
  - **F3 (~$8/user/mo) would work but costs more than Business Basic** and adds only desktop-adjacent frontline features D2 does not need.
  - **The mailbox is no longer a tradeoff.** The whole reason to consider a mailbox-less SKU was the F1 saving. With F1 gone, Business Basic's mailbox comes free with the cheapest working option, so **Flow 1's email dispatch stays as built and verified** and there is no reason to port dispatch to Teams.

  Price with D2's direct-Microsoft rep; the per-seat figures predate the GoDaddy exit. But the *shape* of the recommendation is settled: **~7 Business Basic seats.**
- **Dataverse remains correctly ruled out** — Power Apps Premium at ~$20/user/mo is ~$2,900–4,800/yr across this user set, plus a full rebuild.

**PM proxy sign-off is mandatory regardless of the licensing path — this is load-bearing for the canvas app design.** The four subcontractor crews (George, Armondo, STL, Brothers) are `Unlimited = Yes` with **no M365 seat by design**, so they can never sign off for themselves. Someone in the office must sign off on their behalf. Consequences:

- The app **must** have a crew/assignment picker and proxy sign-off from day one. Retrofitting it later is a screen-flow rewrite.
- "PM signs off for everyone" is therefore a *subset* of the app you have to build anyway — so D2 can **go live with zero new licences** and add crew seats per-crew afterwards with **no rebuild**.
- If PM-proxy becomes permanent rather than a starting point, the costs are non-monetary and real: `InstallerSignOffBy` records the PM rather than the person who did the work (attestation-by-proxy, weaker for warranty/QC than the crew-lead signature); 295 tasks/pool funnel through 2 PMs, reinstating the data-entry bottleneck the design exists to remove; and every sign-off becomes retrospective, making `WorkDate` load-bearing rather than an exception valve.

**OPEN — `Crews.LeadEmail` holds placeholder data, and there are 7 field crews, not ~10** (live schema read 2026-09-04; this supersedes the 2026-08-25 note that the column was empty).

- All seven real field crews carry the same value, `stalbot@stratirus.com` — an **external UPN that does not exist in the D2 tenant**, so no D2 user can ever match it, and because all seven share it `LookUp` returns only the first match (`saul`). Worse than empty: it looks populated.
- **Only 7 crews actually need a sign-off identity** — `saul`, `guillermo`, `harrison`, `antonio`, `devon`, `cirilo`, `campos`. The other 7 rows are `Unlimited = Yes` buckets (`stl`, `george`, `armondo`, `brothers`, `subcon`, `unassigned`, `office`) that never sign off. **Crew-lead licensing is therefore ~7 seats, not 10** — ~$504/yr on Business Basic at list. (Ignore any ~$190/yr F1 figure in older notes; F1 has no Power Apps.)

- **DONE 2026-09-05 — all seven placeholders cleared.** Verified against live: `cleared 7` (`saul`, `guillermo`, `harrison`, `antonio`, `devon`, `cirilo`, `campos`), `failures []`, `stillSet []`, row count unchanged. The live read also confirmed the split exactly: 7 `Unlimited=false` field crews all held `stalbot@stratirus.com`, and the 7 `Unlimited=true` buckets were already empty. `canvas-app/blank-lead-email.js` is retained and is idempotent, so it is safe to re-run as a check. Empty is strictly safer than wrong here: populated-but-unmatchable makes the app *look* correct while showing every crew lead Saul's assignments, whereas empty falls through to the PM-proxy picker that has to exist anyway for the four `Unlimited` subcontractor crews. Reseed with **userPrincipalName** once the identities exist.
- `subcon`, `unassigned` and `office` are pseudo-crews, not companies.

**Canvas app authoring — YAML authoring works, but the loop is NOT headless. Corrected 2026-09-06g.**

This reverses the "headless YAML authoring CONFIRMED WORKING" entry written earlier the same
day. That claim was verified **in Studio only**, and Studio is the one client that cannot
detect this bug.

**A canvas app has two representations of the same screens, and they can silently diverge:**

| Client | Reads | Result with our loop |
|---|---|---|
| **Studio (Edit)** | `Src/*.pa.yaml` (because `packed.json` sets `LoadFromYaml: true`) | Correct — renders the authored YAML |
| **The player (Play)** | the compiled control model, `Controls/*.json` | **Stale** — renders whatever was last compiled |

`pac canvas pack` **does not compile YAML.** It copies `Controls/*.json` verbatim out of the
`.msapr` residual and writes the YAML alongside. So an imported app shows the new screens in
Studio and the *old* ones in the player, with no error anywhere.

**Publishing does not fix it.** Studio only creates a new published version when the document
is genuinely dirty. Loading YAML for display does not mark it dirty, so Publish re-publishes
the previous version indefinitely. Two full Save+Publish rounds changed nothing.

**The dirty Studio save is IRREDUCIBLE. Re-tested from scratch 2026-09-07 and confirmed — do
not spend another cycle looking for a headless publish.**

Shane's hypothesis was that the pixel nudge had never actually been necessary, and that a stale
open Studio tab had been corrupting every test. It was a good hypothesis: every earlier test did
have Studio open, and a stale tab demonstrably *can* revert a deploy. The two explanations fit
the evidence equally well and had never been separated. They have now.

**A headless publish endpoint EXISTS and returns 200:**

```
POST https://api.powerapps.com/providers/Microsoft.PowerApps/apps/{appId}/publish?api-version=2017-05-01
```

(App id for D2 Sign-off is `6bad1fae-7f3b-42d7-a63f-48a63e1e8771`. `api-version=2016-11-01` is
rejected with `UnsupportedApiVersion` — the route is real, only the version was wrong, which is
what makes this look promising right up until you test it.)

**It does not work.** Deploying and then publishing purely by API, with Studio never opened,
left the player serving the old version. `lastPublishTime` stayed `null`, the app kept reporting
*"A new version of this app is coming. We'll let you know when it's available."*, and a normal
Studio Edit + Publish with no control nudge **silently failed**. Only the 1px move + Ctrl+S +
Publish made the new version live.

So the constraint is not publishing and not a stale tab. It is that **only a Studio save compiles
the YAML into the control model the player reads**, exactly as originally diagnosed. Both the
stale-tab rule above and this one are real and independent.

**THE STUDIO DANCE IS NOW AUTOMATED. Proven end to end 2026-09-07 — Claude can publish the canvas
app with no human step.**

The save is still required (everything below still holds), but it no longer has to be Shane. The
whole Studio UI is exposed in the accessibility tree, so `chrome-devtools` can drive it. A full
round trip was proven twice: deploy a marker, publish it, see it in the player; deploy its
removal, publish, see it gone.

**Procedure** (chrome-devtools MCP, attached to a browser signed in as `stratirus@d2pools.com`):

1. `python canvas-app/deploy.py`
2. `navigate_page` to
   `https://make.powerapps.com/e/<env>/canvas/?action=edit&app-id=%2Fproviders%2FMicrosoft.PowerApps%2Fapps%2F6bad1fae-7f3b-42d7-a63f-48a63e1e8771`
3. `wait_for` a control name from the tree, e.g. `["lblHeaderTitle"]`. Waiting on `"Tree view"`
   is **not** enough — it appears while Studio is still showing "Getting things ready".
4. Dismiss the "Welcome to Power Apps Studio" dialog if present. Tick *Don't show me this again*
   first; it has been ticked, so it should not reappear.
5. Click the control's **treeitem**, then click a canvas element (`generic "Double click to edit
   text"`). **Both clicks are needed** — selecting in the tree leaves focus on the tree, where
   arrow keys navigate the tree instead of nudging the control.
6. `press_key` `ArrowDown`, then `ArrowUp`. 1px down and back: dirty, net zero.
7. **Verify it actually dirtied** before saving: in a snapshot, `menuitem "Undo (Ctrl+Z)"` loses
   its `disabled` attribute. If it is still disabled, step 5 failed and the save will be a no-op.
8. `press_key` `Control+s`.
9. Confirm the save via the **iframe's document title**, which becomes
   `"D2 Sign-off - Saved (Unpublished) - Power Apps"`. `wait_for` matches visible text only, so
   waiting on `"Saved (Unpublished)"` **times out even though the save succeeded** — take a
   snapshot and read the `RootWebArea` title instead.
10. Click Publish. It is `button "Publish"` or `menuitem "Publish (Ctrl+Shift+P)"` depending on
    window width, so match on the word rather than the role.
11. `wait_for` `["Publish this version"]`, click that button.
12. `wait_for` `["Publish successful", "is now available to everyone"]`.

**Verifying in the player needs a cache-bypassing reload.** Navigating to
`https://apps.powerapps.com/play/e/<env>/a/<appId>` right after publishing still shows the OLD
build plus *"A new version of this app is coming"*. `navigate_page` with `type: "reload"` and
`ignoreCache: true` then shows the new one. **That banner means stale cache, not a failed
publish** — it wasted real time before this was understood.

**The one human dependency left is authentication.** `chrome-devtools` attaches to a browser
instance with no session, and it must be signed in **as `stratirus@d2pools.com`**, not
`stalbot@stratirus.com` — the same wrong-account trap as `az`, `pac` and `Add-PowerAppsAccount`.
Shane signs in once; the session then persists for the browser's lifetime. When it lapses, the
Studio URL lands on `login.microsoftonline.com` and he has to sign in again.

**Do not let this reduce batching.** Automation makes a publish cheap for Shane, not free for the
tenant: every publish is a real version in a live client environment. Keep batching changes.

**REFINED 2026-09-07 after a second experiment — the blocker is VERSION CREATION, not compiling.**

The compiled control model stores every formula as a plain string in `Rules[].InvariantScript`,
so a formula change can be written directly into `Controls/*.json` inside the `.msapr`, keeping
the YAML in sync, and packed with no Studio compile. That was tested: the edit was confirmed
present in the packed `.msapp`, the solution imported, and the app was published by API (HTTP
200). **The player still served the old version**, showing the same *"A new version of this app
is coming"* banner.

So Studio's unique contribution is not compilation. It is that **only a Studio save produces an
app version the player will serve.** A solution import changes the app document without creating
a servable version, and the publish API then publishes the newest *saved* version, which is still
the old one. This also explains why a Studio Publish with no control nudge silently does nothing:
there is no new saved version to publish.

Practical upshot is unchanged, and now understood rather than merely observed: **deploy, then
Studio nudge + Ctrl+S + Publish.** Do not try to route around it by pre-compiling, by patching
`Controls/*.json`, or by calling the publish API. All three were tested and none works.

**Consequence — BATCH THE WORK. Shane's standing request, 2026-09-07.** Every deploy costs him a
manual Studio dance, so do not deploy one change at a time. Accumulate a coherent set of changes,
deploy once, and ask for one publish. Ask for a publish only when a batch is genuinely ready to
test or when a test is actually blocked on it.

Two things that force an *extra* Studio visit, so plan them in advance rather than discovering
them one at a time:

- **Attaching a flow to the app** can only be done in Studio, and the app cannot reference a flow
  in Power Fx until it is attached.
- **Changing a flow's trigger signature** invalidates the app's cached copy of it. Studio's
  Power Automate pane offers **Edit / Refresh / Remove from app** on each flow, and **Refresh
  alone fixes it** — a remove-and-re-add is NOT needed. (This entry previously claimed it was;
  corrected 2026-09-07 after adding a third parameter to `D2 - Reopen Sign-off`: App checker went
  from Formulas (3) to (2), clearing `Invalid number of arguments: received 3, expected 2` on
  `recConfirmGo.OnSelect`.) Refresh also marks the document saved by itself, so the 1px nudge is
  unnecessary on that trip.

Capture new control vocabulary in the same visit for the same reason — dropping a control in
Studio once to read the YAML it generates is cheap when bundled, expensive as its own trip.

**CLOSE Studio before deploying, and open it fresh afterwards.** Studio holds the app in
memory from the moment the tab is opened. If a tab is already open when `deploy.py` runs, the
subsequent Ctrl+S writes that **stale** in-memory model back, silently reverting the deploy —
no warning, no conflict, no error. Observed 2026-09-07: a deploy wiring the app to a new flow
was reverted this way, and the only symptom was that the flow had zero runs. The published YAML
still carried the previous version of the formula.

**Verify a deploy landed by reading the published YAML, not by assuming**, e.g.
`pac canvas download` then check the formula is present — that check is what caught this.

**The working deploy sequence — the Studio step is mandatory, not a validation nicety:**

```
python canvas-app/deploy.py          # YAML syntax gate, pack, solution export/swap/import
open the app in Studio               # it loads and validates the YAML
select any control, press Down then Up   # 1px move and back: no net change, marks it dirty
Ctrl+S, wait for "Saved"             # THIS is what compiles YAML -> Controls/*.json
Publish -> Publish this version      # now the player gets it
```

**Diagnosis evidence, so this is not re-litigated:** `Controls/4.json` in the live published app
was byte-identical to the stale `.msapr` residual across three downloads spanning two publishes,
and its control tree was the seed app's scratch screen (`Gallery1`, `Image1`, `Title1`,
`Subtitle1`, `DatePicker1`, `Label1`) — exactly what the player rendered, and nothing like the
authored YAML. Confirmed on a second, different computer, which ruled out browser caching.

**`pac canvas download` is NOT a check on what the player serves.** It returned the same
artifact this repo imported, every time, regardless of Studio activity — almost certainly the
solution component rather than the live published document. **Verify canvas changes by playing
the app, never by downloading it.** Trusting the download is how the original wrong conclusion
was reached.

**First run of a rebuilt app prompts for connection consent** ("Allow D2 Sign-off to access your
data?" — SharePoint + Office 365 Users). Until Allow is clicked the galleries are empty and the
app looks broken but is not.

**The `deploy.py` YAML syntax gate.** `pac canvas pack` also does not *parse* the YAML — it packs
invalid files without complaint, so a syntax error surfaces only as Studio refusing to open the
app. `deploy.py` now parses every `*.pa.yaml` before packing and refuses to deploy on error.
Watch for one trap in particular: **a plain YAML scalar containing `": "` is read as a mapping.**
`Text: ="Sign off: " & x` fails as `PA1001 YamlInvalidSyntax`; use a block scalar (`Text: |`) for
any formula containing a colon-space. Requires `pyyaml`.

Loop and rationale in `canvas-app/README.md`; run it with `python canvas-app/deploy.py`.

Three facts still hold and are what make YAML authoring worth keeping at all:

- **Connections survive.** They live in the `.msapr` residual (`References/DataSources.json`, and
  `Properties.json`'s `LocalConnectionReferences`), which `unpack` writes beside `Src/` and `pack`
  folds back in. All 7 sources (Jobs, Assignments, Tasks, Crews, Office365Users,
  `D2-Sign-offIntake`) ride through untouched. **Never delete the `.msapr`, and never rebuild
  sources from a blank app** — that is how you would silently drop every connection.
- **The solution swap is accepted.** `customizations.xml` references the app by path only, with no
  hash or checksum.
- **Studio is the compiler**, in the literal sense established above. It validates the YAML on open
  and reports precise errors, e.g. `Src\Screen1.pa.yaml(16,9) : error PA2109 : Unknown variant
  'verticalGallery' for control type 'Gallery'`. Treat a failed open as a build error.

**Git Integration is RULED OUT for D2 — licensing, not capability. Investigated 2026-09-06g.**

Microsoft deprecated the very commands this loop runs on: the `pac canvas` reference now states
**"The `pack` and `unpack` commands are deprecated. To source control your canvas app, use the
Power Platform Git Integration."** Git Integration is GA, works natively on `.pa.yaml` with no
conversion, and would replace the manual Studio save outright — *"Any changes are restored with
the app when you pull changes to your environment."* That is exactly the compile step the pixel
nudge is faking.

**It is still not available to us.** The prerequisite is explicit: *"Dataverse Git integration is
a feature of **managed environments**. Development and target environments must be enabled as
managed environments."* And Managed Environments is *"a suite of **premium** capabilities …
included as an entitlement with **standalone** Power Apps, Power Automate, Copilot Studio, Power
Pages, and Dynamics 365 licenses."*

**Standalone** means the ~$20/user/mo premium SKUs. It does **not** include the seeded
*Power Apps for Microsoft 365* rights that come with Business Basic and Business Standard, which
are the entire licensing basis of this build. Adopting Git Integration therefore reintroduces the
premium per-user cost that ruled out Dataverse in the first place, to buy nothing but a nicer
deploy loop. D2 holds zero standalone licenses today.

**Provider is not the constraint** — Azure DevOps is the first-class provider (GitHub support only
arrived in 2026 wave 1), and this repo is already on Azure DevOps. The blocker is Managed
Environments alone.

**Consequence: the manual Studio save is permanent, not a stopgap.** Do not spend time looking for
a headless publish again, and do not automate the nudge by driving the browser — it is a ~30 second
manual step and Studio's UI is not a stable automation target. `deploy.py` prints the four steps on
every run. Revisit only if D2 ever buys standalone Power Apps licenses, which is the same decision
as adopting Dataverse.

**Control vocabulary can only come from Studio.** The published schema does not enumerate it (`Variant` is merely "a non-empty string"), so **do not guess control or variant names.** Drop the control in Studio once, save, publish, download, unpack, and read what it generated. Known-good so far:

| Control | Exact YAML |
|---|---|
| Gallery | `Control: Gallery@2.15.0` + `Variant: BrowseLayout_Vertical_TwoTextOneImageVariant_ver5.0` |
| Label | `Control: Label@2.5.1` |
| Checkbox | `Control: Classic/CheckBox@2.1.0` |
| Date picker | `Control: Classic/DatePicker@2.6.0` |
| Icon | `Control: Classic/Icon@2.5.0` with `Icon: =Icon.ChevronRight` |
| Rectangle | `Control: Rectangle@2.3.0` |

Omitting `@version` is legal and takes the current version. Font is `=Font.'Open Sans'`.

**`pac canvas download` reads the PUBLISHED version.** A Studio Save alone is invisible to the CLI — publish, or you will read stale YAML and conclude the write failed. Second instance in this project of a published-vs-draft split looking like a silent failure, after the flow draft-row mechanism.

**Microsoft documents this as unsupported** — the `pa.yaml` docs say the files are read-only, "not used when an app is loading", that edits "are ignored and might be lost", and that external editing is supported only via Power Platform Git Integration. It demonstrably works today. The risk is accepted deliberately because the fallback is cheap: the Power Fx is identical either way, so if the mechanism breaks, the same formulas get pasted into Studio and nothing is lost but time. **Git Integration remains the supported alternative** and this repo is already on Azure DevOps, with a Source control tab on the solution.

**Superseded reasoning from earlier the same day, kept so the dead ends are not re-walked:** Full reasoning in `canvas-app/README.md`. The short version: `pac canvas` round-trips YAML cleanly, but **data connections are not expressible in YAML** (they live in the `.msapr` residual, and this app needs four SharePoint connections plus the Flow 2 connector), there is **no `pac canvas upload`** verb, and Microsoft scopes the format to "review changes made within Studio and minor edits (Preview)". Use `download` + `unpack` after each Studio session to get reviewable formula-level diffs into git. That is a real gain we did not have before, and it is all the YAML path is good for. The spike cost about half an hour and caught this before it surfaced at Day 1 Step 2 of the Phase C spec.

**Superseded detail from the same day, kept because the dead ends are worth not re-walking:**

`pac` CLI 2.11.2 is installed and `pac canvas` offers `download / list / pack / unpack / validate / create`. **`pack` and `unpack` are flagged Preview by Microsoft.** `pack` requires a complete `--sources` tree in `SourceCode` layout, and hand-authoring that tree from nothing is a very different proposition from repacking one that `unpack` produced.

Confirmed dead ends for bootstrapping a seed `.msapp` without the designer:
- `pac canvas list` against D2 Automation returns **empty** — no canvas app exists yet to download.
- `pac canvas create` builds an app **from a custom connector**, and `pac connector list` reports **no connectors in the environment**.

**So the seed app must be created once in Studio.** The plan: create a blank app, `pac canvas download` it, `unpack` it, then author against a known-good tree rather than inventing one. Decide headless-vs-Studio on the evidence of that round-trip, and do not commit to headless before it. This is deliberately cautious because the Phase B lesson applies exactly here: authoring compresses, undocumented-platform discovery does not.

**`pac` auth — the cached-tenant trap bites here too.** `pac auth list` showed `stalbot@stratirus.com`, the third instance after `az login` and `Add-PowerAppsAccount`. Fixed with a named profile:

```
pac auth create --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4 --name D2
```

Sign in as **`stratirus@d2pools.com`**. Verify with `pac env list`, which must show `D2 Automation` / `2710a01b-6cfa-e820-b338-2286f2649300` / `https://org4ed2f722.crm.dynamics.com/`.

**REST from the browser: always use the ABSOLUTE site URL.** A leading-slash path such as `/_api/web/lists/GetByTitle('Crews')` resolves against the **root** site and returns `List 'Crews' does not exist at site with URL 'https://netorgft15040037.sharepoint.com'`. Every call must be prefixed with `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`. The list is on the subsite, and the 404 names the root URL, which makes it look like a permissions problem when it is a path problem.

**Phase C canvas app is built by Stratirus, IN D2 PRODUCTION — env decided 2026-09-04, ownership settled 2026-09-05.** No mirror environment, no stub flow, no cross-tenant port. The build happens in **D2 Automation** against the real lists, signed in as **D2 Bot** (`stratirus@d2pools.com`, Business Standard, which carries Power Apps for M365 seeded rights), calling the real published Flow 2. This removes roughly a day of port-and-re-point overhead from the only week that still has slack — Phases E and F are calendar-locked.

The third-party risk is gone, but **the production risk is not** — this is still a live client tenant and still a shared credential. The safety rules are in `D2-Canvas-App-Handoff-Contract.md` §6a and remain load-bearing: never touch Assignments 1–5 or `D2-1001` (use the `TEST-900x` rows, and do **not** delete them — that removal is sequenced for just before the pilot); stop Flows 3 and 4 before bulk writes, because Flow 3's no-op trigger means every Assignments edit burns a run; calling Flow 2 writes real sign-off data; everything logs as D2 Bot so there is no individual attribution; and do not edit the five published flows in the designer.

`canvas-app/mirror-provision.js` is retained as the authoritative live-schema capture (more accurate than the obsolete `D2-Provision-Lists.ps1`) but is **not needed** for this build.

**`Patch()` DOES work from the canvas app. CORRECTED 2026-09-07 — an earlier entry here said
the opposite in strong terms and was wrong.**

Proof: with the app freshly published, one task row was tapped and nothing else — no Back, no
sign-off. Task 142 came back from SharePoint with `Complete=true` and
`CompletedOn=2026-09-07T14:29:35`, while the tick flow's most recent run was still 13:05:12.
Nothing but the app's own `Patch` could have written it. Two earlier writes (tasks 139 and 140,
at 14:23:58 and 14:24:11) show the same signature.

**Why the earlier conclusion looked airtight, and why it was wrong.** A clean single-tap test had
left every Tasks row at `Complete=False` with no error raised, which is genuinely what a dropped
write looks like. But that test ran while two other faults were live and unknown: a stale Studio
tab was silently reverting deploys, so the published build was not the one being reasoned about,
and `Classic/CheckBox` OnCheck never fired, so in some builds no write was ever attempted. The
most likely direct cause is that the app's SharePoint connection had not yet been consented for
writes — the "Allow D2 Sign-off to access your data?" prompt granting Read *and Write* was
accepted partway through this sequence.

**The lesson is about method, not Power Apps.** Three faults were in play at once and each masked
the others, so a single clean-looking experiment produced a confident wrong answer. When several
things are broken, an experiment only proves something if every *other* variable is known-good —
and here the build under test was not even known to be the build deployed. Re-verify a
load-bearing negative before building a workaround on top of it.

**What this means in practice:**

- `Patch(<SharePointList>, ThisItem, {...})` is a valid way to write, and is what the task rows
  use. It persists immediately, per tap.
- **`D2 - Task Tick Batch` is retained anyway** and is not dead weight: it still writes the
  `TasksTotal` / `TasksComplete` counters on the Assignment in the same call, and sending the
  whole task list keeps that write idempotent. Sign-off calls it first for exactly that reason.
- **Flow 2 must still be used for sign-off**, because `InstallerSignOffBy` is a Person column and
  cannot be set by email through the connector — it needs the numeric site-user id from
  `ensureuser`. That has nothing to do with whether `Patch` works.

**RESOLVED 2026-09-07 — the counters are a cache, and a nightly sweep now repairs them.**
`TasksComplete` is written only when the crew lead leaves the task screen or signs off, while
individual ticks persist per tap, so closing the app mid-edit strands the counter behind the rows.
That matters because Don's summary emails score compliance from the counters, not from the Tasks
list. Fixed by `D2 - Counter Reconciliation` rather than by writing the counter on every tick,
which would burn a Flow 3 run per tick — 295 per pool.

The first run repaired six rows and found more than expected: **four Harrison rows had NULL
counters**, not merely stale ones, which would have rendered blank in the summaries. It also
corrected Assignment 1's long-standing 6/6-against-unticked-rows divergence to 0/6. Note that
disposes of the deliberately-kept "app must cope with disagreeing counters" test case — the app
was observed coping with exactly that state beforehand, so nothing was lost.

**The SharePoint connector returns a lookup as `Assignment` + `Assignment#Id`, NOT `AssignmentId`.
Cost a build cycle 2026-09-07.**

`AssignmentId` is the **REST/OData** name. It is correct in `cleanup.js`, **and** it is correct in
a server-side `$filter=AssignmentId eq 14` — which is cheaper than pulling rows and using a
Filter array, and is the better option where it fits. What it is *not* is a key in the
connector's **output**, which is where the mistake was made. The connector returns:

```json
"Assignment":     {"@odata.type": "...SPListExpandedReference", "Id": 1, "Value": "D2-1001 · 2.1 Rebar Delivery"},
"Assignment#Id":  1
```

A `Filter array` on `item()?['AssignmentId']` therefore matches **nothing**, silently — every
group comes back empty and any guard on "did we find rows" skips the work. The first Counter
Reconciliation run reported a confident `43 assignments checked, 282 tasks scanned, 0 repaired`,
which looks like a clean bill of health and was in fact a total mismatch. Use
`item()?['Assignment']?['Id']`.

This is the **fourth** time this project has lost time to assuming a field or join name instead of
reading it — after `Crews.Title` vs `CrewID`, `Assignments.Job.Value` vs `JobNumber`, and the
`Crew` lookup-vs-text confusion. **Read the shape from a real payload before writing the
expression**; a run's action outputs are the cheapest way to do that.

**`Classic/*` control events did not fire in this app — but check the ordinary causes FIRST.
Refined 2026-09-07 after a clean-context check challenged the original wording.**

The standard reasons a handler does not fire, in order: `DisplayMode` is `View`/`Disabled`;
**z-order** — the topmost control under the tap consumes it, so a transparent or full-bleed
control over a row swallows that row's `OnSelect`; and `OnCheck`/`OnChange` fire on **user
interaction only**, not when `Default` changes or `Reset()` runs. Rule those out before blaming
the control type.

They were ruled out here. The checkbox failure was observed on a build that predated the
full-screen confirm scrim, and the Back button was fixed by swapping `Classic/Icon` for a `Label`
**while leaving the scrim in place** — if z-order were the cause, the Label would have failed too.
So the observation stands, but it is two instances in one app, not a platform law:

The controls render correctly, and Studio round-trips their event properties verbatim, but the
handlers never run:

| Control | Event | Fires? |
|---|---|---|
| `Gallery` | `OnSelect` | yes |
| `Rectangle`, `Label` | `OnSelect` | yes |
| `Classic/CheckBox` | `OnCheck` / `OnUncheck` | **no** |
| `Classic/Icon` | `OnSelect` | **no** |

Both cost a diagnosis cycle. The checkbox looked like a failing write; the Back button looked
like a broken formula. **Build anything interactive from `Gallery`, `Rectangle` or `Label`.**
`Classic/*` is fine for display only — `Classic/Icon` is still used as the inert tick indicator,
and `Classic/DatePicker` is read for its value, which works.

Practical consequence for the task list: ticking is done by tapping the **row** (the gallery's
`OnSelect`), not a checkbox. That is also the better design — the whole 76px row is the touch
target, which matters when the user is wearing work gloves.

**Declaration order in a `.pa.yaml` screen IS z-order, and LATER paints on top. Cost a
session 2026-09-07.** `_EditorState.pa.yaml` carries no z-index, so file order is the only thing
deciding what covers what. Studio's tree view lists **topmost first**, i.e. the exact reverse of
the file — a useful cross-check. A modal overlay declared *above* a gallery renders *underneath*
it: valid YAML, correct formulas, correct Studio preview, broken app. That is how the PM-proxy
crew picker shipped invisible behind `galToday`.

`canvas-app/check_zorder.py` gates this and runs inside `deploy.py`. The rule it enforces: a
full-screen scrim opens an overlay group, and every control declared after it must be gated by
the same global. Worth having because this class is invisible anywhere except a running player,
and reaching one costs a deploy plus a Studio save and publish.

**The app icon and tile colour CANNOT be set by API.** `PATCH api.powerapps.com/.../apps/{id}`
returns 400 `InvalidAppPatchDefinition`: *"Only the following properties may be edited with PATCH:
ConnectionReferences, EntityReferences, AuthorizationReferences, DatabaseReferences, EmbeddedApp,
SourceControl"*. Studio → Settings → General is the only route, and its **"Icon background fill"
textbox does not accept automated keystrokes** — fill/type append or are silently ignored, and a
mangled value is committed to the in-memory document. Treat setting the icon as a manual human
step. (Live app metadata is untouched until a save, so a bad edit is discarded by navigating away
without saving — verified.)

**Canvas-app schema traps — all CONFIRMED against live lists 2026-09-04, all were in the Phase C spec:**

- **The lists are named `Assignments` and `Tasks`**, not `Sub-phase Assignments` / `Sub-phase Tasks`. The spec had the wrong names in 11 places; Power Apps binds a data source by list Title, so every reference would have failed. Fixed.
- **`Jobs` has no `State` and no `ZIP` column.** Live schema is exactly `Title, JobNumber, Address, City, StartDate, Status, ProjectManager`. The spec's address formula referenced both.
- **`Assignments.Job` is a Lookup with `ShowField='Title'`**, so `Job.Value` returns `Harrison Residence`, not `D2-1001`. The spec compared it against `JobNumber` — always blank. **Third instance of the same root cause: joining on a display label instead of a key.** In this data model `Title` is *always* display. Never join on it.

**Join identity on `userPrincipalName`, NOT `mail`.** `mail` is unreliable in this tenant — blank on unlicensed accounts, and divergent even on the service account (D2 Bot's UPN is `stratirus@d2pools.com` while its `mail` is `d2bot@d2pools.com`). UPN is always present and is the actual sign-in identity, so `Crews.LeadEmail` must be seeded with UPNs and matched as `LeadEmail = gblCurrentUser.userPrincipalName`. Matching on `mail` fails silently — the same failure signature as the CrewID bug.

**Context only, not in scope: `d2install.com`.** D2 Pools and D2 Install are sister companies both owned by Don. Four accounts in this tenant (Amy Stevens, Bobby Harlow, David Taylor, Mike Brantley) carry `@d2install.com` in their `mail` attribute while signing in on `netorgft15040037.onmicrosoft.com` UPNs — `d2install.com` is **not** a verified domain here (only `d2pools.com`, `d2tn.com` and the onmicrosoft default are). **This project is pools-only.** Recorded so future sessions don't re-investigate it.

**Data gaps still open (from Rev D §15 / original plan §09):**
- **10 trades unmapped to any sub-phase:** Retaining Walls, Veneer/Stone, CMU, Brick/Masonry, Landscaping, Pavers, Forms, Water Line Install, Material Runs, Grading. Don owes a mapping decision. George Crew is scheduled zero days until this lands.
- **11 field-supervision sub-phases sit in Unassigned.** Don owes: shared PM bucket, or specific-person ownership?
- Finish Grade skill on Saul & Guillermo — confirmed by Don (yes, they are qualified). No action.
- Four crews without roster (George, Armondo, STL, Brothers) — resolved as subcontractors, Unlimited=Yes.
- 46 durations still at 2-day placeholder — deferred; will be replaced from real actuals after first few pools.

**`D2 - New Pool` / `D2 - Delete Pool` build: new platform constraints found 2026-09-07/08, all
reproduced. None of the three below is caught by `validate_flow`:**

- **Logic Apps forbids `Terminate` nested inside ANY loop: `Until` as well as `Foreach`.** Fails
  at save/validate, not at run time.
- **`runAfter` is container-scoped.** An action cannot declare `runAfter` on something in a
  different `Scope`, `If`, or `Foreach`; the cross-scope dependency has to be dropped and the
  ordering re-expressed inside the shared container instead.
- **`InitializeVariable` cannot nest inside ANY container, not just a `Scope`: an `If` rejects
  it too.** All variable initialization has to sit at the top level of the flow, before any
  container that uses it. Confirmed against the live tenant 2026-09-08: a `clientdata` PATCH of a
  `New Pool` revision that nested nine `InitializeVariable` actions inside a `Scope` was rejected
  with `InvalidVariableInitialization` naming the `Scope` by name, the same failure mode already
  known for `If`.

Two more, unrelated to nesting:

- **The SharePoint connector omits null-valued fields from its output entirely, rather than
  emitting the field as null.** A 2-row sample landed on two rows that both happened to have a
  null trade column, and reading the shape off that sample produced a confident, wrong
  conclusion that the column did not exist at all. Pull a row known to have the field populated
  before concluding a column is missing.
- **Observed three times, mechanism unexplained: a `Delete Pool Requests` row created by REST
  with a blank `Title` sat at `Requested` forever** (ids 8, 10, 12), while blank-`Title` rows are
  never reachable through the list form, which enforces `Title` as Required; this only happens
  via the direct-REST bypass. The flow itself was also republished (`clientdata` PATCH +
  `PublishXml`) several times during the same task, which is an untested alternative
  explanation for the trigger missing those rows and was never ruled out. Do not treat "blank
  `Title` is invisible to `GetOnNewItems`" as a settled platform fact until that variable is
  isolated.

**Concurrent sessions against this shared production tenant are real, not theoretical.** During
this build, two Assignments rows were modified outside this session's own activity (id 4 at
2026-09-08T01:53:16Z, id 25 at 2026-09-07T23:32:51Z), and a Jobs row was created and then removed
that this session did not create. Nothing above explains any of the three. Everything writes as
the same `stratirus@d2pools.com` identity, so there is no way to tell from the data alone whether
it was another session, a person, or a flow: see the shared-credential warning under the Phase C
production-risk section. Take it literally: more than one process can be touching this tenant at
the same time, and a surprising row is not automatically a bug in this session's own work.

## How to run it

**Phase A complete: the original 7 SharePoint lists provisioned and seeded on the D2 tenant** as of 2026-08-25. Rev D week-by-week runbooks are in repo root (`D2-Phase-A-Foundation-Runbook.md` through `D2-Phase-F-Cutover-Runbook.md`). Four more lists (`New Pool Requests`, `Delete Pool Requests`, `Sub-phase Template`, `Task Template`) were added later for the New Pool / Delete Pool feature, not as part of Phase A. The table below is current deployed state, not a Phase A inventory.

**Deployed state (D2BuildScheduler site):**

| List | Rows | GUID |
|---|---|---|
| Jobs | 1 (Harrison Residence D2-1001 — **demo data, not a real pool**) | `ee0ecabf-2f11-458d-a9ea-641f76d10cc3` |
| Assignments | 5 (D2-1001 sub-phases; 22 fields incl full Phase A schema) | `49ef7006-d3fe-40a7-a52f-c4c18545bd35` |
| Tasks | 30 (6 × 5 assignments) | `22c45847-ff0d-417a-b53e-1ea018fbb6d3` |
| Trades | 26 | `05038f7f-a6cb-4f57-b1a1-3ff9c7126ba5` |
| Crews | 14 (subcontractor patch applied) | `45e9ff1f-bf36-4ab5-929d-25ab9a80d460` |
| Crew-Trades | 51 | (see viewlsts.aspx) |
| Work Calendar | 62 (52 Sundays + 10 US federal holidays) | (see viewlsts.aspx) |
| New Pool Requests | 0 (cleared 2026-09-08 of build-time test rows; this is a client-facing operational log, not a place for our test litter) | `13331a5e-ea8e-4ab2-9276-db5b4f4d46bf` |
| Delete Pool Requests | 0 (cleared 2026-09-08, same reason) | `b1ea3db6-7870-4648-80c2-7fe8414ecfd7` |
| Sub-phase Template | 46 (one row per sub-phase; read by `D2 - New Pool`) | `453e7cd5-f84a-4e2a-9372-73f26019e3f0` |
| Task Template | 295 (one row per task across the 46 sub-phases) | `61824add-8eaa-4b1b-aed7-a202204bf9f5` |

**Flow status (table originally closed out Phase B on 2026-09-05; rows 6 onward are later
additions and the table was never renumbered, corrected 2026-09-08 after it undercounted the
environment by three. There are eleven D2 flows in total plus the unrelated `Generate estimate`,
which belongs to a separate estimator workload and is deliberately not documented here.):**

| # | Flow | State | Notes |
|---|---|---|---|
| 1 | Daily Dispatch + Reminders | Started | **DONE — verified end-to-end 2026-09-03.** Both the `?['Value']` fix and the `CrewID` join fix applied and published; a live run produced a populated dispatch email. |
| 2 | Sign-off Intake | Started | DONE, end-to-end verified |
| 3 | Event-Driven Reconciliation | Started | Trigger condition fixed to version-history comparison 2026-09-07 (see Known bugs); no longer the no-op it was when this table was written. **Stop it before any bulk write to Assignments**, since it still fires on every Crew/date edit. |
| 4 | Nightly Reconciliation | Started | **DONE — built and both tests passed 2026-09-03.** Created fully headless (no designer). Clean sweep = 0 conflicts, no email; seeded double-book caught and emailed. |
| 5 | Daily + Weekly Summary | Started | **DONE.** Built 2026-09-03 as two flows, HTML body not PDF. **Content reviewed 2026-09-05 and three defects fixed** — weekly compliance counted unfinished work, neither table was sorted, daily footer off by one. Re-verified by manual run. |
| 6 | Task Tick Batch | Started | **NEW 2026-09-07, verified end to end.** `D2 - Task Tick Batch`, flowId `e8843056-53aa-f111-aaab-6045bd0196b3`. PowerAppV2 trigger `(AssignmentID, TaskUpdates, TasksTotal, TasksComplete, SignedByEmail)`. Resolves the site user once via `ensureuser`, MERGEs each task from a comma-separated `taskId:flag` list, then MERGEs the assignment counters. **This exists because Patch() does not work from the canvas app — see the Patch entry under Known bugs.** |
| 7 | Counter Reconciliation | Started | **NEW 2026-09-07, verified.** `D2 - Counter Reconciliation`, flowId `291fa9d9-caaa-f111-aaac-6045bd0195dd`. Nightly 05:30 Central, an hour ahead of the daily summary so Don's compliance figures are always computed from repaired counters. Recomputes `TasksTotal`/`TasksComplete` from the Tasks list and MERGEs **only rows that drifted**, so a clean night writes nothing. First run repaired 6 rows; the immediate second run repaired 0. |
| 8 | Reopen Sign-off | Started | **Built 2026-09-07, verified.** `D2 - Reopen Sign-off`, flowId `0f850a63-beaa-f111-aaac-6045bd0195dd`. PowerAppV2 trigger. Clears `InstallerSignOff` and appends who reopened, when, who had signed, and an optional reason to `SignOffNotes`. Was already live but had never been added to this table. |
| 9 | New Pool | Started | **NEW 2026-09-08, verified.** `D2 - New Pool`, flowId `02905018-4f41-e05a-d140-74e2afc82052` (Dataverse workflowid `d782ee70-2fab-f111-aaab-6045bd0196b3`). Triggered by a new row in **New Pool Requests** (`ProjectManager` is a required field on that list). Reads the 46-row **Sub-phase Template** and 295-row **Task Template** and generates a full pool: one Job, 46 Assignments, ~295 Tasks. See Known bugs and gotchas for the platform constraints found building it. |
| 10 | Delete Pool | Started | **NEW 2026-09-08, verified.** `D2 - Delete Pool`, flowId `995099f4-76e6-8bc0-89ef-9fd3557138ce` (Dataverse workflowid `83064f1f-47ab-f111-aaac-6045bd0195dd`). Triggered by a new row in **Delete Pool Requests**. Removes a pool's Tasks, Assignments and Job. |

**Phase B close-out completed 2026-09-05:** summary previews reviewed (three defects found and fixed, see Flow 5 below), Flow 5 recipients deliberately left internal, and all six flows then existing re-exported to `flows/exports/`. Flows 8-10 above postdate Phase B close-out and were added by later work.

**Phase C status 2026-09-07 — the core loop WORKS END TO END and is verified against live data.**
Today's work -> open a sub-phase -> tick tasks -> save -> sign off, with the sign-off attributed
to a real person. Both blockers carried in from 2026-09-06a are closed: Flow 2 writes
`InstallerSignOffBy`, and the canvas deploy loop is understood, documented and demonstrably
working.

Proof, read from the lists rather than the UI (the UI misled us repeatedly — see the Patch entry
under Known bugs): assignment 25 (`TEST-9002 · 2.1`) reads `InstallerSignOff=True`,
`InstallerSignOffBy="D2 Bot"`, `WorkDate=2026-09-06`, `TasksComplete=3`, `TasksTotal=6`, and
Tasks 137/138/141 carry `Complete=True` with `CompletedOn` timestamps matching the tick-flow run
to the second.

Screens built in `canvas-app/src/Src/`: `Screen1` (today's work) and `scr_Tasks` (task tick,
work-date picker, confirm overlay, sign-off).

**THE SHAREPOINT SITE WAS REWRITTEN 2026-09-07 — that task is DONE.** It was the untouched
Microsoft project-management template, with three web parts literally titled `[Sample content]`
over stock photography. It is now a launchpad: a short intro with the field-app link, the LIVE
`Today by Crew` view rendered on the page itself, and an indexed set of links to the other seven
views. Theme, logo, description and welcome page are set. `ProjectHome.aspx` and both empty
template lists are deleted.

Everything is scripted and committed under `sharepoint/` — `provision-views.js`,
`format-views.js`, `build-home-page.js`, `brand-site.js`, `make-site-logo.py`. Re-running any of
them reproduces the tenant state.

**Brand colours are MEASURED, not chosen** — read from d2pools.com computed styles weighted by
painted area: navy `#082544`, green `#0B594B`, cream `#F6F3ED`, Poppins + Source Sans Pro. The
site theme, the list-view cards and the canvas app now share one palette. SharePoint will not
load Poppins, so the brand cue is colour, logo and restraint.

**No header photography, and that is a LICENSING decision.** The hero images on d2pools.com are
licensed Getty stock (`GettyImages-134108091`, `-1364656744`, `-521154563`). D2 licensed those
for their marketing site; that does not extend to copying them into their tenant. The logo is
different in kind — D2's own mark, on D2's own intranet — and is composited onto navy by
`make-site-logo.py` because the published mark is white on transparent and invisible on
SharePoint's white header. A real header photo must come from D2's own project photography.

---

## NEXT SESSION: one task (Shane, 2026-09-07)

### ~~1. Calendar / schedule visualisation~~ (DONE 2026-09-08b)

**RESOLVED as a timeline lane on the two whole-job views.** `All Assignments` and
`Late-Starting Jobs` now render a Gantt-style bar per row: 28 day-cells across a fixed
`today-7 .. today+21` window, painted in the row's status colour, with a navy rule on today and
faint week gridlines. Every row draws the same 28 cells at the same widths, so bars align across
rows without `position: absolute`, which SharePoint's style allowlist cannot be trusted to pass.
The other four Assignments views keep the plain card, because a 28-day window is mostly empty
space either side of a one-day bar.

Built into `sharepoint/format-views.js` rather than a second script, deliberately: two scripts
both MERGEing `CustomFormatter` on the same views would be last-writer-wins with no error.

Verified by reading the rendered DOM, not the status code: 43 lanes on `All Assignments`, 15 on
`Late-Starting Jobs`, 0 on `Today by Crew`, and for every sampled row the painted cells match the
day indices computed independently from that row's own displayed dates, including rows clipped at
the window edge and rows entirely outside it.

**Option 1 below (surface the browser tool) is struck because it is not available.** The route was
closed on 2026-09-07 by the New Pool spec and the ranked list was never updated: an HTML page in a
document library IS the custom-script mechanism, modern sites block it by default, and the setting
reverts within 24 hours. That applies to a read-only Gantt link exactly as it does to writing.

The kept history below is still worth reading for the two routes that remain closed.

### The original ranking, for the record

**Gantt is genuinely not available and cannot be engineered around at this licensing tier.**
Microsoft's modern view compatibility checklist lists *"The View is either a Calendar or Gantt
type and is not Modern compatible"* as a detection whose only recommendation is to send feedback.
A real Gantt needs SPFx, which needs an app catalog and a build toolchain — reintroducing the
premium cost that ruled out Dataverse.

**A modern Calendar view cannot be usefully created by REST.** Creating one with
`ViewType2: 'MODERNCALENDAR'` returns **201**, appears in the view bar with a calendar icon, and
**renders completely blank** because the date-field mappings are not supplied. Worse, while it is
the active view it **disables the "Add view" button**, so it also blocks the UI route to fixing
itself. Tried and deleted 2026-09-07. Create it through the **UI** and then capture what
SharePoint wrote — the same discipline the canvas control vocabulary needs.

Alternatives, ranked by value for effort:

1. ~~**Surface the browser tool.**~~ **NOT AVAILABLE**, see above. Blocked on custom-script
   policy, not on effort.
2. **Schedule-bar column via JSON formatting.** **This is what was built.**
3. **Modern Calendar view**, created via the UI and captured. Still open, still the way to do it
   if a real calendar grid is wanted on top of the timeline lane.
4. Canvas app timeline screen — real effort, Power Fx is a poor fit for drawing timelines.
5. Power BI — good, but David and Don explicitly declined dashboards and it adds licensing.

### ~~2. New pool deployment~~ (DONE 2026-09-08)

**RESOLVED.** A PM now creates a pool by adding a row to **New Pool Requests** (job number, name,
address, start date, project manager, all required on that list) and deletes one by adding a row
to **Delete Pool Requests**. `D2 - New Pool` reads the 46-row **Sub-phase Template** and 295-row
**Task Template** and generates the whole pool: one Job, 46 Assignments, ~295 Tasks, all four
business rules enforced, crews and dates assigned, exactly the logic `add_pool.py` planned in
Python, now running as a flow against the live lists. Both are linked from the office launchpad
under "Pool management." See **Staging / integration contracts** for where this sits relative to
the browser tool, and **How to run it** for the flow ids.

`tools/add_pool.py` and `tools/write-pool.js` remain in the repo as Stratirus bulk tooling, for
loading several pools at once or for us directly, but a PM never runs either now; they are not
the user-facing path.

**`D2 - New Pool` does NOT stop Flow 3 around its own 46 inserts, confirmed by reading the
published definition, not assumed.** Every real pool created through the form therefore burns
**92** Event-Driven Reconciliation runs, not 46: one per `Create_assignment` insert (a brand-new
row always reconciles, per the version-history gate) plus one more per `Merge_task_total` MERGE
on the same Assignment. The `Merge_task_total` runs terminate cheaply at
`Skip_non_scheduling_edit`, because that MERGE only ever touches `TasksTotal`/`TasksComplete`,
never `Crew`, `ScheduledStart` or `ScheduledFinish`, so this is accepted, not a defect, but the
real number is 92, not 46. See the Phase G bullet above ("New Pool's accepted reconciliation
cost") if alert volume ever makes this worth closing; if it does, add a `SuppressReconcile`
boolean set in the same `Create item` call and one clause in Flow 3's version-history gate, which
adds no extra write. For `tools/write-pool.js` (the separate bulk tool, still ours to run by
hand): **stop Flow 3 before any bulk write and restart after.**

**Still open on the app** (list corrected 2026-09-07 — four entries here were stale and claimed
built features were missing):

- **PM-proxy picker — BUILT** (commit dd4d882). Crew picker on Screen1, proxies only.
- **Reopen action + task locking — BUILT AND VERIFIED.** Sign-off locks the rows, the button
  becomes Reopen, and `D2 - Reopen Sign-off` records who, when, who had signed, and now an
  optional reason.
- **Notes field — BUILT.** `Classic/TextInput@2.3.2` is verified vocabulary. It is shown in both
  sign-off and reopen modes, with the caption switching on `gblConfirmMode`.
- **Flow 3 — STARTED, not stopped.** Its trigger condition was fixed to version-history
  comparison on 2026-09-07 and it is running. The old warning here said it was stopped and must
  not be restarted; that is no longer true. It still fires on every Assignments edit that changes
  Crew or the dates, so **stop it before a bulk write** (`write-pool.js` needs this) and restart
  after.
- **App icon and splash — still Power Apps defaults.** Cannot be set by API; see the canvas
  section. Needs a human in Studio.
- **`Crews.LeadEmail` still empty** — client-gated on the crew-lead identities existing. Until
  then every user is a proxy and the header reads "office view".
- **TEST-900x stays** until just before the pilot, deliberately — it is the only realistic test
  volume the canvas app has. Note the landing page now shows it, so the SITE IS INTERNAL-ONLY
  until either real data lands or the test data goes.

**Reading and writing SharePoint headlessly — two routes, both now proven.** The old note that
this was impossible without a live browser session is superseded.

1. **Browser REST from the page (preferred for bulk).** Navigate the `chrome-devtools` browser to
   `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler` — SSO carries over from a
   Power Apps sign-in — then `evaluate_script` with a digest from `/_api/contextinfo`. This is
   how the seven views were created: ~50 REST calls in two script calls. Return a compact summary
   from the script, not raw payloads, or the token cost is severe.
2. **A throwaway Power Automate flow (no browser needed).** A Recurrence-triggered flow with
   `Send an HTTP request to SharePoint` actions, run via `run_flow`, then read its action outputs
   from
   `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/{env}/flows/{flow}/runs/{run}/actions?api-version=2016-11-01`
   and fetch each `outputsLink` (SAS-signed, needs no auth header). Slower to set up, but needs no
   human sign-in at all. Delete the flow afterwards.

   Note `select` and `filter` are **not** valid WDL expression functions — use `Query`
   (Filter array) actions instead — and the SharePoint `GetItems` operation rejects `$select`
   outright with `WorkflowOperationParametersExtraParameter`.

**Assignments gained a calculated column `WeekMonday` on 2026-09-07 — a live schema change.**

    = [ScheduledStart] - WEEKDAY([ScheduledStart], 2) + 1

the Monday of the row's own week. It exists because **CAML has no start-of-week primitive** — the
documented children of `<Value>` are ListProperty, Month, Now, Today, UserID and XML, and there is
no `<Week/>` — so a Mon–Sat window cannot be written as a static filter on a date column.
`This Week by Crew` now filters `WeekMonday <= [Today] AND WeekMonday >= [Today]-6`, which selects
exactly the current Mon–Sun week; no work starts on a Sunday, so in practice that is Mon–Sat. It
previously filtered `ScheduledStart` within `[Today]..[Today]+7`, a rolling seven days that on a
Thursday showed Thursday to next Thursday. Derived from the row alone and never from `[Today]`,
because a calculated column referencing `[Today]` only recalculates when the item is edited.

**`All Assignments` is the Assignments list's DEFAULT view as of 2026-09-08b.** It was `All Items`,
the system view created with the list, which carries no formatter and no grouping. So every route
into Assignments that does not name a view (the launchpad's own list link included) landed on a
plain grey table, and none of the seven views built in Phase A was what anyone saw first. Set via
`DefaultView: true` on the view; SharePoint unsets the previous default itself. Verified by opening
`/Lists/Assignments/` bare and confirming it redirects to `All Assignments` and renders the cards.

**All eight views are now `Paged=true`.** They were stored `RowLimit=100, Paged=false`, which in
SharePoint means "return 100 and stop" — no next control, no indication anything is missing.
`Incomplete Tasks` was showing 100 of 184.

**All eight views carry a JSON card formatter** (`sharepoint/format-views.js`): status pill,
progress bar, colour-coded left border on Assignments; tick / strikethrough on Tasks. Two things
that are load-bearing and were learned by looking at the rendered result:
`width`/`box-sizing`/`align-items` on the root, without which SharePoint shrink-wraps the card and
centres it as a narrow floating block; and `hideSelection: true`, without which SharePoint's own
selection gutter draws a second indicator next to yours.

**A view formatter may NOT contain a raw `<` or `&`. Found 2026-09-08 building the timeline
lane.** A view's `CustomFormatter` is persisted inside the view's **XML** schema and is not
escaped on the way in, so any character that is special in XML fails the entire MERGE with **HTTP
500**. This bites the moment an expression needs `<=` or `&&`, which no formatter on this site had
needed before. Neither error message names the character actually at fault:

| In the expression | Server response |
|---|---|
| `<=` | `System.Xml.XmlException: Name cannot begin with the '=' character, hexadecimal value 0x3D. Line 1, position 280.` |
| `&&` | `System.Xml.XmlException: An error occurred while parsing EntityName. Line 1, position 3503.` |

The first names `=` and reads like a broken expression, because the parser saw `<` open a tag and
is complaining about the next byte. The second is `&` opening an entity reference. Both were
reproduced deliberately: two formatters identical but for `<= 0` versus `0 >=` return 500 and 204
respectively.

**Workarounds cost nothing.** Flip the operands so a comparison uses `>` or `>=`, and express AND
as a nested `if` instead of `&&`. A raw `>` is legal as XML content and is fine. Note this is a
500 at write time, so unlike bad CAML or a bad formatter body it does **not** silently render
wrong later. It is the rare SharePoint failure that is loud.

**Hero and Quick links web parts do NOT bind `serverProcessedContent` when a page is written via
list-item MERGE.** They store correctly, they mount, and they render as nothing — titles and URLs
live under keys like `content[0].link` and `items[0].sourceItem.url` which are persisted but never
applied. Use **Text web parts** (controlType 4, plain HTML inline in `data-sp-rte`, no binding), or
build Hero/Quick links in the page editor UI and capture `CanvasContent1` back. Also ruled out:
`hideWebPartWhenEmpty:false`, GUID tile ids, and the modern Pages API `SavePageAsDraft`, which
rejects HTML in `CanvasContent1` outright. Hero is additionally image-driven — `color` is a tint
behind an image, not a standalone flat tile.

**The page editor takes a coauthoring lock that 423s every write.** It is NOT a checkout —
`CheckOutType` reads 2 (None) and `UndoCheckOut` also 423s, and 40s of retries does not clear it.
`POST /_api/sitepages/pages(<id>)/discardPage` clears it.

**The List web part height is FIXED, with no auto-size.** `webpartHeightKey` 6 left a large gap on
a three-row day, 1 clipped those three rows to two; settled on 2. No value is right for every row
count.

**The office surface is SharePoint VIEWS, not an app — and they were missing until 2026-09-07.**

Worth stating plainly, because "the canvas app" is easy to mistake for the whole system. The
design splits four audiences across four surfaces, and only one of them is the app:

| Need | Surface | Status |
|---|---|---|
| Planning / scheduling | the browser tool `pool-scheduler.html` | exists, unchanged, PM-only |
| Office day-to-day | **SharePoint list views** | built 2026-09-07 |
| Ownership visibility | daily + weekly HTML summary emails | built, Phase B |
| Field sign-off | the canvas app | built, Phase C |

**Dashboards are a declined requirement, not a gap** — David and Don accepted daily/weekly email
summaries and explicitly did not want Power BI.

The Phase A runbook specified seven views and its exit gate claimed "all views show correct
filters". **None of them existed.** Every list had only the default `All Items`, so the office
training in Phase F Day 2 — which walks Don, both PMs and Amy through "Views drop-down > This Week
by Crew" — would have opened a flat ungrouped list of every assignment ever. Built and verified by
rendering each one (a view can be created with invalid CAML and fail only when opened, so
`RenderListDataAsStream` is the real test, not a 201 on create):

| List | View | Rows at build |
|---|---|---|
| Assignments | All Assignments (group by Job) | 43 |
| Assignments | This Week by Crew | 8 |
| Assignments | Unassigned | 0 |
| Assignments | Sign-off Overdue (group by Crew) | 12 |
| Assignments | Late-Starting Jobs (group by Job) | 14 |
| Tasks | All Tasks (by Assignment) | paged |
| Tasks | Incomplete Tasks | paged |

Two deviations from the runbook, both deliberate:

- **`Unassigned` also matches `Crew = 'unassigned'`,** not just blank. The browser tool models
  `unassigned` as a real pseudo-crew, so filtering only on blank would have missed the actual
  unassigned work. Currently 0 rows because the seed always sets a crew.
- **`Incomplete for Today` was built as `Incomplete Tasks`.** The spec wanted it filtered by the
  parent assignment's dates, but CAML cannot filter a view on a lookup's *other* columns without
  a join. Filter is `Complete = No`, grouped by Assignment.

**RESOLVED 2026-09-08b — the Phase E and F runbooks now match what exists.** This entry used to
say the training materials still promised a nightly export at 11 PM and pointed at Teams channels.
That half had already been fixed by someone and the note was never struck, so CLAUDE.md was
carrying a phantom. What it missed was a *newer* staleness created the day before: the PM workflow
sheet still said **"Plan a NEW pool in the browser tool as before, then tell Stratirus, we load it
into SharePoint for you"**, which `D2 - New Pool` had just made false. Training Don and the two PMs
off that copy would have handed straight back the bottleneck the feature exists to remove.

Fixed across both runbooks:

- **Phase F Step 3** and **Phase E Step 2** both routed the pool load through a "browser-tool
  export flow" that has never existed. Both now use `D2 - New Pool`, and both say plainly that
  generation is the cheap part and **reconciling a template-generated schedule to the pool's real
  sequencing and progress is the actual work**. That distinction matters: New Pool counts dates
  forward from a start date and knows nothing about how a live pool has actually been run.
- **Office quick reference** gained "Start a new pool?", "Remove a pool?", and how to read the new
  timeline bar.
- **PM workflow** now says PMs raise pools themselves, and that the browser tool stays the planner
  and the only Gantt.
- **Step 12** no longer tells the office that Stratirus loads new pools.
- The **Auto-Schedule gotcha** described an export flow pushing conflicting rows over a crew lead's
  sign-off. That cannot happen. The real risk is the quiet inverse, which it now describes.
- **Phase E's "use Pacific"** timezone instruction was wrong and is now Central.

**The lesson worth keeping: a stale OPEN note is worse than no note.** This one asserted a problem
that was already fixed while the real defect sat three lines away in the same file, and it had
been read past more than once. When closing an item here, check the artifact rather than the
memory of it.

**TEMPORARY TEST DATA IS LIVE ON THE D2 TENANT — remove before the pilot.** Seeded 2026-09-03 so Flows 4 and 5 could be judged against realistic volume rather than 5 rows.

| What | Count | Marker |
|---|---|---|
| Jobs | 2 | `TEST-9001` Sandbox Ridge, `TEST-9002` Sandbox Vista |
| Assignments | 38 | Titles begin `TEST-900x ` (ids 6-43) |
| Tasks | **252 (added 2026-09-06)** | see below |

**Tasks were backfilled 2026-09-06 — without them the canvas app could not be built.** The seed originally created **zero** Tasks rows, so 38 of 43 assignments had nothing to tick and the only 30 tasks in the list belonged to the Harrison demo job that is scheduled for deletion. The app's central screen is task-ticking, so this would have stopped the build on Day 2 of the Phase C spec.

252 rows were generated from the browser tool's `SEED_TEMPLATE` (295 real task names across 46 sub-phases), giving real text like `Verify Suction Lines`, not `Task 1`. Live state is now **282 tasks, 43 of 43 assignments covered, 93 complete**, with every assignment's row count matching its `TasksTotal` and completed count matching `TasksComplete`. The template's per-sub-phase task counts matched the existing `TasksTotal` values on all 38 rows with **zero mismatches**, which is a useful independent check that the seeder and the template agree.

One deliberate inconsistency remains: **Assignment 1 reports `TasksComplete = 6` while all six of its Tasks rows are `Complete = false`.** That is the pre-existing stale `"Chrome-driven test"` sign-off, not a backfill error. It is worth keeping until the demo job is deleted, because the counters are only written at sign-off and the app has to cope when they disagree with the rows.

Generated by `flows/testdata/generate-seed.py` from the real 46 sub-phase template in the browser tool, so it mirrors production shape (skills, durations, task counts). The generator enforces all four business rules and cross-checks against the 5 pre-existing Harrison rows before emitting anything — it caught two collisions with Assignment 5 on the first pass.

**Gap found 2026-09-05: the generator's rule-4 check does not cover the whole span.** `TEST-9002 · 2.1 Engineering Review by PM` is scheduled `2026-09-05 → 09-07`, crossing Sunday 09-06 — the same defect class as Assignment 4 in the original seed. It looks like only the start date is tested for Sunday, not every day in the range. Harmless in test data, but **do not reuse this generator for real scheduling without fixing the span check.** It became visible only once the summaries started rendering day names.

**To remove:** stop Flows 3 and 4, run `flows/testdata/cleanup.js` in the browser console on the site, restart the flows. Idempotent; reports what remains. The manifest of exactly what was created is `flows/testdata/seeded-ids.json`.

**`New Pool Requests` and `Delete Pool Requests` were separately cleared 2026-09-08.** Both
lists had accumulated build-time test rows (`Guard Test`, `Plan Test Alpha/Bravo/Charlie`,
`Sunday Start Test`, `TEST-9999`, `TEST-8888`, `PROBE-BLANK-CONFIRM`, and the `TEST-91xx` runs
from the New Pool build), and a PM opening either list on day one would have seen our test litter
in what is meant to read as a client-facing operational log. Both lists are now empty by direct
REST delete.

**RESOLVED 2026-09-08b — `cleanup.js` now covers both request lists**, so the pre-pilot gate no
longer silently skips them. It handles them more cautiously than Jobs/Assignments/Tasks, and
deliberately:

- It deletes only rows it can **prove** are ours, meaning a `TEST-` job number or the demo job.
- Anything else is **reported, never deleted**, via a `console.warn` plus a table of what was left.
  These lists are a client-facing operational log, so after go-live their rows are a PM's real
  request history. A blanket wipe would destroy that the first time someone ran the script post
  go-live, which is exactly when it would look harmless.
- Consequence to know: leftover test rows whose name carries no `TEST-` marker (`Guard Test`,
  `PROBE-BLANK-CONFIRM` and the rest above all looked like this) are **not** auto-removed. They
  show up in the review table and clearing them is a human decision.

**The two lists do NOT share a job-number column**, and this is worth knowing before writing any
query against them: it is `JobNumber` on `New Pool Requests` and **`ConfirmJobNumber`** on
`Delete Pool Requests`. Verified rather than assumed, by probing `$select` against the live lists:
a bogus column returns **400**, both real columns return 200, and `JobNumber` against
`Delete Pool Requests` returns **400**. The obvious guess of a shared `JobNumber` would have
failed at the gate.

**`cleanup.js` also gained a `DRY_RUN` flag** (default `false`). Set it `true` to report exactly
what would be deleted without deleting anything. Worth using before the real gate run: that gate
is a one-shot destructive step on a live client tenant, normally run under time pressure, and this
is the only way to see the blast radius first.

Not yet exercised end to end: the request-list **delete** and **review** paths have never run
against real rows, because both lists are currently empty and the only way to populate them is to
create rows that trigger `D2 - New Pool` or `D2 - Delete Pool`. The queries themselves are
verified. Do a `DRY_RUN` pass before trusting the gate.

**`cleanup.js` was extended 2026-09-05 and now removes the Harrison demo job too.** `D2-1001` is no more real than `TEST-900x` — it is the browser prototype's hardcoded demo job and Assignments 1-5 hang off it, so leaving it means going live with demo data in a client tenant. Deleting it also disposes of three separately-tracked defects for free: Assignment 1's stale `"Chrome-driven test"` sign-off, Assignment 4's Sunday start, and the D2 Bot placeholder in `Jobs.ProjectManager`. **Do not spend effort fixing those three; they are being deleted.**

Two behaviours worth knowing:
- **It now deletes `Tasks` first.** The original version never touched Tasks, which would have orphaned Harrison's 30 rows. The `TEST-900x` rows have no Tasks, so this only matters for the demo job.
- **`DROP_DEMO_JOB` is a flag at the top.** Set it `false` to clear only `TEST-` rows and keep Harrison alive while the canvas app is being built against it. Set `true` (the default) for the pre-pilot gate, whose expected end state is an empty tenant: `assignments []`, `jobs []`, `tasks 0`.

**Stop Flow 3 (and Flow 4) before any bulk write to Assignments.** Every insert or edit fires Flow 3 — see the trigger-condition bug above. 38 inserts would otherwise burn 38 runs.

Rendered previews of what the summaries produced against this data: `flows/testdata/daily-summary-preview.html`, `flows/testdata/weekly-summary-preview.html`.

**Flow 5 is HTML email, not PDF — decided 2026-09-03.** The runbook specified Create file -> Convert file -> attach. Investigation showed the only non-premium conversion is **OneDrive for Business `ConvertFile`**; SharePoint has no convert action, and PDF4me / Encodian are third-party premium connectors that would breach the zero-incremental-licensing constraint. No OneDrive connection exists in D2 Automation, so PDF would have cost a new connection plus an interactive sign-in.

Shane's call: send a rich HTML body instead. Same content, zero new connections, no temp-file lifecycle, readable on a phone without opening an attachment. If Don later wants an attachment, the PDF path is four extra actions on top of what exists.

**Built as two flows** (schedules in **Central**, correcting the runbook's Pacific):

| Flow | Schedule | Window |
|---|---|---|
| `D2 - Daily Summary` | 06:30, **Mon-Sat** (no Sunday - not a work day) | today, plus 7-day trailing compliance |
| `D2 - Weekly Summary` | Friday 15:00 | Mon-Sat of the current week |

Both render: active job count, a table of scheduled sub-phases (Job / Sub-phase / Crew / Dates / Tasks), and sign-off compliance as `signed / finished (pct)` with the oldest outstanding item named.

Two implementation details worth keeping:
- **Percent must multiply before dividing.** PA's `div` truncates on integers, so `div(mul(signed,100), total)` — the naive `mul(div(signed,total),100)` always renders 0%. Guarded for `total = 0`.
- **Crew is displayed by `Crews.Title`, joined on `CrewID`.** A per-row `Filter_crew` inside the loop resolves the short code to the friendly name, so ownership sees `Devon Crew +3`, not `devon`. Same join rule as everywhere else.
- Week boundaries: `weekStart = today + (1 - dayOfWeek(today))` -> Monday, `weekEnd = weekStart + 5` -> Saturday. Verified from a Thursday run producing 2026-08-31..2026-09-05.

**Recipient is `stratirus@d2pools.com` on both, deliberately.** Switching to Don (or Don + David) is a one-token edit in each `Send_summary` action. Do not point these at a client inbox until the content has been reviewed on a real cadence. Reaffirmed 2026-09-05: still internal, because ~90% of the rows either summary can see are `TEST-900x`.

**RESOLVED 2026-09-05 — the weekly compliance percentage was measuring work that had not happened yet.** Found by reviewing the rendered previews rather than the run status; both flows had been green since they were built.

`Get_week_finished` filtered `ScheduledFinish ge weekStart and ScheduledFinish le weekEnd`. The flow runs **Friday 15:00** but `weekEnd` is **Saturday**, so every sub-phase finishing Friday evening or Saturday was counted as an unsigned outstanding item. The 2026-09-03 preview named `D2-1001 · 2.2 Steel Installation` as the oldest outstanding while it was still two days from finishing.

The effect was a permanently depressed number that would have been the first thing Don ever saw from this system. Fixed to `ScheduledFinish lt <today>`, matching the daily flow, which had it right from the start. Same data now reports **33%** where it previously reported **22%**, and "Finished this week: 9" became "Finished so far this week: 6".

**Known limitation, accepted:** with `lt today` on a Friday run, work finishing Friday or Saturday never appears in *any* weekly compliance figure. The daily's 7-day trailing window still catches it, so nothing goes unmeasured overall. If that gap matters later, the clean fix is to score compliance over the **previous** completed Mon–Sat while keeping the schedule table on the current week, rather than moving the run later.

Two more defects fixed in the same pass:

- **Neither flow set `$orderby`,** so both tables came out in list-ID order. The weekly jumped 09-05, 09-03, 08-29, 09-01 *within a single job*. Now `$orderby=ScheduledStart asc` on `Get_today_assignments` and `Get_week_assignments`. Safe because `ScheduledStart` is a real column — unlike the `Crew/Title` path that failed in Phase B, which was never valid at all.
- **The daily footer overstated its own window by a day** — it printed `lookback … today` while the filter is `lt today`. Now prints the true end date.

Cosmetics in the same pass: dates render as `Wed 09/02 to Sat 09/05` instead of ISO (matching Flow 1's dispatch), guarded with `if(empty(coalesce(x,'')),'',formatDateTime(x,'ddd MM/dd'))` so a null date cannot fail the run; and a `&#183;` separator after the title.

Both verified by manual runs on 2026-09-05 with the rendered HTML pulled back from the run and committed to `flows/testdata/`.

**The `Tasks` column reads counters that nothing currently maintains.** `Append_row` projects `TasksComplete`/`TasksTotal` off the Assignment row, and those are only ever written by **Flow 2 at sign-off**. Every real (Harrison) row therefore shows `0/0` despite the Tasks list holding 6 rows for each. It is accurate — nothing has been ticked yet — but it means the column is blank until sign-off and redundant after it.

**Decision 2026-09-05: fix this in the canvas app, not the summaries.** The app maintains the counters, writing **one MERGE when the crew lead leaves the assignment screen, never one per checkbox** — at 295 tasks per pool, per-tick writes would burn a Flow 3 run each (see the trigger no-op bug). Counting the Tasks list inside the summary loop was rejected: it adds a SharePoint call per row per email, six mornings a week, on top of the per-row `Filter_crew`. **Sequencing consequence: gate Flow 3 before the canvas app writes at volume.**

**Build flows via FlowAgent, not Chrome UI-driving.** Author the definition JSON offline, then: for a **new** flow use `create_flow` (which writes straight to the published row) followed by Dataverse `PublishXml`; for an **existing** flow use `update_flow` (which writes to the draft) followed by `PublishXml`. Full mechanics in the draft-row callout under Known bugs, and in `flows/README.md`. Export each flow to `flows/exports/` after it tests green.

**No designer Save is needed for a new flow — corrected 2026-09-03.** The earlier guidance said to expect one designer Save per new flow to create per-operation connection-reference bindings. Flow 4 was built start to finish with no UI at all. The sequence that works:

1. `create_flow` with `state: "Stopped"` and full `connectionRefs`. The definition lands in the **published** row immediately (unlike `update_flow`).
2. Running it now fails with `CannotRunUnpublishedSolutionFlow` — *"Please authenticate the flow connections and save the flow to enable activation."* This message is misleading: it does **not** require the designer.
3. `PublishXml` against the `workflowEntityId` creates the bindings. The failure then changes to `WorkflowTriggerIsNotEnabled`, which proves the connection binding succeeded.
4. `publish_flow` to enable (start) it. Now it runs.

`create_flow` returns the **Dataverse `workflowid`** directly — the ID `PublishXml` wants — so no lookup is needed for a new flow. (Note a third ID also exists: the internal ARM workflow ID surfaced in trigger errors, e.g. `e51b5571-…` for Flow 4. Ignore it; it addresses nothing you call.)

**Load-bearing pattern for write-back flows (from Sign-off Intake win):** use "Send an HTTP request to SharePoint" action with SP MERGE, NOT the Update item action. PA's Update item requires binding every required field on the target list (Assignments has 7 required → 14+ dynamic-content bindings per action). Send-HTTP-to-SP with `X-HTTP-Method: MERGE` header does partial updates, only touching fields in the body. ~15 clicks total vs 100+. See sessions/2026-08-25-week2-flow-start.md for the body/headers template.

**PA Expression syntax — two forms, not interchangeable:**

- **Inside `@{...}` template strings** (fields treated as a template with mixed literals + expressions): the `body('ActionName')?['fieldPath']` shorthand works. PA rewrites it during template evaluation.
- **In the bare Expression tab** (fields where the whole value IS a raw expression — Init variable Value, Compose Inputs, condition operands): shorthand is rejected as "expression is invalid". Use full path: `outputs('ActionName')?['body/fieldPath']`.

Same rule for every connector's outputs — never `body('X')?[...]` in a bare Expression, always `outputs('X')?['body/...']`. Discovered on Compose 2 Inputs fix in Daily Dispatch; see sessions/2026-08-28b-compose2-fix.md.

**Flow definition export — use the ProcessSimple GET from a script that writes UTF-8 itself (2026-09-05).** `flows/exports/` is regenerated wholesale by fetching every flow from `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/{env}/flows` with a bearer token from `az account get-access-token --resource https://service.flow.microsoft.com/`, then writing with an explicit `encoding='utf-8'`.

**The token must come from `az`, but the response must NOT.** Piping `az rest` to a file drops non-cp1252 glyphs silently. This is not theoretical: the 2026-09-05 export run proved Flow 3 carries `U+2013 U+2014 U+2192 U+26A0` and Flow 1 carries `U+00B7 U+2014`, and the run's own console `print` of those characters crashed with `UnicodeEncodeError: charmap` while the files themselves came out intact. Console encoding is the trap; file encoding under your control is the escape.

Exports are named `<Flow-Name>-<YYYY-MM-DD>.json` and carry `flowId`, `workflowEntityId`, `state` and `connectionReferences` alongside the definition, so a future `PublishXml` needs no lookup. Note the environment also contains a `Generate estimate` flow belonging to the separate estimator workload — it is deliberately not exported here.

**Superseded approach — ZIP button is gone; `Get-AdminFlow` also works:** The PA cloud-flow toolbar no longer surfaces Package (.zip) export as of 2026 — the Export dropdown holds only "Learn how" and "Get flow identifier", overflow menu has nothing useful. For version-control artifacts, use `Get-AdminFlow` from `Microsoft.PowerApps.Administration.PowerShell`. The returned object's `Internal.properties.definition` holds the full trigger + actions JSON.

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

**The draft-row mechanism — this explains the whole 2026-09-01 REST wall (discovered 2026-09-02):**

Solution-aware flows have **two rows**: a published one and an unpublished draft. Definition writes through *any* PPAPI surface — the REST `PATCH`, and FlowAgent's `update_flow` alike — land in the **draft**. `get_flow` reads the **published** row. So a write returns 200, bumps `lastModifiedTime`, and appears to have done nothing. It did something; you just can't see it from there. Last session's "200-OK-but-silently-ignored" was never silent failure — it was a successful draft write read back from the wrong row.

Once a draft exists, the flow sits in `CurrentState=ActiveUnpublished`, and any *published* update is refused:

```
XrmApiServerError 0x80040203: You are attempting to do a published update of publishable
component in an unmodified active context when there exists an unpublished active row.
Component Type: 29  Object Id: <workflowEntityId>  CurrentState=ActiveUnpublished
```

Practical consequences:

- **To see the real error, use `preview_update` → `update_flow` with `previewToken`.** The plain `update_flow` path writes to the draft and reports success. The token path attempts a published update and surfaces the actual Xrm error. Use it as the diagnostic.
- **`publish_flow` does NOT publish the definition.** It is enable/start only — it flips state to Started and leaves the draft unpromoted. Starting a flow whose published row is still a stub gets you a live flow running the *old* definition.
- **`PublishXml` is the real promote**, and it validates the draft:

  ```bash
  az rest --method post \
    --url "https://<org>.crm.dynamics.com/api/data/v9.2/PublishXml" \
    --resource "https://<org>.crm.dynamics.com/" \
    --headers "Content-Type=application/json" \
    --body '{"ParameterXml":"<importexportxml><workflows><workflow>{<workflowEntityId>}</workflow></workflows></importexportxml>"}'
  ```

  Org URL comes from the BAP API: `properties.linkedEnvironmentMetadata.instanceUrl`. For D2 Automation it is `https://org4ed2f722.crm.dynamics.com/`.

**Two different IDs for one flow — don't conflate them.** `523d99c0-bc2e-7819-5d96-6faab60734f1` is Flow 3's **ProcessSimple resource ID** (what FlowAgent's `flow` argument wants). `2764968c-4aa6-f111-b8dd-6045bd0196b3` is its **`workflowEntityId`** (the Dataverse row, what `PublishXml` wants). The 2026-09-01 session log recorded the latter. Both are correct; they address different APIs.

**RESOLVED 2026-09-03 — `PublishXml` connection-reference binding.** With Flow 3's full definition in the draft, publish originally failed:

```
InvalidOpenApiFlow / WorkflowRunActionInputsInvalidProperty:
The API connection reference 'new_sharedsharepointonline_beb06' could not be found
for the operation 'Get_touched_assignment'.
```

At the time the unblock was a designer Save. **That is no longer required.** Flow 4 (2026-09-03) was created and published with no UI whatsoever — see the build-sequence note in "How to run it". Actions must still use the **connector** name in `host.connectionName` (`shared_sharepointonline`), not the connection-reference logical name; passing the logical name there is what produced the error. Supply the logical name only inside `connectionRefs`.

**Both D2 flows live in `Active Solution`** (the default solution, `fd140aae-4df4-11dd-bd17-0019b9312238`). The default solution **cannot be exported**, so the PAC solution-ALM fallback requires first creating a custom solution and adding the flow to it — a structural ALM change, not a drop-in workaround.

**Flow scope discipline:** solution-aware flows (which is all cloud flows on Dataverse-backed envs by default) do NOT appear in the standard flow list — they only show inside their solution. Address by flow ID (from the URL after Save) or from within the solution view.

**After Phase B flows:**
1. Build the canvas app per `D2-Phase-C-Field-App-Spec.md`
2. Pilot one live pool per `D2-Phase-E-Pilot-Runbook.md`
3. Cutover per `D2-Phase-F-Cutover-Runbook.md`

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
