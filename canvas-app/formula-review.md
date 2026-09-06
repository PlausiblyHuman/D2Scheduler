# Week 3 spec — Power Fx review against live schema and published flows

Reviewed 2026-09-06 against the live SharePoint schema, the published Flow 2 definition
(`flows/exports/D2-Sign-off-Intake-2026-09-05.json`), and the data actually in the tenant.

Two findings are not formula bugs — they are gaps in the design. Fix those first; the rest
are mechanical.

---

## 1. BLOCKING — there is no PM-proxy path, and without one the app is empty for everyone

The spec's `App.OnStart` does:

```powerfx
Set(gblCurrentCrew, LookUp(Crews, LeadEmail = gblCurrentUser.userPrincipalName));
Set(gblTodayAssignment, First(Filter(Assignments, Crew = gblCurrentCrew.CrewID && ...)));
```

`Crews.LeadEmail` is **empty on all 14 rows** (cleared 2026-09-06, deliberately — the previous
values were an unmatchable external UPN that made the app show every crew lead Saul's work).
So `gblCurrentCrew` is Blank, `gblCurrentCrew.CrewID` is Blank, and the filter matches nothing.
**Every user, including the PM, sees an empty app.**

This is not a temporary data problem to wait out. CLAUDE.md establishes that PM-proxy sign-off
is **mandatory regardless of the licensing path**, because the four `Unlimited = Yes`
subcontractor crews (George, Armondo, STL, Brothers) have no M365 seat by design and can never
sign off for themselves. Someone in the office must sign off on their behalf, permanently.

The spec has no crew picker and no assignment picker. Retrofitting one later is a screen-flow
rewrite, which is exactly what CLAUDE.md warns against.

**Required change:** `scr_Today` needs a fallback path when `gblCurrentCrew` is Blank —
a crew picker, then an assignment picker for that crew and date. Sketch:

```powerfx
// OnStart
Set(gblCurrentUser, Office365Users.MyProfileV2());
Set(gblCurrentCrew, LookUp(Crews, LeadEmail = gblCurrentUser.userPrincipalName));
Set(gblIsProxy, IsBlank(gblCurrentCrew));
Set(gblToday, Today());
```

`gblIsProxy` drives the UI: crew leads get their own assignment directly, office users get the
picker. Since `LeadEmail` is empty today, **everyone is a proxy**, which means the proxy path
gets exercised from day one rather than being the untested branch.

When proxy sign-off is used, the record must say so — see finding 2, which makes that
currently impossible.

---

## 2. BLOCKING — Flow 2 never writes `InstallerSignOffBy`, so every sign-off is anonymous

CLAUDE.md's staging contract says: *"Flow writes InstallerSignOff = true, By, On, WorkDate,
Notes, task counts onto the Assignment."* The published flow does not write `By`. Its MERGE
body is exactly:

```json
{"__metadata":{"type":"SP.Data.AssignmentsListItem"},
 "InstallerSignOff":true,
 "InstallerSignOffOn":"@{utcNow()}",
 "WorkDate":"@{triggerBody()?['date']}",
 "SignOffNotes":"@{triggerBody()?['text']}",
 "TasksTotal":@{triggerBody()?['number_1']},
 "TasksComplete":@{triggerBody()?['number_2']}}
```

`InstallerSignOffBy` exists in the schema as a `User` column and is never populated. The flow
tested green because it correctly writes the fields it writes.

This matters more than a missing column. The system exists to produce field attestation for
warranty and QC. Right now it records *that* a sign-off happened and *when*, but not *who* —
and the PM-proxy discussion is entirely about the difference between a crew lead's signature
and a PM's signature on someone else's work.

**Required change, in two parts:**

- **Trigger:** add a sixth parameter, `SignedByEmail` (text). The five existing params are all
  `required`, so adding one is additive and the app must send it.
- **Flow:** resolve the email to a SharePoint user id and MERGE `InstallerSignOffById`.
  A Person field cannot be set by email through REST — it needs the numeric site-user id,
  via `_api/web/siteusers/getByEmail('<upn>')` or `ensureuser`.

Send `gblCurrentUser.userPrincipalName`, **not** `.mail` — `mail` is unreliable in this tenant
and diverges even on the service account (D2 Bot's UPN is `stratirus@d2pools.com`, its mail is
`d2bot@d2pools.com`).

Until this lands, consider recording proxy sign-offs in `SignOffNotes` as a stopgap so the
pilot does not produce an unattributable audit trail.

---

## 3. WILL FAIL — `Confirm()` is not a Power Fx function

The spec's sign-off button uses:

```powerfx
If(CountRows(Filter(gblTasks, !Complete)) > 0
     && !Confirm("You have unticked tasks. Sign off anyway?", "Sign off?"), ...)
```

and notes *"`Confirm()` is a built-in Power Apps dialog primitive — no custom modal build
needed."* **There is no `Confirm()` in Power Fx.** Power Apps has `Notify()` but no blocking
confirmation dialog. This does not compile.

**Fix:** build the confirmation as a visible/hidden group — a semi-transparent rectangle, a
label, and Cancel / Confirm buttons — toggled by a context variable:

```powerfx
// btn_CompleteSignOff.OnSelect
If(CountRows(Filter(gblTasks, !Complete)) > 0,
   UpdateContext({locShowConfirm: true}),
   SubmitSignOff())          // or inline the submit below
```

The submit logic then lives on the confirm button and is called directly when all tasks are
ticked. Budget an extra control group on `scr_Tasks` for this; the spec's hour estimate for
Step 7 does not include it.

---

## 4. WILL FAIL — `CompletedBy` cannot be patched from an Office 365 profile

```powerfx
Patch(Tasks, ThisItem, { Complete: true, CompletedBy: gblCurrentUser, CompletedOn: Now() })
```

`gblCurrentUser` is `Office365Users.MyProfileV2()`, a Graph profile object. A SharePoint Person
column needs the connector's own shape:

```powerfx
Patch(Tasks, ThisItem,
  { Complete: true,
    CompletedOn: Now(),
    CompletedBy: {
      '@odata.type': "#Microsoft.Azure.Connectors.SharePoint.SPListExpandedUser",
      Claims: "i:0#.f|membership|" & Lower(gblCurrentUser.userPrincipalName),
      DisplayName: gblCurrentUser.displayName,
      Email: gblCurrentUser.userPrincipalName
    }})
```

Note `Claims` uses the **UPN**, consistent with finding 2 and with the join rule everywhere else.

---

## 5. WILL REGRESS A FIXED BUG — the WorkDate round-trip

The spec passes `dp_WorkDate.SelectedDate` straight into the flow, and the flow writes it
verbatim: `"WorkDate":"@{triggerBody()?['date']}"`.

Power Apps serialises a Date to a full ISO timestamp. SharePoint then stores midnight **UTC**,
which the connector reads back as the **previous day** in Central. That is precisely the defect
that made all 62 Work Calendar rows a day early and inverted the work week — Flow 1 would have
terminated on Saturdays and dispatched on Sundays.

**Fix, in the app:**

```powerfx
Text(dp_WorkDate.SelectedDate, "yyyy-mm-dd")
```

The established convention is a bare `yyyy-MM-dd` string, never `...T00:00:00Z`. Verify the
rendered value in a test run rather than trusting the format string — Power Fx `Text()` treats
`mm` as month only when no time part precedes it.

---

## 6. FRAGILE — joining on a display label, for the third time

```powerfx
Filter(Tasks, Assignment.Value = gblTodayAssignment.Title)
```

`Assignment` is a Lookup, so `.Value` returns its display column, not a key. This is the same
root cause as the `CrewID` bug (joined on `Crews.Title`) and the `Assignments.Job` bug (compared
`Job.Value` against `JobNumber`). In this data model **`Title` is always display, never a key.**

It happens to work today because assignment titles are unique, and it will keep working until
two sub-phases share a title. It is also **not delegable**, which matters for finding 7.

**Prefer** filtering on the lookup id. In the SharePoint connector the id is available as
`Assignment.Id`, so `Filter(Tasks, Assignment.Id = gblTodayAssignment.ID)` — confirm the exact
accessor once the data source is added, since it varies by connector version.

---

## 7. DELEGATION — 295 tasks per pool will breach the default limit

`Tasks` currently holds **282 rows** and the default delegation limit is **500** (max 2000).
One real pool is 295 tasks; two pools breach the default, four breach the maximum.

`Filter(Tasks, Assignment.Value = ...)` on a lookup's display value is not delegable, so Power
Apps pulls the first N rows and filters locally. Once `Tasks` exceeds the limit, **tasks will
silently go missing from the sign-off screen** — no error, just a short list. That is the worst
possible failure mode for an attestation app.

Raise the limit to 2000 (Settings → General → Data row limit) *and* make the filter delegable
via finding 6. Both, not either.

---

## 8. MINOR — the flow reference name will not resolve

The spec calls `'D2-SignoffIntake'.Run(...)`. The flow's display name is **`D2 - Sign-off
Intake`**. Power Apps derives the reference from the display name, so this exact identifier will
not exist. Take whatever name Studio inserts when the flow is added, and do not hand-type it.

Parameter order is confirmed correct against the live trigger schema:
`AssignmentID` (number), `WorkDate` (date string), `Notes` (text), `TasksTotal` (number),
`TasksComplete` (number) — **all five required**, so `Notes` must be sent even when empty.

## 9. MINOR — the failure branch is unreachable

```powerfx
If(gblIntakeResponse.status = "Success", ...success..., Notify("Sign-off failed", ...))
```

Flow 2's only response is a hardcoded `{"status":"Success"}` on the happy path. If an earlier
action fails, the flow fails and `.Run()` **throws** rather than returning a different status,
so the else-branch never executes and the user sees a generic Power Apps error.

Wrap the call in `IfError(...)` to catch that, or add a failure path in the flow that responds
with a non-Success status.

---

## Confirmed correct, no change needed

- `Crew = gblCurrentCrew.CrewID` — right join key. `Title` carries the `+N` headcount suffix and
  is display only.
- Flow 2 **does** return `{status: "Success"}` via a `Respond to a Power App or flow` action, so
  the success check itself is sound.
- `Locked`, `NotApplicable`, `PMSignOff`, `DurationDays` are populated on all 43 rows, so the
  Required-but-NULL problem will not block Patch.
- `Tasks` now has 282 rows covering all 43 assignments, so the task screen has real data.
