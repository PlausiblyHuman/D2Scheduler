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
- **Client office/PM:** Amy Stevens, Carolyn Morris, Cody Campbell, Daniel Morris, Emon Alexander, Tyler Huisman — all on Business Standard
- **Field crew leads (~10):** currently unlicensed. **DECIDED 2026-09-04 — canvas app, not Forms.** Shane's call: "MS Forms will not cut it." Requires Business Basic ($6/user/mo, ~$720/yr for 10) added for them. Business Basic also gives them a real D2 mailbox, which `Crews.LeadEmail` and Flow 1's dispatch both depend on — the seats are the price of the crew being on the system at all, not just of one app. See "Crew-lead licensing" under Known bugs for the reasoning and the open procurement question.
- **Prior builder:** Ryan Meyer (Tennetech). **Stratirus is owned by Tennetech**; Ryan owns both companies and both Power Platform environments. This handoff was an internal brand reshuffle, not a vendor transition — so there is no IP, provenance or cross-vendor question about which environment work is built in. **Updated 2026-09-05 — Ryan is OFF the build again; the canvas app stays with Stratirus.** This reverses the 2026-09-04 decision to hand Week 3 to him. `D2-Canvas-App-Handoff-Contract.md` is therefore no longer a handoff document: read it as **internal build guidance**, and note that its §6a production-safety rules now bind *us*, not a third party. They are still load-bearing, because the app is still being built in the live client tenant.

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

## Staging / integration contracts

**Between the browser tool and Lists:**
- Browser tool is the planner. PM lays out schedules in the HTML tool as before.
- A nightly Power Automate flow reads the browser tool's JSON backup (dropped to a watched SharePoint folder) and upserts Jobs + Sub-phase Assignments into Lists.
- Lists is the source of truth for execution state (sign-off, task completion, timestamps). Never edit sign-off in the browser tool.

> **THE NIGHTLY SYNC FLOW DOES NOT EXIST (found 2026-09-05).** The bullet above describes a
> contract with no implementation. It is not one of the five Week 2 flows, it is not in
> `flows/definitions/`, and it is not a build step in any of the five week runbooks. Nothing
> anywhere was tracking it. Without it there is **no path for a PM's schedule to reach
> SharePoint except hand-entry**, which is the bottleneck this system exists to remove.
>
> **Decision 2026-09-05: descoped from the pilot, deliberately and on the record.** Week 4
> pilots one pool with its assignments loaded once, by us, via REST. That is a few dozen rows
> and it still tests everything the pilot is actually for: does a crew lead sign off on a
> phone, do the flows fire, does Don's summary land. Build the sync in Week 5 or after,
> when the browser tool's real JSON export has been seen in anger rather than assumed.
>
> Weeks 4 and 5 are calendar-locked. Discovering this during Week 4 would have eaten both.

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
- **CORRECTED 2026-09-06 — the flow does NOT write `InstallerSignOffBy`.** This contract previously claimed it wrote "InstallerSignOff = true, By, On, ...". The published MERGE body writes `InstallerSignOff`, `InstallerSignOffOn`, `WorkDate`, `SignOffNotes`, `TasksTotal`, `TasksComplete` and nothing else. **Every sign-off is therefore anonymous**, which undercuts the attestation the system exists to produce, and makes the crew-lead-vs-PM-proxy distinction unrecordable. Fixing it needs a sixth trigger parameter (`SignedByEmail`) plus a site-user lookup in the flow, because a Person column cannot be set by email through REST — it needs the numeric id from `_api/web/siteusers/getByEmail(...)`. Send the **UPN**, not `mail`. See `canvas-app/formula-review.md` §2.
- **CRITICAL:** The Event-Driven Reconciliation flow's trigger condition MUST skip sign-off-only edits, or Sign-off Intake writes re-fire it and burn quota. See Rev D §06 for the trigger-condition expression.

**Between the four subcontractor crews and Assignments:**
- Their CrewID stays as the browser tool's short code (`george`, `armondo`, `stl`, `brothers`)
- `Unlimited = Yes` flag on their Crews row means they never contribute to busy-map or double-book detection
- Assigning them zero-in on scheduling logic — they schedule like any other crew but don't consume capacity

**Auth to SharePoint from scripts:** unsolved for headless PS. Working pattern is Claude Chrome + REST-from-page — see below.

## Commercial basis — not in this repo

**The `~$14k build` figure in `D2-Stratirus-Ownership-Plan.md` is WRONG for this project** (corrected 2026-09-04). That SOW covered a **Copilot setup and GoDaddy migration** — a separate engagement that was conflated with this build when the plan was drafted. Anything derived from it is equally void: the "build drops ~$4k" for the Forms fallback in `D2-Phase-1-Verifications.md`, and the "$14k Lists vs $36k Dataverse" comparison in `Ryan-Handoff-Email.md`.

**Do not quote any of those numbers as this project's budget.** The commercial terms for the D2 Build Scheduler are not recorded anywhere in this repo. If a cost question comes up, ask rather than infer.

Figures that *are* sound, because they come from Microsoft list pricing rather than the SOW: crew-lead licensing at ~$6/user/mo (Business Basic), and Power Apps Premium at ~$20/user/mo for the Dataverse path. **The ~$2.25 M365 F1 figure that used to appear here is void** — F1 does not include Power Apps, so it was never a real option at any price. See the crew-lead licensing entry under Known bugs.

## Estimating — the week/hour figures are not reliable

The Rev D plan's per-week hour estimates were written for human developers. Observed pace with Claude Code assisting:

| | Estimated | Actual |
|---|---|---|
| Week 1 — 7 lists, 22-field schema, 200+ seed rows | 25 hrs / 5 days | **1 session, 1 day** |
| Week 2 — 5 flows | 22 hrs / 5 days | **~11 sessions over 10 days** |

Week 1 collapsed. Week 2 did not — but its time went to **auth dead ends** (PnP, m365 CLI, the `api.flow.microsoft.com` REST wall, the draft-row mechanism, the `az rest` encoding trap) and **bug discovery**, not authoring. Writing the definitions was the cheap part.

So classify work by what actually bounds it, not by hours:

- **Effort-bound** (authoring, schema, scripts, docs) — compresses hard. Estimate as "a session or two."
- **Discovery-bound** (auth walls, undocumented platform behaviour, wrong assumptions in the spec) — **does not compress**, and is where Week 2 actually went. Buffer, don't estimate.
- **Human-gated** (Don's trade mapping, the 7 crew-lead accounts, Teams channels, licensing) — moves at client speed. Currently the longest poles.
- **Calendar-bound** (the pilot needs a real work week; training needs people in rooms; go-live support needs business days) — **irreducible**. Assistance does nothing here.

The practical consequence: compression helps the app build and nothing after it, so any slack has to be taken out of Week 3 / Phase C. Weeks 4 and 5 cost what they cost.

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

**Any future flow, the canvas app, and the nightly browser-tool→Lists sync must write and join on `CrewID`.** The Flow 4 Select projection in `D2-Week-2-Automations-Runbook.md` still needs this treatment.

**`az rest` output on Windows silently DROPS characters outside cp1252 — never rebuild a flow definition from an `az rest` capture.** Redirecting `az rest` to a file loses U+26A0 (warning sign), U+2192 (right arrow) and U+2013 (en dash) entirely — they vanish rather than becoming mojibake, and `PYTHONIOENCODING=utf-8` does **not** fix it. Characters that *are* in cp1252 (U+00B7 middle dot, U+2014 em dash) survive, which makes the loss look selective and easy to miss. Writing such a capture back would strip those glyphs from the live flow.

- To read a definition you intend to modify, use FlowAgent `get_flow` (MCP channel, faithful UTF-8). It confirmed Flow 3's glyphs are intact in production.
- To submit a definition, emit it with `json.dumps(..., ensure_ascii=True)` so every non-ASCII character becomes a backslash-u escape — uncorruptible through any console or transport.

**`authentication` is service-managed on the trigger too, not just actions.** The published rows of both flows contain no `"authentication": "@parameters('$authentication')"` anywhere, trigger included. Submitting it produces a spurious "trigger changed" diff. Omit it everywhere; the service owns it.

**FlowAgent `preview_update` reports container actions as changed with `fields: []`.** `If` blocks and the trigger show as "changed" with an empty field list even when byte-identical to live (verified against `get_flow`). Treat `fields: []` as differ noise; only entries with named fields are real changes.

**Assignments has four Required columns seeded NULL — `Locked`, `NotApplicable`, `PMSignOff`, `DurationDays`.** All are genuine Boolean/Number columns (not Choice), but REST item-creation bypassed required-field validation during Week 1 seeding while the SharePoint form does not. Consequence: **the list form refuses to save any hand-edit** until all four are populated — you cannot change one date in the UI. Use SP REST `MERGE`, which validates only the fields named in the body. This will also hit the canvas app unless it writes via MERGE.

**RESOLVED 2026-09-03 — DateTime storage convention. All seeded dates were one day early, which silently inverted the work-week.**

The date columns were never the problem: `ScheduledStart`, `ScheduledFinish`, `WorkDate`, `Jobs.StartDate` and `Work Calendar.Date` are all already **DateOnly** (`DisplayFormat=0`). The stored *values* were wrong.

Site regional timezone is **(UTC-06:00) Central Time**. What matters is the wall-clock time a DateOnly value is stored at:

| Stored | SP connector reads it as | |
|---|---|---|
| `2026-09-02T00:00:00Z` — midnight **UTC** (Week 1 seeding) | `2026-09-01` | **wrong, one day early** |
| `2026-09-05T05:00:00Z` — midnight **Central** | `2026-09-05` | correct |

**The convention: write DateOnly fields as a bare `'yyyy-MM-dd'` string via REST.** SharePoint interprets it in site-local time and stores local midnight (`05:00Z` under CDT, `06:00Z` under CST). Never write an explicit `...T00:00:00Z` — that is what Week 1 seeding did and it is off by one.

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

**OPEN BUG — Flow 3's trigger condition is a no-op; `GetOnUpdatedItems` emits no `@odata.oldValue` properties. Found 2026-09-03 by exit-gate test 2.**

The Rev D §06 trigger condition is:

```
@or(not(equals(body/Crew, body/Crew@odata.oldValue)),
    not(equals(body/ScheduledStart, body/ScheduledStart@odata.oldValue)),
    not(equals(body/DurationDays, body/DurationDays@odata.oldValue)),
    equals(body/Crew@odata.oldValue, null))
```

**Empirically, the SharePoint `GetOnUpdatedItems` trigger body contains no `@odata.oldValue` keys whatsoever.** Verified on run `08584131498858558107493709439CU07`: the trigger payload held `ID`, `Crew`, `ScheduledStart`, `InstallerSignOff`, `SignOffNotes` and no `*@odata.oldValue` at all.

Consequences, all following from every `oldValue` reference evaluating to null:
- The fourth clause `equals(null, null)` is **always true**, so the condition always passes.
- The first three are also true (`not(equals('harrison', null))`).
- **Every edit to any Assignments row fires Flow 3**, including every sign-off write from Flow 2 — the precise quota burn the condition exists to prevent.

**Test evidence:** a MERGE touching only `InstallerSignOff` + `SignOffNotes` on row 5 at 17:36:08 produced a Flow 3 run at 17:36:40. Exit-gate test 2 **fails**.

**Severity is quota, not corruption.** Flow 3 only reads (`GetItem`/`GetItems`) and sends mail — it never writes to Assignments — so there is **no self-retriggering loop**. The costs are wasted runs on every sign-off and a duplicate double-book alert whenever a genuine conflict row is later signed off.

**Not yet fixed — needs a design decision.** Options considered, none applied:
1. Have Flow 2 set a `SkipReconcile` flag that Flow 3 checks and clears (adds a write, so re-check for loops).
2. Store a last-reconciled copy of `Crew`/`ScheduledStart`/`DurationDays` on the row and compare in-flow.
3. Drop the condition and gate cheaply inside the flow, accepting one run per edit.
4. Find a SharePoint trigger variant that does populate `oldValue`.

Until resolved, treat the Rev D §06 "trigger condition prevents self-firing" claim as **not achieved**, and do not rely on it when estimating flow-run consumption.

The stale lookup-shape assumption in `D2-Week-2-Automations-Runbook.md` has been corrected (L74, L80, the Flow 4 Select projection, and the "Common gotchas" entry that wrongly claimed `Crew` filters need `CrewId eq 3`). `sessions/2026-08-26a-daily-dispatch-handoff.md` (~L143, L151) still carries it and was deliberately left alone — session logs are historical record, not instructions.

Related: `sessions/2026-08-28a-daily-dispatch-test-debug.md` blames the `$orderby Crew/Title` failure on "SP OData can't order by an expanded lookup". That diagnosis is wrong — `Crew` is not a lookup at all, so `Crew/Title` was never a valid path.

**`az login` silently uses the cached tenant — the FlowAgent version of the `Add-PowerAppsAccount` trap.** Without `--tenant`, `az` reuses whichever tenant last authenticated (Tennetech LLC, `20f64e0e-…`, in Shane's case). FlowAgent's `doctor` then reports **all checks passing** and `list_environments` returns exactly one environment — "Tennetech LLC (default)". D2 Automation is invisible, with no error anywhere. Always pin:

```powershell
az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4
```

and confirm with FlowAgent `whoami` that `tokenIdentity.tenantId` is `f24d9b39-…` before trusting any flow listing.

**FlowAgent rejects `authentication` in action inputs, but the live exports all contain it.** `validate_flow` fails any definition carrying `"authentication": "@parameters('$authentication')"` inside an action's `inputs` (rule `extra-authentication`) — the Flow API injects it on create. The service then writes it back, which is why every `OpenApiConnection` action in the Flow 1 and Flow 2 exports has it. Correct at runtime, invalid at authoring time: strip it from actions before importing, leave the trigger's copy alone. Also note FlowAgent takes `definition` / `connectionRefs` / `name` / `state` as four separate arguments — our `flows/definitions/*.json` nest all four under `properties`, so they must be split on the way in. Mapping table is in `flows/README.md`.

**`Harrison Residence` / `D2-1001` is NOT a real pool — it is the browser prototype's hardcoded demo job** (`pool-scheduler.html` L258: `newJob('Harrison Residence','1420 Camino Real','Thousand Oaks','CA','91360')`), carried into SharePoint verbatim during Week 1 seeding. Assignments 1-5 hang off it. **D2 production therefore contains no real job data at all** — only this demo job and the `TEST-900x` rows. The first real pool arrives in Week 4. Two things follow: the seed-data "defects" (Assignment 4 spanning Sunday 09-06, Assignment 1's stale sign-off) are demo-data artifacts rather than live scheduling errors, and this is also **why the Week 3 spec referenced `Jobs.State` and `Jobs.ZIP`** — the prototype's job model carries them, the SharePoint list does not.

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
- **D2 Bot (`stratirus@d2pools.com`) holds Business Standard**, which includes Power Apps for M365 seeded rights. **This licenses the entire Week 3 build and most of device testing with no new purchase.**
- The two `Suspended` rows are **dead subscriptions with 8 stale assignments**, not reclaimable capacity — GoDaddy-era leftovers from D2's move to direct Microsoft billing in late July 2026. The Aug 24 "ghost licensing" question is now closed: it frees nothing.
- 19 disabled accounts (gmail, thryv.com, emich.edu, plus typo-duplicate pairs) are the same migration debris. Harmless; tidy when convenient.

**Crew-lead licensing — canvas app confirmed, seats not yet bought (2026-09-04).**

- **There are no crew-lead accounts in the tenant at all.** The dependency is *create ~10 identities + mailboxes*, then licence, then install and sign in per handset — not merely "buy 10 seats." That lead time sits upstream of Week 4 and is the item to put in front of David/Don.
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

**Canvas app authoring — SPIKED AND ANSWERED 2026-09-06: build in Studio, not headless.** Full reasoning in `canvas-app/README.md`. The short version: `pac canvas` round-trips YAML cleanly, but **data connections are not expressible in YAML** (they live in the `.msapr` residual, and this app needs four SharePoint connections plus the Flow 2 connector), there is **no `pac canvas upload`** verb, and Microsoft scopes the format to "review changes made within Studio and minor edits (Preview)". Use `download` + `unpack` after each Studio session to get reviewable formula-level diffs into git. That is a real gain we did not have before, and it is all the YAML path is good for. The spike cost about half an hour and caught this before it surfaced at Day 1 Step 2 of the Week 3 spec.

**Superseded detail from the same day, kept because the dead ends are worth not re-walking:**

`pac` CLI 2.11.2 is installed and `pac canvas` offers `download / list / pack / unpack / validate / create`. **`pack` and `unpack` are flagged Preview by Microsoft.** `pack` requires a complete `--sources` tree in `SourceCode` layout, and hand-authoring that tree from nothing is a very different proposition from repacking one that `unpack` produced.

Confirmed dead ends for bootstrapping a seed `.msapp` without the designer:
- `pac canvas list` against D2 Automation returns **empty** — no canvas app exists yet to download.
- `pac canvas create` builds an app **from a custom connector**, and `pac connector list` reports **no connectors in the environment**.

**So the seed app must be created once in Studio.** The plan: create a blank app, `pac canvas download` it, `unpack` it, then author against a known-good tree rather than inventing one. Decide headless-vs-Studio on the evidence of that round-trip, and do not commit to headless before it. This is deliberately cautious because the Week 2 lesson applies exactly here: authoring compresses, undocumented-platform discovery does not.

**`pac` auth — the cached-tenant trap bites here too.** `pac auth list` showed `stalbot@stratirus.com`, the third instance after `az login` and `Add-PowerAppsAccount`. Fixed with a named profile:

```
pac auth create --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4 --name D2
```

Sign in as **`stratirus@d2pools.com`**. Verify with `pac env list`, which must show `D2 Automation` / `2710a01b-6cfa-e820-b338-2286f2649300` / `https://org4ed2f722.crm.dynamics.com/`.

**REST from the browser: always use the ABSOLUTE site URL.** A leading-slash path such as `/_api/web/lists/GetByTitle('Crews')` resolves against the **root** site and returns `List 'Crews' does not exist at site with URL 'https://netorgft15040037.sharepoint.com'`. Every call must be prefixed with `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`. The list is on the subsite, and the 404 names the root URL, which makes it look like a permissions problem when it is a path problem.

**Week 3 canvas app is built by Stratirus, IN D2 PRODUCTION — env decided 2026-09-04, ownership settled 2026-09-05.** No mirror environment, no stub flow, no cross-tenant port. The build happens in **D2 Automation** against the real lists, signed in as **D2 Bot** (`stratirus@d2pools.com`, Business Standard, which carries Power Apps for M365 seeded rights), calling the real published Flow 2. This removes roughly a day of port-and-re-point overhead from the only week that still has slack — Weeks 4 and 5 are calendar-locked.

The third-party risk is gone, but **the production risk is not** — this is still a live client tenant and still a shared credential. The safety rules are in `D2-Canvas-App-Handoff-Contract.md` §6a and remain load-bearing: never touch Assignments 1–5 or `D2-1001` (use the `TEST-900x` rows, and do **not** delete them — that removal is sequenced for just before the pilot); stop Flows 3 and 4 before bulk writes, because Flow 3's no-op trigger means every Assignments edit burns a run; calling Flow 2 writes real sign-off data; everything logs as D2 Bot so there is no individual attribution; and do not edit the five published flows in the designer.

`canvas-app/mirror-provision.js` is retained as the authoritative live-schema capture (more accurate than the obsolete `D2-Provision-Lists.ps1`) but is **not needed** for this build.

**Canvas-app schema traps — all CONFIRMED against live lists 2026-09-04, all were in the Week 3 spec:**

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

## How to run it

**Week 1 complete — all 7 SharePoint lists provisioned and seeded on the D2 tenant** as of 2026-08-25. Rev D week-by-week runbooks are in repo root (`D2-Week-1-Build-Runbook.md` through `D2-Week-5-Cutover-Runbook.md`).

**Deployed state (D2BuildScheduler site):**

| List | Rows | GUID |
|---|---|---|
| Jobs | 1 (Harrison Residence D2-1001 — **demo data, not a real pool**) | `ee0ecabf-2f11-458d-a9ea-641f76d10cc3` |
| Assignments | 5 (D2-1001 sub-phases; 22 fields incl full Week 1 schema) | `49ef7006-d3fe-40a7-a52f-c4c18545bd35` |
| Tasks | 30 (6 × 5 assignments) | `22c45847-ff0d-417a-b53e-1ea018fbb6d3` |
| Trades | 26 | `05038f7f-a6cb-4f57-b1a1-3ff9c7126ba5` |
| Crews | 14 (subcontractor patch applied) | `45e9ff1f-bf36-4ab5-929d-25ab9a80d460` |
| Crew-Trades | 51 | (see viewlsts.aspx) |
| Work Calendar | 62 (52 Sundays + 10 US federal holidays) | (see viewlsts.aspx) |

**Week 2 flow status (as of 2026-09-05 — Week 2 is CLOSED):**

| # | Flow | State | Notes |
|---|---|---|---|
| 1 | Daily Dispatch + Reminders | Started | **DONE — verified end-to-end 2026-09-03.** Both the `?['Value']` fix and the `CrewID` join fix applied and published; a live run produced a populated dispatch email. |
| 2 | Sign-off Intake | Started | DONE, end-to-end verified |
| 3 | Event-Driven Reconciliation | **STOPPED 2026-09-05** | **Deliberately stopped for the canvas-app build.** Detection works; gate test 2 FAILED. `CrewID` join fix applied + published; double-book correctly fired a High-importance alert with correct body. But the trigger condition is a **no-op** — `GetOnUpdatedItems` emits no `@odata.oldValue`, so every edit fires the flow. See Known bugs. |
| 4 | Nightly Reconciliation | Started | **DONE — built and both tests passed 2026-09-03.** Created fully headless (no designer). Clean sweep = 0 conflicts, no email; seeded double-book caught and emailed. |
| 5 | Daily + Weekly Summary | Started | **DONE.** Built 2026-09-03 as two flows, HTML body not PDF. **Content reviewed 2026-09-05 and three defects fixed** — weekly compliance counted unfinished work, neither table was sorted, daily footer off by one. Re-verified by manual run. |

**Week 2 close-out completed 2026-09-05:** summary previews reviewed (three defects found and fixed, see Flow 5 below), Flow 5 recipients deliberately left internal, and all six flows re-exported to `flows/exports/`.

**Immediate next action:** start the Week 3 canvas app per `D2-Week-3-Canvas-App-Spec.md`. Two things gate it and one is now sequenced:

- **Gate Flow 3 before the app writes at volume** — its trigger condition is a proven no-op, so every Assignments write burns a run, and the app is going to write task counters. This moved from "low urgency" to "blocking" the moment we owned the app.
- **`Crews.LeadEmail` still holds placeholder data** — all seven field crews carry the same non-existent external UPN, so the app's `LookUp` on current user cannot work until it is seeded with real UPNs. That needs the crew-lead accounts to exist, which is client-gated.
- **TEST-900x stays** until just before the pilot, deliberately — it is the only realistic test volume the canvas app has.

**TEMPORARY TEST DATA IS LIVE ON THE D2 TENANT — remove before the pilot.** Seeded 2026-09-03 so Flows 4 and 5 could be judged against realistic volume rather than 5 rows.

| What | Count | Marker |
|---|---|---|
| Jobs | 2 | `TEST-9001` Sandbox Ridge, `TEST-9002` Sandbox Vista |
| Assignments | 38 | Titles begin `TEST-900x ` (ids 6-43) |
| Tasks | **252 (added 2026-09-06)** | see below |

**Tasks were backfilled 2026-09-06 — without them the canvas app could not be built.** The seed originally created **zero** Tasks rows, so 38 of 43 assignments had nothing to tick and the only 30 tasks in the list belonged to the Harrison demo job that is scheduled for deletion. The app's central screen is task-ticking, so this would have stopped the build on Day 2 of the Week 3 spec.

252 rows were generated from the browser tool's `SEED_TEMPLATE` (295 real task names across 46 sub-phases), giving real text like `Verify Suction Lines`, not `Task 1`. Live state is now **282 tasks, 43 of 43 assignments covered, 93 complete**, with every assignment's row count matching its `TasksTotal` and completed count matching `TasksComplete`. The template's per-sub-phase task counts matched the existing `TasksTotal` values on all 38 rows with **zero mismatches**, which is a useful independent check that the seeder and the template agree.

One deliberate inconsistency remains: **Assignment 1 reports `TasksComplete = 6` while all six of its Tasks rows are `Complete = false`.** That is the pre-existing stale `"Chrome-driven test"` sign-off, not a backfill error. It is worth keeping until the demo job is deleted, because the counters are only written at sign-off and the app has to cope when they disagree with the rows.

Generated by `flows/testdata/generate-seed.py` from the real 46 sub-phase template in the browser tool, so it mirrors production shape (skills, durations, task counts). The generator enforces all four business rules and cross-checks against the 5 pre-existing Harrison rows before emitting anything — it caught two collisions with Assignment 5 on the first pass.

**Gap found 2026-09-05: the generator's rule-4 check does not cover the whole span.** `TEST-9002 · 2.1 Engineering Review by PM` is scheduled `2026-09-05 → 09-07`, crossing Sunday 09-06 — the same defect class as Assignment 4 in the original seed. It looks like only the start date is tested for Sunday, not every day in the range. Harmless in test data, but **do not reuse this generator for real scheduling without fixing the span check.** It became visible only once the summaries started rendering day names.

**To remove:** stop Flows 3 and 4, run `flows/testdata/cleanup.js` in the browser console on the site, restart the flows. Idempotent; reports what remains. The manifest of exactly what was created is `flows/testdata/seeded-ids.json`.

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

- **Neither flow set `$orderby`,** so both tables came out in list-ID order. The weekly jumped 09-05, 09-03, 08-29, 09-01 *within a single job*. Now `$orderby=ScheduledStart asc` on `Get_today_assignments` and `Get_week_assignments`. Safe because `ScheduledStart` is a real column — unlike the `Crew/Title` path that failed in Week 2, which was never valid at all.
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
