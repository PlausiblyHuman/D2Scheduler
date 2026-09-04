# D2 Week 3 build runbook — Power Apps canvas app

> ### ⚠ Read `D2-Canvas-App-Handoff-Contract.md` before building
>
> This spec was written **before** the Weeks 1–2 build, which found three production defects and
> one missing requirement. Corrections applied to this file on 2026-09-04:
>
> - `App.OnStart` — was `Crew.Value = gblCurrentCrew.Title`, which is wrong twice over.
>   `Assignments.Crew` is a **Text** column (so no `.Value`), and the join key is **`CrewID`**,
>   not `Title`. Now `Crew = gblCurrentCrew.CrewID`. Note `Assignment.Value` on the **Tasks**
>   list is still correct — that one genuinely is a Lookup.
> - Identity resolves on **`userPrincipalName`**, not `mail`. `mail` is blank on unlicensed
>   accounts and diverges even on the service account.
> - Data connections pointed at a placeholder site URL; corrected below.
> - **Not yet reflected in the day-by-day steps: PM proxy sign-off.** The four subcontractor
>   crews have no M365 seat by design and can never sign off for themselves, so a crew picker
>   and proxy mode are **mandatory**, not optional. See §2 of the handoff contract.
>
> The contract wins wherever it disagrees with this file.

**App name:** `D2 Sign-Off`
**Prereq:** Weeks 1–2 complete. All **7** SharePoint lists exist and populated. Sign-off Intake flow (Flow 2) is callable.
**Time budget:** ~28 hours. Bulk of it in Days 1–3 on the four screens; Days 4–5 on device testing + polish.
**Working account:** D2 tenant service account with Power Apps standard rights + Contribute on the lists.
**Runtime:** Power Apps Mobile app (iOS + Android) — crew leads install from App Store / Play Store, sign in with their D2 M365 account, pin the app.

Design goals up front:
- Every screen usable one-handed on a phone
- Big touch targets — assume gloved, wet, or dusty hands
- Minimum typing (WorkDate override is optional; notes are optional)
- Clear "you're done" confirmation
- Portrait-first, landscape acceptable
- No offline mode (David confirmed always-connected)

---

## Architecture — 4 screens

| Screen | Purpose | Key controls |
|---|---|---|
| `scr_Today` | Home. Shows today's sub-phase for the signed-in crew lead. Entry point to task-tick. | Header (crew name), Job/sub-phase card, "Sign Off Tasks" button, "Recent Sign-offs" strip |
| `scr_Tasks` | Task checklist for the current sub-phase. Tick each task; add optional notes; set WorkDate. | Task gallery (checkbox + label), WorkDate picker, Notes textarea, "Complete Sign-Off" button |
| `scr_Confirm` | Confirmation after sign-off submitted. Success/failure state + return to today. | Success icon, summary text, "Back to Today" button |
| `scr_NoAssignment` | Fallback when no assignment exists for today. | Message + "Check Again" button |

Plus one hidden screen `scr_ErrorPatterns` used for debugging during build. Delete before publish.

---

## Data connections

Add these under **Data** in the Power Apps studio left rail:

1. **SharePoint** connector — pointed at `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`
   - Add: `Assignments`, `Tasks`, `Crews`, `Jobs`
2. **Office 365 Users** connector — for resolving the signed-in user's identity
3. **D2 — Sign-off Intake** flow (from Week 2 Flow 2) — via **Power Automate** left rail → **Add flow**

---

## Day 1 — App shell + Today screen (~7 hrs)

### Step 1 — Create the app

1. Open `https://make.powerapps.com` signed in with the D2 service account
2. Environment picker (top-right) → select **D2 Automation** (NOT the default environment)
3. **Create** → **Blank app** → **Blank canvas app**
4. Name: `D2 Sign-Off`
5. Format: **Phone**
6. Create

### Step 2 — Add data connections

Left rail → **Data** → **Add data** →
- SharePoint → connect to the `D2BuildScheduler` site (URL above) → select the four lists above
- Office 365 Users → connect
- Power Automate → Add flow → `D2 — Sign-off Intake`

### Step 3 — App-level state (App.OnStart)

Set global variables on app start. Click **App** in the tree (top of Screens panel) → set `OnStart`:

```powerfx
Set(
    gblCurrentUser,
    Office365Users.MyProfileV2()
);
Set(
    gblCurrentCrew,
    LookUp(
        Crews,
        LeadEmail = gblCurrentUser.userPrincipalName
    )
);
Set(
    gblToday,
    Today()
);
Set(
    gblTodayAssignment,
    First(
        Filter(
            Assignments,
            Crew = gblCurrentCrew.CrewID
              && ScheduledStart <= gblToday
              && ScheduledFinish >= gblToday
              && NotApplicable = false
              && InstallerSignOff = false
        )
    )
);
Set(
    gblTasks,
    Filter(
        Tasks,
        Assignment.Value = gblTodayAssignment.Title
    )
);
```

Note: the `First()` returns a blank record if nothing matches, which we handle on the Today screen with an `IsBlank()` check.

Right-click **App** → **Run OnStart** to test the load. Verify `gblCurrentCrew` resolves to your test crew and `gblTodayAssignment` resolves to a real assignment (create a test assignment in SharePoint for today with your test user's crew if needed).

### Step 4 — Build scr_Today

**Screen properties:**
- Name: `scr_Today`
- Background: `RGBA(246, 247, 249, 1)` (matches browser tool's `--bg`)
- Fill: same

**Controls (top to bottom):**

**Header bar — `hdr_Screen`:**
- Type: Rectangle
- Height: 80
- Width: `Parent.Width`
- Fill: `RGBA(11, 34, 32, 1)` (D2 dark ink)
- Position: `X=0, Y=0`

**Header text — `lbl_HeaderCrew`:**
- Type: Label
- Text: `"D2 · " & gblCurrentCrew.Title`
- Color: White
- Font: `Font.'Segoe UI'`
- Size: 18
- Weight: Bold
- Position: centered inside `hdr_Screen`

**Date label — `lbl_HeaderDate`:**
- Type: Label
- Text: `Text(gblToday, "dddd, mmm d")`
- Color: `RGBA(200, 210, 220, 1)`
- Size: 12
- Position: under `lbl_HeaderCrew`

**Job card — `cnt_JobCard`:**
- Type: Container (Vertical)
- Fill: White
- BorderColor: `RGBA(229, 231, 235, 1)`
- BorderThickness: 1
- BorderRadius: 12
- Padding: 20
- Margin: 16 all sides
- Visible: `!IsBlank(gblTodayAssignment)`

Inside `cnt_JobCard`:

**`lbl_JobName`:**
- Text: `gblTodayAssignment.Job.Value`
- Font: Segoe UI, Size 22, Bold, Color: `RGBA(17, 24, 39, 1)`

**`lbl_JobAddress`:**
- Text: `LookUp(Jobs, JobNumber = gblTodayAssignment.Job.Value, Address & ", " & City & ", " & State & " " & ZIP)`
- Font: Segoe UI, Size 14, Color: `RGBA(107, 114, 128, 1)`

**`lbl_SubPhase`:**
- Text: `gblTodayAssignment.SubPhaseNumber & " · " & gblTodayAssignment.SubPhaseName`
- Font: Segoe UI, Size 18, Weight: SemiBold, Color: `RGBA(15, 118, 110, 1)` (D2 accent)
- Margin top: 12

**`lbl_TaskProgress`:**
- Text: `"Tasks: " & CountRows(Filter(gblTasks, Complete)) & " of " & CountRows(gblTasks) & " done"`
- Font: Segoe UI, Size 14, Color: `RGBA(107, 114, 128, 1)`

**Sign-off button — `btn_StartSignOff`:**
- Type: Button
- Text: `"Tick tasks & sign off →"`
- Fill: `RGBA(15, 118, 110, 1)`
- Color: White
- Height: 60 (big touch target)
- Width: `Parent.Width - 32`
- BorderRadius: 12
- Font size: 18
- OnSelect:
  ```powerfx
  Navigate(scr_Tasks, ScreenTransition.Cover)
  ```

**No-assignment fallback — `cnt_NoAssignment`:**
- Type: Container (Vertical)
- Visible: `IsBlank(gblTodayAssignment)`
- Position: centered in remaining space
- Contains: Label with text `"No sub-phase scheduled for you today. Check with your PM if this looks wrong."`, and a `btn_Refresh` that runs `Set(gblTodayAssignment, First(Filter(Assignments, ...same filter as OnStart...)))`

---

## Day 2 — Tasks screen (~7 hrs)

### Step 5 — Build scr_Tasks

**Screen properties:** same background, same header style.

**Header — `hdr_Tasks`:**
Same rectangle as scr_Today.
- `lbl_HeaderTitle`: Text `"Sign off: " & gblTodayAssignment.SubPhaseNumber`
- Back arrow icon `ico_Back` (top-left): OnSelect `Navigate(scr_Today, ScreenTransition.UnCover)`

**Task list — `gal_Tasks`:**
- Type: Gallery (Vertical, blank)
- Items: `Sort(gblTasks, Sequence)`
- Padding, template size: at least 72 tall so touch targets are big
- Template contains:

  **`chk_Task`:**
  - Type: Checkbox
  - Default: `ThisItem.Complete`
  - OnCheck:
    ```powerfx
    Patch(
        Tasks,
        ThisItem,
        {
            Complete: true,
            CompletedBy: gblCurrentUser,
            CompletedOn: Now()
        }
    );
    Set(gblTasks, Filter(Tasks, Assignment.Value = gblTodayAssignment.Title));
    ```
  - OnUncheck:
    ```powerfx
    Patch(
        Tasks,
        ThisItem,
        {
            Complete: false,
            CompletedBy: Blank(),
            CompletedOn: Blank()
        }
    );
    Set(gblTasks, Filter(Tasks, Assignment.Value = gblTodayAssignment.Title));
    ```
  - Size: 40 × 40 (big enough for gloves)

  **`lbl_TaskLabel`:**
  - Text: `ThisItem.Title`
  - Wrap: On
  - Font: Segoe UI, Size 15
  - Color: `If(ThisItem.Complete, RGBA(107, 114, 128, 1), RGBA(17, 24, 39, 1))`
  - Overlaid strikethrough if complete: use `Underline` off, but wrap in an `HtmlText` control with `If(ThisItem.Complete, "<s>" & ThisItem.Title & "</s>", ThisItem.Title)`

⚠️ *Patch → refresh → re-render is intentional. Optimistic UI (updating locally without patch confirmation) can cause task state to drift from SharePoint. The extra roundtrip costs ~200ms per tick — acceptable for the safety.*

### Step 6 — WorkDate + Notes controls

Below the gallery, sticky-bottom area:

**Container — `cnt_MetaFields`:**
- Fill: White
- BorderRadius: 12 top, 0 bottom
- Position: docked to bottom above the sign-off button

Inside:

**`lbl_WorkDate`:** "Work performed on:"

**`dp_WorkDate`:**
- Type: Date picker
- Default: `gblToday`
- Format: `DateTimeFormat.ShortDate`
- Font size: 16
- Height: 44

**`lbl_Notes`:** "Notes (optional):"

**`txt_Notes`:**
- Type: Text input (multi-line)
- Mode: Multiline
- Height: 80
- Placeholder: "Anything the PM should know?"

### Step 7 — Complete Sign-Off button

**`btn_CompleteSignOff`:**
- Type: Button
- Text: `"Sign off " & gblTodayAssignment.SubPhaseNumber & " ✓"`
- Fill: `If(CountRows(Filter(gblTasks, !Complete)) = 0, RGBA(15, 118, 110, 1), RGBA(180, 83, 9, 1))`
  (Green if all tasks done, orange if incomplete tasks — orange means "you're submitting a partial")
- Color: White
- Height: 64
- Width: `Parent.Width - 32`
- BorderRadius: 12
- Font size: 18
- OnSelect:

```powerfx
// Confirm submission if any task is incomplete
If(
    CountRows(Filter(gblTasks, !Complete)) > 0
      && !Confirm("You have unticked tasks. Sign off anyway?", "Sign off?"),
    Notify("Cancelled", NotificationType.Warning),

    // Call the Sign-off Intake flow
    Set(
        gblIntakeResponse,
        'D2-SignoffIntake'.Run(
            gblTodayAssignment.ID,
            dp_WorkDate.SelectedDate,
            txt_Notes.Value,
            CountRows(gblTasks),
            CountRows(Filter(gblTasks, Complete))
        )
    );

    If(
        gblIntakeResponse.status = "Success",
        Set(gblSignOffJob, gblTodayAssignment.Job.Value);
        Set(gblSignOffSubPhase, gblTodayAssignment.SubPhaseNumber & " · " & gblTodayAssignment.SubPhaseName);
        Reset(txt_Notes);
        Reset(dp_WorkDate);
        Set(gblTodayAssignment, Blank());
        Navigate(scr_Confirm, ScreenTransition.Cover),

        Notify("Sign-off failed. Try again or contact your PM.", NotificationType.Error, 5000)
    )
)
```

Notes on the expression:
- `Confirm()` is a built-in Power Apps dialog primitive — no custom modal build needed.
- `'D2-SignoffIntake'.Run(...)` calls the Week 2 Flow 2 with the exact parameter order defined in that flow's PowerApps V2 trigger. If parameter order in the flow changes, this call breaks — keep in sync.
- On success, clear inputs and navigate to confirmation. Setting `gblTodayAssignment` to Blank forces the Today screen's OnVisible re-query to run.

---

## Day 3 — Confirmation + polish (~6 hrs)

### Step 8 — Build scr_Confirm

Simple screen. On visible, refresh app state.

**Screen properties:**
- OnVisible:
  ```powerfx
  // No-op; the sign-off flow already updated globals
  ```

**Success icon — `ico_Success`:**
- Type: Icon (Check)
- Size: 120 × 120
- Color: `RGBA(15, 118, 110, 1)`
- Position: centered horizontally, ~30% down the screen

**Success message — `lbl_Success`:**
- Text: `"Signed off"`
- Font: Segoe UI, Size 28, Bold

**Sub-message — `lbl_SuccessDetail`:**
- Text: `gblSignOffJob & Char(10) & gblSignOffSubPhase`
- Font: Segoe UI, Size 16, Color: `RGBA(107, 114, 128, 1)`
- Wrap: On

**Return button — `btn_BackToToday`:**
- Type: Button
- Text: `"Back to today"`
- Fill: White
- BorderColor: `RGBA(229, 231, 235, 1)`
- BorderThickness: 1
- Color: `RGBA(17, 24, 39, 1)`
- Height: 60
- Width: `Parent.Width - 32`
- OnSelect:
  ```powerfx
  // Re-run App.OnStart's assignment query to refresh
  Set(gblToday, Today());
  Set(
      gblTodayAssignment,
      First(
          Filter(
              Assignments,
              Crew = gblCurrentCrew.CrewID
                && ScheduledStart <= gblToday
                && ScheduledFinish >= gblToday
                && NotApplicable = false
                && InstallerSignOff = false
          )
      )
  );
  Set(
      gblTasks,
      Filter(
          Tasks,
          Assignment.Value = gblTodayAssignment.Title
      )
  );
  Navigate(scr_Today, ScreenTransition.UnCover)
  ```

### Step 9 — Polish + branding

- App icon: use a simple D2 mark. If none exists, use the letter "D" on the accent color.
- App title in Power Apps: `D2 Sign-Off`
- Splash screen (optional): App → OnStart → set `Set(gblAppReady, false)` before the data loads, `Set(gblAppReady, true)` after; use a covering rectangle on scr_Today that dismisses when `gblAppReady` is true.
- Confirm all touch targets are ≥ 44pt (Apple's HIG minimum) and ≥ 48dp (Google's Material minimum). Anything smaller fails accessibility and frustrates crew leads with dirty fingers.

### Step 10 — Recent Sign-offs strip (optional, nice-to-have)

Below the main Job card on scr_Today, a horizontal-scroll gallery showing the last 5 sub-phases this crew has signed off. Useful confidence: "yes, my last submissions were captured."

- Add a Gallery: `gal_Recent`
- Items: `SortByColumns(Filter(Assignments, Crew = gblCurrentCrew.CrewID && InstallerSignOff = true), "InstallerSignOffOn", Descending)`
- Template shows: JobNumber, sub-phase number, date signed
- Optional for MVP — skip if Week 3 is running long.

---

## Day 4 — Device testing (~5 hrs)

### Step 11 — Publish for testing

1. Studio → **File** → **Save** → save with a version comment
2. **File** → **Publish** → publish this version
3. **Share** → add the `D2 Crew Leads` security group with Co-owner or User access. **Do not** share directly to individuals — hard to maintain.

### Step 12 — Install Power Apps mobile

For each crew lead's phone:
1. App Store or Play Store → search "Power Apps" (Microsoft publisher)
2. Install, sign in with D2 M365 account
3. Find `D2 Sign-Off` in the Apps list → tap → **Pin to home screen**

Give crew leads a printed 3-step how-to for this. It's the one-time friction point of the whole deployment.

### Step 13 — Test matrix

Real devices, not just simulators. Ideally 2–3 phones covering:
- iOS (latest major version)
- iOS (one version back — some crew leads won't update)
- Android (latest)
- Android (mid-tier, 2–3 years old — some crew leads' phones are older)

Test cases:

| Case | Steps | Expected |
|---|---|---|
| Load with today's assignment | Open app on morning of a scheduled day | scr_Today shows the correct job + sub-phase within 3 seconds |
| No assignment today | Open on Sunday (or a day with no work) | scr_Today shows "No sub-phase scheduled" message + Refresh button |
| Tick tasks | Navigate to Tasks, tap each checkbox | Each tick persists (verify in SharePoint list) |
| Untick a task | Tick then untick | Complete goes back to false, CompletedBy clears |
| Sign off with all tasks ticked | Complete flow | Green button, sign-off intake fires, scr_Confirm shows success |
| Sign off with untick | Skip one task, hit Sign Off | Orange button, Confirm dialog asks "sign off anyway?", proceed writes correct TasksTotal/TasksComplete |
| WorkDate override | Set date to yesterday | Sign-off writes yesterday's date to WorkDate |
| Notes | Type multi-line notes | Notes save to Assignment.SignOffNotes |
| Cancel from Tasks | Hit back arrow mid-flow | Return to Today, no writes |
| Offline behavior | Turn phone to airplane mode | Sign-off button shows error notification (David confirmed no offline needed, this is expected) |
| Rotate to landscape | Test both screens | Layout doesn't break |
| Dirty screen | Test with gloves on a real phone | Every touch target hits |

---

## Day 5 — Fixes + exit gate (~3 hrs)

### Step 14 — Common fixes for device-testing findings

- **Delegation warnings** in Studio: `Filter()` on non-delegable columns (Person, Lookup) can silently return only 500 rows. Solution: use `.Value` on Lookups in filter conditions (already done above), or pre-filter server-side via a specific `Get items` action.
- **Slow load on cheap Android:** Set `Delayed load` on the app to load screens on-demand. Studio → App settings → General → Delayed load.
- **Date picker time-zone drift:** SharePoint stores UTC; Power Apps shows local. If dates are off by a day, wrap: `DateAdd(dp_WorkDate.SelectedDate, TimeZoneOffset(dp_WorkDate.SelectedDate), TimeUnit.Minutes)`.
- **App won't load on a specific device:** likely a signed-out M365 session. Sign out and back in.

### Step 15 — Week 3 exit gate

Verify all before proceeding to Week 4 pilot:

- ✅ Crew lead opens app on phone, sees today's sub-phase within 3 seconds
- ✅ Ticks 6 tasks, sees progress update, submits sign-off in under 60 seconds
- ✅ Sign-off writes correctly to SharePoint (Assignment updated, Tasks updated)
- ✅ Sign-off Intake flow (Week 2 Flow 2) runs successfully — verify in Power Automate portal
- ✅ Event-Driven Reconciliation does NOT re-fire from the sign-off (Week 2 Flow 3 trigger condition holds)
- ✅ WorkDate defaults to today, can be overridden
- ✅ Notes optional and saved when entered
- ✅ App works on at least 2 different crew-lead phones (iOS + Android)

**If any check fails, do not proceed to Week 4.** Fix in-week or extend a day. Pilot week depends on all above being solid.

---

## Common gotchas

- **Standard Power Apps rights limit connectors.** SharePoint and Office 365 Users are standard. Anything else (custom connectors, HTTP requests, Azure services) would require Premium and break the $0 promise. If you find yourself adding a premium connector, pause and rethink.
- **`gblTodayAssignment` being blank is normal.** Sundays, weather days, or between-jobs windows all produce empty assignments. Handle every downstream reference with `IsBlank()` checks.
- **Patch() vs SubmitForm()** — this app uses `Patch()` throughout because there's no traditional form control. `Patch` is atomic per record and returns the patched record; `SubmitForm` is form-tied and pickier.
- **`Reset()` on controls** clears them to their Default value, not to blank. Setting a `dp_WorkDate.Default = gblToday` and calling `Reset(dp_WorkDate)` sends it back to today, which is what we want.
- **Publish before sharing.** Studio "Save" is not the same as "Publish." Shared users see the last-published version, not the last-saved.
- **App version history is your friend.** Every publish is a version; you can roll back from the Share panel. Use it if you ship a bug.

---

## What Week 4 pilot starts with

A working canvas app on real crew-lead phones, calling a working sign-off intake flow, writing to a working SharePoint schema, triggering (or correctly not triggering) working reconciliation flows. If Week 3's exit gate is green, the pilot week is validation, not development.
