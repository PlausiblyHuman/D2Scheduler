# D2 Week 2 build runbook — Power Automate flows

**Prereq:** Week 1 complete. All 6 lists exist with correct schemas and seed data loaded.
**Time budget:** ~22 hours. Most of it in Days 1–3 on the reconciliation flow, which is the fiddliest.
**Working account:** D2 tenant service account with `Power Automate` license (comes with seeded rights) and Contribute on all six lists.

Five flows to build, in this order. Each depends only on the lists and the flows above it.

| Order | Flow | Trigger | Complexity | Time |
|---|---|---|---|---|
| 1 | Daily Dispatch + Reminders | Scheduled 6 AM Mon–Sat | Medium | 5 hrs |
| 2 | Sign-off Intake | HTTP request from canvas app (Week 3 caller, but build shell now) | Low | 2 hrs |
| 3 | Event-Driven Reconciliation | SharePoint item created/modified on Assignments | High — trigger condition + polling floor | 6 hrs |
| 4 | Nightly Reconciliation | Scheduled 11 PM daily | Medium | 4 hrs |
| 5 | Daily + Weekly PDF Summary | Scheduled 6:30 AM daily + Fri 3 PM | Medium | 5 hrs |

Site URL used below: `https://[tenant].sharepoint.com/sites/d2-scheduler` — substitute the actual URL.

---

## Day 1 — Foundation flows (~7 hrs)

### Flow 1 — Daily Dispatch + Reminders

**Purpose:** Every crew lead gets one morning artifact showing today's sub-phase + anything unsigned from yesterday.

#### Create the flow

1. `make.powerautomate.com` → **My flows** → **New flow** → **Scheduled cloud flow**
2. Name: `D2 — Daily Dispatch + Reminders`
3. Starting: tomorrow at 6:00 AM Pacific
4. Recurrence: **Daily** at **06:00**, on days **Mon, Tue, Wed, Thu, Fri, Sat**

#### Actions (in order)

**Init — cache today and yesterday as strings**

```
Initialize variable: today (String) = formatDateTime(convertFromUtc(utcNow(), 'Pacific Standard Time'), 'yyyy-MM-dd')
Initialize variable: yesterday (String) = formatDateTime(addDays(convertFromUtc(utcNow(), 'Pacific Standard Time'), -1), 'yyyy-MM-dd')
```

**Get today's Assignments — one row per active crew**

- Action: **Get items** (SharePoint)
- Site: `d2-scheduler`
- List: `Sub-phase Assignments`
- Filter query: `ScheduledStart le '@{variables('today')}' and ScheduledFinish ge '@{variables('today')}' and NotApplicable ne 1`
- Order by: `Crew/Title asc`
- Top count: 500

**Get yesterday's unsigned Assignments**

- Action: **Get items** (SharePoint)
- Same list
- Filter query: `ScheduledFinish eq '@{variables('yesterday')}' and InstallerSignOff ne 1 and NotApplicable ne 1`
- Top count: 500

**Get active crews**

- Action: **Get items** (SharePoint)
- List: `Crews`
- Filter query: `Active eq 1 and Unlimited ne 1`
- Top count: 100

**Loop through crews**

- Action: **Apply to each** — output of "Get active crews"
- Inside the loop:

  **Filter today's assignments to this crew:**
  ```
  Filter array — from: outputs of "Get today's Assignments"
  where: item()?['Crew'] equals items('Apply_to_each')?['Title']
  ```

  **Filter yesterday's unsigned to this crew:**
  ```
  Filter array — from: outputs of "Get yesterday's unsigned"
  where: item()?['Crew'] equals items('Apply_to_each')?['Title']
  ```

  **Compose the HTML email body:**
  Use a Compose action with HTML template. Sample structure below (adjust per D2 brand):

  ```html
  <div style="font-family:Segoe UI,sans-serif;font-size:14px;color:#1a2332">
    <h2 style="color:#0b6e78">TODAY — @{formatDateTime(variables('today'), 'ddd MM/dd')} · @{items('Apply_to_each')?['Title']}</h2>
    @{if(empty(body('Filter_today')),
      '<p><em>No sub-phase scheduled today.</em></p>',
      concat('<p><strong>', body('Filter_today')?[0]?['Job']?['Value'], '</strong><br>',
             body('Filter_today')?[0]?['SubPhaseNumber'], ' ', body('Filter_today')?[0]?['SubPhaseName'], '</p>',
             '<p><a href="@{concat('https://forms.office.com/…?assignment=', body('Filter_today')?[0]?['ID'])}">Sign off this sub-phase</a></p>'))}

    @{if(empty(body('Filter_yesterday')), '',
      concat('<h3 style="color:#a84a18">OUTSTANDING FROM YESTERDAY</h3>',
             '<p>', length(body('Filter_yesterday')), ' sub-phase(s) finished yesterday but not yet signed off.</p>'))}
  </div>
  ```

  **Send email:**
  - Action: **Send an email (V2)** (Office 365 Outlook)
  - To: crew lead's email (see "Crew lead email resolution" below)
  - Subject: `D2 Dispatch — @{formatDateTime(variables('today'), 'ddd MM/dd')} · @{items('Apply_to_each')?['Title']}`
  - Body: HTML from Compose above

  **Post to Field Teams channel:**
  - Action: **Post message in a chat or channel** (Microsoft Teams)
  - Post as: Flow bot
  - Post in: Channel
  - Team: `D2 Build Scheduler`
  - Channel: `Field Dispatch`
  - Message: `@{items('Apply_to_each')?['Title']} — today's dispatch: [link to sign-off]`

#### Crew lead email resolution

The `Crew` list has a `Members` person column, but crew leads aren't necessarily list members — the lead may be someone in the Office group who oversees the crew. Two options:

- **Simpler:** add a `LeadEmail` single-line-text column to the Crews list. Manual, one-time entry per crew. Flow reads it directly.
- **Cleaner:** designate one specific member of each crew as the "lead" via a `Lead` person column on Crews. Flow resolves the email from the person object.

Go with **LeadEmail** for Week 2 speed; migrate to Lead person column post-cutover if it becomes a maintenance headache.

#### Test

1. Save and turn on the flow
2. Manually run it (test → "I'll perform the trigger action" → skip since it's scheduled → use "Run" from the flow detail page after saving)
3. Confirm one email arrives per active crew with a name
4. Confirm one Teams post per crew lands in `Field Dispatch`
5. Turn on for scheduled execution

---

### Flow 2 — Sign-off Intake (shell)

**Purpose:** Called from the canvas app in Week 3 to write installer sign-off onto an Assignment. Build the shell now so Week 3 has a callable endpoint.

#### Create the flow

1. New flow → **Instant cloud flow**
2. Name: `D2 — Sign-off Intake`
3. Trigger: **PowerApps (V2)**

#### Input parameters (add to the PowerApps V2 trigger)

- `AssignmentID` (Number)
- `WorkDate` (Date, no time)
- `Notes` (Text, optional)
- `TasksTotal` (Number)
- `TasksComplete` (Number)

#### Actions

**Get the Assignment being signed off:**
- Action: **Get item** (SharePoint)
- Site: `d2-scheduler`
- List: `Sub-phase Assignments`
- ID: `triggerBody()?['AssignmentID']`

**Get the calling user's identity:**
- Action: **Get user profile (V2)** (Office 365 Users)
- User (UPN): `workflow()?['run']?['trigger']?['outputs']?['body']?['userPrincipalName']`

  If that doesn't resolve, fall back to a hardcoded lookup by an `email` parameter in the trigger.

**Update the Assignment:**
- Action: **Update item** (SharePoint)
- Site: `d2-scheduler`
- List: `Sub-phase Assignments`
- ID: `triggerBody()?['AssignmentID']`
- Fields to set:
  - `InstallerSignOff` = `Yes`
  - `InstallerSignOffOn` = `utcNow()`
  - `InstallerSignOffByClaims` = `outputs('Get_user_profile_(V2)')?['body/mail']` (SharePoint person columns accept email in the `Claims` internal field for updates)
  - `WorkDate` = `triggerBody()?['WorkDate']`
  - `SignOffNotes` = `triggerBody()?['Notes']`
  - `TasksTotal` = `triggerBody()?['TasksTotal']`
  - `TasksComplete` = `triggerBody()?['TasksComplete']`

**Respond to PowerApps:**
- Action: **Respond to a PowerApp or flow**
- Add outputs:
  - `Status` (Text) = `Success`
  - `AssignmentTitle` (Text) = `body('Get_item')?['Title']`

Test with a manual run once the canvas app is calling it in Week 3.

---

## Day 2 — Event-Driven Reconciliation (~6 hrs)

> **BUILD-PATH SHIFT (2026-09-01b):** don't hand-build Flow 3 in the designer.
> The full definition JSON is authored at
> `flows/definitions/D2-Event-Driven-Reconciliation.json` and imported via
> `flows/scripts/Import-Flow.ps1` — one PowerShell command. Read
> `flows/README.md` first. This section stays as the design reference and as
> the fallback checklist for `flows/manual-build/Flow3-checklist.md` when the
> REST import doesn't work.
>
> **MVP scoping:** Flow 3 alert is **email-only** (Send Email V2 to the touched
> Job's PM, with a coalesce fallback to `stratirus@d2pools.com`). Native Teams
> channel post + DM was in the original design but would require wiring a Teams
> connection to the D2 Automation env — Daily Dispatch never did, so this env
> has no Teams connection today. Add native Teams as v1.1 once the connection
> exists; the pattern is a copy-paste of any Post-message action from a flow
> that already has Teams wired.

**Purpose:** Detect crew double-bookings within one polling interval of the offending edit. Alert the PM by email.

> **Schema corrections discovered 2026-09-01 (build against these, not the runbook body below):**
> - List display name is **`Assignments`**, not "Sub-phase Assignments". Internal `EntityTypeName` is `AssignmentsList`.
> - `Crew` field is **Text** (holds the crew display name like `"Devon Crew +3"`), not a Lookup. There is **no `CrewId` field**. Substitute `body/Crew` wherever the runbook says `body/CrewId`.
> - Jobs list originally lacked a `ProjectManager` column — added 2026-09-01 as internal name `ProjectManager` (User/Person, Group=D2, field ID `90ec6a24-4631-4c6f-bc78-43549dc1c37d`). Seed each Job row's PM before the DM step can resolve. Harrison Residence D2-1001 needs seeding on next touch.
> - Verified Assignments editable fields: `Title, Job (Lookup), SubPhaseNumber, SubPhaseName, Crew (Text), Sequence, ScheduledStart, ScheduledFinish, WorkDate, InstallerSignOff, InstallerSignOffBy, InstallerSignOffOn, Locked, NotApplicable, PMSignOff, TasksComplete, TasksTotal, DurationDays, PMSignOffBy, PMSignOffOn, SignOffNotes, Trade (Lookup)`.
> - **Trigger condition (field-diff strategy, locked in):**
>   ```
>   @or(
>     not(equals(triggerOutputs()?['body/Crew'], triggerOutputs()?['body/Crew@odata.oldValue'])),
>     not(equals(triggerOutputs()?['body/ScheduledStart'], triggerOutputs()?['body/ScheduledStart@odata.oldValue'])),
>     not(equals(triggerOutputs()?['body/DurationDays'], triggerOutputs()?['body/DurationDays@odata.oldValue'])),
>     equals(triggerOutputs()?['body/Crew@odata.oldValue'], null)
>   )
>   ```

### Flow 3 — Event-Driven Reconciliation

#### Create the flow

1. New flow → **Automated cloud flow**
2. Name: `D2 — Event-Driven Reconciliation`
3. Trigger: **When an item is created or modified** (SharePoint)
4. Site: `d2-scheduler`
5. List: `Sub-phase Assignments`

#### CRITICAL — Set the trigger condition

Without this, the flow re-fires every time Sign-off Intake writes to an Assignment, burning quota and adding no value.

Click into the trigger → **Settings** → **Trigger conditions** → **Add**:

```
@and(
  or(
    not(equals(triggerOutputs()?['body/InstallerSignOff'], triggerOutputs()?['body/InstallerSignOff@odata.oldValue'])),
    equals(triggerOutputs()?['body/InstallerSignOff@odata.oldValue'], null)
  ),
  not(equals(triggerOutputs()?['body/Crew']?['StringValue'], null))
)
```

That's overcomplicated because SharePoint's trigger data model is a mess. Simpler and equivalent for our purpose: **run only when Crew or ScheduledStart or DurationDays changed** — implement this by tracking an `EditFingerprint` column (added to the Assignments schema as a hidden text column) that only the PM-facing edit flow updates. The condition becomes:

```
@not(equals(triggerOutputs()?['body/EditFingerprint'], triggerOutputs()?['body/EditFingerprint@odata.oldValue']))
```

If you don't want to add the fingerprint column, the cheapest working condition is to skip the trigger on any edit where the only changed columns are sign-off-related. SharePoint doesn't expose changed-column info directly, so this requires reading the old and new values of a few key columns:

```
@or(
  not(equals(triggerOutputs()?['body/CrewId'], triggerOutputs()?['body/CrewId@odata.oldValue'])),
  not(equals(triggerOutputs()?['body/ScheduledStart'], triggerOutputs()?['body/ScheduledStart@odata.oldValue'])),
  not(equals(triggerOutputs()?['body/DurationDays'], triggerOutputs()?['body/DurationDays@odata.oldValue'])),
  equals(triggerOutputs()?['body/CrewId@odata.oldValue'], null)
)
```

⚠️ *Test this condition thoroughly during build. If it evaluates true on a Sign-off Intake write (which shouldn't touch CrewId, ScheduledStart, or DurationDays), the flow will loop and burn quota. First 30 minutes of testing: watch flow-run count in the Power Automate portal after every canvas-app sign-off. If it grows by more than 1 per sign-off, the condition is wrong.*

#### Actions

**Compute the affected date span:**
```
Initialize variable: start (String) = triggerOutputs()?['body/ScheduledStart']
Initialize variable: end (String) = addDays(triggerOutputs()?['body/ScheduledStart'], sub(triggerOutputs()?['body/DurationDays'], 1))
Initialize variable: touchedCrewId (Integer) = triggerOutputs()?['body/CrewId']
Initialize variable: touchedAssignmentId (Integer) = triggerOutputs()?['body/ID']
```

**Skip capacity-exempt crews:**

- Action: **Get item** (Crews list) with ID = `variables('touchedCrewId')`
- Condition: **If** `body('Get_crew')?['Unlimited']` equals `true` → **Terminate** (Succeeded). Unlimited crews can't double-book by definition.

**Query for potential collisions:**

- Action: **Get items** (Sub-phase Assignments)
- Filter query: `CrewId eq @{variables('touchedCrewId')} and ScheduledStart le '@{variables('end')}' and ScheduledFinish ge '@{variables('start')}' and Id ne @{variables('touchedAssignmentId')} and NotApplicable ne 1`
- Top count: 20

  If any items come back, they overlap the touched row's crew + date range.

**Condition — if any results:**
- **If** `length(body('Get_potential_collisions')?['value'])` is greater than 0:

  **Post to Ops Teams channel:**
  ```
  ⚠ Double-book detected on @{outputs('Get_crew')?['body/Title']}:
    - @{triggerOutputs()?['body/Job/Value']} → @{triggerOutputs()?['body/SubPhaseNumber']} (@{variables('start')} to @{variables('end')})
    - Overlaps with: @{first(body('Get_potential_collisions')?['value'])?['Job']?['Value']} → @{first(body('Get_potential_collisions')?['value'])?['SubPhaseNumber']}
  ```

  **DM the PM:**
  - Action: **Post message in a chat or channel**
  - Post as: Flow bot
  - Post in: Chat with Flow bot
  - Recipient: PM email (from the touched Assignment's Job → ProjectManager, requires an extra Get item on Jobs)
  - Message: same content as Teams post

#### Test the trigger condition

1. Manually edit an Assignment's `ScheduledStart` in the SharePoint list → flow should fire, reconciliation runs
2. Trigger a canvas-app sign-off (or manually update `InstallerSignOff = Yes` in Grid view) → flow should **NOT** fire
3. Confirm flow run count in Power Automate portal shows exactly one run for #1, zero for #2

If #2 fires, the trigger condition is wrong. Refine the condition and re-test before proceeding.

---

## Day 3 — Safety net + PDF (~6 hrs)

### Flow 4 — Nightly Reconciliation

**Purpose:** Catch double-bookings that the event flow missed (Work Calendar edits, TOCTOU races, out-of-band updates).

#### Create the flow

1. New flow → **Scheduled cloud flow**
2. Name: `D2 — Nightly Reconciliation`
3. Starting: tomorrow at 11:00 PM Pacific
4. Recurrence: Daily at 23:00

#### Actions

**Query all future non-locked Assignments in the next 30 days:**
- Action: **Get items** (Sub-phase Assignments)
- Filter query: `ScheduledStart ge '@{formatDateTime(convertFromUtc(utcNow(), 'Pacific Standard Time'), 'yyyy-MM-dd')}' and ScheduledStart le '@{formatDateTime(addDays(convertFromUtc(utcNow(), 'Pacific Standard Time'), 30), 'yyyy-MM-dd')}' and NotApplicable ne 1`
- Top: 5000

**Group by (CrewId, Date):**

This requires expanding each Assignment's date range into per-day rows. Cleanest way is a Select action followed by aggregating.

- **Select** to project: `{ CrewId: item()?['Crew'], Dates: [range of days from ScheduledStart to ScheduledFinish], AssignmentId: item()?['ID'], JobName: item()?['Job']?['Value'], SubPhase: item()?['SubPhaseNumber'] }`
- Then a nested apply-to-each to flatten dates
- Then a filter to find any (CrewId, Date) tuple appearing more than once

**Simpler alternative for D2 volume** (~1,800 rows to sweep, not millions): a triple-nested for-loop is fine. Outer: distinct crews. Middle: 30 days. Inner: check for overlaps. Slower but readable and works at D2 scale.

**If any conflicts found, post a summary to Ops Teams channel.** Zero conflicts = post nothing (no wallpaper).

#### Test

Run manually after Week 1's data is loaded. Should return 0 conflicts on a clean seed. Then manually create a conflict (double-book Devon on two overlapping days) and re-run — should catch it and post.

---

### Flow 5 — Daily + Weekly PDF Summary

**Purpose:** Email Don a scanning summary of the week's schedule state. Skip Power BI.

#### Two flows or one?

Two, for simplicity — one daily, one weekly. Reuse the same "build HTML summary" child flow if you want DRY, but for Week 2 velocity just build them as separate flows.

**Daily PDF Flow:**

1. New flow → **Scheduled cloud flow**
2. Name: `D2 — Daily PDF Summary`
3. Starting: tomorrow at 6:30 AM Pacific
4. Recurrence: Daily at 06:30

**Weekly PDF Flow:**

1. New flow → **Scheduled cloud flow**
2. Name: `D2 — Weekly PDF Summary`
3. Starting: next Friday at 3:00 PM Pacific
4. Recurrence: Weekly on Friday at 15:00

#### Actions (identical for both, differ only in date range)

**Query the data:**
- Active jobs
- Assignments in date range (today for daily, current week for weekly)
- Sign-off compliance stats

**Compose HTML summary:**

```html
<html><body style="font-family:Segoe UI">
  <h1>D2 Scheduler Summary — @{formatDateTime(utcNow(), 'yyyy-MM-dd')}</h1>
  <h2>Active jobs</h2>
  <table>
    <tr><th>Job</th><th>Current sub-phase</th><th>On track?</th></tr>
    <!-- populated from query -->
  </table>
  <h2>This week by crew</h2>
  <!-- populated -->
  <h2>Sign-off compliance</h2>
  <p>@{compliance percentage}</p>
</body></html>
```

**Convert HTML to PDF:**
- Action: **Create file** (OneDrive for Business)
  - File name: `summary.html`
  - File content: composed HTML
- Action: **Convert file** (OneDrive for Business, or SharePoint)
  - File: created HTML file
  - Target type: `application/pdf`
- Action: **Delete file** (cleanup the .html)

**Send email to Don + post to Ownership channel:**
- **Send email (V2)** to `don@d2pools.com` with the PDF attached
- **Post message in a chat or channel** to `D2 Build Scheduler` → `Ownership` with a message + attachment link

#### Test

Run manually. Confirm PDF renders and reaches Don's inbox + Ownership channel.

---

## Week 2 exit gate

Verify all six before proceeding to Week 3:

- ✅ Dry-run of Daily Dispatch at 6 AM posts one email + one Teams message per active crew
- ✅ Test edit that creates a double-book on Sub-phase Assignments posts to Ops channel within the measured polling window (from Phase 1)
- ✅ Test edit that only changes sign-off fields does NOT re-fire the Event-Driven Reconciliation flow
- ✅ Manual run of Nightly Reconciliation on clean seed returns zero conflicts and posts nothing
- ✅ Manual run of Nightly Reconciliation on a manually-injected conflict catches it and posts to Ops
- ✅ Daily and Weekly PDF flows produce a rendered PDF that lands in Don's inbox + Ownership Teams channel

**If any check fails, do not proceed to Week 3.** Debug in Week 2 or extend by half a day. The canvas app in Week 3 depends on all five flows being solid.

---

## Common gotchas

- **SharePoint filter query syntax is quirky.** Person and Lookup columns filter on the internal integer ID (`SomeLookupId eq 3`), not the display value. If a filter returns 0 unexpectedly, that's the first thing to check.

  **But `Assignments.Crew` is NOT one of them.** It is a plain **Text** column holding the crew display name, and there is no `CrewId`. Filter it as `Crew eq 'Devon Crew +3'` and read it as `item()?['Crew']` / `triggerOutputs()?['body/Crew']` — a plain string. Applying the lookup shape to it (`?['Value']`, `CrewId`, `Crew/Title`) is what caused the Flow 1 empty-dispatch-table bug. Verified against the provisioned list 2026-09-01; see the schema callout above and the Known-bugs entry in `CLAUDE.md`.
- **`ne 1` vs `ne true`.** SharePoint's boolean columns return `1`/`0` in filter queries, not `true`/`false`. Use `ne 1` for "is not Yes."
- **Flow-run quota** on seeded Power Automate rights is 6,000 API calls per user per 24 hours. Well above what these five flows need — Event-Driven fires maybe 50×/day on active editing, Daily Dispatch fires 12 times (crews × 6 days), etc. Not tight. But watch this if the trigger condition on Event-Driven is wrong and it loops.
- **Convert File action** requires the source file to be in OneDrive or SharePoint. Can't convert an inline string.
- **Time zones matter.** SharePoint stores dates in UTC; D2 operates in Pacific. Use `convertFromUtc` in every dispatch-time comparison.
- **Testing Event-Driven Reconciliation** requires actual edits to the list — not manual flow triggering. The trigger only fires on real list writes.

---

## What Week 3 starts with

Five working flows. The canvas app in Week 3 calls Flow 2 (Sign-off Intake); the app doesn't have to know about the other four. Reconciliation, dispatch, and PDF summary run in the background. When the app publishes and a crew lead signs off, sign-off intake fires, Assignment gets updated, and the next morning's dispatch reflects it. That's the whole feedback loop.
