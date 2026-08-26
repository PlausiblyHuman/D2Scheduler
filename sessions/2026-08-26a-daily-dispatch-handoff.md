# 2026-08-26a — Daily Dispatch: trigger + first var built, handoff to Shane for remaining 9 actions

## Session goal

Build Flow 1 (Daily Dispatch + Reminders) per Week 2 runbook, with holiday-skip
enhancement Shane approved. Started via Chrome UI-driving on new designer, hit
per-field click cost too high to justify continuing, handing off remainder.

## What's done in the portal

**Flow:** `D2 — Daily Dispatch + Reminders` in **D2 Automation** env, owned by
`stratirus@d2pools.com`. Saved as published draft.

- Flow ID: `f4e387a3-86a1-f111-b8dc-6045bd0195dd`
- Environment ID: `2710a01b-6cfa-e820-b338-2286f2649300`
- URL: https://make.powerautomate.com/environments/2710a01b-6cfa-e820-b338-2286f2649300/solutions/~preferred/flows/f4e387a3-86a1-f111-b8dc-6045bd0195dd

**Trigger (Recurrence):**
- Frequency: Week, Interval 1
- Time zone: (UTC-06:00) Central Time (US & Canada)
- Start time: 2026-08-27T06:00:00
- On these days: Mon, Tue, Wed, Thu, Fri, Sat
- At these hours: 6
- At these minutes: 0

**Action 1 (Initialize variable "today"):**
- Name: `today`
- Type: String
- Value: `@{formatDateTime(convertFromUtc(utcNow(),'Central Standard Time'),'yyyy-MM-dd')}`

## Prereq state (verified via REST this session)

- Assignments list has all needed fields (NotApplicable, ScheduledFinish,
  ScheduledStart, DurationDays, Crew, Job, SubPhaseNumber, SubPhaseName, etc.).
- Crews.LeadEmail column exists, populated on all 7 field crews with placeholder
  `stalbot@stratirus.com` — every dispatch email routes to Shane until real
  addresses land.
- **NOT done:** Assignments.EditFingerprint — needed for Flow 3 not Flow 1,
  tracked as task #8.
- **NOT verified:** Teams team `D2 Build Scheduler` + `Field Dispatch` channel
  existence. Will surface when adding the Teams post action in Step 10 below.
- **Sign-off Intake flow from last session is NOT visible** in D2 Automation
  env cloud flows list. Either it was built elsewhere or last session's log
  overstated. Flagging — task #6 needs re-scoping.

---

## Remaining 9 actions — copy-paste sequence

Open the flow, ensure **classic designer** is on (toggle top-right, "New designer"
should be OFF — dark toggle). Click **+ New step** below "Initialize variable"
to add each action in order.

### Action 2 — Initialize variable "yesterday"

- Search: `Initialize variable`
- Name: `yesterday`
- Type: String
- Value (paste literally into Value field):
  ```
  @{formatDateTime(addDays(convertFromUtc(utcNow(),'Central Standard Time'),-1),'yyyy-MM-dd')}
  ```

### Action 3 — Get items: today's Assignments

- Search: `Get items` → **SharePoint** connector → Get items
- Site Address: `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`
- List Name: `Assignments`
- Show advanced options → Filter Query (paste):
  ```
  ScheduledStart le '@{variables('today')}' and ScheduledFinish ge '@{variables('today')}' and NotApplicable ne 1
  ```
- Order By: `Crew/Title asc`
- Top Count: `500`
- Rename this action (… menu → Rename): `Get today Assignments`

### Action 4 — Get items: yesterday's unsigned Assignments

- Search: `Get items` → SharePoint
- Site Address: same as Action 3
- List Name: `Assignments`
- Filter Query:
  ```
  ScheduledFinish eq '@{variables('yesterday')}' and InstallerSignOff ne 1 and NotApplicable ne 1
  ```
- Top Count: `500`
- Rename: `Get yesterday unsigned`

### Action 5 — Get items: active field crews

- Search: `Get items` → SharePoint
- Site Address: same
- List Name: `Crews`
- Filter Query:
  ```
  Active eq 1 and Unlimited ne 1
  ```
- Top Count: `100`
- Rename: `Get active crews`

### Action 6 — Get items: today's Work Calendar holidays

*(This is the holiday-skip enhancement you approved.)*

- Search: `Get items` → SharePoint
- Site Address: same
- List Name: `Work Calendar`
- Filter Query:
  ```
  Date eq '@{variables('today')}'
  ```
- Top Count: `10`
- Rename: `Get today holidays`

### Action 7 — Condition: skip if holiday

- Search: `Condition` → Control
- Left value: expression
  ```
  length(body('Get_today_holidays')?['value'])
  ```
- Operator: `is greater than`
- Right value: `0`
- In the **If yes** branch → add action → search `Terminate` → Control:
  - Status: `Succeeded`
- Leave **If no** branch empty for now (Apply-to-each in Action 8 goes below Condition).

### Action 8 — Apply to each: crew

- Add outside the Condition (click + below Condition at the top level).
- Search: `Apply to each` → Control
- Select an output from previous steps: expression
  ```
  body('Get_active_crews')?['value']
  ```
- Rename outer scope: `For each crew`

### Actions inside `For each crew` (in order)

**8a. Filter array — today's assignments for this crew**
- Search: `Filter array` → Data Operation
- From: expression `body('Get_today_Assignments')?['value']`
- Left value (item property): expression `item()?['Crew']?['Value']`
- Operator: `is equal to`
- Right value: expression `items('For_each_crew')?['Title']`
- Rename: `Filter today for crew`

**8b. Filter array — yesterday's unsigned for this crew**
- Search: `Filter array` → Data Operation
- From: expression `body('Get_yesterday_unsigned')?['value']`
- Left value: expression `item()?['Crew']?['Value']`
- Operator: `is equal to`
- Right value: expression `items('For_each_crew')?['Title']`
- Rename: `Filter yesterday for crew`

**8c. Compose — email body HTML**
- Search: `Compose` → Data Operation
- Inputs (paste this whole block; it's one expression string):
  ```
  <div style="font-family:Segoe UI,sans-serif;font-size:14px;color:#1a2332">
    <h2 style="color:#0b6e78">TODAY — @{formatDateTime(variables('today'),'ddd MM/dd')} · @{items('For_each_crew')?['Title']}</h2>
    @{if(empty(body('Filter_today_for_crew')),'<p><em>No sub-phase scheduled today.</em></p>',concat('<p><strong>',first(body('Filter_today_for_crew'))?['Job']?['Value'],'</strong><br>',first(body('Filter_today_for_crew'))?['SubPhaseNumber'],' ',first(body('Filter_today_for_crew'))?['SubPhaseName'],'</p><p><a href="https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler/Lists/Assignments/DispForm.aspx?ID=',string(first(body('Filter_today_for_crew'))?['ID']),'">Open sub-phase to sign off</a></p>'))}
    @{if(empty(body('Filter_yesterday_for_crew')),'',concat('<h3 style="color:#a84a18">OUTSTANDING FROM YESTERDAY</h3><p>',string(length(body('Filter_yesterday_for_crew'))),' sub-phase(s) finished yesterday but not yet signed off.</p>'))}
  </div>
  ```
- Rename: `Compose email HTML`

**8d. Send an email (V2)** — Office 365 Outlook
- To: expression `items('For_each_crew')?['LeadEmail']`
- Subject: `D2 Dispatch — @{formatDateTime(variables('today'),'ddd MM/dd')} · @{items('For_each_crew')?['Title']}`
- Body: dynamic content → **Outputs** of `Compose email HTML`
- Show advanced options → Is HTML: **Yes**
- Rename: `Send dispatch email`

**8e. Post message in a chat or channel** — Microsoft Teams
- Post as: `Flow bot`
- Post in: `Channel`
- Team: `D2 Build Scheduler` (create the team first if it doesn't exist — see gotcha below)
- Channel: `Field Dispatch` (create the channel if it doesn't exist)
- Message: paste
  ```
  @{items('For_each_crew')?['Title']} — dispatch email sent for @{formatDateTime(variables('today'),'ddd MM/dd')}.
  ```
- Rename: `Post to Field Dispatch`

---

## Save + test

1. Click **Save** at bottom.
2. Wait for "Your flow is ready to go." banner.
3. Click **Test** (top right) → *Manually* → Test → Save & test.
4. Confirm you get 7 emails (one per field crew) in `stalbot@stratirus.com`.
5. Confirm 7 posts land in the `Field Dispatch` channel.
6. If holiday check: manually add a Work Calendar row with `Date = today` and
   re-run. Flow should Terminate after Action 7 with 0 emails, 0 posts.

## Gotchas

- **Teams team + channel:** May not exist yet. If Team dropdown in Action 8e
  doesn't list `D2 Build Scheduler`, create it via Teams web
  (teams.microsoft.com → Join or create a team → From scratch → Private,
  named `D2 Build Scheduler`). Add channel `Field Dispatch` inside it.
- **Crew lookup shape:** Filter array in 8a/8b uses `item()?['Crew']?['Value']`
  because SP's expanded lookup returns `{Id, Value}` where Value = display title.
  If flow runs return 0 filtered results even when data exists, check by
  peeking the Get today Assignments output — you may need `?['Crew']?['DisplayName']`
  or `?['CrewId']` instead of `?['Value']`. First run test will reveal.
- **`@{...}` in text fields:** In classic designer these save as expressions
  even if they don't visually convert to a chip. Trust the save.

## Next action

Shane finishes 8a-8e in the portal. Then export the flow to
`flows/exports/D2-DailyDispatch.zip` (PA Portal → Export → Package .zip) and
commit.

Then move to Flow 3 (Event-Driven Reconciliation) — first add
`Assignments.EditFingerprint` text column via REST.

## Files touched

- `sessions/2026-08-26a-daily-dispatch-handoff.md` (this file, new)
- `sessions/latest.md` (copy pending)
- Crews list — LeadEmail populated with placeholder on 7 rows (SP data, not repo)
- PA flow `D2 — Daily Dispatch + Reminders` created (portal, not repo — export
  pending after Shane finishes)
