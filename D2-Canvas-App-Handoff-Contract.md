# D2 Build Scheduler — canvas app build contract

> **SUPERSEDED AS A HANDOFF, 2026-09-05.** The canvas app is staying with Stratirus; Ryan is
> not picking it up. Everything below still stands as **internal build guidance** — the
> invariants, the schema traps and the §6a production-safety rules are all properties of the
> environment, not of who is holding the keyboard. §6a in particular still binds, because the
> app is still being built in a live client tenant on a shared credential. Read "you" as
> "whoever is building this", not as Ryan.

**Originally for:** Ryan Meyer, picking up the Phase C canvas app build
**From:** Shane Talbot / Stratirus
**Date:** 2026-09-04 (reversed 2026-09-05)
**Status of the rest of the build:** Phases A–B complete. All 7 SharePoint lists provisioned and
seeded; all 5 Power Automate flows built, published and verified end-to-end.

This document is the set of invariants the app must honour. It is deliberately short and
prescriptive. `D2-Phase-C-Field-App-Spec.md` has the screen-by-screen build steps; **this file
wins wherever the two disagree**, because the spec was written before Phases A–B surfaced the
defects below.

---

## 0. Read this first — three bugs already found in production

All three shipped in flows, were diagnosed against live data, and are fixed there. The Phase C
spec still contains the first two. Do not reproduce them.

### 0.1 `Crew` is a Text column, not a Lookup or Choice

`Assignments.Crew` is plain **Text**. Any `.Value` accessor against it is wrong.

In Power Automate this threw rather than returning null:

```
InvalidTemplate: property 'Value' cannot be selected.
Property selection is not supported on values of type 'String'.
```

The Phase C spec's `App.OnStart` currently reads `Crew.Value = ...`. **That is wrong twice over
— see 0.2 for the second half.**

Note the nuance: `Tasks.Assignment` **is** a genuine Lookup, so `Assignment.Value` on the Tasks
list is correct. This is not a global find-and-replace.

### 0.2 The crew join key is `CrewID`, never `Title`

Three different value spaces are in play:

| | Devon |
|---|---|
| `Crews.CrewID` | `devon` |
| `Crews.Title` | `Devon Crew +3` |
| `Assignments.Crew` | `devon` |

`CrewID` is the join key. `Title` is a **display label** carrying a `+N` headcount suffix
(headcount also lives in the separate `Size` column). The browser tool — which is the authority
— models crews as `{id:'devon', name:'Devon Crew +3'}`.

This was masked for crews whose Title has no suffix: `STL Shotcrete` matched by luck while all
seven `+N` field crews never could. **A passing subcontractor case does not prove the join
works.**

So the corrected `OnStart` filter is:

```powerfx
Filter(
    'Sub-phase Assignments',
    Crew = gblCurrentCrew.CrewID        // NOT Crew.Value, NOT .Title
      && ...
)
```

Use `Title` only for display.

### 0.3 DateOnly columns must be written as bare `'yyyy-MM-dd'`

Site regional timezone is **(UTC−06:00) Central**. All date columns
(`ScheduledStart`, `ScheduledFinish`, `WorkDate`, `Jobs.StartDate`, `Work Calendar.Date`) are
already DateOnly. What matters is the wall-clock time a value is stored at:

| Stored | Read back as | |
|---|---|---|
| `2026-09-02T00:00:00Z` (midnight **UTC**) | `2026-09-01` | **wrong, one day early** |
| `2026-09-05T05:00:00Z` (midnight **Central**) | `2026-09-05` | correct |

Phase A seeding wrote midnight UTC and every date in the system was a day early — which silently
**inverted the work week**, since Flow 1 checks Work Calendar for non-work days. It would have
terminated on Saturdays and dispatched on Sundays. Fixed 2026-09-03.

**Never send an explicit `...T00:00:00Z`.** Write a bare date string; SharePoint interprets it
in site-local time. Watch this closely on the `WorkDate` picker, which is user-set.

---

## 1. Identity — resolve on UPN, not mail

```powerfx
Set(gblCurrentUser, Office365Users.MyProfileV2());
Set(gblCurrentCrew,
    LookUp(Crews, LeadEmail = gblCurrentUser.userPrincipalName)   // NOT .mail
);
```

`mail` is unreliable in this tenant: blank on unlicensed accounts, and divergent even on the
service account (D2 Bot's UPN is `stratirus@d2pools.com`, its `mail` is `d2bot@d2pools.com`).
`userPrincipalName` is always present and is the actual sign-in identity.

`Crews.LeadEmail` will be seeded with **UPNs** to match.

> **Currently `Crews.LeadEmail` is empty on all 14 rows.** Until it is populated,
> `gblCurrentCrew` is blank for everyone. Seed your own dev-tenant Crews rows with your own UPN
> so `OnStart` resolves while you build.

---

## 2. PM proxy sign-off is mandatory — build the picker from day one

**This is the most important design requirement in this document, and it is not in the
existing spec.**

Four subcontractor crews — George, Armondo, STL Shotcrete, Brothers — are modelled as
`Unlimited = Yes` and have **no M365 seat by design**. They can never sign off for themselves.
Someone in the office must do it on their behalf.

Therefore the app cannot assume *signed-in user == the crew doing the work*. It needs:

- **Self mode** — crew lead signs in, app resolves their own crew, signs off their own work.
- **Proxy mode** — an office/PM user picks a crew (and its assignment for the date), then signs
  off on that crew's behalf.

Design notes:

- Gate proxy mode on membership of a `D2 PM` group, or on the user resolving to no crew row.
  Do not expose crew-picking to crew leads — it invites signing off someone else's work.
- **Record the proxy honestly.** `InstallerSignOffBy` must capture *who actually clicked*, and
  the note or a dedicated field should record that it was entered on behalf of crew X. Do not
  write the crew lead's identity into a sign-off they did not perform — the audit trail is the
  reason this system exists.

This also has a commercial consequence worth knowing: because proxy sign-off must exist anyway,
D2 can go live licensing nobody new and add crew-lead seats later **with no rebuild**. Build it
so that remains true.

---

## 3. Writes — use the Sign-off Intake flow, do not Patch Assignments

`Sub-phase Assignments` has **four Required columns** (`Locked`, `NotApplicable`, `PMSignOff`,
`DurationDays`). Phase A seeded them NULL via REST, which bypasses required-field validation —
the SharePoint form and the Power Apps connector do not. A `Patch()` against an Assignment will
fight this.

- **Sign-off goes through Flow 2, `D2 — Sign-off Intake`** (PowerApps V2 trigger), which does a
  SharePoint `MERGE` and only touches the fields named in the body. Call signature:

  ```
  { AssignmentID, WorkDate, Notes, TasksTotal, TasksComplete }
  ```

  The flow writes `InstallerSignOff`, `...By`, `...On`, `WorkDate`, `Notes` and the task counts.

- **Task ticks** may `Patch()` the `Sub-phase Tasks` list directly — that list has no
  required-but-null problem.

- Any **newly created** Assignment must set all four required columns at creation.

---

## 4. Connector constraints — non-negotiable

The whole commercial case for this build is that it runs on D2's existing M365 with **no
premium connectors and no Dataverse**.

**Allowed:** SharePoint · Office 365 Users · Power Automate (to call Flow 2).
**Not allowed:** anything premium, Dataverse, custom connectors, on-prem gateway.

This is a live trap when building in a Developer Plan environment, where premium connectors are
available and will work fine for you — and then cannot be licensed when the app comes home.
If you find yourself needing one, stop and raise it rather than designing around it.

---

## 5. Business rules the app must not violate

1. A crew is only assigned to a sub-phase whose required trade it holds (via the Crew-Trades
   intersect list).
2. A field crew is never on two pools the same day. `Unlimited = Yes` crews are **exempt** —
   they never consume capacity and cannot be double-booked.
3. Sub-phases run in order; one cannot start before the previous ends.
4. **Mon–Sat are work days. Sunday is not.** Extended by `Work Calendar` rows (holidays,
   weather days, per-crew shutdowns).

The app is a sign-off surface, not a scheduler — it should never *create* or *reschedule*
assignments. Rules 1–3 are enforced upstream. Rule 4 matters to the app only insofar as
`WorkDate` should not silently default to a non-work day.

---

## 6. Environment and delivery

**DECIDED 2026-09-04 — build directly in D2, no port.**

| | |
|---|---|
| Tenant | D2 Pools (`netorgft15040037`) |
| Power Platform environment | **D2 Automation** |
| SharePoint site | `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler` |
| Account | **D2 Bot** — UPN `stratirus@d2pools.com` (note: `mail` is `d2bot@d2pools.com`) |
| Licence | Business Standard, which carries Power Apps for M365 seeded rights |

This removes the whole cross-tenant exercise. **You do not need** the mirror script, a stub
Sign-off Intake flow, or an import/re-point pass. You build against the real lists and call the
real, already-verified Flow 2.

`canvas-app/mirror-provision.js` is retained as the authoritative live-schema capture and for
any future dev environment — it is **not** needed for this build.

**Deliverables back:**

- The app, plus `pac canvas unpack` YAML committed alongside the `.msapp` — so the work is
  reviewable and diffable rather than an opaque binary.
- Notes on anything you had to work around.

---

## 6a. You are working in the client's PRODUCTION tenant — read this

This is live. D2's real flows are running against these lists right now. Five rules:

**1. There is no real job data in D2 yet — test freely, but delete nothing.**

`Harrison Residence` / `D2-1001` is **not a real pool.** It is the demo job hardcoded in your
own browser prototype (`pool-scheduler.html`, `newJob('Harrison Residence','1420 Camino Real','Thousand Oaks','CA','91360')`),
carried into SharePoint verbatim during Phase A seeding. Assignments 1–5 hang off it.

So production currently holds only demo data (`D2-1001`, 5 assignments, 30 tasks) and test data
(`TEST-9001`/`TEST-9002`, 38 assignments, ids 6–43). **Both are fair game to test against** —
the `TEST-900x` rows are the better choice simply because there are more of them and they were
generated at realistic volume from the real 46 sub-phase template.

**Delete nothing, though.** The TEST rows are scheduled for removal just before the Phase E
pilot and that is tracked separately; the demo rows are what several flows have been verified
against. If you need a clean row, add one rather than repurposing an existing one — and set all
four required columns (`Locked`, `NotApplicable`, `PMSignOff`, `DurationDays`) at creation or
the list form will refuse later edits to it.

The first *real* pool arrives in Phase E.

**2. Stop Flows 3 and 4 before any bulk write to Assignments.** Flow 3's trigger condition is a
proven no-op — the SharePoint `GetOnUpdatedItems` trigger emits no `@odata.oldValue`, so
**every edit to any Assignments row fires it**, including sign-off writes. It only reads and
emails, so there is no corruption risk and no loop — but a testing session that touches 40 rows
burns 40 flow runs against D2's quota. Restart them when you are done.

**3. Calling Flow 2 writes real sign-off data.** It is live and published. Every `.Run()`
during testing stamps `InstallerSignOff`, `...By`, `...On` and `WorkDate` onto a real
Assignments row. Point it at TEST rows only, and expect to clean up after yourself.

**4. Everything you do logs as D2 Bot.** The account is shared with Shane, so there is no
individual attribution — sign-off records created during testing will show "D2 Bot" as the
signer, and so will any accidental edit. Be correspondingly careful, and tell Shane what you
changed rather than assuming the audit log will show it.

**5. Do not modify the five published flows.** If a flow needs changing to support the app,
raise it — do not edit in the designer. Flow definitions are version-controlled in
`flows/definitions/`, published via a specific FlowAgent + `PublishXml` sequence, and a designer
save can promote a draft nobody intended to ship.

One more, for `Crews.LeadEmail`: it currently holds `stalbot@stratirus.com` on all seven field
crews — placeholder data, and an external UPN that resolves for nobody in D2. To make `OnStart`
resolve while you build, set **one** crew's `LeadEmail` to `stratirus@d2pools.com` (D2 Bot's
UPN, since that is what you will be signed in as) and leave the rest. Tell Shane which row you
changed — the real per-crew UPNs are a tracked work item.

---

## 7. Exit gate

From the Phase C runbook, unchanged:

> A crew lead ticks 6 tasks and signs off from a phone in **under 60 seconds**; the work date
> defaults correctly to today and is overridable.

Plus one addition from §2:

> A PM can select a subcontractor crew, sign off on its behalf, and the resulting record
> correctly identifies the PM as the signer.

---

## 7a. Three more defects — CONFIRMED against live production schema 2026-09-04

All three were verified by reading the live lists, not inferred. All three are in the Phase C
spec. The first two are now corrected in that file; the third is corrected in the formula but
worth understanding.

### The list names are wrong throughout the spec

The lists are called **`Assignments`** and **`Tasks`**. The spec referenced
`'Sub-phase Assignments'` and `'Sub-phase Tasks'` in **11 places**. Power Apps names a
SharePoint data source by its list Title, so every one of those would have failed to bind.
Corrected.

### `Jobs` has no `State` and no `ZIP` column

Live `Jobs` schema is exactly: `Title`, `JobNumber`, `Address`, `City`, `StartDate`, `Status`,
`ProjectManager`. The spec's `lbl_JobAddress` formula references `State` and `ZIP`.
**Do not add those columns to make the formula work — fix the formula.**

### `Job.Value` returns the Title, not the JobNumber — confirmed

`Assignments.Job` is a Lookup into `Jobs` with `ShowField='Title'`. Live data:

| Jobs.Title | Jobs.JobNumber |
|---|---|
| `Harrison Residence` | `D2-1001` |

So `Job.Value` yields `Harrison Residence`, and the spec's
`LookUp(Jobs, JobNumber = gblTodayAssignment.Job.Value, …)` compares that against `D2-1001` —
**always blank**. Same defect class as the CrewID bug: joining on a display label instead of a
key. Either match on `Title = ...Job.Value`, or resolve via the lookup ID.

**The general rule, and it now has three instances:** in this data model `Title` is *always* a
display label. **Never join on it.** If a formula compares anything against a Title, treat it
as a bug until proven otherwise.

---

## 7b. `Crews` — read this before seeding LeadEmail

Live `Crews` data as of 2026-09-04 differs from what CLAUDE.md previously recorded.

**`LeadEmail` is not empty — it is worse than empty.** All seven real field crews carry the
same value, `stalbot@stratirus.com`:

- It is an **external UPN** that does not exist in the D2 tenant, so no D2 user will ever match it.
- All seven share it, so `LookUp` returns only the **first** match (`saul`). Even signed in as
  that identity you would never resolve `devon`, `antonio`, or any of the others.

Treat it as placeholder test data. Real values must be per-crew D2 UPNs.

**There are 7 real field crews, not ~10.** The `Crews` list has 14 rows, but 7 are
`Unlimited = Yes` buckets that never sign off and never consume capacity:

| Real field crews (7) | Unlimited buckets (7) |
|---|---|
| `saul`, `guillermo`, `harrison`, `antonio`, `devon`, `cirilo`, `campos` | `stl`, `george`, `armondo`, `brothers`, `subcon`, `unassigned`, `office` |

Note `subcon`, `unassigned` and `office` are pseudo-crews, not companies. Your proxy picker
should probably not offer `unassigned` or `office` as sign-off targets.

---

## 8. Known-good reference

- `CLAUDE.md` — durable project orientation; the Known bugs section carries the full history of
  every defect summarised above, with the run IDs and evidence.
- `D2-Phase-B-Automations-Runbook.md` — how the five flows fit together.
- `flows/definitions/` — the live flow definitions, including Sign-off Intake.

If something here contradicts your memory of the original Rev C/D design, trust this document.
Rev D was written before the build, and the build found things.
