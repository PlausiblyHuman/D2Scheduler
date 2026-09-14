# CLAUDE.md — D2Scheduler

Durable orientation for any Claude session working in this repo.

---

## What this is

Pool construction scheduling and field sign-off system for D2 Pools. SharePoint Lists + Power Automate + Teams + a Power Apps canvas app for crew-lead task-tick, running on D2's existing M365 subscription with **no premium connectors and no Dataverse** — but see the licensing note below: the canvas app does require Business Basic seats for the ~10 field crew leads, so "zero incremental licensing" is **not** accurate and must not be repeated to the client. Replaces a browser-based prototype (`web/index.html` as of 2026-09-11; originally shipped as `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`, note the doubled directory) originally built by Ryan Meyer under his Tennetech brand; Stratirus took over full delivery ownership.

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
- **Browser scheduler** — `web/index.html` (moved 2026-09-11 from the doubled `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`, ahead of Azure Static Web Apps hosting in Phase H — see "Companion tools" below), permanent PM-side planner role. **It is fed from SharePoint as of 2026-09-11** via `sharepoint/export-to-planner.js` plus its own "Load from D2" button; it still never writes back. The "committed schedule flows to Lists nightly" half of this line was always aspirational and is the never-built nightly sync.

**Environment split:**
- SharePoint site at tenant level (netorgft15040037.sharepoint.com)
- Canvas app + flows live in Power Platform env **D2 Automation** (also home to a separate estimator engine — coexisting workloads, no interference expected)

**Rev D §16 traceability table** documents every design change from Rev A→B→C→D with source. When making architectural changes, extend that table.

## Business rules

The four load-bearing invariants (enforced by the design, not by a database primary key — SharePoint Lists has no composite alternate key equivalent):

1. **A crew is only assigned to a sub-phase whose required trade it actually holds.**
   **DETECTED NIGHTLY ON THE SHAREPOINT SIDE, NEVER PREVENTED. Corrected 2026-09-11c — this entry
   previously read "NOT ENFORCED ANYWHERE ON THE SHAREPOINT SIDE", which was true when it was
   written and stopped being true later the same day, when `D2 - Crew Trade Check` was built. That
   flow (row 14 in the flow table) runs at 05:15 Central, performs the join this section says nobody
   performs, and writes `Assignments.TradeMismatch`. The two statements sat in this file
   contradicting each other until this correction.**

   **What is still true, and it is most of it.** The flow *detects*; nothing *prevents*. The edit
   form will still accept a carpentry crew on a plumbing sub-phase and the flag appears the next
   morning. `TradeMismatch` has **no view**, so the enforcement is invisible unless someone opens the
   row. And it covers only the 22 of 46 sub-phases that carry a trade at all. Everything below about
   how the check was lost, why a column validation formula cannot do this, and why a null `Trade`
   must be a PASS remains accurate and is why the flow had to be the answer.

   The original finding, unchanged: the crew-to-trade join ran **once, offline, in Python**
   (`tools/gen-template-seed.py`) on 2026-09-07, and its answer was baked into
   `Sub-phase Template.DefaultCrew` as **plain text with no validation**. `D2 - New Pool` transcribes
   that text and the row's `Trade` side by side into each Assignment and **never compares them**.
   Nothing re-evaluates the join afterwards.

   **`Crew-Trades` (51 rows) and `Trades` (26 rows) are inert at runtime.** `Crew-Trades` appears in
   zero flows, zero views, zero forms, and is not a canvas-app data source; it is not even reachable
   from the site navigation. `Trades` survives only as a lookup display label.

   **The `Assignments.Crew` guard is a VOCABULARY check, not a qualification check, and this
   distinction is the whole point.** `guard-crew-values.js` writes
   `=OR(ISBLANK([Crew]),[Crew]="antonio",...)` over the 14 crew codes. It asks "is this one of the
   known crews", never "does this crew hold this row's trade" — and a SharePoint column validation
   formula **cannot** ask the latter, because it cannot traverse the `Trade` lookup into `Trades` and
   on into the intersect list. The Choice conversion adds nothing here either; it constrains the form
   only. Two vocabulary guards, zero qualification guards.

   **How it was lost:** `tools/add_pool.py` *does* carry the check (`pick_crew()`, and an explicit
   `UNQUALIFIED` assertion). That tool was superseded by `D2 - New Pool` as the user-facing path, and
   **the rule-1 check was left behind in the retired tool.** `D2 - Crew Trade Check` is where that
   check now lives, a day later and one surface over. The browser planner enforces it at the point of
   assignment via crew skills, so the two halves still disagree on *when* — the planner warns as you
   pick, SharePoint flags it overnight.

   **A check must treat a null `Trade` as a PASS.** The 11 field-supervision sub-phases carry no
   trade, so `Assignments.Trade` is null on 11 rows of every pool. A naive check fires on all of them
   from the first run and gets ignored within a week. (This is also the real reason the `Unassigned`
   view renders empty: its CAML requires `IsNotNull Trade`.)

   **Don's trade mapping makes this worse, not better.** Closing that gap puts `george` and `armondo`
   into rotation and forces a template regeneration, widening the surface this rule is failing to
   police. See the recommended fix under Known bugs.
2. **A field crew is never on two pools the same day.** Detection is post-hoc within one Power Automate polling interval (event-driven flow scoped to touched Crew + date range), with a nightly full-sweep safety net. This is "acceptable degradation, not equivalence" vs. the Dataverse alternate-key approach — see Rev D §07 for honest framing.
3. **Sub-phases run in order — one cannot start before the one before it ends.** Enforced by the
   browser planner's Auto-Schedule; re-enforced by its conflicts checker. **Nothing on the
   SharePoint side checks it** — no flow does (Nightly Reconciliation, Conflict Flag and
   Event-Driven Reconciliation all check crew overlap only), CAML cannot express it, and the canvas
   app does not look. So a PM editing `ScheduledStart` on the edit form can put 3.2 before 3.1 and
   nothing catches it.

   **A shared defect, half of it now fixed.** Both the planner's `autoSchedule` and
   `D2 - Reschedule Pool` advanced their cursor to a locked row's end **unconditionally**, so a
   locked row starting earlier than the rows before it dragged the cursor backwards and the next
   unlocked row landed on top of work already placed. **The planner half was fixed 2026-09-12**
   (`web/index.html`, take the later of the cursor and the locked row's end; pinned by
   `fixtures/planner/rules.js`). **The flow half is still open**: `Set_cursor_pinned` is
   `addDays(ScheduledFinish, 1)` with no `max()` against the running cursor. It needs the live
   tenant, so it was deliberately left. The difference today is that the planner will tell you and
   the flow will not.
4. **Mon–Sat are work days. Sunday is not.** Extended in the Lists path to include Work Calendar entries (Holidays, Weather days, per-crew shutdowns).

**TWO PLANNER-SIDE RULE BUGS FIXED 2026-09-12, both of which made the planner claim compliance it
was not delivering.** Both were recorded in `docs/planner-vs-sharepoint-parity.md` D1 and are now
closed there.

- **Rule 1: `qualified()` and `isQualified()` used different predicates.** `FIXED` maps the three
  pseudo-trades to one bucket crew each (`@office`→`office`, `@sub`→`subcon`,
  `@unassigned`→`unassigned`). `qualified()` offered only that crew, while `isQualified()` accepted
  **any** `unlimited` crew — so putting STL Shotcrete on an `@office` sub-phase produced **no error
  at all** while the same UI simultaneously flagged it under "⚠ Not qualified". `isQualified` now
  honours the map. Safety-checked against the three demo pools before committing: all 72
  pseudo-trade rows already carry their own bucket crew, so the stricter predicate flags nothing
  that exists (`office:24, subcon:15, unassigned:33`, 0 mismatches).

  **Open product question this surfaced, for Don rather than for code:** should `@sub` admit the
  four *named* subcontractors (`george`, `armondo`, `stl`, `brothers`) rather than only the
  `subcon` bucket? Arguably a subcontractor genuinely is "a subcontractor". It was deliberately NOT
  decided as a side effect of a bug fix, because it is a question about which buckets are open to
  which crews. Note the drawer dropdown currently offers only the bucket crew, so widening means
  changing both predicates together or reopening the same UI-vs-validation split.

- **Rule 2: `autoSchedule`'s busy map did not exempt `unlimited` crews** while `busyMap()` did, so a
  capacity-exempt subcontractor could be skipped as "busy" on a day it was legitimately free,
  pushing work to another crew or later than necessary. Now matches `busyMap()`.

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

**RESOLVED 2026-09-09: `Planned` is now a real pool state, not just a column default, and a
live pool's schedule can be reflowed instead of hand-edited.** Two gaps closed together, per
`docs/superpowers/specs/2026-09-08-pool-lifecycle-and-reflow-design.md`:

`Jobs.Status` defaults to `Planned` and `D2 - New Pool` already wrote it, but until 2026-09-09
nothing read it: a freshly generated pool dispatched to crews and raised conflict alerts on the
same run that created it. Now **Daily Dispatch, Event-Driven Reconciliation, Nightly
Reconciliation and both Summary flows all resolve the Active job set once per run and filter to
it.** A pool stays fully visible in the SharePoint views throughout, because the PM is working on
it; it is only invisible to dispatch, alerting and the summary schedule tables. `On Hold` gets the
same treatment for free, since every check is `Status eq 'Active'` rather than `Status ne
'Planned'`, which also gives the office a way to pause a pool without deleting it. **Committing a
pool is one field: open the Jobs row and change `Status` from `Planned` to `Active`.** Nothing
dispatches, and nothing alerts, until that happens. Status is deliberately NOT denormalised onto
the 46 Assignments rows: a `Get_active_jobs` call once per run is cheaper than 46 extra writes at
creation (and 46 more at commit) and cannot drift, and the two Summary flows already did exactly
this before the rest were brought into line.

**`Locked` (Boolean, on Assignments) now does something.** It sat Required-but-unused since Phase
A, seeded `false` on every row. `D2 - Reschedule Pool` is the first thing that reads it: a locked
row's dates are never moved by a reflow, and the walk resumes from the first working day after its
existing finish. Same treatment for a row with `InstallerSignOff = true`: signed-off work is
never silently rescheduled out from under the sign-off. This is what lets a PM pin a booked
inspection or a delivered-materials date and reflow everything around it.

**`D2 - Reschedule Pool`** is triggered by a row in the new **Reschedule Requests** list
(`JobNumber`, `FromSequence`, optional `NewStartDate`). It walks the job's Assignments in
`Sequence` order starting at `FromSequence`, recomputing `ScheduledStart`/`ScheduledFinish` as
working-day spans exactly as `D2 - New Pool` does (Sundays computed, holidays from Work Calendar),
skipping `Locked` and signed-off rows and any row with a null or non-positive `DurationDays`
(logged, not guessed at). One mechanism covers both cases the name promises: scheduling a freshly
generated pool is a reflow from sequence 1 with a real start date, and absorbing a slip on a live
pool is a reflow from the sub-phase that moved. Rows before `FromSequence` are never touched, and a
requested date that lands rows in the past is honoured, not silently clamped: the result email
says how many rows landed there, which is more useful than a schedule the PM did not ask for.

**`Assignments.SuppressReconcileUntil` (DateTime, NOT required) exists to stop a reflow from
burning up to 45 conflict-check runs on itself.** A reflow can rewrite every row in a pool, and
every write changes `ScheduledStart` or `ScheduledFinish`, which is exactly what Event-Driven
Reconciliation's version-history gate watches for. The reflow sets this field a few minutes ahead
on every row it writes, in the same MERGE as the dates; Event-Driven Reconciliation gained one
clause that terminates early when the timestamp is still in the future. **It is a timestamp, not a
boolean, deliberately.** A boolean has to be reset by a second write, and a reset that fails leaves
the row permanently invisible to conflict detection with no error anywhere. A timestamp expires on
its own and cannot mute a row for longer than its window. The accepted cost: a genuine PM edit to
the same row inside that window is skipped by the real-time check, same as a suppressed reflow
write. The reflow's own end-of-run conflict sweep and the nightly full sweep both still cover it,
so the conflict is caught, just not within seconds.

**The reflow's own conflict sweep is tenant-wide, deliberately, and this is an asymmetry worth
knowing.** Every other conflict surface in this system (Event-Driven Reconciliation, the nightly
sweep) considers `Active` jobs only, per the `Planned`-suppression change above. The reflow sweep
does not: it runs against every job regardless of status and can alert that an `Active` pool
collides with a `Planned` one that has not been committed yet. This was a deliberate ruling on the
spec's own grounds, not an oversight carried over from before the `Planned` filtering existed. A
PM choosing dates for a new pool still wants to know it collides with an existing pool on three
days, at the moment they are choosing the dates, and that is information they asked for rather
than an alert they need to be protected from. The distinction the design draws is alert versus
report, not Active versus Planned: the sweep always reports, but only sends an alert email when the
job being reflowed is `Active`.

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

  **EXERCISED END TO END — confirmed 2026-09-08b, this caveat previously said the opposite.**
  The `?['d']?['Id']` accessor is correct and the `ensureuser` path works. The proof no longer shows in the row state, because assignment 25 was subsequently REOPENED as a test of that feature, which clears `InstallerSignOff` and `InstallerSignOffById`. It survives in the audit trail the reopen appends:

  > `REOPENED 2026-09-07 18:09 by stratirus@d2pools.com (was signed by D2 Bot): Poor work quality on tile line, PM walk-through`

  That single line proves four things at once: sign-off wrote a real attributed user, Reopen clears it, Reopen records who had signed, and the optional reason is captured. **No row in the tenant currently carries a non-null `InstallerSignOffById`** — the six rows flagged `InstallerSignOff=true` today are seed rows with no timestamps plus Harrison 1's pre-fix `"Chrome-driven test"`. Do not read that as the fix being broken; read it as the evidence having been consumed. Original caveat, now void: The definition validated, published and re-exported clean, but FlowAgent cannot inject inputs into a PowerAppV2 trigger (`DirectApiTriggerInputsUnsupported` — the caller lacks the ACL on the flow's Logic Flows connection), and the only past run targets Harrison Assignment 1, so resubmitting it is barred by §6a. **The first real test is the canvas app's sign-off screen calling it against a `TEST-900x` row.** Until then treat the `?['d']?['Id']` accessor as unverified: if the connector returns the body unwrapped, it needs to be `?['Id']`. Assignment **32** (`TEST-9002 · 2.1 Engineering Review by PM`, 6 tasks, 0 complete, unsigned) is the intended target.
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
| **E** | Pilot — one real pool, parallel run | **Calendar** | Not started, **after H** | `D2-Phase-E-Pilot-Runbook.md` |
| **F** | Cutover — training, go-live, support | **Calendar** | Not started, **after H** | `D2-Phase-F-Cutover-Runbook.md` |
| **G** | Deferred backlog — post-go-live | Effort | Not started | (below) |
| **H** | Presentation layer — the hosted planner becomes the office surface | **Effort** | **Stage 1 local half DONE 2026-09-11d; hosting + auth remain** | `docs/superpowers/specs/2026-09-11-planner-as-primary-surface-design.md`, plan `docs/superpowers/plans/2026-09-11-phase-h-stage1-parity-and-brand.md` |

**Phase H is the build phase inside the client-facing "Phase 2". Two numbering schemes are
deliberate:** D2 hears "Phase 2", the repo says "Phase H", and H continues the A-G lettering
that matches the AzDo epics. Do not renumber A-G to match, and do not write "Phase 2" in the
repo without saying which one is meant.

**Decided 2026-09-11c by Shane, at the go-live cut.** Ryan raised that the presentation layer
looks cookie-cutter, and the client has seen `pool-scheduler.html` and expects that finish. The
answer is to host the thing they already approved rather than build a rival to it: Azure Static
Web Apps in D2's own tenant, MSAL delegated Graph reads, D2 brand repaint, with SharePoint
Lists still the database and all fourteen flows still the engine. The sequencing decision that
matters is that **this is explicitly NOT pre-pilot work** — ship the current system on the
SharePoint surface, then shift gears.

**RESEQUENCED 2026-09-11c, later the same day: H RUNS AHEAD OF E AND F.** Shane's call, an
immediate need. The morning's reasoning for putting it after the pilot rested on the Azure signup
being client-gated, and that turned out to be false (Shane holds admin rights). What is left of
that reasoning argues the other way: shipping H first means the office is **trained once**, on the
surface they will actually keep, instead of being trained on SharePoint views in Phase F and again
afterwards.

**Three knock-on effects, all real work rather than blockers:**

1. **Phase F's Day 2 office training material is now wrong.** It walks through
   "Views drop-down > This Week by Crew" and the rest of the SharePoint surface. It has to be
   rewritten against the hosted planner before Phase F runs. This file already records what
   happens when training docs go stale, so treat it as a tracked task, not a detail.
2. **The PM guide just went to the client describing the surface H replaces.** Version 5 of
   `a84a2e1a-…` was sent on 2026-09-11c. It needs reissuing once H lands, and the client will see
   the churn, so the Phase 2 framing in the invite is doing real work.
3. **The five parity divergences this put on the critical path are now CLOSED.** D7, D2, D8, D9
   and D4 would all have produced visibly wrong output once the planner became primary. All five
   were fixed directly in the planner (now `web/index.html`) in the same branch that repainted it
   and moved it out of the doubled directory — see `docs/planner-vs-sharepoint-parity.md` for what
   each was and what closed it. The Work Calendar HOLD lifted with D7, as intended.

**The risk to hold in mind:** Phase E exists to test the system under real work. Piloting on a
brand-new UI means interface bugs and system bugs arrive together, and this file already records
how expensive that is — three faults masking each other on the canvas app produced a confident
wrong answer. If H lands close to E, get the planner exercised on the demo pools first so the
pilot is not the first real use.

Three things a future session should not have to rediscover:

- ~~**D2 HAS NO AZURE SUBSCRIPTION.**~~ **SUPERSEDED 2026-09-13 — the subscription now exists; see the Azure subscription entry below.** Original finding, 2026-09-11 as `stratirus@d2pools.com`:
  `az account list` returns `N/A(tenant level account)` against tenant `f24d9b39-…` and the ARM
  subscriptions call returns empty. The only subscription on Shane's machine is `INTERNAL_BILL`,
  in **Tennetech's** tenant. Creating a subscription is free and SWA Free tier is free, so the
  ask to D2 is a signup and a payment method, not spend.
- **The read layer has to move from SharePoint REST to Graph.** `export-to-planner.js` works
  only because it runs on the SharePoint origin with `credentials: 'include'`. SharePoint REST
  does not serve CORS to arbitrary origins. Graph is a **third** field-shape surface alongside
  REST and the connector, so capture a real Graph payload into
  `fixtures/planner/live-payloads-graph.json` before writing any mapping. A REST probe does not
  validate a Graph expression, exactly as it does not validate a connector expression.
- **The hosting was never going to be the whole job, and that part is now done too.** Five of the
  eleven parity-map divergences would have produced visibly wrong output once the planner became
  primary: D7 Work Calendar, D2 PM sign-off crying wolf on 51 rows, D8 `NotApplicable` not
  exported, D9 `Jobs.Status` discarded, D4 `Jobs.StartDate` drift. **All five are CLOSED**, fixed
  in the planner itself before the Static Web Apps work started — see
  `docs/planner-vs-sharepoint-parity.md` for what each was and what closed it. What is left for
  Phase H is the hosting plus the SharePoint-REST-to-Graph read-layer swap, not these five. Netlify
  on a Stratirus account is the documented fallback host if the Azure signup stalls before a
  client demo.

**A–F match the AzDo Epic letters**, which is why the letters were preserved rather than
renumbered when G was added.

**THE LETTERS ARE NOT THE RUNNING ORDER.** They are AzDo Epic labels and creation order. As of
2026-09-11c the actual sequence is **A, B, C, D, H, E, F**, with G as a standing backlog. H was
specced last and runs next.

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
- **A Work Calendar top-up flow.** The list was extended by hand to **2029-12-30** on
  2026-09-08b, so this is no longer near-term, but it still expires and nothing still maintains
  it. A yearly recurrence appending the next year's Sundays and holidays closes it permanently.
  Do it before the horizon is inside a pool's four-month span again, i.e. well before mid-2029.
- **Photo capture** on a task or sign-off. Raised by Shane 2026-09-07, likely the highest-value
  addition after go-live for a warranty/QC trail. Needs a camera control, image storage, and an
  upload through a flow.
- **New Pool's accepted reconciliation cost.** `D2 - New Pool` does not stop Flow 3 around its own
  46 inserts, so every real pool burns 92 Event-Driven Reconciliation runs (46 from
  `Create_assignment`, 46 more from `Merge_task_total`). The second 46 terminate cheaply at the
  version-history gate, so this is accepted rather than fixed. If alert volume ever makes it worth
  closing, add a `SuppressReconcile` boolean set in the same `Create item` call and one clause in
  Flow 3's gate.

- **Editing a duration should reflow the pool by itself. Raised by Shane 2026-09-11c.** Today
  `DurationDays` is recorded and *nothing moves*: the dates only change when someone raises a
  `Reschedule Requests` row. That is two steps for what reads like one action, and the PM guide has
  to carry a callout explaining it, which is the tell that the behaviour is wrong rather than the
  documentation. Likely shape: add `DurationDays` to Event-Driven Reconciliation's version-history
  gate (which already watches `Crew`, `ScheduledStart` and `ScheduledFinish`) and have it raise a
  Reschedule request from that row's `Sequence`. Think about two things first: a PM correcting six
  durations in a row would fire six reflows, so it wants debouncing or a "reflow now" action rather
  than a per-edit trigger; and `D2 - Reschedule Pool` sets `SuppressReconcileUntil` on every row it
  writes, so the interaction between that suppression window and a duration-triggered reflow needs
  working through rather than assuming.

- **Conflict detection should cover the subcontractor crews. Raised by Shane 2026-09-11c.**
  `D2 - Conflict Flag`'s `Get_crews` filters `Active eq 1 and Unlimited ne 1`, and Event-Driven and
  Nightly Reconciliation carry the same `Unlimited` exemption, so `stl`, `george`, `armondo`,
  `brothers`, `subcon`, `unassigned` and `office` are never flagged as double-booked.

  **This is a business-rule change, not a filter change, and that is the whole difficulty.** Rule 2
  as written says an `Unlimited` crew never contributes to the busy map, deliberately, because a
  subcontractor can field more than one team on a day. Removing the exemption outright would flag
  every legitimate two-pool day STL works and the alerts would be ignored within a week, which is
  the same failure already documented for a naive rule-1 check firing on null trades. What is
  actually wanted is a *capacity* per crew rather than a boolean: `stl` can be on two pools but
  probably not five. `Crews.Size` already exists and is unused for this. Until someone decides what
  each subcontractor's real limit is, which is a question for Don, there is nothing to build.

  The PM guide no longer claims subcontractors are excluded, so nothing client-facing has to change
  when this lands.

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

**THE SIX-TIME REPEAT IS THE LOOKUP/CHOICE SHAPE TRAP, AND THERE IS A SKILL FOR IT: invoke
`power-automate-flow-mechanics` BEFORE writing any expression that reads a SharePoint column.** It
was available and correct on 2026-09-11 and was not invoked, which is how `D2 - Crew Trade Check`
wrote 66 wrong flags. The one-line version:

> **Which surface produced this output?** `OpenApiConnection` / `GetItems` / a connector trigger
> gives **connector** names (`Crew` as `{Id,Value}`, plus `Crew#Id`). `Send an HTTP request to
> SharePoint` and every `$filter=` string give **raw REST** names (`CrewId`). Same list, same
> column, different name, and which one you need depends on **the action, never the list**.

**Reading a column's internal name off the list schema tells you NOTHING about its shape**, and that
is precisely how this keeps happening: you look up `CrewId` over REST, where it is genuinely
correct, and carry it into a connector expression without noticing the surface changed. For the same
reason **a REST probe cannot validate a connector expression** — both can be right and still
disagree, so evidence about a flow has to come from the flow.

**Guard every cross-list join against the empty set.** A broken join does not error; it yields an
empty set and every row then fails whatever the join tested. `D2 - Crew Trade Check` now terminates
with `QualificationSetEmpty` rather than writing, which turns this entire class from silent-wrong
into loud-fail. Copy that guard into any future join.

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

**`Assignments.Crew` IS NOW A CHOICE COLUMN, converted 2026-09-10.** Shane's ask: free text on the
edit form meant "anybody can type anything in there and I feel like that's going to break flows
down the chain." It is now a native dropdown of the 14 crew codes (`FillInChoice=FALSE`,
`Required=FALSE`), so a PM picks rather than types. All 181 rows survived with 12 distinct values.

**A CHOICE COLUMN DOES NOT VALIDATE REST WRITES. This is the single most important thing on this
entry and it is counter-intuitive.** Proven on a throwaway list before touching Assignments:

| Write to a Choice column | Result |
|---|---|
| `Create item` with `Crew = "Devon Crew +3"` | **201, accepted** |
| `MERGE` with `Crew = "NOT_A_CREW"` | **204, accepted** |

Choice constrains the **form only**. The thing that actually blocks a bad value is the column
**validation formula** from 2026-09-09, which still returns `SPListDataValidationException`. So
the guard and the Choice list are complements, not alternatives — **do not remove the guard**, and
when a crew is added, update **both** the choice list and the validation formula.

**Converting via a `SchemaXml` MERGE SILENTLY WIPES `ValidationFormula`.** It was gone immediately
after the conversion and had to be restored in a second MERGE (`ValidationFormula` +
`ValidationMessage` only — never `SchemaXml`, which would clobber the choices back). Caught only
by reading the field back. If you ever re-run a SchemaXml write on this column, re-assert the
guard afterwards and re-prove it bites.

**The shapes, read off a real payload rather than assumed:**

| Read via | `Crew` comes back as |
|---|---|
| SharePoint **connector** `GetItems` / trigger | `{"@odata.type":"…SPListExpandedReference","Id":8,"Value":"harrison"}`, plus a sibling `Crew#Id` |
| **raw REST** (`Send an HTTP request`, `odata=nometadata`) | plain string `"harrison"` |
| server-side `$filter` | compares as a string — `Crew eq 'unassigned'` still returns all 41 rows |
| SharePoint **view** render / JSON view formatter `[$Crew]` | plain string |
| **Power Fx** | a record — `ThisItem.Crew.Value` |

**Ten sites were changed across seven flows; three deliberately were NOT.** Changed to
`?['Crew']?['Value']`: Daily Dispatch (`Filter_array`, `Filter_array_2`), Daily Summary
(`Filter_crew`, `Append_row`), Weekly Summary (same two), Nightly Reconciliation
(`Filter_crew_assignments`), Conflict Flag (same), Reschedule Pool (`Filter_job_rows_for_crew`,
`Filter_other_job_overlaps`), and Event-Driven Reconciliation's `Initialize_touchedCrew`
(`triggerOutputs()?['body/Crew']?['Value']` — it reads the **connector** trigger). Left alone,
correctly: Flow 3's two `body('Get_versions')?['value'][n]?['Crew']` reads (raw REST, plain
string), every `$filter` clause, and **`D2 - New Pool`'s write**, which posts a plain string via
raw REST and is the correct shape for a Choice column.

**The canvas app needed `.Value` in three places AND a data-source refresh in Studio.** Formulas:
`Crew.Value = gblCrewFilter`, `ThisItem.Crew.Value`, and — the one that is easy to miss —
`Distinct(…, Crew.Value)` feeding `galCrewList`, which otherwise makes `ThisItem.Value` a Record
and produces `can't be compared: Text, Record`. **Fixing the formulas is not enough**: the app
caches the SharePoint schema, so until **Data pane → Assignments → … → Refresh**, every `.Value`
resolves to `Error` and Studio shows `Incompatible types for comparison: Text, Error`. The refresh
does **not** by itself dirty the document, so the 1px nudge is still required before Ctrl+S.
Verified end to end in the **player**, not the download: three rows rendering `Harrison +2`,
`Saul +2`, `STL Shotcrete`, and the crew picker listing them.

**Related finding, pre-existing and NOT caused by this change:** the `Unassigned` view shows **0 of
the 41 rows** whose crew is `unassigned`, because its CAML also requires `IsNotNull Trade` and none
of those rows has a Trade. CLAUDE.md previously said it was "0 rows because the seed always sets a
crew", which is no longer true. Whether `Unassigned` should require a Trade is a design question
for Don's trade-mapping decision, not a typo to fix.

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

**AMENDED 2026-09-08b by Shane — the tenant is not yet operationally live, and the caution above
should be read in that light.** His words: *"I am literally the only person with access and
getting notifications. It's not really production yet, so we can move, edit and tweak what we need
to get it right."*

What that releases: batching changes purely to avoid tenant churn, hesitating to edit a published
flow, hesitating to stop or restart a flow, and treating alert emails as something to protect
people from. Nobody at D2 is receiving anything yet. Move.

What it does NOT release, because the reason was never "it is production":

- **Verification discipline stays.** This platform's whole failure signature is a write that
  returns 200/201/204 and does nothing, or renders blank, or matches no rows. That is a property
  of SharePoint and Power Automate, not of who is watching. Read the shape off a real payload,
  and verify by opening the result.
- **Expensive-to-recreate data stays protected.** The 46-row Sub-phase Template, the 295-row Task
  Template and the Work Calendar are hand-built or seeded once. Losing them costs real time, not
  reputation.
- **Batching canvas deploys stays**, for a different reason: every deploy costs Shane a manual
  Studio save. That is his time, not tenant risk.

This changes again the moment a real pool or a real crew lead is in the system. Revisit at
Phase E.

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

**THE WORK CALENDAR RAN OUT ON 2027-08-22. EXTENDED TO 2029-12-30 on 2026-09-08b.**

The original 62 rows were not "2026 holidays". They were a rolling year seeded once in Phase A,
running **2026-08-30 to 2027-08-22**: 52 Sundays and 10 US federal holidays spanning both years.
No flow, script or runbook step extended it, so it simply ran out, about 11 months out.

**Now 210 rows covering 2026-08-30 to 2029-12-30** (175 Sundays, 35 holidays), so the fuse is
roughly three years rather than one. Verified on write: 0 duplicates, 0 missing Sundays across
the whole span, 0 rows stored at midnight UTC (126 at `T05:00Z` CDT and 84 at `T06:00Z` CST,
which is the DST split you get only if each bare `yyyy-MM-dd` was interpreted in site-local time),
and every Sunday row's stored date matches the date embedded in its own Title.

**This is a reprieve, not a fix.** It still expires, and nothing still maintains it. The Phase G
top-up flow is the actual answer.

What happens after that date is quiet rather than loud, which is what makes it worth writing down.
`D2 - New Pool`'s `Condition_is_work_day` is:

```
and( not(equals(dayOfWeek(current), 0)),            // Sunday, COMPUTED
     not(contains(variables('nonWork'), current)) ) // holiday, from Work Calendar
```

Sundays are computed and therefore correct forever. **Holidays are read only from the list**, so
past 2027-08-22 every holiday silently becomes a work day, and pools get scheduled across
Thanksgiving and Christmas with no error anywhere. A pool runs roughly four months, so pools
created from about **April 2027** start crossing the boundary.

Two related notes. `Get_work_calendar` passes `$top: 500`, so a calendar extended past roughly
nine years would truncate, also silently. And Flow 1 reads the same list to decide whether today
is a work day, so an expired calendar degrades dispatch as well, not just generation.

**JUNETEENTH IS DELIBERATELY EXCLUDED. Decided by Shane, 2026-09-08b. Do not re-raise it, and
do not "helpfully" add it when next extending the calendar.**

It has been absent since seeding and stays absent. The reasoning matters for anyone extending
this list later: a row here **suppresses dispatch**, so adding a holiday the crews actually work
silently kills a real work day, and no error surfaces anywhere. Absence is the safe default;
presence is the claim that needs evidence.

Standing note, not a blocker: the other ten are inherited from the Phase A seed and were never
confirmed against D2's actual practice. The set includes Columbus Day and Veterans Day, which
many construction crews work, so it is really "US federal holidays" used as a proxy for D2's
shutdown days. If a crew is ever dispatched on a day D2 is closed, or not dispatched on a day it
is open, this list is the first place to look.

**`generate-seed.py` does not check holidays at all, only Sundays.** Three assignments carry an
endpoint on **Labor Day, 2026-09-07**: ids 4 (Harrison), 21 and 25 (both TEST-900x, so seeder
output). Business rule 4 covers Work Calendar entries, not merely Sundays, so these are rule-4
violations of the same class as the already-recorded Sunday-span gap. Harmless in test data that
is being deleted, and **the production path is unaffected** because `D2 - New Pool` checks both.
But do not reuse this generator for real scheduling without fixing the holiday check as well as
the span check.

**A FULL PLANNER-VS-SHAREPOINT PARITY MAP EXISTS: `docs/planner-vs-sharepoint-parity.md`
(2026-09-11, revised same day as divergences closed).** Eleven divergences between the browser
planner and this system, bucketed as already matched / easily matched / hard (with the wall named)
/ gap. Read it before changing either side. The three that mattered most when this map was first
written: the planner had **no holiday concept**, so it recomputed every imported span over Sundays
alone and drew holiday-crossing sub-phases a day short, feeding wrong spans into its own conflict
checks (**D7, now CLOSED** — the planner imports and checks against the SharePoint Work Calendar);
**business rule 1 is enforced only there** (D1, still open — untouched by the D7/D2/D8/D9/D4/D11
closures below); and the export made Schedule Check permanently cry wolf, because `PMSignOff` was
always false, `Tasks.NotApplicable` was not exported, and `Jobs.Status` was exported then discarded
(**D2, D8, D9 — all now CLOSED**).

**Data gaps still open (from Rev D §15 / original plan §09):**
- **10 trades unmapped to any sub-phase:** Retaining Walls, Veneer/Stone, CMU, Brick/Masonry, Landscaping, Pavers, Forms, Water Line Install, Material Runs, Grading. Don owes a mapping decision. George Crew is scheduled zero days until this lands.
- **11 field-supervision sub-phases sit in Unassigned.** Don owes: shared PM bucket, or specific-person ownership? **This is not an idle choice: see the `office` compliance asymmetry below.** If Don picks "shared PM bucket," these 11 land on the `office` pseudo-crew, which inherits that asymmetry immediately: no reminder ever nudges anyone to finish them, but every one still counts against Don's compliance number the day it finishes.
- Finish Grade skill on Saul & Guillermo — confirmed by Don (yes, they are qualified). No action.
- Four crews without roster (George, Armondo, STL, Brothers) — resolved as subcontractors, Unlimited=Yes.
- 46 durations still at 2-day placeholder — deferred; will be replaced from real actuals after first few pools.

**The `office` pseudo-crew has an asymmetry that is behaviour, not a bug, found 2026-09-09 in
the final whole-branch review.** `office` is not invisible: its sub-phases show up in Don's daily
summary and in the Assignments views exactly like any crew's. The real asymmetry is narrower and
easy to miss, because it sits between two flows that never looked wrong on their own:

- **Daily Dispatch's outstanding-work reminder never nudges anyone about an `office` sub-phase.**
  The reminder loop (`Get_items_3` in the export) is scoped `Active eq 1 and Unlimited ne 1`, the
  same "7 real field crews" filter used everywhere else in this codebase, and `office` is one of
  the seven `Unlimited = Yes` pseudo-crew buckets (`stl`, `george`, `armondo`, `brothers`,
  `subcon`, `unassigned`, `office`), so it is correctly excluded from a loop built to email a crew
  lead. Nobody is meant to get a text-message-shaped reminder on behalf of "the office."
- **But `office` sub-phases still count against Don's compliance percentage.** `Get_recent_finished`
  in the Daily and Weekly Summary flows has no crew filter at all (by design, since compliance is
  meant to be pool-wide, not crew-scoped), so a finished, unsigned `office` sub-phase depresses the
  same `signed / finished (pct)` number as a finished, unsigned field sub-phase.

Put together: work assigned to `office` gets counted against compliance but nothing in the system
ever prompts anyone to go close it out. Nobody is asked to fix it and everybody just watches the
number fall. This was true the day `office` was seeded as a pseudo-crew and is unrelated to the
`Planned`-suppression work this branch did. It is recorded here because it was found while
reviewing the same compliance-adjacent flows, and because it explains why the 11 unmapped
field-supervision sub-phases above are not a paperwork question: whichever way Don resolves them,
if any land on `office`, they will surface as a falling compliance score before they ever surface
as a question anyone asks. Not proposing a fix here: the honest options are "give `office` its
own reminder path" (real scope: a second recipient, since `office` has no single crew lead to
email) or "exclude `office` from the compliance denominator" (changes what the number means), and
neither is this branch's decision to make.

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

**`D2 - Reschedule Pool` build: five more platform findings, 2026-09-08/09, none caught by
`validate_flow`.**

- **A `SetVariable` whose value expression reads the same variable it writes fails save-time
  validation with a misleading error.** The message names an unrelated action and complains about
  a missing connection reference, which sends you looking at connection references rather than at
  the self-referential expression that actually caused it. Route the read through a `Compose`
  intermediate instead of a `SetVariable` reading its own name.
- **Nesting depth 9 is rejected. The maximum is 8.** This is why Task 7's walk merged
  `Condition_pinned` and `Condition_bad_duration` into one `Condition_skip_row` rather than the
  spec's literal two nested `If`s: the walk already sat at exactly 8 containers deep, and the
  literal structure was unbuildable. Add new containers as siblings, not nested, once you are
  anywhere near this depth.
- **The shape of a Choice column depends on how you read it: the fifth instance of this project
  assuming a field shape instead of reading it.** The SharePoint connector's `GetItems` returns a
  Choice column as `{Id, Value}`; raw REST via "Send an HTTP request to SharePoint" with
  `odata=nometadata` returns a plain string; a server-side `$filter` compares it as a string too.
  This silently made `D2 - Reschedule Pool`'s Active-job check always false: it was written
  against the `{Id, Value}` shape while reading via raw REST, and no test could see it, because a
  false comparison and an empty result look identical to "nothing to suppress." Tasks 2-5's
  Active-job filters were cross-checked against this and are safe: Daily Dispatch, Nightly
  Reconciliation and both Summary flows filter server-side, and Event-Driven Reconciliation reads
  via raw REST, so both sides of each comparison agree. This is the same family as the documented
  `Assignment` vs `AssignmentId` lookup-shape trap, `Crews.Title` vs `CrewID`, and
  `Assignments.Job.Value` vs `JobNumber`. Read the shape off a real payload for the specific
  action doing the reading, never assume it carries over from a different action on the same list.
- **`edit_flow`'s apply step is a full synchronous save-validation, not a draft write.** It can
  reject with a spurious error naming an action the edit barely touched, the same misleading-error
  shape as the `SetVariable` finding above. Related and required on these flows:
  `autoResolveConnectionRefs: false`. The default failed an edit while naming a pre-existing
  action the edit did not change at all.
- **FlowAgent `get_run_history` returned stale or absent snapshots repeatedly** while building and
  testing this flow. SharePoint's own `Status`/`Result` fields on the request row, and FlowAgent
  `get_run_action_repetitions`, were reliable where `get_run_history` was not. **An empty
  `get_run_history` result is not evidence a run did not happen.** This is the same shape as the
  already-documented published-vs-draft split: the read surface lags the write, so a read that
  shows nothing does not mean nothing happened, and the fix each time is to read from a surface
  that reflects the write rather than to trust an empty read.

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
| Jobs | **3** (`D2-1042` Reyes, `D2-1043` Whitfield, `D2-1044` Salcedo — all Active, all fictional; Harrison and both TEST pools deleted 2026-09-10) | `ee0ecabf-2f11-458d-a9ea-641f76d10cc3` |
| Assignments | **138** (3 pools x 46; 24 fields — `ConflictWith` and `CalendarEventId` added since Phase A) | `49ef7006-d3fe-40a7-a52f-c4c18545bd35` |
| Tasks | **885** (3 pools x 295) | `22c45847-ff0d-417a-b53e-1ea018fbb6d3` |
| Trades | 26 | `05038f7f-a6cb-4f57-b1a1-3ff9c7126ba5` |
| Crews | 14 (subcontractor patch applied) | `45e9ff1f-bf36-4ab5-929d-25ab9a80d460` |
| Crew-Trades | 51 | (see viewlsts.aspx) |
| Work Calendar | **210** (175 Sundays + 35 holidays, 2026-08-30 to 2029-12-30) | (see viewlsts.aspx) |
| New Pool Requests | 0 (cleared 2026-09-08 of build-time test rows; this is a client-facing operational log, not a place for our test litter) | `13331a5e-ea8e-4ab2-9276-db5b4f4d46bf` |
| Delete Pool Requests | 0 (cleared 2026-09-08, same reason) | `b1ea3db6-7870-4648-80c2-7fe8414ecfd7` |
| Sub-phase Template | 46 (one row per sub-phase; read by `D2 - New Pool`) | `453e7cd5-f84a-4e2a-9372-73f26019e3f0` |
| Task Template | 295 (one row per task across the 46 sub-phases) | `61824add-8eaa-4b1b-aed7-a202204bf9f5` |
| Reschedule Requests | **3** (the 2026-09-10 demo-pool reflows, all `Done` -- legitimate history, not test litter) | `31ada231-3937-4d72-9abf-8677f07c3fea` |

**Flow status (table originally closed out Phase B on 2026-09-05; rows 6 onward are later
additions and the table was never renumbered, corrected 2026-09-08 after it undercounted the
environment by three. There are fourteen D2 flows in total plus the unrelated `Generate estimate`,
which belongs to a separate estimator workload and is deliberately not documented here. Row 12 is
`D2 - Conflict Flag`, added 2026-09-09 and missing from this table until 2026-09-10; row 13 is
`D2 - Calendar Sync`, added 2026-09-10. Note the row numbers do NOT equal the flow count: row 5
covers two flows, the daily and weekly summaries.):**

| # | Flow | State | Notes |
|---|---|---|---|
| 1 | Daily Dispatch + Reminders | Started | **DONE — verified end-to-end 2026-09-03.** Both the `?['Value']` fix and the `CrewID` join fix applied and published; a live run produced a populated dispatch email. |
| 2 | Sign-off Intake | Started | DONE, end-to-end verified |
| 3 | Event-Driven Reconciliation | Started | Trigger condition fixed to version-history comparison 2026-09-07 (see Known bugs); no longer the no-op it was when this table was written. `Get_overlapping` gained the `Get_active_jobs`/`Select_active_job_ids`/`Compose_active_job_clause` idiom 2026-09-09, so a double-book alert can no longer name a `Planned` pool that has not been committed yet (see the `Planned`-suppression entry above). **Stop it before any bulk write to Assignments**, since it still fires on every Crew/date edit. |
| 4 | Nightly Reconciliation | Started | **DONE — built and both tests passed 2026-09-03.** Created fully headless (no designer). Clean sweep = 0 conflicts, no email; seeded double-book caught and emailed. |
| 5 | Daily + Weekly Summary | Started | **DONE.** Built 2026-09-03 as two flows, HTML body not PDF. **Content reviewed 2026-09-05 and three defects fixed** — weekly compliance counted unfinished work, neither table was sorted, daily footer off by one. Re-verified by manual run. |
| 6 | Task Tick Batch | Started | **NEW 2026-09-07, verified end to end.** `D2 - Task Tick Batch`, flowId `1a825a83-492a-d47a-0fc0-ec5ef7d43594` (Dataverse workflowid `e8843056-53aa-f111-aaab-6045bd0196b3`). PowerAppV2 trigger `(AssignmentID, TaskUpdates, TasksTotal, TasksComplete, SignedByEmail)`. Resolves the site user once via `ensureuser`, MERGEs each task from a comma-separated `taskId:flag` list, then MERGEs the assignment counters. **This exists because Patch() does not work from the canvas app — see the Patch entry under Known bugs.** |
| 7 | Counter Reconciliation | Started | **NEW 2026-09-07, verified.** `D2 - Counter Reconciliation`, flowId `e877197e-1ab6-8f74-49f2-9a12532e3b14` (Dataverse workflowid `291fa9d9-caaa-f111-aaac-6045bd0195dd`). Nightly 05:30 Central, an hour ahead of the daily summary so Don's compliance figures are always computed from repaired counters. Recomputes `TasksTotal`/`TasksComplete` from the Tasks list and MERGEs **only rows that drifted**, so a clean night writes nothing. First run repaired 6 rows; the immediate second run repaired 0. |
| 8 | Reopen Sign-off | Started | **Built 2026-09-07, verified.** `D2 - Reopen Sign-off`, flowId `d7bad02d-cbdf-f8e6-c385-9ff41bac3776` (Dataverse workflowid `0f850a63-beaa-f111-aaac-6045bd0195dd`). PowerAppV2 trigger. Clears `InstallerSignOff` and appends who reopened, when, who had signed, and an optional reason to `SignOffNotes`. Was already live but had never been added to this table. |
| 9 | New Pool | Started | **NEW 2026-09-08, verified.** `D2 - New Pool`, flowId `02905018-4f41-e05a-d140-74e2afc82052` (Dataverse workflowid `d782ee70-2fab-f111-aaab-6045bd0196b3`). Triggered by a new row in **New Pool Requests** (`ProjectManager` is a required field on that list). Reads the 46-row **Sub-phase Template** and 295-row **Task Template** and generates a full pool: one Job, 46 Assignments, ~295 Tasks. See Known bugs and gotchas for the platform constraints found building it. |
| 10 | Delete Pool | Started | **NEW 2026-09-08, verified.** `D2 - Delete Pool`, flowId `995099f4-76e6-8bc0-89ef-9fd3557138ce` (Dataverse workflowid `83064f1f-47ab-f111-aaac-6045bd0195dd`). Triggered by a new row in **Delete Pool Requests**. Removes a pool's Tasks, Assignments and Job. |
| 11 | Reschedule Pool | Started | **NEW 2026-09-09, verified.** `D2 - Reschedule Pool`, flowId `2f2cde97-e0fd-5c5c-934a-02f09a1d83a5` (Dataverse workflowid `210f1d70-e2ab-f111-aaab-6045bd0196b3`). Triggered by a new row in **Reschedule Requests**. Walks a job's assignments from a given `Sequence` forward, recomputing working-day spans, skipping rows that are `Locked` or already signed off. See **Staging / integration contracts** for the `Planned`/`Locked`/`SuppressReconcileUntil` mechanics and Known bugs and gotchas for the platform constraints found building it. **Hardened the same day in the final whole-branch review:** the reflow-walk `Foreach` now carries `concurrency: {repetitions: 1}` like every other variable-mutating loop in this flow (it always ran sequentially; this closes the gap between "does" and "is guaranteed to"); the mid-run failure email now names how many sub-phases already moved and says to re-raise the same request from the same `FromSequence` (the walk is idempotent); and `Send_completion_email`, `Send_failure_email_guard` and `Send_failure_email_action` all gained the PM -> requester -> `stratirus@d2pools.com` fallback that `Send_conflict_alert_email` already had, so a blank `Author.Email` (plausible per the UPN-vs-`mail` note above) can no longer produce a silent `400 To Field cannot be null or empty` on the very email meant to explain a failure. |

| 12 | Conflict Flag | Started | **NEW 2026-09-09, verified.** `D2 - Conflict Flag`, flowId `972c139d-e55f-6743-a76c-fbd2f08eeb45` (Dataverse workflowid `f0dd9a1d-8bac-f111-aaab-002248043e80`). Nightly 05:00 Central. Annotates `Assignments.ConflictWith` so a crew double-book is visible in SharePoint and not only in email; unlike the alerting flows it deliberately covers `Planned` pools too, so a PM can see collisions while choosing dates. Was missing from this table until 2026-09-10. |
| 13 | Calendar Sync | Started | **NEW 2026-09-10, verified.** `D2 - Calendar Sync`, flowId / workflowEntityId `f890f891-48ad-f111-aaab-6045bd0196b3`. Nightly 04:30 Central. Writes one all-day event per in-scope Assignment to the **M365 group calendar** behind the site. See "Group calendar" below. |
| 14 | Crew Trade Check | Started | **NEW 2026-09-11, verified both directions.** `D2 - Crew Trade Check`, flowId / workflowEntityId `a5f50628-eead-f111-aaac-6045bd0195dd`. Nightly 05:15 Central. Joins `Assignments.Crew` -> `Crews.CrewID` -> `Crew-Trades` -> `Assignments.Trade` and writes `Assignments.TradeMismatch`, which is **the first thing in this system to enforce business rule 1**. Writes only rows that changed, so a clean night writes nothing. See below for the lookup-shape trap it cost, and for what it does NOT cover. |

**CALENDAR SYNC IS NOW INCREMENTAL, and runs hourly (2026-09-10).** Trigger fires at **04:30 plus
06:30 to 18:30 Central**, all via one Recurrence with `schedule.hours`.

The naive version of this would have been expensive. The flow rewrote *every* in-scope assignment
on every run, so 13 runs a day at 138 assignments is ~1,800 Office 365 Groups calls a day, scaling
linearly with pools (~3,600 at six pools, ~6,000 at ten). Every flow here runs as
`stratirus@d2pools.com` on **seeded Power Apps for M365 rights**, so they share one daily request
allowance. Hourly-as-was would have made this the dominant consumer and would have started failing
as D2 adds pools.

**The fix is a rolling window rather than stored sync state.** `Compose_mode` reads the Central hour
and yields `full` at 04, `incremental` otherwise. On an incremental run `Get_in_scope` appends
`and Modified ge '<utcNow-2h>'`. The two-hour window against an hourly schedule overlaps
deliberately, so a missed or throttled run self-heals on the next one and there is no state row to
corrupt.

**THE SAFETY PROPERTY, and it is not optional: `Filter_orphans` must be fed an EMPTY array on an
incremental run.** Its `from` is
`@if(equals(outputs('Compose_mode'),'full'), outputs('Get_with_event')?['body/value'], json('[]'))`.
Without that, an incremental run sees only recently-modified rows in `Select_in_scope_ids`,
concludes every other event is an orphan, and **deletes the entire calendar**. Orphan removal
therefore happens on the 04:30 sweep only.

Verified both directions against the rendered calendar rather than the run status: an incremental
run with nothing changed finished in **3.8s**, skipped Create/Update/Delete, and left all 138 events
intact; touching one far-future row then re-running took **5s** and fired `Update_event` exactly
once with Create and Delete still skipped, 138 events, zero duplicates. A full sweep remains ~90s.

Note the 04:30 full sweep still does **not** cover events stranded by deleting a pool: that row is
gone, so no filter can reach it. See the `D2 - Delete Pool` gap above.

**`D2 - Crew Trade Check` — the sixth instance of the lookup-shape trap, and it cost a wrong write to
66 live rows before it was caught. 2026-09-11.**

The first run flagged **all 66 trade-checkable assignments as unqualified**, including
`campos does not hold Demolition` when `campos` demonstrably holds `demolition`. The flow returned
**Succeeded** and every action reported green.

Cause: `Crew-Trades`' lookup columns are named `Crew` and `Trade`, so **raw REST** exposes them as
`CrewId` / `TradeId` while the **connector** returns `Crew` / `Trade` as `{Id, Value}` objects (plus
`Crew#Id`). The flow read the connector's output using the REST names, so
`item()?['CrewId']` was undefined, `Filter_crew_trades` matched nothing, the qualification set stayed
**empty**, and therefore every checkable row looked unqualified. Correct expression:

```
@equals(item()?['Crew']?['Id'], items('For_each_crew')?['ID'])
@concat(string(item()?['Trade']?['Id']), ':', items('For_each_crew')?['CrewID'])
```

What makes this one instructive is that a **manual REST probe written minutes earlier returned 0
mismatches over the same data and was correct** — because raw REST really does expose `CrewId`. The
two surfaces disagree, and the probe validated nothing about the flow.

**A clean run of this flow proves nothing**, exactly like a green Daily Dispatch on a day with no
assignments. It was verified by deliberately setting assignment 342 (`D2-1042 · 1.5 Excavation
Operations`, trade Dig / Excavation) to crew `brothers`, which holds only `pebbletech` and `plaster`:
one row flagged with the right message, 65 others untouched; reverting to `harrison` cleared it. Test
it that way or not at all.

**WHAT IT DOES NOT COVER, and this is load-bearing: only 22 of the 46 sub-phases per pool carry a
trade at all.** The other 24 ride the pseudo-trades `@office`, `@sub` and `@unassigned`, which
`gen-template-seed.py` resolves to **no `Trade` lookup**, so they are routed to a bucket crew by
design. **A null `Trade` is therefore a PASS, not a violation** — a check that fired on them would
raise 24 rows per pool from the first run and be ignored within a week. Live today: 66 checkable, 72
null-trade, 0 mismatches.

**`Unlimited` crews ARE trade-checked.** `Unlimited` means capacity-exempt (rule 2), never
trade-exempt (rule 1) — a subcontractor still has to hold the trade. An early probe of mine wrongly
exempted them; `stl` legitimately holds shotcrete, rebar, plumbing, dig, form, plaster and pebbletech,
so the subcontractor rows pass on merit rather than by exemption.

**This is detection, not prevention.** The SharePoint edit form will still let a PM put a carpentry
crew on a plumbing sub-phase; the flag appears the next morning. Column validation **cannot** do
better, because it cannot traverse the `Trade` lookup into a second list. The accepted grammar here
matches rule 2, which is also detected post-hoc rather than prevented.

**THE GROUP CALENDAR — built 2026-09-10, and the route is not the obvious one.**

Shane wanted schedules to "drop to a shared calendar somewhere, so they can see what's happening
when". They now do: `D2 - Calendar Sync` maintains the **D2 Build Scheduler** M365 group calendar
(`D2BuildScheduler@NETORGFT15040037.onmicrosoft.com`, group id
`7b305c56-ceea-4838-9e58-90050a846204`, which is the group behind the SharePoint site).

**The Office 365 Outlook connector CANNOT reach a group calendar. Do not spend time trying.**
`CalendarGetTables` returns only D2 Bot's own three calendars, and the connector's Graph
passthrough (`HttpRequest`) rejects the segment outright:

> `URI path is not a valid Graph endpoint … Invalid resource, Allowed values: me,users.`

**The route that works is the `shared_office365groups` connector, which is Standard tier**, and
carries `CreateCalendarEventV2` / `UpdateCalendarEvent` / `CalendarDeleteItem_V2` — a full
lifecycle for free. Its connection was created **silently** by FlowAgent
`pick_or_create_connection` (`shared-office365grou-2b5c4977`), with no interactive consent, which
is worth knowing given the OneDrive connection was once treated as a blocker for exactly this
reason.

**Shape, captured from a real create rather than assumed:** the `body` parameter is the
**Graph-native event resource** — `subject`, `body{contentType,content}`, `start{dateTime,timeZone}`,
`end{dateTime,timeZone}`, `isAllDay`, `showAs`, `location{displayName}` — and the response returns
the event id as **`id`**. Two details that matter:

- **An all-day event's `end` is EXCLUSIVE.** A sub-phase finishing 09-10 must be written
  `end = addDays(ScheduledFinish, 1)`, or it renders a day short. Verified against the rendered
  calendar: a 2-day sub-phase reads `2026-08-19 -> 2026-08-21`.
- **The connector rewrites `timeZone` to `UTC`** even when `Central Standard Time` is sent. Harmless
  for all-day events because they key off the date part, but do not be surprised by it, and do not
  use this action for timed events without re-checking.

**Idempotency is via `Assignments.CalendarEventId`** (Text, hidden from New/Edit like the other
machine-owned fields). Empty → create and store the id; present → update in place; row no longer in
scope → delete the event and clear the id. **Scope is `Status eq 'Active'` only**, consistent with
dispatch, alerting and the summaries, so a `Planned` pool is invisible until committed. Rows with a
null `ScheduledStart`/`ScheduledFinish` are excluded server-side rather than guarded in the loop.

All three legs were verified against the rendered calendar, not the run status: first run created
43 events; an immediate second run created 0, updated 43 and produced **zero duplicates**; taking a
row out of scope deleted its event and nulled the id; putting it back recreated it, still with no
duplicates.

**Two things to know before this goes to the client:**

- **RESOLVED 2026-09-11c — the four are now members.** Verified on Graph: five members
  (`don@`, `david@`, `emon@`, `cody@` and `stratirus@`), owners still **D2 Bot alone**. Group
  membership is also what grants site access, via the `D2 Build Scheduler Members` SharePoint group
  backed by the `federateddirectoryclaimprovider` claim, so the four have site Edit rights too. The
  long-standing "client-gated, blocking everything" item is closed.

  **ADDING A MEMBER SENDS A WELCOME EMAIL, AND GRAPH WILL TELL YOU IT DOES NOT.** This was live on
  this group and was caught only because Shane required no notifications. Three surfaces, only one
  of them authoritative:

  | Read via | Reported |
  |---|---|
  | Graph `resourceBehaviorOptions` | `[]` — looks like nothing is set |
  | `Get-UnifiedGroup` | `UnifiedGroupWelcomeMessageEnabled` **blank**, which is not False |
  | `Get-UnifiedGroup -IncludeAllProperties` | **`WelcomeMessageEnabled = True`** — the truth |

  **Exchange is the authority, because Exchange sends the mail. Never check this on Graph.**
  `resourceBehaviorOptions` is a *creation-time* array that `Set-UnifiedGroup` does not update, so
  the two disagree permanently and Graph keeps reading `[]` even after the setting is off. Same
  family as every other shape trap in this file: the read surface and the write surface are
  different things.

  Current state, set 2026-09-11c and verified by read-back: `WelcomeMessageEnabled = False`,
  `AutoSubscribeNewMembers = False`, `AlwaysSubscribeMembersToCalendarEvents = False`. The third was
  `True` and was turned off deliberately: the group calendar holds 138 events and Calendar Sync
  rewrites it hourly, which is an email path that could not be ruled out. **Both are left off**,
  because re-arming welcome mail would also fire for the ~7 crew leads added later. Turn them back
  on only deliberately.

- **SITE RIGHTS VERIFIED 2026-09-11c: the four can edit pools, sub-phases and tasks.** Read from
  the live site rather than inferred, via a throwaway probe flow:

  | Checked | Result |
  |---|---|
  | `D2 Build Scheduler Members` role | **Edit** |
  | `D2 Build Scheduler Owners` / `Visitors` | Full Control / Read |
  | What is in the Members group | one principal, the claim `c:0o.c\|federateddirectoryclaimprovider\|7b305c56-…`, i.e. the M365 group itself |
  | Lists breaking permission inheritance | **0 of 18** |

  So M365 group membership flows straight through to Edit on every list, `Jobs`, `Assignments`,
  `Tasks` and all three request lists included, with no list-level exception to trip over. Edit
  covers add, edit and delete of items, which is everything the PM guide asks a PM to do.

  Two consequences worth knowing rather than acting on. Edit on a team site also permits creating
  and deleting **lists**, which is more than a PM needs but is the standard Members level and not
  worth tightening. And a PM can delete `Assignments` and `Tasks` rows by hand rather than through
  `D2 - Delete Pool`; the guide steers them to the request list, but nothing enforces it.

- **The tenant has DUPLICATE accounts for two of these people. Join on `userPrincipalName`.**
  Don Borgeson exists as both `don@d2pools.com` and `contact@d2pools.com`, both enabled, same
  display name. David Taylor exists as `david@d2pools.com` and as a **guest**
  `david_d2install.com#EXT#@...`, which is the `d2install.com` debris recorded elsewhere in this
  file. The `@d2pools.com` accounts are the right ones and are the ones now in the group and stored
  in `Jobs.ProjectManager`. A display-name match would have picked either.
- **Starting a Recurrence flow fires it immediately**, on top of any manual run. A probe flow
  during this build produced two events instead of one for exactly that reason. Create such flows
  `Stopped`, test with `run_flow`, and expect one extra run at the moment you start them.

Accepted cost: the first run writes `CalendarEventId` to every row, so it fires one Event-Driven
Reconciliation run per assignment. All of them terminate cheaply at the version-history gate,
because `CalendarEventId` is not `Crew` or a date — the same accepted trade as `D2 - New Pool`'s 92.
Runtime is ~90s for 43 assignments on a cold first run and ~30-45s thereafter, so a tenant with
five real pools should expect a few minutes nightly.

**THE PRE-PILOT CLEANUP GATE WAS RUN 2026-09-10, and the tenant now holds three fictional pools
and nothing else.** `cleanup.js` removed 282 Tasks, 43 Assignments and 3 Jobs (`D2-1001` Harrison,
`TEST-9001`, `TEST-9002`) with zero failures, matching the 2026-09-08b dry-run rehearsal exactly.
What survives is `D2-1042` Reyes, `D2-1043` Whitfield and `D2-1044` Salcedo, deliberately staged at
three different completion levels so the views, the calendar and the summary emails demonstrate
properly:

| Pool | Span | Sub-phases finished | Tasks | Signed off | PM |
|---|---|---|---|---|---|
| Reyes Residence | 08 Sep to 28 Dec | 1 of 46 | 26/295 | 1 | Cody Campbell |
| Salcedo Residence | 10 Aug to 28 Nov | 13 of 46 | 121/295 | 12 | **Don Borgeson** (was Cody, changed 2026-09-10) |
| Whitfield Estate | 15 Jun to 30 Sep | 37 of 46 | 251/295 | 35 | Emon Alexander |
| **Navarro Residence** | **20 Jul to 05 Nov** | **23 of 46** | **174/295** | **21** | **David Taylor** |

Staging notes worth keeping: the pools were **reflowed with `D2 - Reschedule Pool`** rather than
hand-dated, so the working-day and holiday logic did the work; **four sub-phases are deliberately
left unsigned** so `Sign-off Overdue` and the compliance figure have real content; and sign-offs
are attributed to **Cody and Emon**, who are real enabled accounts (site user ids 14 and 15), which
matches the pilot model of PMs signing on the crew's behalf.

**PMs were spread one pool each on 2026-09-10** (Shane's call) so all three see a PM's view: Cody
on Reyes, Emon on Whitfield, **Don on Salcedo**. Don had no site user record and was provisioned
via `POST _api/web/ensureuser('don@d2pools.com')`, giving site user id **16** (Cody 14, David 13,
Emon 15). The matching `New Pool Requests` rows were re-pointed from `D2 Bot` to the same three, so
the request history reads like a PM's rather than a machine's; editing those rows is safe because
`D2 - New Pool` triggers on `GetOnNewItems`, created-only. **Setting a Person field notifies
nobody**, and the only flow that emails `Jobs.ProjectManager` unprompted is Event-Driven
Reconciliation, which needs a Crew or date edit to fire — which is why this was safe to do before
the four were given access. `flows/testdata/demo-pools-manifest.json`
remains the removal record: `cleanup.js` will not auto-remove these, by design, because they carry
real-looking job numbers.

**KNOWN GAP, unfixed: `D2 - Delete Pool` does not remove calendar events, so deleting a pool
strands them.** `D2 - Calendar Sync` finds orphans by querying Assignments rows that still carry a
`CalendarEventId`; once the row is deleted the event is unreachable. The cleanup gate proved it by
stranding 43 events, which were cleared by hand over Graph. **CORRECTED 2026-09-11: the connector has no list-events *operation*, but it DOES have a Graph
passthrough that reaches group events, so Calendar Sync CAN be made to self-heal.** See the
Groups-passthrough entry below. The original claim here was half right and the wrong half was
load-bearing: it closed off the better fix. Delete Pool removing each event before its row is
still an option, but it only covers orphans that Delete Pool itself creates. Two `edit_flow` attempts failed and rolled back cleanly (flow untouched,
48 actions): adding a *new* connector to that solution-aware flow needs a Dataverse connection
reference that does not exist, and **both `autoResolveConnectionRefs: true` and `false` fail with
the same misleading error**, naming `new_sharedsharepointonline_beb06` and the pre-existing
`Set_status_deleting` action rather than the connector actually missing. Next attempt should create
the connection reference first, or add the action in the designer.

**THE OFFICE 365 GROUPS CONNECTOR HAS A GRAPH PASSTHROUGH THAT REACHES GROUP EVENTS. Proven
2026-09-11, and it reopens the Delete Pool ghost-events fix.**

`shared_office365groups` exposes **`HttpRequestV2`** ("Send an HTTP request V2", params `Uri`,
`Method`, `Body`, `ContentType`, `CustomHeader1..5`). A probe flow called:

```
GET https://graph.microsoft.com/v1.0/groups/7b305c56-.../events?$select=id,subject&$top=3
```

and it **succeeded in 124 ms**, returning `value` plus an `@odata.nextLink`. So the calendar can be
enumerated after all.

**Do not confuse this with the Outlook connector's passthrough**, which is genuinely restricted
(`Invalid resource, Allowed values: me,users`) and is what the 2026-09-10 note was about. Two
different connectors, two different scopes. That note's conclusion, "Calendar Sync cannot
self-heal", does not follow and has been corrected above.

**What this unblocks.** Calendar Sync's `Filter_orphans` currently finds orphans by looking at
Assignments rows that still carry a `CalendarEventId` but have fallen out of scope. An event whose
row was *deleted* is unreachable that way. With the passthrough it could instead enumerate the
calendar, diff against the set of `CalendarEventId` values held in Assignments, and delete whatever
is left over. That heals ghosts from **any** cause, not just Delete Pool, and needs no change to the
destructive Delete Pool flow.

**NOT IMPLEMENTED, deliberately, and think hard before doing it.** This makes a full sweep capable
of deleting every event on the calendar if the "what should exist" side is ever computed wrong. It
is the same hazard already documented for `Filter_orphans` on incremental runs, but worse, because
enumeration means it no longer needs a row to find an event. Any implementation needs: full-sweep
runs only (never incremental), a guard that refuses to delete when the Assignments read returned
zero rows, and probably a cap on how many events one run may delete.

**THE PLANNER IS DISTRIBUTED AS A SHAREPOINT DOWNLOAD, not a hosted page. Decided by Shane
2026-09-11, and the constraint that forced it is the same custom-script block as ever.**

An `.html` file in a document library cannot RENDER on this site. But it can be **downloaded** and
opened locally, and that is all this tool needs, because it is entirely self-contained: no external
scripts, no stylesheets, no `fetch`, no network of any kind.

Link it with `download.aspx` so the link never depends on what SharePoint would otherwise do with
an `.html` file:

```
/sites/D2BuildScheduler/_layouts/15/download.aspx?SourceUrl=/sites/D2BuildScheduler/Shared%20Documents/pool-scheduler.html
```

Living in the Documents library also means only people with site access can reach it, which
settles the "public URL versus Entra sign-in" question without hosting anything.

**Verified from `file://` in real Chrome on 2026-09-11, not assumed** (Playwright refuses the
`file:` protocol, so this was driven with `chrome --headless=new --dump-dom` against an isolated
profile):

| Check | Result |
|---|---|
| Planner initialises from a local file | 14 crews, 46 sub-phases, Load from D2 button present |
| `localStorage` on `file://` | **works**; `location.origin` is `file://` |
| Work survives close and reopen | yes, `poolsched.v6` written and reloaded |
| Work survives **re-download under a new name** (`pool-scheduler (1).html`) | **yes** |

That last row is the one that makes this viable rather than a compromise: **all local files share
one `file://` storage bucket per browser profile**, so shipping an updated planner does not cost a
PM their saved work. The key is namespaced, so nothing else collides with it.

**The tool can go stale even though the data cannot.** Every PM holds their own copy, while the
schedule they load through "Load from D2" is always current. Keep the filename stable, replace in
place, and tell people when to re-download. This is the same drift that produced the whole
2026-09-11 episode, so it is worth a line in the guide rather than a hope.

**THE NAV LINK WAS PULLED AT GO-LIVE, 2026-09-11c. The download mechanism above still works and
is still the Phase H starting point, but nothing on the site points at it today.**

Shane's call, made before D7 and D4 were fixed (see below). The planner is absent from the PM
guide, so nobody is trained on it, while the nav link made it discoverable to anyone browsing the
site. Opened untrained, at the time, it produced a **wrong plan** rather than an incomplete one:
`isWork = d => d.getDay() !== 0` was its entire work-calendar model, so any span stepping over one
of the 35 Work Calendar holidays drew a day short, and the shortened span then fed its own
`conflicts()` checks, which could miss a real overlap and invent a sequence error. Auto-Schedule
would also place crews on Thanksgiving, and `Jobs.StartDate` drift anchored an imported pool's
Auto-Schedule months late. See `docs/planner-vs-sharepoint-parity.md` D7 and D4.

**Both are now CLOSED.** The planner (`web/index.html`) imports the SharePoint Work Calendar on
every Load from D2 and checks spans against it instead of Sundays alone, and Auto-Schedule now
anchors pool ordering and each pool's cursor on its earliest real assignment rather than the
drifted `Jobs.StartDate` field. The paragraph above is kept because it is the reasoning that got
the link pulled, not because it still describes today's planner. The link stays out of nav anyway
— Phase H's plan is to put the *hosted* planner in that slot, not to restore a link to the
downloadable file, and nobody has been trained on either one yet.

Removed by `sharepoint/pull-planner-link.js`, which deletes that one node and re-reads the nav to
prove it, rather than re-running `build-navigation.js` (that script clears and rebuilds every node,
which is too much blast radius for removing one link on a go-live morning). `build-navigation.js`
carries the link commented out with the same reasoning, so re-running it will not restore it.

**`pool-scheduler.html` is still in the Documents library**, deliberately, because Phase H wants
it. So it remains reachable by browsing that library. Delete it in Phase H, when the hosted app
becomes the single copy.

**It sat as a child of Pools**, not a top-level tab, because the horizontal bar overflows at four
or five items and Pools and Calendar were buried by exactly that once before. Put it back in the
same place in Phase H, pointing at the Static Web App rather than `download.aspx`. **The file must
be uploaded before the nav script runs**, or the link 404s.

**HEADLESS EXCHANGE ONLINE — no interactive sign-in needed. Found 2026-09-11c.**

Exchange Online holds settings Graph cannot see or change (the group welcome-message trap above is
the worked example). It is reachable with the token `az` already has:

```powershell
$t = az account get-access-token --resource https://outlook.office365.com --query accessToken -o tsv
Connect-ExchangeOnline -AccessToken $t -Organization netorgft15040037.onmicrosoft.com
```

Confirm the token's `upn` claim is `stratirus@d2pools.com` before trusting it, the same cached-tenant
discipline `az`, `pac` and `Add-PowerAppsAccount` all need. **And read group settings with
`Get-UnifiedGroup -IncludeAllProperties`**: without that flag the interesting properties come back
blank, and blank is not False.

**HEADLESS SHAREPOINT READS WITHOUT A BROWSER — the recipe, now exercised end to end.**

The `az` routes do **not** work for SharePoint list data, both confirmed 2026-09-11: an
`az account get-access-token --resource https://netorgft15040037.sharepoint.com` token is issued
but every REST call returns **401**, and the `az` Graph token carries no `Sites.*` scope (it has
`Directory.AccessAsUser.All`, `Group.ReadWrite.All`, `User.ReadWrite.All` and friends, which is why
*group calendar* reads over Graph do work while *list* reads do not).

The throwaway-probe-flow route works and takes about five minutes:

1. `create_flow` with a `Recurrence` trigger, `state: "Stopped"`, and read-only
   `HttpRequest` actions against `shared_sharepointonline`.
2. Dataverse `PublishXml` against the returned workflowid, then `publish_flow`, then `run_flow`.
3. Read each action's `outputsLink` — **SAS-signed, so fetch it with no auth header**.
4. `delete_flow`.

**The `connectionRefs` shape is FLAT and getting it wrong costs a 400.** Not
`{"connection": {"connectionReferenceLogicalName": ...}}`, which is how some export readers present
it. Copy it verbatim from an export's `connectionReferences`:

```json
{"shared_sharepointonline": {
   "connectionName": "shared-sharepointonl-20b83f29-d689-437e-b1ff-930f7bf3fda4",
   "connectionReferenceLogicalName": "new_sharedsharepointonline_beb06",
   "source": "Embedded",
   "id": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
   "tier": "Standard", "apiName": "sharepointonline"}}
```

Two more: **`create_flow` auto-injects the `$authentication` / `$connections` parameters but
`update_flow` does not** (`InvalidPowerFlow ... missing the required parameter '$authentication'`),
so include them yourself on any update. And the SharePoint action is
`operationId: "HttpRequest"` with the flattened parameter keys `parameters/method`,
`parameters/uri`, `parameters/headers`, `parameters/body`.

**A REFLOW LEAVES TWO DERIVED SURFACES STALE. Found 2026-09-11 by auditing live data.**

`D2 - Reschedule Pool` rewrites Assignments dates correctly, but two things computed from those
dates are not refreshed, and both are visible to a PM.

- **`Jobs.StartDate` is never written by a reflow.** The flow reads `NewStartDate` off its trigger
  to decide where the walk begins and never writes it back to the Jobs row. Live proof: all three
  demo pools show a `Jobs.StartDate` weeks to months adrift from their own first assignment.

  | Pool | `Jobs.StartDate` | first assignment actually starts |
  |---|---|---|
  | D2-1042 Reyes | 2026-09-14 | 2026-09-08 |
  | D2-1043 Whitfield | 2026-09-21 | **2026-06-15** |
  | D2-1044 Salcedo | 2026-09-28 | **2026-08-10** |

  Whitfield reads as starting in ten days on the Jobs list while it has been running since June and
  finishes 2026-09-30. `Jobs` is the list a PM is sent to in order to commit a pool, so this is on a
  screen people use. Not fixed here: whether a reflow *should* move the job's own start date is a
  product decision (a reflow from sequence 5 clearly should not), and the honest fix is probably
  "write it only when `FromSequence` is 1".

- **`Assignments.ConflictWith` goes stale between a reflow and the next 05:00 sweep.**
  `D2 - Conflict Flag` is nightly, so a reflow during the day leaves the previous night's flags in
  place, describing dates the rows no longer have. Ten rows were carrying exactly that, e.g. a row
  scheduled `2026-06-29 -> 06-30` flagged *"harrison also on D2-1042 Reyes Residence, 2 day(s) from
  2026-10-05"*. **Cleared 2026-09-11** by running Conflict Flag manually; 10 flagged rows became 0,
  which also proves `Condition_needs_clear` / `Send_conflict_clear` work. The window remains: the
  cheap fix is for the reflow to call Conflict Flag, or at minimum to null `ConflictWith` on every
  row it moves.

**LIVE DATA AUDIT, 2026-09-11 (read headlessly via the probe recipe above). Everything else green:**

| Checked | Result |
|---|---|
| Row counts vs this file | **exact** — Jobs 3, Assignments 138, Tasks 885, Work Calendar 210, Sub-phase Template 46, Task Template 295, Crews 14, Trades 26, Crew-Trades 51 |
| Demo pool staging vs the table above | **matches** — Whitfield 37 past / 35 signed / 251 of 295 tasks, Salcedo 13 / 11 / 121, Reyes 1 / 1 / 26 |
| Four deliberately-unsigned sub-phases | present (jobs 19 and 21) |
| Signed-off work scheduled to finish in the future | **0** (the reflow's lock rule held) |
| Required-but-null `Locked`/`NotApplicable`/`PMSignOff`/`DurationDays` | **0 rows** |
| `TasksComplete > TasksTotal` | **0** |
| Unknown crew codes | **none** |
| Business rule 2, non-`Unlimited` crew on two pools the same day | **0 double-books** |
| Group calendar | **138 events, 138 rows carrying an event id, 138 distinct — no orphans, no duplicates** |
| All 14 D2 flow exports vs live, **by content** | **14/14 match**, all `Started` |
| Flow failures in the last 48h | 1, `D2 - Reschedule Pool` on 2026-09-09 11:57 during its own build session; 6 successes since |
| `Crews.LeadEmail` | still blank on all 7 field crews (client-gated, expected) |
| Durations | still uniformly 2.0 (the documented placeholder) |

**`Reschedule Requests` is NOT holding test litter, corrected 2026-09-11.** The deployed-state table
above said "build-time test rows, not yet cleared". The three rows in it are the legitimate
2026-09-10 demo-pool reflows (`D2-1042`, `D2-1043`, `D2-1044`, all `Done`). Leave them: like the
three `New Pool Requests` rows they read as a PM's real request history, which is what those lists
are for.

**SITE CHROME: the site now has HEADER TABS, and all three levers are native and scriptable
(2026-09-10).** `sharepoint/build-navigation.js`. The left rail was stock SharePoint noise (Home,
Conversations, Notebook, Calendar, Documents, Recent) and none of the lists a PM opens were in it.

- **`Web.HorizontalQuickLaunch = true`** moves a `GROUP` team site's nav from the left rail to a
  horizontal bar. This is what "header tabs" means in practice and it is a plain boolean on
  `/_api/web`. No SPFx, no page editor.
- **`Web.HeaderEmphasis` is now `0`, a white/clear header band. Changed 2026-09-10 on Shane's call.**
  It was `3`, which paints the band in the theme primary. On D2's theme that primary is **green, not
  navy**, so the header and the green hero band below it read as one continuous slab with only the
  command bar between them. `0` separates them: blue suite bar, white header carrying the tabs, then
  green as a deliberate hero band. A **navy** header is not available without changing the theme
  primary, which would repaint every link and button on the site, so white was taken instead.
- **`zoneEmphasis` on a canvas section** is the lever for colour on the home page. Inline `style`
  attributes inside `data-sp-rte` are stripped by the rich-text sanitiser, but section emphasis is
  native and sticks. The home page is now a green hero band flowing out of the header, a white
  section holding the live schedule, and a soft-tinted link index.

**SharePoint caches site navigation per page, so a nav or header change looks like it did not
apply.** After setting `HorizontalQuickLaunch` or rebuilding quicklaunch, an already-visited list
page keeps rendering the OLD left rail (Home, Conversations, Notebook, Documents, Recycle bin) with
no tabs, while the home page shows the new chrome correctly. It is cache, not a failed write: a
hard reload (`ignoreCache`) on each page brings the tabs back, and a user who has never loaded the
page gets the new nav first time. Verify a nav change on a **hard-reloaded** page, or you will
conclude it only half-worked.

**The horizontal bar cuts to an overflow at about four or five items**, and the owner-only "Edit
navigation" link competes for the same space, so a member sees one more tab than an owner does. The
first build used "Needs Attention" and pushed **Pools and Calendar into the overflow**, burying the
two things a PM opens most. Short labels, most-used first. Do not lengthen them without re-checking
what survives the cut.

**DEFAULT-VIEW SWEEP FINISHED 2026-09-11c, just before the client invite.** Two lists still
landed on an unformatted `All Items`, the same defect already fixed on Assignments:

| List | Was | Now |
|---|---|---|
| `Tasks` | `All Items`, ungrouped, 885 rows | **`All Tasks (by Assignment)`**, grouped and formatted |
| `Jobs` | `All Items`, right columns but a plain grey table | `All Items` **with the `jobCard` formatter** |

`Jobs` had no better view to promote, since `Planned Pools` is filtered to `Planned` only, so the
card went onto `All Items` instead of switching the default. `format-views.js` now carries
`['Jobs', 'All Items', jobCard]` so re-running it reproduces the tenant.

**Verified as stored, NOT as rendered**, and the difference matters on this platform: the
`chrome-devtools` MCP would not attach (its profile was locked by a running Chrome), so this was
done through a throwaway probe flow, which can confirm `DefaultView` and a 1,483-character
`CustomFormatter` are persisted but cannot prove the card paints. The formatter is byte-identical
to the one already rendering correctly on `Planned Pools` over the same list and columns, which is
why this was accepted. **Open both views in a browser when convenient** and treat it as unproven
until then.

**`Jobs` All Items showed only the Title column until 2026-09-10.** It is the list a PM is sent to
for committing a pool, and it rendered three pool names and nothing else, which made the
instruction "change Status to Active" impossible to follow. Now shows JobNumber, Status, Project
Manager, StartDate, Address and City; `Planned Pools` gained Status too.

**PRE-PILOT REALITY AUDIT, 2026-09-08b.** Every load-bearing claim in this file was checked
against the live tenant, because CLAUDE.md had been caught wrong twice in one morning and the
pilot makes decisions from it under time pressure. Verified green, so a future session need not
redo these:

| Checked | Result |
|---|---|
| 9 tracked lists exist, GUIDs match this file | ok |
| Assignments versioning on (50) — Flow 3's gate depends on it | ok |
| `TasksTotal`/`TasksComplete` vs actual Tasks rows, all 43 | **0 drift** (Counter Reconciliation works) |
| Orphan Tasks / orphan Job lookups / unknown `Crew` codes / assignments with no tasks | **0 each** |
| Business rule 2, a non-`Unlimited` crew on two pools the same day | **0 double-books** |
| Required-but-NULL `Locked`/`NotApplicable`/`PMSignOff`/`DurationDays` | **0 rows** |
| 11 D2 flows exist, all `Started` | ok |
| `flows/exports/` current vs live | **WRONG when first checked, corrected 2026-09-08b — see below** |
| Flow email recipients still internal | all `stratirus@d2pools.com` |
| `Crews.LeadEmail` blank on all 7 field crews | ok |
| 8 built views `Paged=true` with formatters | ok |
| `WeekMonday` calculated column and formula | ok |
| Canvas app published, 3 flows attached, pointing at live flow ids | ok |
| `D2 - New Pool` skips Sundays AND Work Calendar holidays | ok, verified in the definition |

Four things it found are recorded in their own sections above: the Work Calendar expiry, three
flow ids that were really Dataverse workflowids, this table's own row counts having drifted, and
Flow 2's stale "not yet exercised" caveat.

**One audit check was itself defective, and it matters.** The export freshness check above
originally compared each export's **filename date** against the flow's live `lastModifiedTime` and
reported all current. Same-day is not the same as after-the-last-change. Re-checked by **content**
later the same day, four of eleven exports differed from live, and one differed badly:
`D2 - New Pool`'s export was a **pre-hardening snapshot missing the entire failure path** (12
actions absent, including `Scope_provision_job`, both failure emails and both terminates), which
is exactly the Critical the final whole-branch review had caught. Restoring that flow from its
committed export would have silently deleted the fix.

All eleven exports were regenerated on 2026-09-08b and each verified by re-reading the written
file and comparing its definition to live, rather than by trusting the write. **Compare exports by
content, never by date.**

**Method note worth keeping.** Two conclusions in this audit were wrong on first pass and caught
by looking harder. A grep for `"Work Calendar"` in the New Pool export returned zero and nearly
produced "the flow ignores holidays" — the flow references lists by **GUID**. And matching the
canvas app's flow connections by flow id reported two of three missing — the app references flows
by **workflowEntityId**. Both would have been confident, wrong, and written down.

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

## POOL CREATION HAS ONE PATH — `+ Job` runs `D2 - New Pool`, built 2026-09-12, NOT yet run live

**Shane's instruction, verbatim:** *"The new job should just run the new pool flow. I don't want to
have a new job flow in the HTML and then a new job flow in the SharePoint site that do different
things... there should be a pop-up or warning that says please wait 10 to 15 minutes."*

`+ Job` no longer builds a 46-sub-phase pool in the browser. It collects the fields, queues a
pending create, and the change-set carries it to `sharepoint/apply-planner-changes.js`, which raises
a **New Pool Requests** row. `D2 - New Pool` then generates the Job, 46 Assignments and ~295 Tasks
from the template. **This closes parity D10** and collapses the two independent job-number
generators that ran with no uniqueness check between them.

**`AssignDefaultCrews` IS SENT EXPLICITLY, and that is not cosmetic.** It is `Boolean, Required,
default 1` on the list, and `D2 - New Pool` reads it as
`if(AssignDefaultCrews, coalesce(DefaultCrew,'unassigned'), 'unassigned')`. So if it arrives falsy
or absent, **all 46 sub-phases land `unassigned`** and the tool looks broken rather than configured.
SharePoint's *form* demonstrably supplies defaults for omitted required fields — proven when
`Status` was hidden from the New form — but **nothing proves the same for a REST create**, and REST
item-creation is already known to bypass required-field validation on this tenant. It is now an
explicit checkbox on the form, defaulting to checked, carried through to the create body. Do not
"tidy" it back to relying on the default.

**Three creation hazards found in review, all fixed before any live use:**

- **A blank `ProjectManager` would have failed silently, then wasted ten minutes.** `ProjectManagerId`
  comes from `/_api/web/currentuser`, and with no `r.ok` or null guard an error body still parses as
  JSON, `cu.Id` is `undefined`, `JSON.stringify` drops the key, and the row lands **201** with the
  field blank. The PM then waits the full 9 minutes for the flow to fail with "Project Manager is
  required." Both guards now throw **before** the create loop.
- **Re-running the same change-set could create two whole pools.** The uniqueness check read live
  `Jobs` only, and the documented run instructions actively train a re-run because the request sits
  at `Building` looking stuck. The flow catches it most of the time, but two requests landing in one
  `GetOnNewItems` batch yields 92 assignments and 590 tasks, at ~6 minutes each to delete. The check
  now unions `Jobs` with `New Pool Requests` rows whose `Status` is `Requested` or `Building`.
- **The check was case- and whitespace-sensitive while SharePoint's is not.** `$filter` on a Text
  column is case-insensitive, so `d2-1042` passed the script and was refused by the flow — safe
  direction, wasted round trip, reads as the tool being wrong. Now trimmed and lowercased.

**Creation is two-phase and the UI says so**: the form warns ~9 minutes measured, allow **10-15**,
and that the request sits at `Building` the whole time and looks stuck. A PM then uses Load from D2
to pull the finished pool. `D2 - New Pool` generates from the **template** and cannot accept a
planner-authored schedule, which is why sequencing happens after the pool comes back, not before.

**On the first real creation:** dry-run first and read the planned-creates table; do **not** re-run
the live pass "to be sure"; then open **New Pool Requests** and confirm `Project Manager` is
populated and `AssignDefaultCrews` is ticked.

---

## THE PLANNER HEADER IS FOUR BUTTONS — four controls removed 2026-09-12

`⚡ Auto-Schedule · + Job · Save · Refresh`, plus the freshness stamp. It was eight and wrapped
to a second row. Removed on Shane's call once the planner stopped being a standalone scratchpad:

| Removed | Why it was vestigial |
|---|---|
| **CSV** | *"I don't know why it's there."* Nobody uses it. |
| **Backup** | downloaded all state as JSON; SharePoint is the durable store now, and it has versioning on `Assignments` |
| **Restore** | uploaded a backup and replaced `S` **wholesale** — the one path in the app capable of destroying a local sketch, which is exactly why `importFromD2` was written to merge instead |
| **Reset** | cleared local state and re-seeded. Once `Refresh` reads live, that IS the reset. Discarding unsaved edits becomes a choice inside the refresh dialog, not a standing button. |

**RENAMED TO `Refresh` ON 2026-09-13b, and the "from D2" half is gone for good** — everyone who
opens this tool works at D2, so naming D2 as the other party read from the builder's seat. See the
copy rule under the hosting-posture section. It absorbs what Reset used to do — at that
point its only remaining job is "someone else changed something while I had this open", which is
real with two PMs, since Save already re-imports after a push.

**ACCEPTED RISK, taken deliberately: a local-only sketch is now unrecoverable if `localStorage`
clears.** Anything that exists in SharePoint is always re-gettable by re-running
`export-to-planner.js`, but a pool created with `+ Job` and never pushed has no home to go back to,
and Backup was the only thing that protected it. Shane chose to pull Backup/Restore now rather than
wait for Route B, with that stated. **It is the strongest argument for wiring `+ Job` to
`New Pool Requests`** (parity D10) sooner rather than later — that closes the exposure by giving
sketches somewhere real to live, and also collapses the two independent job-number generators that
currently run with no uniqueness check between them.

**One removal trap worth knowing:** the "wrong file" alert in `importFromD2` said *"Use the
Backup/Restore buttons for a scheduler backup file"* — prose pointing at controls that no longer
exist. Deleting a control means grepping the **copy** as well as the code. `roundtrip.js`'s
"rejects a plain backup file" assertion survives deliberately and is now more valuable, not less:
someone holding an old backup will try it in the only remaining file input.

`restore()` was also one of four `syncNonWork()` call sites. Three remain and that is correct — both
branches of `load()` and `importFromD2` — but if `NONWORK` ever fails to rebuild the planner
silently stops honouring the 35 holidays, so `fixtures/planner/workcalendar.js` is the thing that
proves it still does.

---

## THE PLANNER CAN NOW WRITE BACK — Route A built 2026-09-12, VERIFIED LIVE 2026-09-14

**Spec:** `docs/superpowers/specs/2026-09-12-batch-write-back-design.md`. Two pieces:

- **Save**, in `web/index.html`. Computes what diverged since the last Load from D2 via
  `divergedSecs(j)`, shows a **per-pool, per-sub-phase, per-field preview the user must confirm**
  (loaded value beside new value — never a bare count), and downloads a change-set JSON carrying the
  SharePoint row id, `jobno`, `num`, and both the baseline and new value for each changed field.
  Disabled when nothing diverged. Local-only pools are excluded by three independent guards; pool
  creation is out of scope.
- **`sharepoint/apply-planner-changes.js`**, the console-paste applier and the exact inverse of
  `export-to-planner.js`.

**FIVE SAFETY PROPERTIES, each enforced in code and each pinned by a test proven to fail:**

1. **`DRY_RUN` defaults `true`.** It does the whole compare pass and prints the plan, writing
   nothing. (Note `fix-job-startdates.js` defaults `false`; that is treated here as a hazard, not a
   precedent.)
2. **An allowlist of exactly five columns** — `Crew`, `ScheduledStart`, `DurationDays`, `Locked`,
   `NotApplicable`. Anything else is rejected and reported. `ScheduledFinish` is derived and never
   sent. **No sign-off column and nothing on the `Tasks` list is reachable from any path** — the
   sign-off names appear in that file only in the header prose explaining their exclusion.
3. **Compare-before-write, per FIELD not per row.** A row with two changed fields can have one
   refused and the other land. **Deliberately NOT ETags:** `odata=nometadata` suppresses
   `odata.etag` entirely, and more importantly five flows write to `Assignments` on schedules
   unrelated to the PM (Calendar Sync hourly, Counter Reconciliation, Conflict Flag, Crew Trade
   Check, Event-Driven Reconciliation), so a row-level ETag would reject a whole batch because a
   nightly flow annotated the rows overnight.
4. **Row-identity check.** The live `Title` is read and verified against the change-set's `jobno`
   and `num` before any write, and printed in the dry-run plan so a human reads SharePoint's own
   account of the row rather than the file's. **The match is token-anchored**, because a substring
   test let a `2.1` edit land on a `2.10` row — proven by exploit test, dormant only because the
   current template tops out at `7.0`.
5. **`SuppressReconcileUntil` (+10 min) in the SAME MERGE as the data**, exactly as
   `D2 - Reschedule Pool` does, so a 46-row batch does not burn one Event-Driven Reconciliation run
   per row. A second write would re-trigger the flow it is suppressing.

**NOT YET RUN AGAINST THE TENANT, and one mechanism is unverified:** `input.click()` opening a file
picker from a console-pasted script. If it silently does nothing, use DevTools > Sources > Snippets,
which also avoids the paste guard. On the first real run: dry-run a single-field change first and
confirm the printed `from` matches what the row shows in SharePoint; deliberately provoke a refusal
by changing one row's `Crew` in SharePoint after loading; then after the first live write **open the
rows** rather than reading the summary, and watch Event-Driven Reconciliation's run count for ten
minutes to confirm the suppression held.

**A HARNESS CAN PIN THE CORE AND MISS EVERY MARGIN.** `writeback.js` opened at 29 assertions and the
reviewer's mutation sweep found **4 of 6 survived** — write-side date normalisation, the suppression
window's lower bound, writing every chunk rather than only the first, and the verify-after-write pass
were all untested, while the allowlist and compare-before-write were genuinely pinned. Now 44
assertions with each of those mutations confirmed red. **When a test count is cited as coverage, ask
what it fails on.**

---

## D2 HAS AN AZURE SUBSCRIPTION — created 2026-09-13, and it needed NO new card

**This reverses the long-standing "D2 HAS NO AZURE SUBSCRIPTION" entry**, which was true when
written and is now not.

| | |
|---|---|
| Subscription | **`D2 Build Scheduler`** |
| Subscription id | `cbcbe68b-bbaa-4926-bd9a-d33f0a9bd312` |
| State | Enabled |
| Tenant | `f24d9b39-6a71-4f4e-a376-03b6f61c97e4` |
| Billing account | `d2pools.com`, **MicrosoftCustomerAgreement**, Active |
| Billing profile | `OZ4Q-64DH-BG7-PGB` — *July_2026 Billing Migration* |
| Invoice section | `9a17703f-399e-4337-aa96-eb7982de7fba` (`d2pools.com`) |

**No new payment method was needed, and the reason generalises.** D2 is on a **Microsoft Customer
Agreement**, where Azure and M365 share one billing account and one payment method — so the card
already carrying Copilot pay-as-you-go covers Azure too. The ownership question the Phase H spec
raised ("whose card decides who owns it") answers itself: it is D2's existing MCA, so D2 owns the
infrastructure, which is exactly why the spec chose Azure over Netlify. Expected steady-state cost
is still **$0** on the Static Web Apps Free tier.

**There is a second, legacy billing profile** — `XZ52-6QS7-BG7-PGB`, *GoDaddy.com, LLC*. That is
the pre-migration one, matching the GoDaddy-era debris recorded elsewhere in this file. **Attach
nothing to it.**

**THE BILLING QUESTION WAS ANSWERED WRONG THREE TIMES FIRST, AND THE REASON IS THE TENANT TRAP.**
`az rest .../billingAccounts` returned **0 accounts** on three separate attempts across two API
versions, and that was read as "D2 has no billing account". It had drifted to **Tennetech's**
tenant, where zero is the correct answer. Pinning `az` to D2 and re-running returned the account
immediately. **An empty Microsoft listing means "wrong tenant" as often as it means "empty"** — and
this nearly became a purchasing decision. See the `m365-tenant-guard` skill, and the standing rule
below.

**TENANT ASSERTION FOR THIS PROJECT — run it before any write, not once per session.** The context
has drifted mid-session three times in two days, including between two reads minutes apart:

```bash
az account set --subscription f24d9b39-6a71-4f4e-a376-03b6f61c97e4
az account show --query tenantId -o tsv | grep -q "^f24d9b39" && echo CONFIRMED || echo ABORT
```

Expected identity is `stratirus@d2pools.com`. FlowAgent keeps a **separate** token cache, so fix
`az` first, then FlowAgent `reconnect`, then confirm `list_environments` shows **D2 Automation**.
ARM calls are the likeliest to cause drift, because D2's non-subscription account cannot serve them
and `az` falls back to the one account that has a subscription — which is Tennetech's.

---

## GRAPH IS A THIRD FIELD-SHAPE SURFACE, AND THE CAPTURE PROVED IT — 2026-09-13

`fixtures/planner/live-payloads-graph.json` is a real Graph capture of all four lists (jobs 3,
asg 138, tasks 885, cal 210), taken with `fixtures/planner/capture-graph.js`. **Every mapping
against Graph must be written from that file, never from the REST fixture.** The shapes differ in
the exact places a join depends on:

| | raw REST (`odata=nometadata`) | **Graph** |
|---|---|---|
| Assignments -> Job | `JobId` — **number** | **`fields.JobLookupId` — STRING** |
| Tasks -> Assignment | `AssignmentId` — **number** | **`fields.AssignmentLookupId` — STRING** |
| item id | `Id` — **number** | **`fields.id` — STRING** |
| Person column | `InstallerSignOffById` | `fields.InstallerSignOffByLookupId` — string |
| `Crew` (Choice) | plain string | plain string — **same** |
| `Sequence`, `DurationDays`, `TasksTotal` | number | number — **same** |
| booleans | bool | bool — **same** |
| DateOnly | `2026-09-08T05:00:00Z` | identical — slice(0,10) still correct |

Every row is `{ id, eTag, fields: {...} }`; the columns live under `fields`.

**Lookups are renamed AND retyped, and the retype is the dangerous half.** `"20" === 20` is false,
so an unnormalised join matches nothing, errors nowhere, and reports success — the same silent
empty-join that made `D2 - Crew Trade Check` flag 66 rows wrongly. Normalise both sides with
`String()`.

**`ProjectManagerLookupId` is an id with no display name.** REST got the name via
`$expand=ProjectManager&$select=ProjectManager/Title`; Graph returns `"16"`. Harmless —
`importFromD2` never reads the job-level PM name.

**The read layer maps Graph into the payload `export-to-planner.js` already emits**
(`web/graph-to-planner.js`), rather than inventing a second shape. That is why `importFromD2` needed
no change at all: merging by job number, locking signed work, and taking structure from the local
template are all untouched and still covered by their existing tests. `fixtures/planner/graph-read.js`
is an **equivalence** test — it maps the REST fixture one way and the Graph fixture the other and
asserts they agree pool by pool. Breaking the `JobLookupId` join name collapses every count to zero
and the test names the mismatch.

**MSAL CANNOT REDIRECT TO `file://`, so a live read only works when the planner is SERVED.** The
file-picker path therefore stays until hosting exists. `Load from D2` detects its situation
(`location.protocol`, plus both libraries being present) and says which mode it is in, rather than
trying and failing confusingly. Auth uses **`loginPopup`, deliberately not `loginRedirect`** — a
redirect would discard in-memory planner state.

**THE PLANNER IS NO LONGER A SELF-CONTAINED SINGLE FILE, and that was decided rather than
stumbled into.** It now has two runtime dependencies, `web/vendor/msal-browser.min.js` and
`web/graph-to-planner.js`, both served alongside it from `web/`, which is the Static Web Apps deploy
root. This contradicts the basis recorded for the `download.aspx` distribution route ("no external
scripts... no network of any kind"), and that is accepted: the nav link was pulled at go-live, the
PM guide does not mention the planner, nobody is trained on the download, and Phase H retires that
copy outright.

**A jsdom harness CANNOT catch a broken `<script src>`** — jsdom does not fetch external scripts
unless told to, so all twelve harnesses passed while the tags pointed into `fixtures/`, i.e. outside
the deploy root at test scaffolding that must never ship. Verify script tags **in a real browser
over HTTP**, both hosted and from `file://`. Doing so confirmed 200s and live-Graph mode when
served, and silent 404s with the file-picker fallback intact from `file://`.

**Do not re-add a CDN.** `https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js` returns
**404** — the path is wrong, not blocked. jsdelivr and unpkg serve the identical bytes, and MSAL is
vendored so there is no runtime CDN dependency at all.

---

## THE ENTRA APP REGISTRATION EXISTS — created 2026-09-12, consented tenant-wide

This is what lets the planner read and write SharePoint from **any origin**, rather than only from
a page served by SharePoint itself. It needs **no Azure subscription**: app registrations are an
Entra feature and D2's tenant already existed. Hosting is a separate, still-open question.

| | |
|---|---|
| Display name | `D2 Build Scheduler (planner)` |
| **Client (app) id** | `1aa00e61-e5e7-42bd-95b4-fd58863e5b54` |
| App object id | `fe3739d0-6cd8-4213-96aa-45786ecaa6d7` |
| Service principal object id | `87f681ec-a4a4-47df-8423-8fc28c2d2324` |
| Tenant | `f24d9b39-6a71-4f4e-a376-03b6f61c97e4` |
| Platform | **SPA** (`spa.redirectUris`), NOT `web` |
| Redirect URIs | `http://localhost:8787` and `http://localhost:8787/` |
| Sign-in audience | `AzureADMyOrg` (single tenant) |
| Graph permission | **delegated `Sites.ReadWrite.All`**, id `89fe6a52-be36-487e-b7d8-d061c450a026` |
| Consent | granted tenant-wide, `consentType: AllPrincipals` |

**SPA, not web, and that is load-bearing.** A SPA app uses auth-code + PKCE and holds **no client
secret** — there is no credential to leak into a static file or a repo. Registering it under `web`
would have implied a confidential client and a secret this design must never have.

**The scope is DELEGATED, so the app grants nothing on its own.** Effective access is always the
signed-in user's own SharePoint permission: a PM in the Members group gets Edit, a visitor gets
Read. `Sites.ReadWrite.All` was chosen over `Sites.Read.All` so the write-back needs no second
consent round, not because anything needed broader rights.

**Redirect URI is localhost only, deliberately** — there is no hosting yet. Add the Static Web App
URL alongside it when that lands; MSAL accepts several. `8787` matches the port the local static
server already uses for rendering the planner.

**TRAP, cost a cycle: `az ad app permission admin-consent` FAILS if you have already run
`az ad sp create`.** It tries to create the service principal itself and returns
`Request_BadRequest ... service principal name is already present for the tenant`, which reads like
a permissions problem and is not. Grant the consent directly instead, by POSTing an
`oauth2PermissionGrant` to Graph with `clientId` = the **service principal** object id (not the app
id), `resourceId` = the Microsoft Graph service principal's object id **in this tenant**
(`257f1ab3-2be6-47f9-aec2-171b6c381ed1`, which is tenant-specific — look it up, never hard-code it
from another tenant), `consentType: "AllPrincipals"`, and `scope` as the space-separated scope
names. Verify by reading `oauth2PermissionGrants` back; the `az` command's own exit code is not
trustworthy here, since it returned 0 while printing the failure.

**What this does NOT unblock:** hosting. Static Web Apps still needs an Azure subscription, which
still needs a payment method and the ownership decision.

**Next use of it:** capture a real Graph payload into `fixtures/planner/live-payloads-graph.json`
**before** writing any Graph mapping code. Graph is a **third** field-shape surface alongside raw
REST and the Power Automate connector; the existing REST fixture does not validate it. Delegated
auth needs an interactive sign-in, so the capture wants a small MSAL page served on
`http://localhost:8787` — roughly 40 lines, and it is the first real piece of the hosted app.

---

## D2-1045 NAVARRO RESIDENCE — created 2026-09-14 through the supported path, end to end

The first pool ever created the way a PM is meant to create one: `+ Job` in the planner, Save,
`sharepoint/apply-planner-changes.js`, `D2 - New Pool`. No REST hand-loading anywhere in the chain.

| | |
|---|---|
| Job | **23**, `D2-1045`, Navarro Residence, 1580 Lindero Canyon Road, Westlake Village |
| Span | 2026-07-20 to 2026-11-05 |
| Staged at | **23 of 46 finished, 21 signed, 174/295 tasks** — deliberately between Salcedo (11) and Whitfield (35) |
| PM | **David Taylor** (site user 13), which gives all four people with access a pool of their own |
| Sign-offs | attributed to David, timestamped to each sub-phase's own finish date |
| Left unsigned | **2.1** (finished 08-08) and **3.2** (finished 08-25), so `Sign-off Overdue` has genuinely overdue content |
| In progress today | 4.3 Shotcrete Placement, tasks half ticked |

Verified against the live rows rather than the write summary: counter drift **0**, no signed work
finishing in the future, no required-but-null fields, `TasksComplete` never exceeds `TasksTotal`.
Tenant totals are now 4 jobs / 184 assignments / 1180 tasks.

**`D2 - New Pool` CAN CREATE BUSINESS-RULE-2 VIOLATIONS, AND DID. This is the find of the session.**

The flow assigns each sub-phase its `Sub-phase Template.DefaultCrew` with **no awareness of what
that crew is already booked on in other pools**. Creating Navarro immediately produced three
cross-pool double-bookings of `harrison`:

```
8/24/26   Salcedo 1.5 Excavation Operations   vs  Navarro 3.2 Underground Plumbing
10/14/26  Reyes   3.2 Underground Plumbing    vs  Navarro 6.1 Equipment Installation
10/16/26  Reyes   3.3 Plumbing Pressure Test  vs  Navarro 6.2 Equipment Plumbing
```

This is consistent with the documented grammar — rule 2 is **detected post-hoc, never prevented** —
but it is the first time it has been seen arising *as a direct consequence of the supported
creation path* rather than from a hand edit. **Every new pool should be expected to arrive with
conflicts**, and the check after creating one is not optional. Nothing alerted at the time only
because the job was still `Planned` during the inserts, so Flow 3 terminated at
`Skip_non_active_job`; the nightly `D2 - Conflict Flag` would have flagged them the next morning.

**A related capacity finding: only TWO crews hold `plumbing`** — `harrison` and `stl`. With harrison
booked, the only qualified alternative was `stl`, which is `Unlimited` and therefore capacity-exempt.
So the conflict was resolvable only by moving work to a subcontractor. That is a real constraint in
D2's crew/trade data rather than a scheduling accident, and it belongs in Don's trade-mapping
conversation: a trade held by one field crew plus one subcontractor has no slack at all.

**The fix was applied through the write-back, not by hand**, which exercised the whole loop on a
genuine corrective action: three `Crew` edits in the planner, Save, apply. 3 rows written, 0
refused, verify clean, suppression set. Planner errors went 3 -> 0.

**MEASURED RUNTIME WAS 16.5 MINUTES, NOT 9.** Request raised 19:03:45, `Done` 19:20:17. Worse, it
**stalled for six minutes mid-run** — assignments sat at 144 and tasks at 949 from 19:06 to 19:12,
then resumed and finished normally. So the existing "9m 03s measured, allow 10-15 minutes" guidance
is optimistic, and the PM guide's callout understates it. A PM watching `Building` for a quarter of
an hour will think it has hung. **Treat a stall as normal; do not re-raise the request** — that is
exactly how two pools get created.

**Incidental confirmation of the `Jobs.StartDate` drift mechanism.** Navarro is the only pool whose
`Jobs.StartDate` matches its own first assignment, because it was created directly at its real start
date instead of being created and then reflowed. The other three drift precisely because
`D2 - Reschedule Pool` never writes the job's start date back. Creating at the intended date avoids
the drift entirely, which is worth knowing when staging future pools.

## THE WRITE-BACK HAS RUN AGAINST THE TENANT — verified 2026-09-14, all five safety properties

First live exercise of Route A. Run on `D2-1044 Salcedo · 5.3 Tile Installation` (row **436**),
chosen because it is unlocked, unsigned, trade-checkable and dated October. **The row was restored
to its exact pre-test values afterwards**, and the tenant ends as it began: 3 jobs, 138 assignments,
3 legitimate `New Pool Requests` rows, no stray test data.

**The refusal path fired, which is the thing nobody had ever watched.** Two fields were changed in
the planner on one row, then `DurationDays` was deliberately diverged in SharePoint before applying:

| Field | Baseline | Live at apply | Wanted | Outcome |
|---|---|---|---|---|
| `Crew` | cirilo | cirilo | guillermo | **written** |
| `DurationDays` | 2 | **4** | 3 | **refused** |

`{loaded: 2, nowLive: 4, wanted: 3}` was reported and the row read back as `Crew=guillermo,
DurationDays=4`. **Compare-before-write is genuinely per-FIELD, not per-row** — one field refused
and the other landed on the same row in the same pass.

**Provoke divergence on `DurationDays`, never on `Crew`, when testing this.** Event-Driven
Reconciliation's version-history gate watches `Crew`, `ScheduledStart` and `ScheduledFinish`, so a
duration edit cannot raise a conflict alert. A `Crew` edit can, and Salcedo's PM is Don.

**`SuppressReconcileUntil` PROVEN, not inferred.** The write set it to +10 minutes in the same
MERGE. Exactly one Flow 3 run fired (1.9s), and its action list is the evidence:

```
Get_versions                  Succeeded
Condition_scheduling_changed  Succeeded   <- correctly saw a real Crew edit
Get_touched_meta              Succeeded   <- read SuppressReconcileUntil
Terminate_suppressed          Succeeded   <- STOPPED HERE
Get_overlapping / Condition_conflict / Send_email_alert   all Skipped
```

So the edit passed the version gate as it should and the suppression stopped it before any conflict
evaluation or email. **A short run duration alone would not have proved this** — read the actions.

**`+ Job` dry run is clean and the duplicate guard blocks.** A request for `TEST-9101` planned
correctly with `assignDefaultCrews: true` carried through. A hand-crafted change-set reusing
`D2-1042` was **refused**: *"refusing to create a duplicate pool -- a Jobs row with this job number
already exists live"*. That guard is what stands between a re-run and 92 assignments plus 590 tasks.

**KNOWN GAP CONFIRMED: a duration write leaves `ScheduledFinish` stale.** The allowlist deliberately
excludes it as derived, so writing `DurationDays` alone leaves the old finish date in place until a
reflow recomputes it. Related to the Phase G item about a duration edit reflowing the pool by
itself; not a defect in the applier, but do not expect the dates to agree after a duration-only push.

### Driving the applier headlessly — the recipe, because it took several dead ends

The applier must run on the **SharePoint origin** (REST needs same-origin cookies), and it reads its
change-set through `input.click()`. Both are awkward to automate, and these fail:

| Attempt | Result |
|---|---|
| `page.addScriptTag({path})` | **CSP**: *"Executing inline script violates ... script-src"* |
| `require` / `import('node:fs')` in the Playwright code VM | not available; the VM exposes only `page` |
| Registering `page.once('filechooser', ...)` | the MCP registers its own handler and wins |

What works: **read the applier into the page through a file input**, the same mechanism the applier
itself uses, then `(0, eval)(src)`. SharePoint's CSP allows `'unsafe-eval'`, and `page.evaluate`
goes through CDP anyway, exactly like a console paste. Sequence: open an input and store the text
promise on `window`; fill it with the MCP's file-upload; `eval` the source; fill the applier's own
chooser; then `await` the stored promise for the result. Wrap `console.log/warn/error/table` first,
because the plan is printed rather than returned.

**Two traps:** file paths must be under the MCP's allowed root and are **case-sensitive on the
drive letter** (`c:\src\...`, not `C:\src\...`); and a change-set in the scratchpad is outside that
root, so stage it inside the repo.

**`DRY_RUN` was flipped by string-replacing the source in memory**, never by editing the committed
file. The repo keeps its safe default.

**A third instance of grep-bounded scope.** The applier's own completion message still said *"Use
Load from D2 in the planner"* after the rename pass, because that pass grepped `web/` only. Found by
reading the live output rather than the code. When renaming user-facing copy, grep **every**
surface that prints it, `sharepoint/*.js` included.


## THE PLANNER IS HOSTED — deployed 2026-09-14, wall verified anonymously

| | |
|---|---|
| URL | **`https://mango-sky-0d6904310.5.azurestaticapps.net`** |
| Resource | `swa-d2-build-scheduler` in `rg-d2-build-scheduler`, `centralus`, **Free** sku |
| Subscription | `D2 Build Scheduler` `cbcbe68b-bbaa-4926-bd9a-d33f0a9bd312` |
| Deploy method | **SWA CLI with a deployment token pulled on demand** from `az staticwebapp secrets list`. No CI integration, no workflow file in this repo, **no stored secret**. |
| Redeploy | `npx -y @azure/static-web-apps-cli deploy ./web --deployment-token "$TOKEN" --env production` |

**`Microsoft.Web` had to be registered first** (`az provider register -n Microsoft.Web`); it took
about 60 seconds. The subscription was completely empty before this.

**VERIFIED ANONYMOUSLY, and the check most likely to fail passed.** Every path — `/`,
`/index.html`, both scripts, `/robots.txt`, and a nonsense path — returns **302 to
`/.auth/login/aad`**. The documented worry that `navigationFallback` bypasses route rules and would
serve `index.html` unauthenticated **did not materialise**. `/.auth/login/github` returns **404** as
intended, and all seven security headers including the CSP are served.

**Side effect worth knowing: `robots.txt` is itself behind the wall**, so no crawler can read it.
Harmless — nothing is reachable to crawl — but it means the `noindex` work is belt-and-braces
rather than the actual control. The wall is the control.

**The sign-in redirect confirms the Free-plan limitation empirically**, which is worth seeing once:
the authorize URL is `login.microsoftonline.com/**common**/...&client_id=d414ee2d-73e5-4e5b-bb16-03ef55fea597`.
That client id is **Static Web Apps' own shared platform app**, not ours, and `/common/` is why any
Microsoft account can pass the wall. Our single-tenant app id only ever appears in the *in-page*
MSAL sign-in that guards the data.

**Four SPA redirect URIs are now registered** on `D2 Build Scheduler (planner)`: both localhost
forms plus the hosted origin with and without a trailing slash. The planner sets
`redirectUri: location.origin + location.pathname`, so the trailing-slash form is the one it
actually requests at the root.

**VERIFIED SIGNED IN, 2026-09-14, against live tenant data.** Both libraries load over HTTPS,
`graphModeAvailable()` is **true** (so the planner is in live-Graph mode, not the file-picker
fallback), the console is clean at every level, and **Refresh pulled 3 pools / 138 sub-phases /
47 sign-offs** with first-start dates matching the `Jobs.StartDate` drift table exactly. The
Work Calendar imports as a **210-entry Set** and Thanksgiving, Christmas, Labor Day and Sundays
all evaluate non-work, so divergence D7 holds on the hosted build.

**THE SECOND SIGN-IN IS SILENT, as hoped but not previously provable.** The SWA wall establishes
an Entra session, and MSAL's `loginPopup` then completes with no popup and no second prompt. Users
sign in once.

**THE TWO CONSENT PROMPTS ARE A ONE-TIME ADMIN EVENT, NOT A PER-USER TAX.** Signing in the first
time raised consent for **Azure Static Web Apps** (`openid profile email`) and for the planner
(`Sites.ReadWrite.All`). Both grants now read **`consentType: AllPrincipals`**, so Don, David, Cody
and Emon will see no consent dialog at all. Check with:

```
az rest --method get --url "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?\$filter=clientId eq '<sp-object-id>'"
```

`2e705612-1b82-416e-aa1c-d7043cad9e4f` is the Azure Static Web Apps SP in this tenant;
`87f681ec-a4a4-47df-8423-8fc28c2d2324` is the planner's.

**A "Chrome is being automated" banner during testing is Playwright's own flag**
(`--disable-blink-features=AutomationControlled`), not the application. Real users never see it.

**Running it on live data found a cry-wolf warning that no harness had reached.** The crew roster
uses `'?'` for a member whose name is not known yet; Campos and Harrison each carry one, and the
shared-member check excluded `'+2'` but not `'?'`. It reported *"?, ? is on both Campos +2 and
Harrison +2 -- confirm these are different people"*, which is unclearable by definition and is the
same failure that got PM sign-off removed from Schedule Check. Fixed; live warnings went 41 -> 40.

**The assertion that pins it was VACUOUS on the first attempt and passed with the bug present.**
The shared-member check only fires for crews sharing a working day, and the harness's scenario put
no two crews on the same date, so it asserted over an empty set. It now builds the overlap and
carries a second assertion confirming the scenario is reached. **A new assertion has to be watched
fail before it is worth anything** -- the fourth time this file has recorded that lesson.

## The decision behind that — hosting and security posture, decided 2026-09-13b

**Shane's requirement: "this shouldn't be public and should sit behind a SSO wall."** The answer
is **Static Web Apps Free plan with the built-in Entra provider**, not Standard. The reasoning
matters more than the choice, because the obvious reading of that requirement costs $9/month and
buys almost nothing.

**THE PLANNER HAS TWO INDEPENDENT GATES AND ONLY THE OUTER ONE WAS EVER IN QUESTION.**

| Gate | Protects | Enforced by |
|---|---|---|
| **Data** | every schedule row | MSAL sign-in against the single-tenant Entra app, then SharePoint's own permissions |
| **Shell** | the crew roster, the 46/295 template, the site identifiers | whatever the host puts in front of the HTML |

No hosting choice can weaken the data gate: a delegated Graph token is the only way to read a
single row, and that app is already single-tenant. So the host-level wall protects **only the
shell**, and a tenant-restricted wall in front of already-tenant-restricted data is overbuying.

**What Free actually gives you, in Microsoft's own words:**

> The preconfigured Microsoft Entra ID provider **allows any Microsoft account to sign in.**

Restricting sign-in to one tenant needs a **custom** provider, and *"custom authentication is only
available in the Azure Static Web Apps Standard plan."* Standard is **$9.00 per app per month** —
read from Azure's retail price API, US regions, 100 GB bandwidth included and $0.20/GB over. Note
the docs *pricing page renders its figures client-side*, so fetching that page returns dashes; the
retail API is the way to get a real number.

| | Cost | What it actually gates |
|---|---|---|
| **A** Free + `allowedRoles:["authenticated"]` | **$0 — CHOSEN** | blocks anonymous and crawlers; any Microsoft account still passes |
| **B** Free + invitation roles | $0 | only invited identities, cap 25, but the invitation is a **forwardable redeemable link** |
| **C** Standard + custom Entra provider | $9.00/app/mo | only D2 tenant accounts can sign in at all |

**B was rejected on this project's own precedent.** A forwardable link is the same weakness that
ruled out anonymous Forms sign-off — *"a typed name on a forwardable link"* — and the 25 cap sits
close to ~5 office staff plus ~7 crew leads.

**USERNAME AND PASSWORD WAS ASKED FOR AND DOES NOT FIT. Do not re-raise it.** Static Web Apps has
no such provider (built-ins are GitHub and Entra only); a custom OIDC provider is the same Standard
tier at the same $9; a client-side check is bypassable with View Source. The decisive point is none
of those: **every user must sign in with their D2 account anyway, because the Graph read needs a
delegated token.** A password wall would be a second, weaker credential stacked on a sign-in that is
already mandatory — friction added, nothing removed.

**Residual risk, accepted:** a Microsoft account holder who also knows the URL could see the shell.
Mitigated by `noindex` three ways (header, `robots.txt`, meta), by 404'ing the GitHub provider, and
by keeping the random `*.azurestaticapps.net` hostname rather than a guessable custom domain.
**Moving to Standard later is a plan toggle in the portal, not a rebuild.**

**THE CONFIG IS UNVERIFIED UNTIL DEPLOYED** — none of it can be tested against a local static
server. On first deploy, check in this order:

1. An unauthenticated request **redirects to the Entra sign-in** rather than serving the page.
2. A request for a **nonsense path** does the same. This is the one most likely to be wrong:
   the docs say *"route rules aren't applied on requests that trigger `navigationFallback`"*, and
   our fallback rewrites unknown paths to `/index.html`. If that bypasses the `/*` auth rule the
   wall is worthless, and it will look fine from the front door.
3. All assets still return **200 after sign-in**.
4. The browser console is **free of CSP violations** during a Refresh.

**The CSP keeps `'unsafe-inline'` on `script-src`, deliberately and with the cost stated.** The
planner uses inline `<script>` and inline `onclick=` throughout, so a strict `script-src 'self'`
would break it outright. The valuable half is still enforced: `connect-src` limits exfiltration to
Graph and `login.microsoftonline.com`, `frame-ancestors 'none'` blocks clickjacking, and
`object-src`/`base-uri` are shut. `frame-src` allows `login.microsoftonline.com` for MSAL's
silent-renew iframe. Tightening `script-src` means refactoring every inline handler first.

### The security review that produced this — findings and what closed them

**SIX renderers put a PM-typed pool name into `innerHTML` unescaped, not the two a grep found.**
`conflicts()` built both its `ref` string and its double-book message raw, and `vBoard`, the
crew-board bar, `vSignoff` and `vDispatch` each painted `j.name` raw. On two of those lines
`j.jobno` was **already escaped immediately beside the unescaped name**.

Exploiting it needs someone with SharePoint Edit on the site, so it is an insider vector rather
than an anonymous one. The impact is what makes it worth fixing: once served from a real origin
the page holds a delegated `Sites.ReadWrite.All` token, so script in that origin can read and
write every SharePoint site the signed-in user can reach. Microsoft states the division of
responsibility plainly in the MSAL v4 notes — cache hardening is *"not to provide additional
security … It's your responsibility to ensure your application isn't vulnerable to XSS."*

**Escaped at construction, never at the sink**, because the Schedule Check messages deliberately
carry `<b>` and `<u>`.

**THE METHOD LESSON, which is the durable part: a pattern grep answered the question wrongly and
I acted on it.** Searching `${j.name}` cannot see `x.j.name` reached through `.map()` and string
concatenation. What caught the other four was `fixtures/planner/escaping.js` sweeping **all seven
tabs** with an `<svg id="xss-probe">` in the pool name — an assertion that does not depend on a
script executing, and that turns "two fixes" into an invariant. **When a grep defines the scope of
a fix, the fix is only as complete as the pattern.** Same family as every other
read-the-shape-off-reality rule in this file.

**MSAL 2.38.3 IS THE CORRECT PIN AND IS NOT TECHNICAL DEBT. Do not "upgrade" it.** Per Microsoft's
own library table, **v2.x is the LTS line still receiving critical security fixes**, while **v3.x
and v4.x have transitioned OUT of active support** (v5 is active). Vendoring is also mandatory
rather than a preference: msal-browser left the CDN at v3, which is why the `alcdn` path 404s.
A v3 upgrade would also be a breaking API change (`initialize()` became required).

**Everything else in `web/` reviewed clean:** no secrets (client id, tenant id and list GUIDs are
identifiers, correct for a PKCE SPA); zero `eval` / `new Function` / `document.write` /
`insertAdjacentHTML`; MSAL caches to **`sessionStorage`**, so the token dies with the tab; and the
newest code — the write-back preview, `+ Job`, `vJobs` — already escaped everything.

**The fonts are self-hosted as of 2026-09-13b**, removing the last third-party request. Poppins and
Source Sans 3 are OFL; 4 files, 52 KB, latin subset only, in `web/fonts/` with `web/fonts.css`.
Regenerate with the script recorded in the session log.

**Two traps worth keeping from that job.** A font that silently falls back still returns **200 for
every file**, so verify by measuring rendered text in a real browser, not by the files existing —
and **measure only after explicitly `document.fonts.load()`-ing each face**, because the first
measurement of an unused weight reports fallback metrics and looks exactly like a broken font.
Second: Source Sans 3's 400 and 600 resolve to the **same file**. A static face declared at two
weights renders both identically and quietly loses every semibold, so that needed proving rather
than assuming — it measures 716.91 against 735.11 at 64px, so the file is variable and the weight
axis is live.

### The planner must not call D2 the other party — copy rule, applied 2026-09-13b

The tool said **"Load from D2"**, **"Not loaded from D2"**, **"nothing reaches D2"**. Everyone who
opens it works at D2, so the copy read from the builder's seat rather than the user's. 25 strings
were rewritten; most needed no referent at all.

| Was | Now |
|---|---|
| `Load from D2` | **`Refresh`** |
| `Not loaded from D2` | **`No schedule loaded yet`** (pairs with the existing `Live as of …`) |
| `Not yet pushed` | **`Draft — not saved`** |
| `Save changes to D2` | **`Save changes`** |
| `not a D2 SharePoint export` | `not a schedule export` |

Where a referent is genuinely needed — the apply script, the request lists — it now says
**SharePoint**, which is where the PM guide already sends them. **The element ids `d2Btn` and
`d2File` are deliberately unchanged**: internal, asserted on by `empty.js`, and renaming them buys
nothing. This also retires the older note that `Load from D2` would become "Refresh from D2" with
Route B — "from D2" is the exact phrase being removed.

**Four harness assertions pinned the old strings and had to move in lockstep**, or the suite goes
red for the wrong reason. Grep the harnesses before any copy change.

---

## NEXT SESSION — CREATE THE STATIC WEB APP (written 2026-09-13b)

**Read `sessions/latest.md` first.** Everything local is done: the planner is reviewed, escaped,
renamed, self-hosting its fonts, and carrying a finished `staticwebapp.config.json`. What is left
is one Azure resource and the verification that needs a human sign-in.

**Held deliberately overnight, and why:** creating the app is not the hard part, but **the
deployment method is a fork that should not be picked at midnight.** Azure DevOps Pipelines (the
spec's preference, and the repo is already there) wants to commit a workflow file into this repo;
a deployment token is quicker but creates a secret to manage. Shane picks.

### Staged facts, read from the live subscription 2026-09-13b

| | |
|---|---|
| Subscription | `D2 Build Scheduler`, `cbcbe68b-bbaa-4926-bd9a-d33f0a9bd312` |
| **`Microsoft.Web` provider** | **`NotRegistered` — register it FIRST**, it propagates for a few minutes |
| Resource groups | **none — the subscription is completely empty** |
| Existing Static Web Apps | none |
| Entra app SPA redirect URIs | `http://localhost:8787` and `http://localhost:8787/` **only** |
| Entra app | `D2 Build Scheduler (planner)`, `AzureADMyOrg`, publisherDomain `NETORGFT15040037.onmicrosoft.com` |

### Order of work

1. **Assert the tenant.** `az` had **drifted to Tennetech again** when checked tonight — that is
   four times in three days. `az account set --subscription cbcbe68b-…` fixed it with no
   interactive login. Use the `m365-tenant-guard` skill; re-assert *after* ARM calls too.
2. `az provider register -n Microsoft.Web`, then a resource group, then a **Free tier** Static Web
   App. Kick the provider registration off first so it propagates while you do the rest.
3. Deploy `web/`.
4. **Add the SWA hostname as a THIRD SPA redirect URI.** Keep both localhost entries — they are
   what `fixtures/planner/capture-graph.html` and local dev use. Without this, sign-in fails on the
   hosted site.
5. **Verify by signing in, not by pipeline status**, and run the four config checks listed under
   the hosting-posture section above — especially the nonsense-path one.

### Then the unattended testing Shane asked for

**Nothing — the write-back, `+ Job`, or the Graph read — has ever run against the tenant.** Safe to
exercise on the three fictional demo pools, in this order: Graph read (expect 3 pools / 138
sub-phases / 885 tasks), then write-back with `DRY_RUN = true`, then a deliberate refusal (change a
row in SharePoint after loading, push, confirm that field is refused while a second changed field
on the same row still lands), then `+ Job` dry-run. Do **not** re-run the `+ Job` live pass "to be
sure" — a second run is exactly what used to create two pools.

### Still blocked on other people

- **A permission gate** still blocks live-tenant writes: the validated Reschedule cursor fix in
  `flows/pending/`, the `TradeMismatch` view, the dispatch filter.
- **Don:** trade mapping, the 11 field-supervision sub-phases, `@sub`, subcontractor emails.

---

## Superseded: NEXT SESSION — HOST THE PLANNER, THEN TEST IT UNATTENDED (written 2026-09-13c)

**Read `sessions/latest.md` first.** Everything needed to host now exists. Nothing is client-gated.

**Shane's goal for the next session, verbatim:** *"make sure the HTML is properly hosted and
running then do some unattended testing of the solution."*

### What is already in place

| | |
|---|---|
| Azure subscription | `D2 Build Scheduler`, `cbcbe68b-bbaa-4926-bd9a-d33f0a9bd312`, Enabled, on D2's MCA. No card needed. |
| Entra SPA app | `1aa00e61-e5e7-42bd-95b4-fd58863e5b54`, delegated `Sites.ReadWrite.All`, consented tenant-wide |
| Deploy root | **`web/`** — `index.html`, `graph-to-planner.js`, `vendor/msal-browser.min.js`, `staticwebapp.config.json` |
| Graph read layer | built and equivalence-tested against a real captured payload |
| Redirect URI registered | `http://localhost:8787/` **only** |

### Hosting, in order

1. **Assert the tenant first** — `az account set --subscription f24d9b39-…`, confirm
   `stratirus@d2pools.com`. Use the `m365-tenant-guard` skill. The context drifted three times in
   two days, including between two reads minutes apart.
2. Register the resource provider (`Microsoft.Web`) on the new subscription if needed, create a
   resource group, then a **Static Web App on the Free tier**.
3. Deploy `web/`. The spec prefers Azure DevOps Pipelines since the repo is already there; the SWA
   CLI or a deployment token are fine for a first stand-up.
4. **Add the SWA URL as a SECOND redirect URI on the Entra app.** Keep `localhost:8787` — it is
   what the capture tool and local dev use. Without this, sign-in fails on the hosted site.
5. **Verify by loading the page and signing in**, not by the pipeline status. Confirm both
   `vendor/msal-browser.min.js` and `graph-to-planner.js` return **200** — the jsdom harnesses
   cannot see a broken `<script src>` and passed while those paths were wrong.

**Then `Load from D2` becomes a live read** and the file picker stops being the only route. It
currently falls back automatically, because **MSAL cannot redirect to `file://`**.

### Unattended testing — what is worth testing, and what must not be

**Everything below has NEVER run against the tenant.** The write-back, `+ Job`, and the Graph read
are all verified only against captured fixtures.

Safe to exercise, on the three demo pools:

- **Graph read** — sign in on the hosted site, Load from D2, confirm 3 pools / 138 sub-phases /
  885 tasks and that spans match SharePoint.
- **Write-back, `DRY_RUN = true` first.** Change one crew in the planner, Save, run
  `sharepoint/apply-planner-changes.js`, read the printed plan. Only then set `DRY_RUN = false`.
  **Deliberately provoke a refusal** too: change a row in SharePoint after loading, then push, and
  confirm that field is refused while a second changed field on the same row still lands. A refusal
  path nobody has watched fire is not known to work.
- **`+ Job`** — dry-run first. Do **not** re-run the live pass "to be sure": the uniqueness check
  now covers pending requests, but the whole point is that a second run is what used to create two
  pools.

Do **not** test against a real pool. The tenant holds only `D2-1042`, `D2-1043`, `D2-1044`, all
fictional — keep it that way until Phase E.

**After the first live write, open the rows rather than reading the summary**, and watch
Event-Driven Reconciliation's run count for ten minutes to confirm `SuppressReconcileUntil` held.

### Still blocked

- **A permission gate gave `+ Job`'s sibling work no route to the tenant.** The validated
  `D2 - Reschedule Pool` cursor fix sits in `flows/pending/reschedule-pool-cursor-fix.md`, along
  with the `TradeMismatch` view and the dispatch-filter change. Resolve once: grant it, or take
  console-paste scripts in the `sharepoint/` pattern.
- **Don, Monday:** trade mapping, the 11 field-supervision sub-phases, `@sub`, and the four
  subcontractor email addresses.

---

## OVERNIGHT 2026-09-12 — write-back specced, three rule bugs closed

Done unattended while Shane slept, authorised in advance, all of it offline and reversible. No
tenant write, no Entra registration, no Azure signup — those were explicitly held.

**1. The batch write-back is specced, not built:**
`docs/superpowers/specs/2026-09-12-batch-write-back-design.md`. Two findings change what the
parent spec assumed:

- **ETags will not work**, for two reasons and the second is the one that matters.
  `odata=nometadata` suppresses `odata.etag` entirely (verified against the fixture — no assignment
  row carries one). More importantly a **row-level ETag would produce constant false conflicts**,
  because five flows write to `Assignments` on schedules unrelated to the PM: Calendar Sync
  (hourly), Counter Reconciliation, Conflict Flag, Crew Trade Check and Event-Driven Reconciliation.
  A PM loading at 09:00 and saving at 16:00 would have the whole batch rejected because a nightly
  flow annotated the rows overnight. **The design compares the five owned fields instead** — precise
  about the collision that matters, immune to machine writes, and needs no Accept-header change.
- **Auto-Schedule cannot be expressed as a `Reschedule Requests` row**, because
  `D2 - Reschedule Pool` moves dates and never picks a crew. A reflow is therefore a large
  row-edit batch, and the flow stays right for the case it was built for.

Also recorded there: **Backup, Restore and the file picker retire WITH the live connection, never
before it** — until the app reads on open they are the only recovery from a cleared `localStorage`.

**2. Three planner rule-enforcement bugs fixed** (`ddca578`, `55794e4`, `3e631a0`), pinned by the
new `fixtures/planner/rules.js` (11 assertions). See the business-rules section above for rule 1
and rule 2; rule 3's cursor defect is under rule 3. Each fix was reverted in isolation and watched
go red before being accepted.

**3. `planner-stage1-verified` is a git tag** marking the last known-good planner.
`git show planner-stage1-verified:web/index.html` recovers it. Shane's instruction was "keep a
master copy" — a **tag, not a second file**, because this repo already spent weeks with CLAUDE.md
describing a `patched-tool/pool-scheduler.html` that never existed while the real planner carried
neither patch it was credited with.

**Shane's standing latitude, 2026-09-12: "you can edit the html, just keep a master copy. it's not
scripture."** This lifts the parent spec's "not a rewrite of the planner" non-goal. Two constraints
survive and neither is style preference: the jsdom harnesses stay green, and **structure still comes
from the local phase template, never from the payload** — that is what makes a partial or malformed
response unable to corrupt the template.

**Still open and still needing a human:** the Azure subscription, the Entra SPA registration, any
tenant write (including `fix-job-startdates.js`, which has `DRY_RUN = false` committed at line 37),
the Graph payload capture, and a human eye on the repaint.

---

## NEXT SESSION — PHASE H, HOSTING HALF (checkpoint written 2026-09-11d)

**Read `sessions/latest.md` first.** Phase H Stage 1's **local half is complete**: the planner
is correct against live data, branded, and moved. What remains is hosting, auth, and the
write-back.

**THE PLANNER NOW LIVES AT `web/index.html`.** Moved 2026-09-11d with `git mv`, history intact.
The doubled `D2-Build-Scheduler/D2-Build-Scheduler/app/` directory no longer holds it. There is
exactly one copy. `web/staticwebapp.config.json` sits beside it with SPA fallback and no `auth`
or `routes` block, because identity comes from MSAL in the browser and a half-configured routes
block would be a guess.

**Six of the eleven parity divergences are CLOSED** — D7, D2, D8, D9, D4, D11. See
`docs/planner-vs-sharepoint-parity.md`, whose line numbers were re-resolved the same day and now
land on the code they describe. Measured outcomes, not assertions:

| | Before | After |
|---|---|---|
| Live spans crossing a holiday | 2 of 138 drawn a day short | **0**, 138 agree with SharePoint |
| Schedule Check | 51 unclearable "missing PM sign-off" | installer-only |
| An N/A task | imported as not-done | third state, label and bar deliberately disagree |
| `Planned` pools | indistinguishable from live | badged, still raise conflicts |
| Auto-Schedule anchor | drifted `Jobs.StartDate` | earliest real work |
| `oracle-test.js` | 14/16 | **15/16** |

**THE BATCH WRITE-BACK IS NOT BUILT, and its groundwork is. Shane asked for it mid-session
2026-09-11d: "when finished press save to batch write back".** What exists:

- the export carries **SharePoint row ids** (`jobs[].id`, `sections[].id`) — it carried none, so
  nothing could address a row
- the import records **`s.base` per sub-phase** (`id, crewId, start, days, locked, skip,
  spLocked`) and `divergedSecs(j)` diffs against it. That diff **is** the change-set a Save
  button would send
- `spLocked` exists separately because `s.locked` is the planner's *derived* lock
  (`is.locked || is.inst`), so without it a write-back could not tell a PM's deliberate pin from
  one inferred from sign-off
- `fixtures/planner/freshness.js` asserts the **exact key set** of `s.base` and fails if anyone
  widens it

**The field scope is settled and must not widen: crew, dates, duration, locked, skip. Never
sign-off, never task ticks.** The planner's `inst`/`pm` are bare booleans with no attribution,
timestamp or notes, while SharePoint holds `InstallerSignOffBy`/`On` and `SignOffNotes`. Writing
them back would replace an attested sign-off with a flag. Three questions the write-back spec has
to answer, none with an obvious default: how it authenticates (no credential exists from
`file://`, so it is gated on hosting + MSAL, or on a companion console script mirroring the
export); what happens when two PMs push overlapping edits (ETags with `If-Match`); and whether a
reflow goes as a `Reschedule Requests` row so `D2 - Reschedule Pool` keeps owning the working-day
logic, rather than as direct date writes.

**A TEST HARNESS CAN GO VACUOUS AND NOTHING NOTICES. Four were caught in one session.**
`workcalendar.js` passed on a broken join reporting `0 spans checked`; `startdate.js` passed
against a fully reverted fix; `empty.js` had no assertion and no non-zero exit at all, so a
boot-time break in the planner passed the whole suite; and **`determinism.js` had been reporting
`assignments compared : 0` since the planner stopped seeding demo pools** while this file
described it as pinning "4 of 138 crew picks drifted per re-run before, 0 after". That was true
when written and silently stopped being true. All four are fixed and each was proven by mutating
production code and watching the harness go red. **This is the same drift class already recorded
here three times** (`flows/definitions/`, the phantom `patched-tool/`, the stale `New Pool`
export): a committed artifact quietly stops meaning what its description says. When a harness is
cited as a gate, check what it actually compared.

**Start here, in order:**

1. **Create the Azure subscription.** Not client-gated — Shane holds admin rights. Free to
   create, SWA Free tier is free, but a pay-as-you-go signup needs a payment method, and **whose
   card decides who owns it**. D2's card keeps ownership where the spec puts it.
2. **Register one Entra SPA app.** This does NOT need the subscription — app registrations are an
   Entra feature and D2's tenant already exists. It is the real unblock for everything else.
3. **Capture a real Graph payload into `fixtures/planner/live-payloads-graph.json` BEFORE writing
   any mapping code.** Graph is a **third** field-shape surface alongside raw REST and the
   connector. The existing REST fixture does not validate it. `fixtures/planner/run-export.js`
   already isolates the read layer behind one stub, which is where a Graph variant plugs in.
4. **Then the write-back**, spec first.

**Outstanding human gate, deliberately not run:** `sharepoint/fix-job-startdates.js` realigns
`Jobs.StartDate` on the three demo pools. **It has `DRY_RUN = false` committed at line 37**, so a
paste is a live write — edit it to `true` first. Now cosmetic rather than load-bearing, since the
planner-side guard means Auto-Schedule no longer depends on that field.

**Still open, unchanged:** `TradeMismatch` has no view. Crew-lead accounts and Business Basic
seats unbought. Phase F Day 2 training documents the SharePoint surface and must be rewritten.
The PM guide describes the surface H replaces.

---

## Superseded: NEXT SESSION — PHASE H (checkpoint written 2026-09-11c)

**Read `sessions/latest.md` first.** The system went live to the client this session: David, Don,
Emon and Cody have access, both summaries reach them, and the invite email has been sent.

**PHASE H IS NEXT AND RUNS AHEAD OF THE PILOT.** Resequenced late on 2026-09-11c. The office
surface is SharePoint *today*, but it is not what Phase F will train on, so do not invest in the
SharePoint surface beyond keeping it working.

**The next phase is the presentation layer.** Spec is written and approved in principle:
`docs/superpowers/specs/2026-09-11-planner-as-primary-surface-design.md`. Host the browser planner
on Azure Static Web Apps in D2's tenant with MSAL delegated Graph reads, repaint it into the D2
palette, and let it become the office surface while SharePoint stays the database.

**Start here, in order:**

1. **Check the guide artifact is actually shared.** New artifacts start private, and the invite has
   already gone out. If it is still private, all four are hitting a permission wall right now.
   https://claude.ai/code/artifact/a84a2e1a-6395-4f3a-b050-8cf53cefa2b5
2. **Put the Azure subscription ask to David and Don.** **D2 has no Azure subscription** (verified,
   `az` returns `N/A(tenant level account)`). Creating one is free and SWA Free tier is free, so the
   ask is a signup and a payment method on file, not spend.

   **NO LONGER CLIENT-GATED, 2026-09-11c.** Shane holds admin rights to create the subscription
   himself, so this moves at our speed rather than D2's and Phase H is **effort-bound throughout**.
   Two things still need a decision rather than a click: a pay-as-you-go signup asks for a **payment
   method** even when nothing is ever spent, and **whose card decides who owns it**. D2's card on
   D2's subscription keeps ownership where the spec puts it; Stratirus billing would quietly make
   Stratirus the owner of infrastructure D2 depends on, which is the continuity question this was
   supposed to settle. The free tier means the card is never charged either way.

   Netlify on a Stratirus account remains the documented fallback, but with the gate gone it is
   now unlikely to be needed.
3. **Review the spec, then turn it into an implementation plan.** It has not had a proper read-through
   yet. The brainstorming path says spec → `writing-plans` → build.
4. **DONE ahead of schedule — do not redo this.** The five parity-map divergences that would have
   produced visibly wrong output once the planner became primary are now CLOSED: **D7** Work
   Calendar, **D2** PM sign-off crying wolf on 51 rows, **D8** `NotApplicable` not exported, **D9**
   `Jobs.Status` discarded, **D4** `Jobs.StartDate` drift. All five were fixed directly in the
   planner (`web/index.html`) before the Static Web Apps work began — see
   `docs/planner-vs-sharepoint-parity.md` for what each was and what closed it. **D7 also lifted
   the standing HOLD on the Work Calendar fix** — that hold was right while the planner was a
   scratchpad and did not survive it becoming primary. What is left of "the hosting is the cheap
   part" is literally just the hosting, plus the Graph read-layer swap in the next item.
5. **Capture a real Graph payload before writing any mapping code**, into
   `fixtures/planner/live-payloads-graph.json`. Graph is a **third** field-shape surface alongside
   raw REST and the connector, and the existing REST fixture does not validate it.

**Created by the resequencing, and easy to forget:**

- **Rewrite Phase F Day 2 office training.** It documents the SharePoint views and will be wrong
  once H lands. `D2-Phase-F-Cutover-Runbook.md`, Steps 5 and 6.
- **Reissue the PM guide.** Version 5 of `a84a2e1a-…` went to the client on 2026-09-11c describing
  the surface H replaces.
- **Exercise the planner on the three demo pools before Phase E**, so the pilot is not the first
  real use of a new interface. Piloting on an untested UI mixes interface bugs with system bugs.

**Carried over, not Phase H:**

- **`TradeMismatch` still has no view**, so business rule 1 is enforced nightly and invisible. The
  last item outstanding from the 2026-09-11b checkpoint. Shane also wanted an hourly diff flow so a
  PM does not wait until morning.
- **Crew-trade mappings from the browser HTML** as the standing source. They already match
  `Crew-Trades` exactly, so this is about authority and drift.
- **Canvas app Day / Week / Month, defaulting to Week.** Design approved, spec owed before code.
  Worth re-reading against Phase H first, since the canvas app's future is a Stage 3 question.
- **Verify the Jobs and Tasks view formatters by OPENING them.** They were applied through a probe
  flow and are verified as stored, not as rendered.

The older notes below are kept for the reasoning they record, not as a current task list.

---

## Superseded: NEXT SESSION: one task (Shane, 2026-09-07)

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

**All eight of the original views are now `Paged=true`.** They were stored `RowLimit=100,
Paged=false`, which in SharePoint means "return 100 and stop" — no next control, no indication
anything is missing. `Incomplete Tasks` was showing 100 of 184.

**Nine views now carry a JSON card formatter** (`sharepoint/format-views.js`): status pill,
progress bar, colour-coded left border on Assignments; tick / strikethrough on Tasks; a
Status-coloured card on Jobs' `Planned Pools`, added 2026-09-09 in the final whole-branch review
of the `Planned`-suppression / reflow work; it was the only one of the nine built views with no
formatter, on a view PMs are now sent to (Phase F step 5, confirm a commit), and it rendered as a
plain grey table beside eight formatted ones. Two things that are load-bearing and were learned
by looking at the rendered result: `width`/`box-sizing`/`align-items` on the root, without which
SharePoint shrink-wraps the card and centres it as a narrow floating block; and
`hideSelection: true`, without which SharePoint's own selection gutter draws a second indicator
next to yours.

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

**HIDING A FIELD FROM THE NEW FORM: `ShowInNewForm` IS NOT SETTABLE ON THE REST FIELD ENTITY.
Found 2026-09-10.** A `MERGE` on
`/_api/web/lists/GetByTitle('X')/fields/getByInternalNameOrTitle('Y')` with `{"ShowInNewForm":false}`
returns **400 `The property 'ShowInNewForm' does not exist`** — it lives on
`SP.FieldCreationInformation` / CSOM, not on `SP.Field`.

**The route that works is `SchemaXml`, and the safe way to use it is a string insert, never a
rebuild.** Read the field's current `SchemaXml`, insert `ShowInNewForm="FALSE"` immediately after
`<Field `, and MERGE that exact string back. This preserves `<CHOICES>`, `<Default>` and everything
else verbatim, which matters because a hand-built `SchemaXml` is what **silently wipes
`ValidationFormula`** (see the `Assignments.Crew` Choice entry above). Handles both the
self-closing `<Field .../>` and the `<Field ...>...</Field>` shapes. Verify by reading `Choices`,
`DefaultValue` and `ValidationFormula` back afterwards.

**Hiding a Required field from the New form is safe ONLY when it has a default**, which SharePoint
then supplies on save. Applied 2026-09-10 to `Status` and `Result` on all three request lists
(`New Pool Requests`, `Delete Pool Requests`, `Reschedule Requests`) — all three `Status` fields
default to `Requested`. **Proven end to end**, not assumed: a pool was created through the form
with `Status` hidden, saved, defaulted to `Requested`, and `D2 - New Pool` built all 46 sub-phases
and 295 tasks correctly. Both fields are flow-owned, so a PM being asked to fill them in was a
straightforward defect. They stay visible on the Display and Edit forms, because the guide tells
PMs to watch `Status` for `Done`.

**THE THREE REQUEST LISTS' DEFAULT VIEWS SHOWED ONLY `LinkTitle`. Fixed 2026-09-10.** Same defect
class as the `Jobs` All Items one recorded above, and it was never checked on these lists. A PM
following the instruction "refresh until Status says Done" **could not see Status at all** — the
view rendered pool names and nothing else, on all three lists. Now:

| List | View fields |
|---|---|
| New Pool Requests | LinkTitle, JobNumber, Status, StartDate, ProjectManager, Result, Created |
| Delete Pool Requests | LinkTitle, ConfirmJobNumber, Reason, Status, Result, Created |
| Reschedule Requests | LinkTitle, JobNumber, FromSequence, NewStartDate, Status, Result, Created |

All three also set `RowLimit=50, Paged=true`. Set with `viewfields/removeallviewfields` then
`viewfields/addviewfield('<name>')` per field, in order.

**`D2 - Delete Pool` REQUIRES `Title` TO EQUAL `ConfirmJobNumber` EXACTLY** — the guard is
`not(equals(trim(ConfirmJobNumber), trim(Title)))`. So the job number is typed **twice**, and a
descriptive Title such as `Alvarez Residence - remove test pool` is **Refused: confirmation did not
match.** Deliberate two-key confirmation on a destructive action, not a bug, but it is unguessable
from the form, so the PM guide now spells it out.

**MEASURED RUNTIMES, 2026-09-10, on a tenant holding 3 pools.** Both were previously described only
as "a few minutes", which understated them:

| Flow | Measured |
|---|---|
| `D2 - New Pool` (46 sub-phases + 295 tasks) | **9m 03s** from Save to `Done` |
| `D2 - Delete Pool` (same pool) | **~6m** |

Roughly 14 seconds per sub-phase, and it scales with the 46 rows rather than with tenant size. The
PM guide carries this as a prominent callout, because the request sits at `Building` the whole time
and looks stuck.

**LIST FORM formatting works, and the wrapper key names are `headerJSONFormatter` /
`bodyJSONFormatter` / `footerJSONFormatter`. Found 2026-09-10; do not re-guess them.**

The Assignments edit form now has a navy header, four named sections and a footer carrying the
crew-code rule (`sharepoint/configure-assignments-form.js` step 5). The formatter is one JSON
string on the **list content type's** `ClientFormCustomFormatter`.

Microsoft documents the JSON for each *region's contents* but never the wrapper that holds all
three, and the wrapper is where the time goes. Three plausible shapes were tried first and **all
three returned 204, round-tripped byte-for-byte, and rendered absolutely nothing** — the exact
failure signature this file opens with:

| Tried | Result |
|---|---|
| `{"Header":"<stringified json>", ...}` | stored, ignored |
| `{"Header":{...}, ...}` | stored, ignored |
| `{"header":{...}, ...}` | stored, ignored |
| `{"headerJSONFormatter":{...}, ...}` | **works** |

The real shape was captured the way the rule says: paste a header into SharePoint's own Format
pane, save, then read `ClientFormCustomFormatter` back over REST.

**Reaching that pane is itself the fiddly part, and is worth writing down.** The `Edit form >
Configure layout` command does **not** exist on the full-page `DispForm.aspx` or `EditForm.aspx`,
nor on `DispForm.aspx?...&env=WebViewList`. It appears **only on the item panel opened from a list
view**, and the row must be opened with a **real CDP click** (`chrome-devtools` `click` against a
snapshot uid). Synthetic `MouseEvent`s dispatched at the title cell only *select* the row, because
Fluent ignores untrusted events. That cost several attempts before the panel would open at all.

Two behaviours confirmed by opening the form rather than trusting the write:

- **`fieldsettings: [{name, readonly: true}]` is real** and is what makes `SubPhaseNumber` /
  `SubPhaseName` non-editable. Microsoft's own page still labels this "proposed". On this tenant
  it **omits the field from the Edit form entirely** rather than rendering it as read-only text,
  which is why the header repeats the sub-phase number and name.
- **Sections did NOT produce the multi-column layout** the docs promise. The form stays
  single-column with section headings and rules. Cosmetically fine, but do not promise two columns.

**A Power Apps custom form would REPLACE all of this**, per Microsoft's own docs — the two are
mutually exclusive, not layered. Relevant because a Crew dropdown needs either that or a Choice
column: form JSON explicitly cannot supply a picker, only layout, sections and visibility.

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
| Planning / scheduling | the browser tool `pool-scheduler.html` | fed from SharePoint 2026-09-11; **nav link pulled at go-live, becomes the primary surface in Phase H** |
| Office day-to-day | **SharePoint list views** | built 2026-09-07 |
| Ownership visibility | daily + weekly HTML summary emails | built, Phase B |
| Field sign-off | the canvas app | built, Phase C |

**THE BROWSER PLANNER IS NOW FED FROM SHAREPOINT (2026-09-11). One way only.**

Shane: *"if the html isn't up to date what's the point?"* It wasn't. The planner
had **no connection to SharePoint at all** — zero `fetch`, `localStorage` only,
and it seeded three fictional California pools of its own (Harrison Residence,
Vasquez Pool & Spa, Bell Canyon Remodel) that matched nothing in the tenant. A PM
opening it saw pools that do not exist, scheduled under rules the system does not
use, and nothing they did there reached anything. It had also sat untouched since
2026-08-13 while every design decision in this project happened around it.

(That seed is also where `Harrison Residence` came from. It was carried into
SharePoint verbatim during Phase A as `D2-1001` and had to be deleted from the
live tenant on 2026-09-10. The demo data outlived the demo by three weeks.)

**How it works now:**

1. `sharepoint/export-to-planner.js`, pasted into the browser console on the
   site, reads Jobs + Assignments + Tasks and downloads `d2-live-schedule-<date>.json`.
   Read-only: it only ever GETs, so a member with read access can run it.
2. The planner's new **Load from D2** button imports that file.

**It MERGES by job number, it does not replace.** The existing `Restore` button
swaps the whole state, which would destroy any pool a PM had sketched locally but
not yet raised in SharePoint. Local-only pools are left alone.

**Structure always comes from the local phase template, never from the file.**
Only what SharePoint owns is overlaid: crew, dates, duration, skip/lock flags,
sign-off state, task ticks. Sub-phase names, skills and task text stay
authoritative in the planner. This makes a partial or malformed payload unable to
corrupt the template, and it is why the importer matches on `SubPhaseNumber`
(`"0.0"`, `"2.1"`) rather than trusting the file's own structure.

**Signed-off and SharePoint-locked sub-phases import as `locked:true`**, so a
later Auto-Schedule cannot move completed work. That is the same rule
`D2 - Reschedule Pool` applies server-side. Without it, one click of
Auto-Schedule after an import would silently replan work that crews had already
signed for.

**Two field shapes that are easy to get wrong, both read off the write bodies in
`flows/exports/D2-New-Pool-*.json` rather than guessed:**

- `Crew` is a Choice column. **Raw REST with `odata=nometadata` returns it as a
  plain string** (the short code, `"devon"`), which is exactly what the planner's
  `crewId` wants. The *connector* would return `{Id, Value}`. See the Choice
  column entry above.
- The Tasks lookup is **`AssignmentId`** in REST/OData. (`Assignment` +
  `Assignment#Id` is the connector shape, not what this script gets.)

**WHY THERE IS NO WRITE-BACK, and do not "finish the job" by adding one.** The
planner has no sign-off model: its `inst`/`pm` are bare booleans with no
attribution, no timestamp and no notes, while SharePoint holds
`InstallerSignOffBy`/`On` and `SignOffNotes`. Pushing the planner's version over a
live row would overwrite attested work with a flag. That is strictly worse than
the reason the nightly sync was descoped on 2026-09-05, so the descope stands.

**Tested offline, no credentials needed:** `fixtures/planner/roundtrip.js` runs
the real HTML in jsdom and pins 16 behaviours, including that a local-only pool
survives an import, that re-importing does not duplicate pools, that signed work
does not move under Auto-Schedule, and that a plain backup file is rejected.

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
  unassigned work. **Renders 0 rows, and the reason recorded here twice before was wrong both
  times.** It is not "the seed always sets a crew", and it is not simply that those rows lack a
  Trade. The CAML is `(Crew IsNull OR Crew='' OR Crew='unassigned') AND Trade IsNotNull`
  (`provision-views.js:149`), and the 11 field-supervision sub-phases it exists to find carry the
  pseudo-trade `@unassigned`, which `gen-template-seed.py` resolves to **no `Trade` lookup at all**
  (`PSEUDO` sets `trade_code = None`). So the `IsNotNull Trade` clause excludes precisely the rows
  the view was built for. The browser planner flags all 11; this view shows zero. Whether the Trade
  clause should be there at all is part of Don's trade-mapping decision, not a typo to fix.
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

**REHEARSED 2026-09-08b.** A `DRY_RUN` pass against the live tenant reported it would remove 282
Tasks, 43 Assignments and 3 Jobs (`D2-1001`, `TEST-9001`, `TEST-9002`), making 328 no-op delete
calls with 0 failures, and would leave `assignments [], tasks 0, jobs []` — the documented gate end
state exactly. Live counts were unchanged afterwards (43/282/3), confirming nothing was written.
Every Assignment and every Task matched, so the two-way matching (Title prefix plus parent Job
lookup) has no survivors on current data.

The request-list **delete** and **review** paths still cannot be exercised against real rows,
because both lists are empty and the only way to populate them is to create rows that trigger
`D2 - New Pool` or `D2 - Delete Pool`. The classification predicate that drives them **was** tested
directly against synthetic rows, which is the part with teeth, since it decides whether a PM's real
request history survives. All twelve cases behave, and they fail safe in one direction:

| Job number | Deleted? |
|---|---|
| `TEST-9001`, `TEST-91xx` | yes |
| `D2-1001` (with `DROP_DEMO_JOB`) | yes |
| `D2-1042`, a real pool | **no** |
| `''`, `null`, field absent | **no** |
| `test-9001` lowercase, `' TEST-9001'` leading space, `TESTING-1` | **no** |

Every ambiguous input lands on "keep and report". A real pool is never deleted by accident; the
worst case is our own litter surviving into the review table, which is visible rather than silent.
Note the consequence: test rows with odd casing are NOT auto-removed.

**`cleanup.js` was extended 2026-09-05 and now removes the Harrison demo job too.** `D2-1001` is no more real than `TEST-900x` — it is the browser prototype's hardcoded demo job and Assignments 1-5 hang off it, so leaving it means going live with demo data in a client tenant. Deleting it also disposes of three separately-tracked defects for free: Assignment 1's stale `"Chrome-driven test"` sign-off, Assignment 4's Sunday start, and the D2 Bot placeholder in `Jobs.ProjectManager`. **Do not spend effort fixing those three; they are being deleted.**

Two behaviours worth knowing:
- **It now deletes `Tasks` first.** The original version never touched Tasks, which would have orphaned Harrison's 30 rows. The `TEST-900x` rows have no Tasks, so this only matters for the demo job.
- **`DROP_DEMO_JOB` is a flag at the top.** Set it `false` to clear only `TEST-` rows and keep Harrison alive while the canvas app is being built against it. Set `true` (the default) for the pre-pilot gate, whose expected end state is an empty tenant: `assignments []`, `jobs []`, `tasks 0`.

**Stop Flow 3 (and Flow 4) before any bulk write to Assignments.** Every insert or edit fires Flow 3 — see the trigger-condition bug above. 38 inserts would otherwise burn 38 runs.

Rendered previews of what the summaries produced against this data: `flows/testdata/daily-summary-preview.html`, `flows/testdata/weekly-summary-preview.html`.

**Flow 5 is HTML email, not PDF — decided 2026-09-03.** The runbook specified Create file -> Convert file -> attach. Investigation showed the only non-premium conversion is **OneDrive for Business `ConvertFile`**; SharePoint has no convert action, and PDF4me / Encodian are third-party premium connectors that would breach the zero-incremental-licensing constraint. No OneDrive connection exists in D2 Automation, so PDF would have cost a new connection plus an interactive sign-in.

Shane's call: send a rich HTML body instead. Same content, zero new connections, no temp-file lifecycle, readable on a phone without opening an attachment. If Don later wants an attachment, the PDF path is four extra actions on top of what exists.

**THE MORNING RUN ORDER MOVED EARLIER, 2026-09-11c. Shane: the crews are up around 05:00, so
everything has to have landed before then.**

| Central | Flow | Was |
|---|---|---|
| **03:30** | `D2 - Counter Reconciliation` | 05:30 |
| **04:00** | `D2 — Daily Dispatch + Reminders` | 06:00 |
| **04:30** | `D2 - Daily Summary` | 06:30 |

**Counter Reconciliation had to move too, and that is the part worth remembering.** It repairs
`TasksTotal`/`TasksComplete`, and the Daily Summary reads `TasksComplete` (verified in the
definition, not assumed), so it has to stay ahead of the summary or the compliance figures are
computed from unrepaired counters. That ordering was already deliberate at 05:30/06:30 and would
have been silently broken by moving only the summary. **If either is ever rescheduled again, move
both.**

Deliberately NOT moved: `D2 - Conflict Flag` (05:00) and `D2 - Crew Trade Check` (05:15) now run
*after* the morning emails. Neither summary reads `ConflictWith` or `TradeMismatch` (checked), so
nothing depends on the old order; their flags are read from the views during the day.

**Built as two flows** (schedules in **Central**, correcting the runbook's Pacific):

| Flow | Schedule | Window |
|---|---|---|
| `D2 - Daily Summary` | **04:30**, **Mon-Sat** (no Sunday - not a work day) | today, plus 7-day trailing compliance |
| `D2 - Weekly Summary` | Friday 15:00 | Mon-Sat of the current week |

Both render: active job count, a table of scheduled sub-phases (Job / Sub-phase / Crew / Dates / Tasks), and sign-off compliance as `signed / finished (pct)` with the oldest outstanding item named.

Two implementation details worth keeping:
- **Percent must multiply before dividing.** PA's `div` truncates on integers, so `div(mul(signed,100), total)` — the naive `mul(div(signed,total),100)` always renders 0%. Guarded for `total = 0`.
- **Crew is displayed by `Crews.Title`, joined on `CrewID`.** A per-row `Filter_crew` inside the loop resolves the short code to the friendly name, so ownership sees `Devon Crew +3`, not `devon`. Same join rule as everywhere else.
- Week boundaries: `weekStart = today + (1 - dayOfWeek(today))` -> Monday, `weekEnd = weekStart + 5` -> Saturday. Verified from a Thursday run producing 2026-08-31..2026-09-05.

**BOTH SUMMARIES NOW GO TO THE REAL AUDIENCE. Changed 2026-09-11c on Shane's call.**
`emailMessage/To` on each `Send_summary` is now
`stratirus@d2pools.com;david@d2pools.com;don@d2pools.com;cody@d2pools.com;emon@d2pools.com`.
Stratirus stays on the list deliberately, so a broken summary is seen by us at the same time as by
the client. The previous instruction here, to keep them internal until the content had been reviewed
on a real cadence, is satisfied: the content was reviewed 2026-09-05, three defects were fixed, the
palette was corrected 2026-09-10, and the `TEST-900x` rows that made the figures meaningless were
deleted 2026-09-10.

Edited with FlowAgent `edit_flow` using **`merge` on `actions/Send_summary/inputs/parameters`**,
which is the right shape here for two reasons worth remembering. The parameter key is literally
`emailMessage/To`, so it **contains the `/` that `edit_flow` uses as a path separator** and cannot
be addressed as a path at all. And `merge` leaves `Subject`, `Body` and `Importance` untouched, so
the 2,700-character HTML body never has to be retyped. Verified on the published row after
`PublishXml`: `To` correct on both, all four parameter keys intact, `Body` still the 26-character
`@{outputs('Compose_body')}` reference with `Compose_body` holding the full navy/green HTML.

**RESOLVED 2026-09-05 — the weekly compliance percentage was measuring work that had not happened yet.** Found by reviewing the rendered previews rather than the run status; both flows had been green since they were built.

`Get_week_finished` filtered `ScheduledFinish ge weekStart and ScheduledFinish le weekEnd`. The flow runs **Friday 15:00** but `weekEnd` is **Saturday**, so every sub-phase finishing Friday evening or Saturday was counted as an unsigned outstanding item. The 2026-09-03 preview named `D2-1001 · 2.2 Steel Installation` as the oldest outstanding while it was still two days from finishing.

The effect was a permanently depressed number that would have been the first thing Don ever saw from this system. Fixed to `ScheduledFinish lt <today>`, matching the daily flow, which had it right from the start. Same data now reports **33%** where it previously reported **22%**, and "Finished this week: 9" became "Finished so far this week: 6".

**Known limitation, accepted:** with `lt today` on a Friday run, work finishing Friday or Saturday never appears in *any* weekly compliance figure. The daily's 7-day trailing window still catches it, so nothing goes unmeasured overall. If that gap matters later, the clean fix is to score compliance over the **previous** completed Mon–Sat while keeping the schedule table on the current week, rather than moving the run later.

Two more defects fixed in the same pass:

- **Neither flow set `$orderby`,** so both tables came out in list-ID order. The weekly jumped 09-05, 09-03, 08-29, 09-01 *within a single job*. Now `$orderby=ScheduledStart asc` on `Get_today_assignments` and `Get_week_assignments`. Safe because `ScheduledStart` is a real column — unlike the `Crew/Title` path that failed in Phase B, which was never valid at all.
- **The daily footer overstated its own window by a day** — it printed `lookback … today` while the filter is `lt today`. Now prints the true end date.

Cosmetics in the same pass: dates render as `Wed 09/02 to Sat 09/05` instead of ISO (matching Flow 1's dispatch), guarded with `if(empty(coalesce(x,'')),'',formatDateTime(x,'ddd MM/dd'))` so a null date cannot fail the run; and a `&#183;` separator after the title.

Both verified by manual runs on 2026-09-05 with the rendered HTML pulled back from the run and committed to `flows/testdata/`.

**REPAINTED into the D2 palette 2026-09-10, and the colours live in TWO actions, not one.** Both
summaries were teal `#0b6e78` throughout, a colour that appears nowhere else in this system, while
the site theme, the list-view cards and the canvas app already shared the measured navy/green. The
summaries were the last surface without it. Now: headings `#082544` navy, links and the
healthy-compliance figure `#0b594b` green, table header row `#f6f3ed` cream. Rust `#a84a18` stays
as the warning signal. The invalid `<p>@{outputs('Compose_body')}</p>` wrapper in `Send_summary`
was removed in the same pass — a `<p>` cannot contain a `<div>`, so every renderer silently closed
it early.

**The trap worth remembering: `Compose_body` is not the only place colours live.** Each table
row's sub-phase deep link is built by **`Append_row` inside the `For_each_today` /
`For_each_week` loop**, which carries its own `style="color:..."`. Repainting `Compose_body` alone
left every row link teal, and **the flow definition read clean while the emails did not**. It was
caught only by re-running both flows, pulling the sent bodies from `Send_summary`'s `inputsLink`,
and counting hex codes. Verify a mail change by reading the sent body, never the definition.

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

Artifacts from the failed REST attempt live under `flows/scripts/` (Import-Flow.ps1, Patch-Flow.ps1, Publish-Flow.ps1) — keep as archaeology for what NOT to try. The definition JSON authoring itself validated (correct expressions, connection refs, list GUIDs) — it's the delivery mechanism that was wrong.

**`flows/definitions/` is HISTORICAL, not a restore source. Found 2026-09-09 in the final
whole-branch review.** Five of the `*.json` files there are flows this branch touched, and all
five are stale snapshots missing every action the branch added. `D2-Event-Driven-Reconciliation.json`
is missing the most: its own `Get_versions`, `Condition_scheduling_changed`, `Get_touched_meta`,
`Skip_suppressed_row`, `Get_touched_job` and `Skip_non_active_job` from the version-history gate,
**and** the `Planned`-suppression `Get_active_jobs` / `Select_active_job_ids` /
`Compose_active_job_clause` idiom added to `Get_overlapping` the same day this entry was written.
`D2-Nightly-Reconciliation.json`, `D2-Daily-Summary.json`, `D2-Weekly-Summary.json` and
`D2-Daily-Dispatch-crewfilter-fix.json` each lack that same `Planned`-suppression idiom. Meanwhile
`D2-Reschedule-Pool.json` in the same folder **was**
kept current as of this session's start, which is what made the folder look trustworthy as a
whole: one fresh file sitting next to five stale ones with no marker distinguishing them.
Importing the Flow 3 file today would have silently deleted the `Planned`-suppression gate and
the version-history gate together. **This is the same class of defect as `D2 - New Pool`'s stale
export**, recorded earlier in this file under the pre-pilot reality audit (search "pre-hardening
snapshot"): a committed artifact quietly falling behind the live flow with nothing to flag it,
except that time it was `flows/exports/` and a content re-check caught it same-day; this time it
was `flows/definitions/` and nothing was re-checking it at all.

**Do not reuse `flows/definitions/*.json` verbatim, and do not regenerate them either.**
`flows/exports/` is already the content-verified artifact (see "Compare exports by content,
never by date" in the pre-pilot audit above), and maintaining two authored-flow-body folders in
parallel is a second thing to keep in sync, which is exactly how this happened. **To restore or
inspect a flow's real definition, read the newest `flows/exports/<Flow-Name>-*.json` and verify
it against a fresh `get_flow`, never `flows/definitions/`.** The folder is kept for archaeology
of the original authoring approach, not as a source of truth for any flow's current shape.

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

**Companion tools — CORRECTED 2026-09-11. This section described two directories
that have never existed in this git history, and the correction matters because
both were described as work already done.**

What it used to claim: a `patched-tool/pool-scheduler.html` carrying the
Auto-Schedule determinism fix, with `patched-tool/README.md` and
`patched-tool/determinism-fix.diff` beside it, and a `seed-data/*.csv` set. None
of the three files existed, `git log --diff-filter=D` shows they were never
deleted either, and the `Subcontractor-Crew-Patch.md` diff had never been applied
to anything. So the single committed copy of the planner carried **neither**
patch, while this file told every session it carried both.

Current, verified state:

- **The browser planner moved to `web/index.html` on 2026-09-11**, via `git mv`,
  as the first step of Phase H repo layout (`web/staticwebapp.config.json` sits
  beside it). It was `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`
  — note the doubled directory name; a path with one `D2-Build-Scheduler` never
  resolved, and appeared in this file twice. **That directory no longer holds the
  planner** — the `app/` subdirectory is now empty — so a future session should
  not go looking for it there; `web/index.html` is the only copy.
- **Both patches were applied to it on 2026-09-11.** Determinism: seed the load
  table from LOCKED assignments only (`crewLoad()` counts every assignment, so
  run 2 inherited run 1's tiebreaks) plus `|| a.id.localeCompare(b.id)` as a
  stable secondary sort key. Subcontractors: `unlimited:true` on george, armondo,
  stl and brothers. Measured with `fixtures/planner/determinism.js`: **4 of 138
  crew picks drifted per re-run before, 0 after.**
- **`oracle-test.js` could not run at all.** It required jsdom from
  `/tmp/node_modules` and read the planner from `/sessions/sweet-great-mayer/...`,
  a build sandbox. Repaired to resolve inside the repo. It also now seeds two
  pools itself, because the planner no longer ships demo pools and most of its
  invariants otherwise pass **vacuously** over zero assignments. Scores on the
  same harness: **committed file 13/16 with idempotency FAILING, patched file
  14/16.** 14/16 is what this file always claimed for the phantom `patched-tool/`.
  The two remaining fails are the documented data gaps (no work calendar in the
  browser tool; Don's 10 unmapped trades).
- **The seed CSVs are real but live elsewhere:**
  `D2-Build-Scheduler/D2-Build-Scheduler/data/*.csv` (trades, crews,
  crew-members, crew-trades, phase-template, sub-phase-template, task-template).
- `Subcontractor-Crew-Patch.md` is kept as the record of why those four crews are
  capacity-exempt. Its diff is now applied.

**Lesson, and it is the same one this file already teaches about flow exports:** a
committed artifact can drift from its description with nothing flagging it. There
it was `flows/exports/` and `flows/definitions/`; here it was an entire directory
that was only ever described. Check the artifact, not the memory of it.

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
