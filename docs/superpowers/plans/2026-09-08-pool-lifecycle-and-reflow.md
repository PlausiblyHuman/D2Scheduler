# Pool Lifecycle and Schedule Reflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `Planned` pool state actually suppress dispatch and conflict alerts, and add a flow that recomputes a pool's date chain from any sub-phase forward.

**Architecture:** Four existing published flows gain an "is this job Active" filter, each resolving the Active job set once per run rather than denormalising status onto 46 assignment rows. A new flow, `D2 - Reschedule Pool`, is triggered by a new `Reschedule Requests` list and walks a job's assignments in `Sequence` order, recomputing working-day spans while leaving `Locked` and signed-off rows pinned. One new Assignments column, `SuppressReconcileUntil`, stops a 45-row reflow from firing 45 conflict alerts.

**Tech Stack:** Power Automate cloud flows (WDL definitions) in the Dataverse-backed **D2 Automation** environment, SharePoint Online lists, FlowAgent MCP for flow authoring, `chrome-devtools` MCP for SharePoint REST.

**Spec:** `docs/superpowers/specs/2026-09-08-pool-lifecycle-and-reflow-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section. Most of these are things this project
has already lost time to.

**Environment and identity**

- Power Platform environment `2710a01b-6cfa-e820-b338-2286f2649300` (D2 Automation), org URL
  `https://org4ed2f722.crm.dynamics.com/`.
- `az login --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4`. Without `--tenant`, `az` silently
  reuses a cached tenant, FlowAgent reports all checks passing, and D2 Automation is invisible.
  Confirm with FlowAgent `whoami` that `tokenIdentity.tenantId` starts `f24d9b39`.
- SharePoint work runs through `chrome-devtools` MCP against a browser signed in as
  **`stratirus@d2pools.com`**. Call `list_pages` first and confirm identity via
  `/_api/web/currentuser` before any write. A 403 means the session changed, not that permissions
  did.
- Site: `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`. Always use the absolute
  site URL in REST calls; a leading-slash path resolves against the root site and 404s in a way
  that looks like a permissions problem.

**Flow authoring mechanics**

- Edit an existing flow: FlowAgent `preview_update`, then `update_flow` with the `previewToken`,
  then Dataverse `PublishXml` against the flow's `workflowEntityId`. `update_flow` alone writes
  the **draft** row; `get_flow` reads the **published** row, so a write can look like a no-op when
  it succeeded.
- `publish_flow` only starts/stops a flow. It does not promote a definition. `PublishXml` does.
- Strip `"authentication": "@parameters('$authentication')"` from action inputs before submitting.
  `validate_flow` rejects it, and the service writes it back itself. Its absence in an export is
  not drift.
- `preview_update` reports container actions as changed with `fields: []`. That is differ noise.
- Submit definitions built with `json.dumps(..., ensure_ascii=True)`. Never rebuild a definition
  from an `az rest` capture on Windows: it silently drops characters outside cp1252, including
  the `→` and `⚠` already present in these flows.
- Re-export each touched flow to `flows/exports/<Flow-Name>-<YYYY-MM-DD>.json` after it tests
  green.

**Platform limits, all previously hit on this project**

- `Terminate` cannot sit inside any loop, `Until` included.
- `InitializeVariable` cannot nest inside any container, including `If` and `Scope`. All variable
  initialisation goes at the top level, before the containers that use it.
- `runAfter` is container-scoped and cannot reach across a `Scope`, `If` or `Foreach`.
- The SharePoint `GetItems` operation rejects `$select` outright
  (`WorkflowOperationParametersExtraParameter`).
- `select` and `filter` are not valid WDL expression functions. Use `Query` (Filter array) actions.

**Data shape rules**

- The SharePoint connector returns a lookup as `Job` (object with `Id` and `Value`) plus
  `Job#Id`. It does **not** return `JobId` in output. `JobId` is the REST/OData name and is
  correct in a server-side `$filter`, and only there. Same pattern for `Assignment` /
  `AssignmentId` on Tasks.
- Crews join on `CrewID`, never `Title`.
- Write date-only fields as a bare `yyyy-MM-dd` string. An explicit `...T00:00:00Z` stores
  midnight UTC and reads back one day early.
- `DurationDays` means **work** days, not the inclusive calendar span. Only the endpoints must be
  working days; a span may legitimately contain a Sunday.

**Verification rule**

A 200/201/204 proves nothing on this platform. Verify every task by reading data back from the
list or from a run's action outputs. This project has three recorded cases of a successful write
that did nothing.

**Test rig**

`TEST-9001` and `TEST-9002` are live in the tenant and are the test data for every task here. Do
not delete them; their removal is sequenced for just before the pilot.

---

## File and artifact map

| Artifact | Type | Responsibility |
|---|---|---|
| `sharepoint/provision-reschedule.js` | new script | Creates `SuppressReconcileUntil`, the `Reschedule Requests` list, and the `Planned Pools` view. Idempotent. |
| `D2 - Event-Driven Reconciliation` | existing flow | Gains a status gate and a suppression gate. |
| `D2 — Daily Dispatch + Reminders` | existing flow | Gains an Active-job filter. |
| `D2 - Nightly Reconciliation` | existing flow | Gains an Active-job filter. |
| `D2 - Daily Summary`, `D2 - Weekly Summary` | existing flows | Gain Active-job filters on the assignment tables. |
| `flows/definitions/D2-Reschedule-Pool.json` | new definition | The reflow flow. |
| `flows/exports/*` | regenerated | Post-change exports. |

---

### Task 1: Schema and list scaffolding

**Files:**
- Create: `sharepoint/provision-reschedule.js`

**Interfaces:**
- Produces: `Assignments.SuppressReconcileUntil` (DateTime, optional); list `Reschedule Requests`
  with columns `JobNumber`, `FromSequence`, `NewStartDate`, `Status`, `Result`; Jobs view
  `Planned Pools`.

- [ ] **Step 1: Confirm the browser session before writing anything**

Call `list_pages`, then run in the page:

```js
await (await fetch('https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler/_api/web/currentuser',
  {headers:{Accept:'application/json;odata=verbose'},credentials:'include'})).json()
```

Expected: `LoginName` is `i:0#.f|membership|stratirus@d2pools.com`.

- [ ] **Step 2: Write `sharepoint/provision-reschedule.js`**

Field creates must be **sequential** on a given list; parallel creates contend and 500 with
"requires a newer version". Item creates may be parallel in chunks of 8.

`SuppressReconcileUntil` must be **optional**. Four Required columns seeded NULL previously made
the Assignments list form refuse to save any hand edit.

```js
/* Adds the reflow scaffolding: one Assignments column, the Reschedule Requests
 * list, and a Planned Pools view on Jobs. Idempotent: re-running reports what
 * already existed and creates nothing twice.
 *
 * SuppressReconcileUntil is a TIMESTAMP, not a boolean, so it expires on its
 * own. A boolean would need a reset write, and a reset that failed would leave
 * a row permanently invisible to conflict detection.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method:'POST', headers:H, credentials:'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const get = async u => (await fetch(u, { headers:{Accept:H.Accept}, credentials:'include' })).json();
  const post = (u, body, extra={}) => fetch(u, { method:'POST', credentials:'include',
    headers:{...HD, ...extra}, body: JSON.stringify(body) });
  const out = [];

  // 1. Assignments.SuppressReconcileUntil  (DateTime, NOT required)
  const aFields = await get(`${site}/_api/web/lists/GetByTitle('Assignments')/fields?$select=InternalName`);
  if (aFields.d.results.some(f => f.InternalName === 'SuppressReconcileUntil')) {
    out.push('SuppressReconcileUntil: already present');
  } else {
    const xml = `<Field Type='DateTime' DisplayName='SuppressReconcileUntil' `
              + `Name='SuppressReconcileUntil' Format='DateTime' Required='FALSE' />`;
    const r = await post(`${site}/_api/web/lists/GetByTitle('Assignments')/fields/CreateFieldAsXml`,
      { parameters: { __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' },
                      SchemaXml: xml, Options: 8 } });
    out.push(`SuppressReconcileUntil: create ${r.status}`);
  }

  // 2. Reschedule Requests list
  const lists = await get(`${site}/_api/web/lists?$select=Title`);
  if (lists.d.results.some(l => l.Title === 'Reschedule Requests')) {
    out.push('Reschedule Requests: already present');
  } else {
    await post(`${site}/_api/web/lists`,
      { __metadata:{type:'SP.List'}, BaseTemplate:100, Title:'Reschedule Requests',
        Description:'Ask the system to recompute a pool schedule from a sub-phase onward.' });
    const base = `${site}/_api/web/lists/GetByTitle('Reschedule Requests')/fields/CreateFieldAsXml`;
    const fields = [
      `<Field Type='Text' DisplayName='JobNumber' Name='JobNumber' Required='TRUE' />`,
      `<Field Type='Number' DisplayName='FromSequence' Name='FromSequence' Required='TRUE' Decimals='0' />`,
      `<Field Type='DateTime' DisplayName='NewStartDate' Name='NewStartDate' Format='DateOnly' Required='FALSE' />`,
      `<Field Type='Choice' DisplayName='Status' Name='Status' Required='FALSE'>`
        + `<Default>Requested</Default><CHOICES>`
        + `<CHOICE>Requested</CHOICE><CHOICE>Running</CHOICE><CHOICE>Done</CHOICE><CHOICE>Failed</CHOICE>`
        + `</CHOICES></Field>`,
      `<Field Type='Note' DisplayName='Result' Name='Result' Required='FALSE' NumLines='6' />`
    ];
    for (const xml of fields) {   // SEQUENTIAL: parallel field creates contend and 500
      const r = await post(base, { parameters:{ __metadata:{type:'SP.XmlSchemaFieldCreationInformation'},
                                                SchemaXml: xml, Options: 8 } });
      out.push(`Reschedule Requests field: ${r.status}`);
    }
  }

  // 3. Planned Pools view on Jobs
  const jv = await get(`${site}/_api/web/lists/GetByTitle('Jobs')/views?$select=Title`);
  if (jv.d.results.some(v => v.Title === 'Planned Pools')) {
    out.push('Planned Pools view: already present');
  } else {
    const r = await post(`${site}/_api/web/lists/GetByTitle('Jobs')/views`,
      { __metadata:{type:'SP.View'}, Title:'Planned Pools', ViewQuery:
        `<Where><Eq><FieldRef Name='Status'/><Value Type='Text'>Planned</Value></Eq></Where>`,
        RowLimit: 100, Paged: true });
    out.push(`Planned Pools view: create ${r.status}`);
  }
  console.log(out.join('\n'));
  return out;
})();
```

- [ ] **Step 3: Run it in the browser and read the output**

Expected: three create lines, no 500s.

- [ ] **Step 4: Verify by reading back, not by status code**

```js
const site='https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
const H={Accept:'application/json;odata=verbose'};
const g=async u=>(await fetch(u,{headers:H,credentials:'include'})).json();
const f=(await g(`${site}/_api/web/lists/GetByTitle('Assignments')/fields?$filter=InternalName eq 'SuppressReconcileUntil'`)).d.results[0];
const rr=(await g(`${site}/_api/web/lists/GetByTitle('Reschedule Requests')/fields?$select=InternalName,Required`)).d.results
  .filter(x=>['JobNumber','FromSequence','NewStartDate','Status','Result'].includes(x.InternalName))
  .map(x=>`${x.InternalName}:${x.Required}`);
const v=(await g(`${site}/_api/web/lists/GetByTitle('Jobs')/views?$select=Title,ViewQuery`)).d.results
  .find(x=>x.Title==='Planned Pools');
return {field:{type:f&&f.TypeAsString,required:f&&f.Required}, rescheduleFields:rr, plannedView:!!v};
```

Expected: `field.required` is **false**; all five request columns present; `plannedView` true.

- [ ] **Step 5: Open the `Planned Pools` view in the browser**

A view can be created with invalid CAML and fail only when a human opens it. Navigate to the Jobs
list, switch to `Planned Pools`, and confirm it renders. It will be empty, which is correct: all
three current jobs are `Active`.

- [ ] **Step 6: Commit**

```bash
git add sharepoint/provision-reschedule.js
git commit -m "Add reflow scaffolding: SuppressReconcileUntil, Reschedule Requests, Planned Pools view"
```

---

### Task 2: Event-Driven Reconciliation honours status and suppression

**Files:**
- Modify: flow `D2 - Event-Driven Reconciliation`, id `523d99c0-bc2e-7819-5d96-6faab60734f1`,
  `workflowEntityId` `2764968c-4aa6-f111-b8dd-6045bd0196b3`

**Interfaces:**
- Consumes: `Assignments.SuppressReconcileUntil` from Task 1.
- Produces: the gate every later task relies on to keep reflow quiet.

This flow already terminates early when the version-history gate sees no scheduling change. Two
more reasons to terminate go **after** that gate, so the cheapest check still runs first.

- [ ] **Step 1: Read the current published definition and write down two names**

Use FlowAgent `get_flow` (not `az rest`, which corrupts non-cp1252 glyphs).

Record: the exact action name that currently runs immediately after the version-history gate.
That name replaces `ACTION_AFTER_VERSION_GATE` in Step 3. Also note the existing `Terminate`
action's shape so the new ones match it. These are read from the artifact rather than guessed,
because action names in this flow have been renamed at least once.

- [ ] **Step 2: Confirm the real accessor for the job id from a past run**

Do not construct this from memory. Use FlowAgent `get_run_actions` on a recent successful run and
read `Get_touched_assignment`'s output. Confirm whether the job id is at `body/Job/Id` or
`body/Job#Id`. The connector returns both `Job` (object) and `Job#Id` (scalar); pick whichever the
real payload shows and use it verbatim.

Expected: an object under `Job` with an `Id` property.

- [ ] **Step 3: Add `Get_touched_job` and the two gates**

```json
"Get_touched_job": {
  "type": "OpenApiConnection",
  "inputs": {
    "host": { "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
              "operationId": "GetItems", "connectionName": "shared_sharepointonline" },
    "parameters": {
      "dataset": "https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler",
      "table": "ee0ecabf-2f11-458d-a9ea-641f76d10cc3",
      "$filter": "@{concat('ID eq ', string(outputs('Get_touched_assignment')?['body/Job']?['Id']))}",
      "$top": 1
    }
  },
  "runAfter": { "ACTION_AFTER_VERSION_GATE": [ "Succeeded" ] }
},
"Skip_non_active_job": {
  "type": "If",
  "expression": {
    "not": {
      "equals": [ "@{first(outputs('Get_touched_job')?['body/value'])?['Status']}", "Active" ]
    }
  },
  "actions": {
    "Terminate_not_active": { "type": "Terminate", "inputs": { "runStatus": "Succeeded" } }
  },
  "runAfter": { "Get_touched_job": [ "Succeeded" ] }
},
"Skip_suppressed_row": {
  "type": "If",
  "expression": {
    "greater": [
      "@ticks(coalesce(outputs('Get_touched_assignment')?['body/SuppressReconcileUntil'], '1900-01-01T00:00:00Z'))",
      "@ticks(utcNow())"
    ]
  },
  "actions": {
    "Terminate_suppressed": { "type": "Terminate", "inputs": { "runStatus": "Succeeded" } }
  },
  "runAfter": { "Skip_non_active_job": [ "Succeeded" ] }
}
```

`ticks()` rather than string comparison, so this does not depend on both timestamps being
formatted identically. `coalesce` supplies a far-past date when the column has never been set;
remember the connector omits null-valued fields from its output entirely rather than emitting
null, so the accessor may be absent, not null.

Rewire the first action of the existing conflict-check chain to `runAfter`
`Skip_suppressed_row: [ "Succeeded" ]`.

- [ ] **Step 4: Validate, update, publish**

```
validate_flow -> preview_update -> update_flow (with previewToken) -> PublishXml
```

`PublishXml` body:

```json
{"ParameterXml":"<importexportxml><workflows><workflow>{2764968c-4aa6-f111-b8dd-6045bd0196b3}</workflow></workflows></importexportxml>"}
```

- [ ] **Step 5: Test the status gate**

Set `TEST-9001` to `Planned` via REST MERGE on its Jobs row. Then edit `ScheduledFinish` on any
`TEST-9001` assignment. Read the run with `get_run_actions`.

Expected: `Skip_non_active_job` succeeded, `Terminate_not_active` ran, everything downstream
Skipped.

- [ ] **Step 6: Test that an Active job still reconciles**

Edit `ScheduledFinish` on a `TEST-9002` assignment (`TEST-9002` stays `Active`).

Expected: the run proceeds past both gates into the conflict check. This is the check that proves
the gate is not over-filtering.

- [ ] **Step 7: Test the suppression gate**

MERGE `SuppressReconcileUntil` on one `TEST-9002` assignment to five minutes ahead, then edit its
`ScheduledFinish`.

Expected: `Terminate_suppressed` ran. Wait for the window to pass, edit again, and confirm the run
now proceeds.

- [ ] **Step 8: Restore `TEST-9001` to `Active`, re-export, commit**

```bash
git add flows/exports/
git commit -m "Flow 3: skip reconciliation for non-Active jobs and suppressed rows"
```

---

### Task 3: Daily Dispatch honours status

**Files:**
- Modify: flow `D2 — Daily Dispatch + Reminders`, id `2683f70a-1bed-b842-b26a-7796485c5233`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on.

**This is the dangerous one.** Over-filter it and crews receive no dispatch at all, silently. The
2026-09-01 verification pass missed a total failure of this flow because it ran on a day with no
scheduled work, so a green run proves nothing here.

- [ ] **Step 1: Read the published definition, note the Filter array actions and one name**

Record the exact action name that currently runs immediately before `Apply_to_each`. That name
replaces `ACTION_BEFORE_APPLY_TO_EACH` in Step 2.

`Filter_array` and `Filter_array_2` currently use:

```
@equals(item()?['Crew'], items('Apply_to_each')?['CrewID'])
```

- [ ] **Step 2: Add the Active-job lookup at top level**

Both actions must run before `Apply_to_each`, and `InitializeVariable` cannot go inside a
container, so keep these at the top level too.

```json
"Get_active_jobs": {
  "type": "OpenApiConnection",
  "inputs": {
    "host": { "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
              "operationId": "GetItems", "connectionName": "shared_sharepointonline" },
    "parameters": {
      "dataset": "https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler",
      "table": "ee0ecabf-2f11-458d-a9ea-641f76d10cc3",
      "$filter": "Status eq 'Active'",
      "$top": 500
    }
  },
  "runAfter": { "ACTION_BEFORE_APPLY_TO_EACH": [ "Succeeded" ] }
},
"Select_active_ids": {
  "type": "Select",
  "inputs": {
    "from": "@outputs('Get_active_jobs')?['body/value']",
    "select": "@string(item()?['ID'])"
  },
  "runAfter": { "Get_active_jobs": [ "Succeeded" ] }
}
```

Projected as **strings** and compared as strings, deliberately. This project has lost time to
int-versus-string mismatches that match nothing and fail silently.

- [ ] **Step 3: Add the clause to both Filter array actions**

```
@and(
  equals(item()?['Crew'], items('Apply_to_each')?['CrewID']),
  contains(body('Select_active_ids'), string(item()?['Job']?['Id']))
)
```

Apply to `Filter_array` and `Filter_array_2`. Do not change the `Crew` comparison: it joins on
`CrewID`, which was fixed on 2026-09-03 and is easy to reintroduce as a bug.

- [ ] **Step 4: Validate, update, publish**

- [ ] **Step 5: Test on a day that HAS work, with one Planned pool and one Active pool**

Set `TEST-9001` to `Planned`. Confirm at least one `TEST-9002` assignment covers today; if none
does, MERGE one so that it does, because a run on an empty day proves nothing.

Run the flow manually. Read the rendered email body from the run's action outputs.

Expected: `TEST-9002` rows present, `TEST-9001` rows absent, and the email is populated rather
than "No sub-phase scheduled today" for the crew that has work.

- [ ] **Step 6: Confirm the reminder branch too**

`Filter_array_2` drives the unsigned-yesterday reminder. Verify the same filtering applied there
by reading its output in the same run.

- [ ] **Step 7: Restore `TEST-9001` to `Active`, re-export, commit**

```bash
git add flows/exports/
git commit -m "Flow 1: dispatch only Active pools"
```

---

### Task 4: Nightly Reconciliation honours status

**Files:**
- Modify: flow `D2 - Nightly Reconciliation`, id `e51b5571-5062-7eae-9de4-900f2c93d95d`

- [ ] **Step 1: Add `Get_active_jobs` and `Select_active_ids`**

Identical to Task 3 Step 2. Place both before the action that currently consumes
`Get_assignments`.

- [ ] **Step 2: Filter the assignments before the sweep**

```json
"Filter_active_assignments": {
  "type": "Query",
  "inputs": {
    "from": "@outputs('Get_assignments')?['body/value']",
    "where": "@contains(body('Select_active_ids'), string(item()?['Job']?['Id']))"
  },
  "runAfter": { "Select_active_ids": [ "Succeeded" ] }
}
```

Repoint whatever currently reads `outputs('Get_assignments')?['body/value']` at
`body('Filter_active_assignments')`.

- [ ] **Step 3: Validate, update, publish**

- [ ] **Step 4: Test both directions**

Seed a deliberate double-book inside `TEST-9002` (same crew, same day, two assignments). Set
`TEST-9001` `Planned` and seed a double-book there too.

Run manually. Expected: the `TEST-9002` conflict is reported, the `TEST-9001` conflict is not.

- [ ] **Step 5: Remove the seeded conflicts, restore `TEST-9001`, re-export, commit**

```bash
git add flows/exports/
git commit -m "Flow 4: nightly sweep covers Active pools only"
```

---

### Task 5: Summary flows honour status

**Files:**
- Modify: `D2 - Daily Summary` (`761279bc-1ea0-8b3a-4737-0b8b313b44d7`),
  `D2 - Weekly Summary` (`aefcc38c-f6ff-221c-558c-8e521916a8cf`)

Both already have `Get_active_jobs` filtering `Status eq 'Active'`, used for the job **count**
only. Reuse it rather than adding a second lookup.

- [ ] **Step 1: Add `Select_active_ids` to each flow**

```json
"Select_active_ids": {
  "type": "Select",
  "inputs": { "from": "@outputs('Get_active_jobs')?['body/value']",
              "select": "@string(item()?['ID'])" },
  "runAfter": { "Get_active_jobs": [ "Succeeded" ] }
}
```

- [ ] **Step 2: Filter the four assignment reads**

Daily: `Get_today_assignments`, `Get_recent_finished`.
Weekly: `Get_week_assignments`, `Get_week_finished`.

For each, insert a `Query` action immediately after it:

```json
"Filter_active_<name>": {
  "type": "Query",
  "inputs": {
    "from": "@outputs('<the Get action>')?['body/value']",
    "where": "@contains(body('Select_active_ids'), string(item()?['Job']?['Id']))"
  }
}
```

Repoint downstream consumers at `body('Filter_active_<name>')`. Compliance is scored from
`Get_recent_finished` and `Get_week_finished`, so filtering those is what stops a Planned pool
depressing Don's percentage.

- [ ] **Step 3: Validate, update, publish both**

- [ ] **Step 4: Test**

Set `TEST-9001` `Planned`, run both summaries manually, and read the rendered HTML from the run
outputs.

Expected: no `TEST-9001` rows in either schedule table, and the compliance denominator drops by
the number of `TEST-9001` rows that had finished.

- [ ] **Step 5: Restore `TEST-9001`, re-export, commit**

```bash
git add flows/exports/
git commit -m "Flow 5: summaries and compliance cover Active pools only"
```

---

### Task 6: The reflow flow, skeleton and failure path

**Files:**
- Create: `flows/definitions/D2-Reschedule-Pool.json`

**Interfaces:**
- Consumes: `Reschedule Requests` list from Task 1.
- Produces: flow `D2 - Reschedule Pool`; later tasks add the walk and the conflict report inside
  it.

Build the guards and the failure path **first**. `D2 - New Pool` shipped with no failure path at
all, which a whole-branch review caught, and a reflow that dies midway leaves a half-reordered
schedule, which is worse than one that refuses to start.

- [ ] **Step 1: Author the definition with trigger, guards and both exits**

Start from `flows/exports/D2-New-Pool-2026-09-08.json` as the working template rather than a blank
page. It already has the shape this flow needs: a request-list trigger, a status-transition
pattern, top-level variable initialisation, a protective `Scope`, and a failure handler. Copy that
skeleton and replace the body.

Structure, all variable initialisation at the top level because containers reject
`InitializeVariable`:

1. Trigger: `GetOnNewItems` on `Reschedule Requests`.
2. `Init_result` (string), `Init_moved` (integer), `Init_skipped` (string), `Init_cursor`
   (string), `Init_nonWork` (array). Top level, before any container.
3. `Set_status_running`: MERGE `Status = Running` on the request row.
4. `Scope_reflow` containing the work.
5. `Handle_failure`: `runAfter` `Scope_reflow: ["Failed","TimedOut"]`. MERGE
   `Status = Failed` plus `Result`, and send an email to the requester.
6. `Set_status_done`: `runAfter` `Scope_reflow: ["Succeeded"]`.

Inside `Scope_reflow`:

- `Get_job`: `$filter=@{concat('JobNumber eq ''', triggerOutputs()?['body/JobNumber'], '''')}`,
  `$top=2`.
- `Condition_job_found`: when `length(outputs('Get_job')?['body/value'])` is not 1, set
  `variables('result')` to the failure reason and set a boolean `failed` variable true. Do **not**
  force a scope failure with a deliberately invalid expression, and do **not** put a `Terminate`
  inside a loop. A top-level condition after `Scope_reflow` reads `failed` and routes to the
  failure exit. This keeps one exit path rather than two competing ones.
- `Get_assignments`: `$filter=@{concat('JobId eq ', string(first(outputs('Get_job')?['body/value'])?['ID']))}`,
  `$orderby=Sequence asc`, `$top=200`.
- `Filter_from_sequence`: `Query` where
  `@greaterOrEquals(item()?['Sequence'], triggerOutputs()?['body/FromSequence'])`.
- `Condition_sequence_exists`: when `length(body('Filter_from_sequence'))` is 0, fail with
  "No sub-phase with Sequence N in job X". This is the guard that stops the flow reporting success
  after doing nothing.

- [ ] **Step 2: Create the flow**

FlowAgent `create_flow` with `state: "Stopped"` and full `connectionRefs`, then `PublishXml`
against the returned `workflowid`, then `publish_flow` to start it. No designer visit is needed;
`D2 - New Pool` and Flow 4 were both built this way.

- [ ] **Step 3: Test the not-found guard**

Create a request row with `JobNumber = NOPE-0000`, `FromSequence = 1`.

Expected: request row reaches `Status = Failed`, `Result` names the job number, and an email
arrives.

- [ ] **Step 4: Test the bad-sequence guard**

Request `JobNumber = TEST-9002`, `FromSequence = 999`.

Expected: `Failed`, with a `Result` naming the sequence. Specifically **not** `Done` with zero
rows moved.

- [ ] **Step 5: Test the happy path reaches the end**

Request `TEST-9002`, `FromSequence = 1`, no `NewStartDate`. The walk does not exist yet, so
nothing should move.

Expected: `Status = Done`, and every `TEST-9002` assignment's dates are byte-identical to before.
Capture all `TEST-9002` dates before and after and diff them.

- [ ] **Step 6: Commit**

```bash
git add flows/definitions/D2-Reschedule-Pool.json flows/exports/
git commit -m "Add D2 - Reschedule Pool: trigger, guards and failure path"
```

---

### Task 7: The reflow walk

**Files:**
- Modify: `flows/definitions/D2-Reschedule-Pool.json`

**Interfaces:**
- Consumes: `Filter_from_sequence` and the initialised variables from Task 6.
- Produces: the date rewrite that Task 8 suppresses reconciliation for.

- [ ] **Step 1: Add the Work Calendar read**

Copy the pattern from `D2 - New Pool` verbatim rather than reinventing it:

```json
"Get_work_calendar": {
  "type": "OpenApiConnection",
  "inputs": { "host": { "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
      "operationId": "GetItems", "connectionName": "shared_sharepointonline" },
    "parameters": { "dataset": "https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler",
      "table": "d36758cf-9d27-4342-84e4-817f8dcfa2ba", "$top": 500 } }
},
"Select_nonWork": {
  "type": "Select",
  "inputs": { "from": "@outputs('Get_work_calendar')?['body/value']",
              "select": "@formatDateTime(item()?['Date'], 'yyyy-MM-dd')" }
}
```

Then `Set_nonWork` assigning `body('Select_nonWork')` to the top-level `nonWork` variable.

- [ ] **Step 2: Set the starting cursor**

```
@if(empty(coalesce(triggerOutputs()?['body/NewStartDate'], '')),
    formatDateTime(first(body('Filter_from_sequence'))?['ScheduledStart'], 'yyyy-MM-dd'),
    formatDateTime(triggerOutputs()?['body/NewStartDate'], 'yyyy-MM-dd'))
```

- [ ] **Step 3: Add the per-row loop**

`Apply_to_each_row` over `body('Filter_from_sequence')`. Inside, in order:

1. `Condition_pinned`: true when
   `@or(equals(item()?['Locked'], true), equals(item()?['InstallerSignOff'], true))`.
   When true: set the cursor to the first working day after `item()?['ScheduledFinish']` and
   append the row to `skipped` with reason `pinned`. Write nothing.
2. `Condition_bad_duration`: true when
   `@lessOrEquals(coalesce(item()?['DurationDays'], 0), 0)`. When true: append to `skipped` with
   reason `no duration`, leave the cursor alone, write nothing. Do not guess a duration.
3. Otherwise run the span walk, which is `D2 - New Pool`'s `Do_until_span_complete` with the same
   `Condition_is_work_day`:

```
and( not(equals(dayOfWeek(outputs('Compose_current_date')), 0)),
     not(contains(variables('nonWork'), outputs('Compose_current_date'))) )
```

   `Terminate` may not appear inside the `Until`. Exit the loop on its condition only.

4. `Condition_changed`: compare computed start and finish against
   `formatDateTime(item()?['ScheduledStart'],'yyyy-MM-dd')` and the same for finish. Write only
   when one differs, so a no-op reflow performs zero writes.
5. `Merge_dates`: `Send an HTTP request to SharePoint`, `X-HTTP-Method: MERGE`, body containing
   only `ScheduledStart` and `ScheduledFinish` as **bare `yyyy-MM-dd` strings**. Use MERGE, not
   `Update item`: Assignments has seven required columns and `Update item` demands all of them.
6. Increment `moved`, and set the cursor to the first working day after the computed finish.

- [ ] **Step 4: Write the result summary**

`Result` should name rows moved, rows skipped with reasons, the pool's new finish date, and how
many rows landed before today. Dates in the past are honoured, not clamped; the count is how the
PM finds out.

- [ ] **Step 5: Test the shift**

Capture every `TEST-9002` assignment's `Sequence`, `ScheduledStart`, `ScheduledFinish` first.
Request a reflow from a middle sequence with a `NewStartDate` three working days later.

Expected, verified by reading the rows back:
- Rows below `FromSequence` unchanged, byte for byte.
- Rows at and above shifted, with no gaps or overlaps in the chain.
- No `ScheduledStart` or `ScheduledFinish` on a Sunday or on a Work Calendar date.
- Each row's span still equals its `DurationDays` in working days.

- [ ] **Step 6: Test pinning**

Set `Locked = true` on one row in the middle of the range. Reflow again.

Expected: that row's dates unchanged, and the row after it resumes from the first working day
after the pinned row's finish.

- [ ] **Step 7: Test the signed-off pin**

Sign off a `TEST-9002` row through the app or by MERGE, reflow across it, and confirm its dates
did not move.

- [ ] **Step 8: Test the no-op case**

Reflow twice in a row with identical inputs. The second run should report zero rows moved and
perform zero writes.

- [ ] **Step 9: Commit**

```bash
git add flows/definitions/D2-Reschedule-Pool.json flows/exports/
git commit -m "Reschedule Pool: working-day walk, Locked and signed-off pinning"
```

---

### Task 8: Suppression and the conflict report

**Files:**
- Modify: `flows/definitions/D2-Reschedule-Pool.json`

**Interfaces:**
- Consumes: `SuppressReconcileUntil` (Task 1) and Flow 3's suppression gate (Task 2).

- [ ] **Step 1: Set the suppression window in the same MERGE**

Add to `Merge_dates`' body, so it is one write rather than two:

```
"SuppressReconcileUntil": "@{addMinutes(utcNow(), 10)}"
```

Ten minutes comfortably exceeds a 46-row reflow and expires on its own.

- [ ] **Step 2: Add the end-of-run conflict sweep**

After the loop, re-read the job's assignments and check each non-`Unlimited` crew for a day
appearing on more than one job. Reuse the comparison shape from `D2 - Nightly Reconciliation`
rather than writing a new one. Crews join on `CrewID`.

- [ ] **Step 3: Report always, alert only when Active**

Write the conflict list into `Result` and into the completion email to the requester whatever the
job's status. Send a conflict **alert** email only when the job's `Status` is `Active`.

The distinction is an alert versus a report. A PM choosing dates wants to know the pool collides
with an existing pool on three days.

- [ ] **Step 4: Test that a reflow produces at most one email**

Reflow a range covering 20 or more rows on `TEST-9002` (Active).

Expected: `SuppressReconcileUntil` populated on every written row; Flow 3 run history shows those
runs terminating at `Terminate_suppressed`; at most one conflict alert email.

- [ ] **Step 5: Test the Planned case reports without alerting**

Set `TEST-9001` `Planned`, seed an overlap against `TEST-9002`, reflow `TEST-9001`.

Expected: the conflict appears in `Result` and the completion email; no alert email.

- [ ] **Step 6: Confirm suppression expires**

After the window, edit a previously reflowed row and confirm Flow 3 now runs the conflict check
normally.

- [ ] **Step 7: Restore `TEST-9001`, re-export, commit**

```bash
git add flows/definitions/D2-Reschedule-Pool.json flows/exports/
git commit -m "Reschedule Pool: suppress the write storm, report conflicts, alert only when Active"
```

---

### Task 9: Documentation and close-out

**Files:**
- Modify: `CLAUDE.md`, `D2-Phase-F-Cutover-Runbook.md`, `D2-Phase-E-Pilot-Runbook.md`

- [ ] **Step 1: Update CLAUDE.md**

Add `D2 - Reschedule Pool` to the flow table with both its flow id and its `workflowEntityId`,
recording them under the correct labels. Three rows in that table previously carried a
`workflowEntityId` mislabelled as a flow id.

Record: `Planned` is now a real state; `Locked` now pins a row against reflow; and
`SuppressReconcileUntil` exists, is a timestamp, and why it is not a boolean.

- [ ] **Step 2: Update the runbooks**

Phase F Step 3 and Phase E Step 2 both describe reconciling a generated pool by hand. Replace the
hand-editing with: raise a Reschedule Request from sequence 1 with the real start date, then
adjust only what remains. Add committing the pool from `Planned` to `Active` as an explicit step,
because nothing dispatches until it happens.

Add "start a new pool" to the office quick reference with the commit step included.

- [ ] **Step 3: Update the starter guide artifact**

Stage 1 gains the commit step. Stage 2's flag about moving one date no longer moving the others is
now wrong, so replace it with how to reflow. Remove the corresponding items from the draft notes.

- [ ] **Step 4: Verify the whole loop once, end to end**

Raise a New Pool Request for `TEST-9100`. Confirm it arrives `Planned`, dispatches nothing, raises
no conflict alerts. Reflow it from sequence 1 to a chosen start date. Commit it to `Active`.
Confirm dispatch picks it up the next run. Then delete it via a Delete Pool Request.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Document pool lifecycle and reflow; update runbooks and starter guide"
```

---

## Notes for the executor

**Do not batch the flow edits into one publish.** Tasks 2 through 5 each touch a different
published flow, and each has its own verification. A single failed publish across four flows is
much harder to unpick than four.

**Restore `TEST-9001` to `Active` at the end of every task that changes it.** Several tasks assume
it starts `Active`.

**If a flow edit appears to do nothing**, you are almost certainly reading the published row after
writing the draft. Use `preview_update` with the `previewToken` to see the real error, and
`PublishXml` to promote.
