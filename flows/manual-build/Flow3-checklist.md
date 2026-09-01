# Flow 3 — Event-Driven Reconciliation (manual-build fallback)

Use this if `Import-Flow.ps1` fails. Every expression here is copy-paste ready.
Definition JSON: `../definitions/D2-Event-Driven-Reconciliation.json`.

**Env:** D2 Automation · `2710a01b-6cfa-e820-b338-2286f2649300`
**Site:** `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`
**Assignments list GUID:** `49ef7006-d3fe-40a7-a52f-c4c18545bd35`
**Crews list GUID:** `45e9ff1f-bf36-4ab5-929d-25ab9a80d460`
**Jobs list GUID:** `ee0ecabf-2f11-458d-a9ea-641f76d10cc3`

---

## 1. Create the flow

- make.powerautomate.com → **Automated cloud flow**
- Name: `D2 - Event-Driven Reconciliation`
- Trigger: **When an item is created or modified** (SharePoint)
- Site: pick D2BuildScheduler; List: `Assignments`
- Leave the trigger with default poll interval (1 min). Save/close settings pane.

## 2. Trigger condition (Settings → Trigger conditions → Add)

Paste **verbatim** — one line:

```
@or(not(equals(triggerOutputs()?['body/Crew'], triggerOutputs()?['body/Crew@odata.oldValue'])), not(equals(triggerOutputs()?['body/ScheduledStart'], triggerOutputs()?['body/ScheduledStart@odata.oldValue'])), not(equals(triggerOutputs()?['body/DurationDays'], triggerOutputs()?['body/DurationDays@odata.oldValue'])), equals(triggerOutputs()?['body/Crew@odata.oldValue'], null))
```

Fires when Crew, ScheduledStart, or DurationDays changed — plus on any new row (the last OR clause).

## 3. Actions — build in this order

Every value is a **bare expression** (Expression tab, not `@{}` template), per the syntax rule in CLAUDE.md.

### 3.1 Initialize variable: `touchedId` (Integer)
Value expression:
```
triggerOutputs()?['body/ID']
```

### 3.2 Initialize variable: `touchedCrew` (String)
Value expression:
```
coalesce(triggerOutputs()?['body/Crew'], '')
```

### 3.3 Initialize variable: `startDate` (String)
Value expression:
```
formatDateTime(triggerOutputs()?['body/ScheduledStart'], 'yyyy-MM-dd')
```

### 3.4 Initialize variable: `duration` (Integer)
Value expression:
```
int(coalesce(triggerOutputs()?['body/DurationDays'], 1))
```

### 3.5 Initialize variable: `endDate` (String)
Value expression:
```
formatDateTime(addDays(variables('startDate'), sub(variables('duration'), 1)), 'yyyy-MM-dd')
```

### 3.6 Get item — `Get_touched_assignment`
- Site: D2BuildScheduler · List: Assignments
- Id: `variables('touchedId')`

### 3.7 Get items — `Get_crew`
- Site: D2BuildScheduler · List: Crews
- Filter Query: `Title eq '@{variables('touchedCrew')}'`
- Top Count: `1`

### 3.8 Condition — `Condition_unlimited` (fires if crew is subcontractor / capacity-exempt)
Left expression:
```
coalesce(first(outputs('Get_crew')?['body/value'])?['Unlimited'], false)
```
Operator: **is equal to** · Right: `true` (bare bool, not "true" string)

**If yes → Terminate** (Status = Succeeded). If no → continue with 3.9.

### 3.9 Get items — `Get_overlapping`
- Site: D2BuildScheduler · List: Assignments
- Filter Query: `Crew eq '@{variables('touchedCrew')}' and ScheduledStart le '@{variables('endDate')}' and ScheduledFinish ge '@{variables('startDate')}' and Id ne @{variables('touchedId')} and NotApplicable ne 1`
- Top Count: `20`

### 3.10 Compose — `Compose_conflict_count`
Inputs (expression):
```
length(outputs('Get_overlapping')?['body/value'])
```

### 3.11 Condition — `Condition_conflict`
Left expression: `outputs('Compose_conflict_count')` · Operator: **is greater than** · Right: `0`

**If yes** → nested actions 3.11.a → 3.11.c below. **If no** → nothing.

#### 3.11.a Get item — `Get_job`
- Site: D2BuildScheduler · List: Jobs
- Id expression (coalesce covers all three lookup-field naming variants):
```
coalesce(outputs('Get_touched_assignment')?['body/Job']?['Id'], outputs('Get_touched_assignment')?['body/JobId'], outputs('Get_touched_assignment')?['body/JobLookupId'])
```

#### 3.11.b Compose — `Compose_alert_body`
Inputs (single line, HTML):
```
<div style="font-family:Segoe UI,sans-serif;font-size:14px;color:#1a2332"><h2 style="color:#a84a18">⚠ Double-book detected on @{variables('touchedCrew')}</h2><p><strong>Touched sub-phase:</strong> @{outputs('Get_touched_assignment')?['body/Job']?['Value']} → @{outputs('Get_touched_assignment')?['body/SubPhaseNumber']} @{outputs('Get_touched_assignment')?['body/SubPhaseName']}<br><strong>Dates:</strong> @{variables('startDate')} through @{variables('endDate')}</p><p><strong>Overlaps with (@{outputs('Compose_conflict_count')} total):</strong> @{first(outputs('Get_overlapping')?['body/value'])?['Job']?['Value']} → @{first(outputs('Get_overlapping')?['body/value'])?['SubPhaseNumber']} @{first(outputs('Get_overlapping')?['body/value'])?['SubPhaseName']} (@{formatDateTime(first(outputs('Get_overlapping')?['body/value'])?['ScheduledStart'], 'MM/dd')}–@{formatDateTime(first(outputs('Get_overlapping')?['body/value'])?['ScheduledFinish'], 'MM/dd')})</p><p><a href="https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler/Lists/Assignments/DispForm.aspx?ID=@{variables('touchedId')}">Open the touched sub-phase</a></p></div>
```

#### 3.11.c Send an email (V2)
- **To** (expression):
```
coalesce(outputs('Get_job')?['body/ProjectManager']?['Email'], 'stratirus@d2pools.com')
```
- **Subject** (template):
```
D2 ⚠ Double-book on @{variables('touchedCrew')} — @{outputs('Get_touched_assignment')?['body/Job']?['Value']}
```
- **Body** (expression):
```
outputs('Compose_alert_body')
```
- **Importance**: High

---

## 4. Save + test (see runbook exit gate)

1. Save the flow. Leave it **Off** initially.
2. Turn on.
3. **Positive test:** in SharePoint Assignments Grid view, edit Harrison D2-1001 sub-phase A's `ScheduledStart` by one day. Wait 60s.
   - Expect: 1 flow run, Succeeded. If no conflicts exist → no email (`Condition_conflict` false). If conflicts → email in D2 Bot mailbox.
4. **Negative test (loop check):** flip `InstallerSignOff` from No to Yes on that same row. Wait 60s.
   - Expect: **0 flow runs**. If a run appears, trigger condition is wrong — check the copy-paste in step 2.
5. **Real conflict test:** set two overlapping Harrison assignments to the same crew + overlapping dates → email arrives naming the other assignment.

If step 4 shows any run, immediately turn the flow **Off** and re-check the trigger condition before iterating.
