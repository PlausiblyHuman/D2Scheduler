# Spec A: Complete Projects and Live Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Counter Reconciliation failing nightly, then let a PM mark a finished project Complete so the planner and every whole-list flow read only live projects.

**Architecture:** Part 1 rewrites `D2 - Counter Reconciliation` to read per live project (Jobs `Status ne 'Complete'`), shipped alone because it has failed with `ReadAtCap` since 2026-10-01 03:30. Part 2 adds the existing live-job clause idiom to Crew Trade Check, Conflict Flag and Reschedule Pool. Part 3 changes the planner: per-job Graph reads, Mark complete / Completed projects / Reopen on the Jobs tab, a read-only Open, and Save re-reading only the jobs it writes.

**Tech Stack:** Power Automate definitions edited through Dataverse `workflows(<id>).clientdata` PATCH + `PublishXml` (Python, `urllib`, `az` tokens); SharePoint connector `GetItems`; single-file planner `web/index.html` with UMD helpers in `web/*.js`; jsdom harnesses under `fixtures/planner/` with `mutate.py` sweeps.

**Spec:** `docs/superpowers/specs/2026-09-28-complete-projects-and-live-reads-design.md`

## Context that changed after the spec was written (2026-10-01)

- Don raised 32 real projects at once on 2026-09-30. At 03:30 on 10-01 Counter Reconciliation read 809 assignments and a capped 5,000 tasks and terminated `ReadAtCap` (the guard working). It will fail every night until Task 2 ships. **Part 1 is the urgent deliverable; Parts 2 and 3 follow.**
- Today "live" (Status not `Complete`) is all ~34 projects. Nothing is Complete yet, so the per-job read is what fixes the cap now; completing projects is what keeps it fixed.
- Concurrent New Pool builds **interleave assignment ids**, so a job's assignments are never a contiguous id range. Tasks for a job must be read by an explicit `or` chain of its assignment ids (spec section 2), never by an id range.

## Global Constraints

- Completed value is `Complete` (existing `Jobs.Status` choice). No schema change, no new column.
- Control labels, verbatim: **Mark complete**, **Completed projects**, **Reopen**, chip **Ready to complete**, banner "N projects are ready to complete: <jobnos>.", read-only banner "Completed project, read only".
- Eligible to complete: `Status = Active`, not building, every sub-phase `s.inst` or `s.skip`. PM sign-off does not count.
- Mark complete and Reopen write immediately through `doSetPoolStatus(jobId, from, to)` (web/index.html:1778), then Refresh.
- Flow edits go through the Dataverse `clientdata` route, never `edit_flow`. Serialise with `json.dumps(..., ensure_ascii=True)`. Never rebuild a definition from an `az rest` capture.
- Every flow script asserts `az account show --query tenantId` == `f24d9b39-6a71-4f4e-a376-03b6f61c97e4` before any call, and defaults to dry run.
- Platform rules: no `Terminate` inside any loop; no `InitializeVariable` inside any container; nesting depth max 8; one connector read returns at most 5,000 rows.
- Graph lookup ids are STRINGS (`fields.JobLookupId`, `fields.AssignmentLookupId`, `fields.id`). Normalise both sides of every join with `String()`.
- The Save allowlist (`crew, start, days, locked, skip`), compare-before-write and sign-off attribution do not change.
- Copy in anything client-visible: no em dashes, no internal attribution.
- Verification is by reading rows and run action outputs back, never by a status code.

## Review Focus

1. **Unsaved sign-off ticks when Mark complete is pressed.** A PM ticks the last INST box and presses Mark complete without Save. Expected: refused with "Save first", because the write plus Refresh would discard the ticks and complete a project SharePoint still holds unsigned. Test in Task 9.
2. **A live job with zero assignments** (a New Pool build that failed early, or mid-build). Expected: no `()` empty `or` filter is sent; the job is skipped in the flow and maps to an empty project in the planner. Tests in Tasks 1 and 6.
3. **Two job numbers differing only by whitespace** (`26-2055` and `26- 2055` are both live today). Expected: completing one removes only that one from the planner. `completedJobNumbers` matching uses the same exact `String(jobno)` comparison as `importFromD2Payload` (index.html:1892-1895). Test in Task 7.
4. **String vs number ids from Graph.** Expected: `liveById` keys and the `or` chain values both come from `String(fields.id)`, and a numeric id in a stub still matches. Tests in Tasks 6 and 8.
5. **Save, Auto-Schedule or Schedule Check with a read-only project open.** Expected: the project appears in no change set, sign-off set or rejection set; Auto-Schedule moves none of its rows; Schedule Check raises nothing for it. Test in Task 10.

---

## Part 1: Counter Reconciliation per live project (ship first)

### Task 1: Definition builder for the per-job Counter Reconciliation, with an offline structural test

**Files:**
- Create: `flows/scripts/counter_recon_per_job.py` (pure function building the new `actions` from the current ones)
- Create: `flows/scripts/test_counter_recon_per_job.py`
- Read for reference: `flows/exports/D2-Counter-Reconciliation-2026-09-28.json`, `flows/scripts/2026-09-28-read-cap-guards.py`

**Interfaces:**
- Produces: `build_actions(old_actions: dict, disarm: bool = False) -> dict` and `max_depth(actions: dict) -> int`, `terminates_in_loop(actions: dict) -> bool`. `disarm=True` replaces `Repair_counters` with a `Compose` holding the would-be MERGE body, so a copy can run against live data and write nothing.

New action graph (top level unless indented; `$DS` = `https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler`, `$SP` host = `{"apiId":"/providers/Microsoft.PowerApps/apis/shared_sharepointonline","connectionName":"shared_sharepointonline","operationId":"GetItems"}`):

```
Get_live_jobs            GetItems Jobs ee0ecabf-...  $filter "Status ne 'Complete'"  $top 500
Init_repaired            array []        runAfter Get_live_jobs
Init_capped              array []        runAfter Init_repaired
Init_tasks_scanned       integer 0       runAfter Init_capped
For_each_job             Foreach body('Get_live_jobs')?['value'], concurrency 1, runAfter Init_tasks_scanned
  Get_job_assignments    GetItems Assignments 49ef7006-...  $filter "JobId eq @{items('For_each_job')?['ID']}"  $top 500
  Select_task_clauses    Select from body('Get_job_assignments')?['value'] -> concat('AssignmentId eq ', string(item()?['ID']))
  Condition_job_readable If and(greater(length(asg),0), less(length(asg),500))
    Get_job_tasks        GetItems Tasks 22c45847-...  $filter "@{concat('(', join(body('Select_task_clauses'), ' or '), ')')}"  $top 5000
    Condition_tasks_complete If less(length(tasks),5000)
      Add_tasks_scanned  IncrementVariable tasks_scanned by length(tasks)
      Apply_to_each_assignment  (existing loop, concurrency 1, foreach body('Get_job_assignments')?['value'])
        Filter_tasks     from body('Get_job_tasks')?['value']   (was Get_all_tasks)
        Filter_done      unchanged
        Condition_drifted unchanged (Repair_counters, Record_repair)
    else: Record_tasks_capped  AppendToArray capped "<JobNumber>: tasks read returned 5,000"
  else: Condition_assignments_capped If greaterOrEquals(length(asg),500)
          Record_asg_capped  AppendToArray capped "<JobNumber>: assignments read returned 500"
Guard_capped             If not(empty(variables('capped')))   runAfter For_each_job
  Terminate_read_at_cap  Failed, code ReadAtCap, message names the capped jobs and says other jobs were repaired
Summarise                Compose {jobsChecked, tasksScanned, countersRepaired, detail, capped}  runAfter Guard_capped
```

Depth: For_each_job(1) > Condition_job_readable(2) > Condition_tasks_complete(3) > Apply_to_each_assignment(4) > Condition_drifted(5). `Terminate` sits at top level, after the loop, because Logic Apps forbids it inside any loop. `Get_all_tasks`, `Get_all_assignments` and `Guard_read_complete` are removed.

- [ ] **Step 1: Write the failing structural test**

```python
# flows/scripts/test_counter_recon_per_job.py
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from counter_recon_per_job import build_actions, max_depth, terminates_in_loop

EXP = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-Counter-Reconciliation-*.json'))[-1]
old = json.loads(EXP.read_text(encoding='utf-8'))['definition']['actions']
fails = 0
def ok(label, cond):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label); fails += (not cond)

for disarm in (False, True):
    A = build_actions(json.loads(json.dumps(old)), disarm=disarm)
    tag = 'disarmed' if disarm else 'live'
    ok(f'{tag}: whole-list reads removed', not any(k in A for k in ('Get_all_tasks', 'Get_all_assignments', 'Guard_read_complete')))
    ok(f'{tag}: live-job filter', A['Get_live_jobs']['inputs']['parameters']['$filter'] == "Status ne 'Complete'")
    ok(f'{tag}: no Terminate inside a loop', not terminates_in_loop(A))
    ok(f'{tag}: depth within 8', max_depth(A) <= 8)
    ok(f'{tag}: variables initialised at top level only', all(a['type'] != 'InitializeVariable' for a in A['For_each_job']['actions'].values()))
    job = A['For_each_job']
    ok(f'{tag}: jobs one at a time', job['runtimeConfiguration']['concurrency']['repetitions'] == 1)
    cond = job['actions']['Condition_job_readable']
    ok(f'{tag}: empty job never sends an empty or-chain', 'greater' in json.dumps(cond['expression']) and 'Get_job_tasks' in cond['actions'])
    tasks_q = cond['actions']['Get_job_tasks']['inputs']['parameters']['$filter']
    ok(f'{tag}: tasks read by or-chain of this job', "join(body('Select_task_clauses'), ' or ')" in tasks_q)
    loop = cond['actions']['Condition_tasks_complete']['actions']['Apply_to_each_assignment']
    ok(f'{tag}: counts from this job only', loop['actions']['Filter_tasks']['inputs']['from'] == "@body('Get_job_tasks')?['value']")
    ok(f'{tag}: Terminate after the loop', A['Guard_capped']['runAfter'] == {'For_each_job': ['Succeeded']})
    repair = loop['actions']['Condition_drifted']['actions']['Repair_counters']
    ok(f'{tag}: disarm controls writes', (repair['type'] == 'Compose') == disarm)
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python flows/scripts/test_counter_recon_per_job.py`
Expected: `ModuleNotFoundError: No module named 'counter_recon_per_job'`

- [ ] **Step 3: Write the builder**

```python
# flows/scripts/counter_recon_per_job.py
"""Builds D2 - Counter Reconciliation's per-live-job definition from the current actions."""
import copy

DS = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler'
JOBS, ASG, TASKS = 'ee0ecabf-2f11-458d-a9ea-641f76d10cc3', '49ef7006-d3fe-40a7-a52f-c4c18545bd35', '22c45847-ff0d-417a-b53e-1ea018fbb6d3'
HOST = {'apiId': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline', 'connectionName': 'shared_sharepointonline', 'operationId': 'GetItems'}
JOBNO = "@{items('For_each_job')?['JobNumber']}"

def get_items(table, after, flt, top):
    return {'runAfter': after, 'type': 'OpenApiConnection',
            'inputs': {'host': dict(HOST), 'parameters': {'dataset': DS, 'table': table, '$filter': flt, '$top': top}}}

def init(name, typ, value, after):
    return {'runAfter': {after: ['Succeeded']}, 'type': 'InitializeVariable',
            'inputs': {'variables': [{'name': name, 'type': typ, 'value': value}]}}

def append_capped(text):
    return {'runAfter': {}, 'type': 'AppendToArrayVariable', 'inputs': {'name': 'capped', 'value': text}}

def build_actions(old, disarm=False):
    loop = copy.deepcopy(old['Apply_to_each_assignment'])
    loop['foreach'] = "@body('Get_job_assignments')?['value']"
    loop['runAfter'] = {'Add_tasks_scanned': ['Succeeded']}
    loop['actions']['Filter_tasks']['inputs']['from'] = "@body('Get_job_tasks')?['value']"
    if disarm:
        r = loop['actions']['Condition_drifted']['actions']['Repair_counters']
        loop['actions']['Condition_drifted']['actions']['Repair_counters'] = {
            'runAfter': {}, 'type': 'Compose', 'inputs': r['inputs']['parameters']['parameters/body']}
    asg_len = "@length(body('Get_job_assignments')?['value'])"
    tasks_len = "@length(body('Get_job_tasks')?['value'])"
    A = {
        'Get_live_jobs': get_items(JOBS, {}, "Status ne 'Complete'", 500),
        'Init_repaired': init('repaired', 'array', [], 'Get_live_jobs'),
        'Init_capped': init('capped', 'array', [], 'Init_repaired'),
        'Init_tasks_scanned': init('tasks_scanned', 'integer', 0, 'Init_capped'),
        'For_each_job': {
            'runAfter': {'Init_tasks_scanned': ['Succeeded']}, 'type': 'Foreach',
            'foreach': "@body('Get_live_jobs')?['value']",
            'runtimeConfiguration': {'concurrency': {'repetitions': 1}},
            'actions': {
                'Get_job_assignments': get_items(ASG, {}, "JobId eq @{items('For_each_job')?['ID']}", 500),
                'Select_task_clauses': {
                    'runAfter': {'Get_job_assignments': ['Succeeded']}, 'type': 'Select',
                    'inputs': {'from': "@body('Get_job_assignments')?['value']",
                               'select': "@concat('AssignmentId eq ', string(item()?['ID']))"}},
                'Condition_job_readable': {
                    'runAfter': {'Select_task_clauses': ['Succeeded']}, 'type': 'If',
                    'expression': {'and': [{'greater': [asg_len, 0]}, {'less': [asg_len, 500]}]},
                    'actions': {
                        'Get_job_tasks': get_items(TASKS, {}, "@{concat('(', join(body('Select_task_clauses'), ' or '), ')')}", 5000),
                        'Condition_tasks_complete': {
                            'runAfter': {'Get_job_tasks': ['Succeeded']}, 'type': 'If',
                            'expression': {'less': [tasks_len, 5000]},
                            'actions': {
                                'Add_tasks_scanned': {'runAfter': {}, 'type': 'IncrementVariable',
                                                      'inputs': {'name': 'tasks_scanned', 'value': tasks_len}},
                                'Apply_to_each_assignment': loop},
                            'else': {'actions': {'Record_tasks_capped': append_capped(JOBNO + ': tasks read returned 5,000')}}}},
                    'else': {'actions': {'Condition_assignments_capped': {
                        'runAfter': {}, 'type': 'If',
                        'expression': {'greaterOrEquals': [asg_len, 500]},
                        'actions': {'Record_asg_capped': append_capped(JOBNO + ': assignments read returned 500')},
                        'else': {'actions': {}}}}}}}},
        'Guard_capped': {
            'runAfter': {'For_each_job': ['Succeeded']}, 'type': 'If',
            'expression': {'not': {'empty': ["@variables('capped')"]}},
            'actions': {'Terminate_read_at_cap': {'runAfter': {}, 'type': 'Terminate', 'inputs': {
                'runStatus': 'Failed', 'runError': {'code': 'ReadAtCap', 'message':
                    "@{concat('A read returned its maximum for: ', join(variables('capped'), '; '), '. Those projects were not recounted. Every other project was checked and repaired.')}"}}}},
            'else': {'actions': {}}},
        'Summarise': {
            'runAfter': {'Guard_capped': ['Succeeded']}, 'type': 'Compose',
            'inputs': {'jobsChecked': "@length(body('Get_live_jobs')?['value'])",
                       'tasksScanned': "@variables('tasks_scanned')",
                       'countersRepaired': "@length(variables('repaired'))",
                       'detail': "@variables('repaired')", 'capped': "@variables('capped')"}},
    }
    return A

def _children(a):
    kids = dict(a.get('actions', {}))
    kids.update(a.get('else', {}).get('actions', {}))
    return kids

def max_depth(actions, d=0):
    return max([d] + [max_depth(_children(a), d + 1) for a in actions.values() if a['type'] in ('If', 'Foreach', 'Until', 'Scope')])

def terminates_in_loop(actions, in_loop=False):
    for a in actions.values():
        if a['type'] == 'Terminate' and in_loop:
            return True
        if a['type'] in ('If', 'Foreach', 'Until', 'Scope') and terminates_in_loop(_children(a), in_loop or a['type'] in ('Foreach', 'Until')):
            return True
    return False
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `python flows/scripts/test_counter_recon_per_job.py`
Expected: every line `PASS`, exit 0.

- [ ] **Step 5: Prove the test bites.** Temporarily move `Terminate_read_at_cap` into `Condition_tasks_complete`'s else branch and rerun: `no Terminate inside a loop` must FAIL. Then change `Filter_tasks.from` back to `Get_all_tasks`: `counts from this job only` must FAIL. Revert both.

- [ ] **Step 6: Commit**

```bash
git add flows/scripts/counter_recon_per_job.py flows/scripts/test_counter_recon_per_job.py
git commit -m "Counter Reconciliation per live project: definition builder and structural test"
```

### Task 2: Run a disarmed copy against live data, then publish and verify both ways

**Files:**
- Create: `flows/scripts/2026-10-01-counter-recon-per-job.py` (modes `dry`, `copy`, `apply`; follows `2026-09-28-read-cap-guards.py` lines 7-81)
- Modify after publish: `flows/exports/D2-Counter-Reconciliation-2026-10-01.json` (via `export-flows.py`)

**Interfaces:**
- Consumes: `build_actions(old, disarm)` from Task 1.

- [ ] **Step 1: Write the script.** Same `ORG`, `token()` and `call()` as `2026-09-28-read-cap-guards.py:7-24`, plus a tenant assertion copied from `export-flows.py` `assert_tenant()` (lines 40-45) called first. Read `workflows(291fa9d9-caaa-f111-aaac-6045bd0195dd)?$select=clientdata,statecode,name,modifiedon`, assert `name == 'D2 - Counter Reconciliation'` and that `'Get_all_tasks' in actions` (refuse if already converted). Then:
  - `dry`: print action names before and after and byte sizes. Write nothing.
  - `copy`: POST a new `workflows` row (`name: 'D2 - Counter Reconciliation (disarmed test)'`, `category: 5`, `type: 1`, `primaryentity: 'none'`, `clientdata` from `build_actions(..., disarm=True)` with the trigger changed to `{"manual":{"type":"Request","kind":"Button","inputs":{"schema":{"type":"object","properties":{}}}}}`), then `PublishXml` it, print its id. This is the route the 2026-09-28 disarmed copies used.
  - `apply`: PATCH the live row's `clientdata` with `build_actions(..., disarm=False)` (`json.dumps(..., ensure_ascii=True)`), `PublishXml`, re-read the row and assert `Get_live_jobs` and `For_each_job` present and `Get_all_tasks` absent.

- [ ] **Step 2: Dry run.** `python flows/scripts/2026-10-01-counter-recon-per-job.py dry`. Expected: `actions 9 -> 7` (top level) and no HTTP write.

- [ ] **Step 3: Capture the or-chain shape on the connector surface.** `... copy`, then FlowAgent `publish_flow` + `run_flow` on the copy. Read its run actions through the ProcessSimple `runs/{run}/actions` API and fetch each `outputsLink` (recipe in CLAUDE.md, "Reading a run's action outputs headlessly"). Required evidence, written into the session log:
  - `Get_job_tasks` Succeeded for every job, including a 46-assignment job: the 46-term `or` chain is accepted.
  - For three sampled jobs, `length(Get_job_tasks)` equals the sum of that job's `TasksTotal`.
  - `capped` is empty. `Repair_counters` (a Compose) lists the rows that would be repaired.
  - **If `Get_job_tasks` fails on the long chain:** stop. Rework Task 1 so `Select_task_clauses` is chunked into groups of 15 (`chunk(body('Select_task_clauses'), 15)`), with a `Foreach` over chunks doing one `GetItems` each and `union` into a `job_tasks` array variable (initialised at top level, reset per job with `SetVariable`). Update the test, then repeat this step.
  - Delete the copy with FlowAgent `delete_flow`.

- [ ] **Step 4: Apply.** `... apply`. Expected: published row re-read shows the new actions, statecode 1.

- [ ] **Step 5: Verify both directions on throwaway rows** (needs the request-triggered REST proxy flow from CLAUDE.md, deleted afterwards):
  - Create `TEST-9801` (Jobs, Status `Planned`, PM D2 Bot site user 7) with one Assignment (all four required fields set, `TasksTotal 9`, `TasksComplete 9`) and two Tasks (one Complete).
  - Create `TEST-9802` the same, but Status `Complete`, counters `TasksTotal 9`, `TasksComplete 9`.
  - `run_flow` Counter Reconciliation. Read back: TEST-9801's assignment reads `2/1`, TEST-9802's still reads `9/9`. The run Succeeded, `Guard_capped` false, `Summarise.capped` empty, `jobsChecked` equals the number of non-Complete jobs.
  - Delete both test jobs' Tasks, Assignments and Jobs rows. Delete the proxy flow. Read the counts back.

- [ ] **Step 6: Export and commit**

```bash
python flows/scripts/export-flows.py "Counter Reconciliation"
git add flows/scripts/2026-10-01-counter-recon-per-job.py flows/exports/D2-Counter-Reconciliation-2026-10-01.json
git commit -m "Counter Reconciliation reads per live project; verified both ways"
```

- [ ] **Step 7: Next morning.** Confirm the 03:30 run Succeeded with `capped` empty.

## Part 2: whole-list flows skip Complete projects

### Task 3: Live-job clause on Crew Trade Check, Conflict Flag and Reschedule Pool

**Files:**
- Create: `flows/scripts/live_job_clause.py` (pure builder) and `flows/scripts/test_live_job_clause.py`
- Create: `flows/scripts/2026-10-01-live-job-clause.py` (modes `dry`, `apply`)

**Interfaces:**
- Produces: `clause_actions(after: str) -> dict` returning three actions, `Get_live_jobs` / `Select_live_job_ids` / `Compose_live_job_clause`, copied from Calendar Sync's idiom with the filter `Status ne 'Complete'`. `apply_to(actions: dict, read_name: str, after: str) -> None` inserts them before `read_name` and ANDs `@{outputs('Compose_live_job_clause')}` onto its `$filter` (or sets it if absent).

Idiom, verbatim apart from names and the filter:

```json
"Get_live_jobs": {"runAfter": {"<after>": ["Succeeded"]}, "type": "OpenApiConnection", "inputs": {"host": {"connectionName": "shared_sharepointonline", "operationId": "GetItems", "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"}, "parameters": {"dataset": "https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler", "table": "ee0ecabf-2f11-458d-a9ea-641f76d10cc3", "$filter": "Status ne 'Complete'", "$top": 500}}},
"Select_live_job_ids": {"runAfter": {"Get_live_jobs": ["Succeeded"]}, "type": "Select", "inputs": {"from": "@outputs('Get_live_jobs')?['body/value']", "select": "@concat('JobId eq ', string(item()?['ID']))"}},
"Compose_live_job_clause": {"runAfter": {"Select_live_job_ids": ["Succeeded"]}, "type": "Compose", "inputs": "@if(empty(body('Select_live_job_ids')), 'JobId eq -1', concat('(', join(body('Select_live_job_ids'), ' or '), ')'))"}
```

Targets:

| Flow | workflowid | read | inserted after | resulting `$filter` |
|---|---|---|---|---|
| Crew Trade Check | `a5f50628-eead-f111-aaac-6045bd0195dd` | `Get_assignments` | `Get_crew_trades` | `@{outputs('Compose_live_job_clause')}` |
| Conflict Flag | `f0dd9a1d-8bac-f111-aaab-002248043e80` | `Get_assignments` | `Get_crews` | `NotApplicable ne 1 and @{outputs('Compose_live_job_clause')}` |
| Reschedule Pool | `210f1d70-e2ab-f111-aaab-6045bd0196b3` | `Scope_reflow/Condition_job_found/else/Condition_sequence_exists/else/Get_all_assignments` | `Apply_to_each_row` | `NotApplicable ne 1 and @{outputs('Compose_live_job_clause')}` |

The read's own `runAfter` becomes `{"Compose_live_job_clause": ["Succeeded"]}`. In Reschedule Pool the three actions are siblings inside the same `else` branch (no new container), so its depth-8 walk is unchanged.

- [ ] **Step 1: Write the failing test** (`test_live_job_clause.py`, loading each newest export): after `apply_to`, `Get_live_jobs` filter is `Status ne 'Complete'`; the read's `runAfter` is the Compose; the read's `$filter` contains `Compose_live_job_clause` and keeps `NotApplicable ne 1` where it had it; `max_depth` (import from `counter_recon_per_job`) unchanged for Reschedule Pool; no existing action was removed.
- [ ] **Step 2: Run, watch it fail** (`ModuleNotFoundError`).
- [ ] **Step 3: Write `live_job_clause.py`** with `clause_actions` (the JSON above as a dict) and `apply_to`, resolving a `/`-separated path through `actions` / `else.actions`.
- [ ] **Step 4: Run, watch it pass.** Then break `apply_to` so it forgets to rewire `runAfter`; the test must fail. Revert.
- [ ] **Step 5: Write the apply script** in the Task 2 pattern (tenant assert, name assert, skip if `Get_live_jobs` already present, dry by default). Run `dry` and read the diff.
- [ ] **Step 6: Apply and verify each flow with one manual run.** Crew Trade Check and Conflict Flag: `run_flow`, then confirm from action outputs that `Get_assignments` returned the same row count as `Get_live_jobs`' jobs hold (today every job is live, so the counts must match the 09-30 baseline plus Don's new rows) and that the TradeMismatch / ConflictWith writes match yesterday's run. Reschedule Pool: raise a reflow on a throwaway `Planned` job owned by D2 Bot (three hand-made Assignments, recipe in CLAUDE.md under "Test pools belong OFF the client-visible pools"), confirm the conflict sweep ran with the new filter, then delete the job, its rows and the request row.
- [ ] **Step 7: Export and commit**

```bash
python flows/scripts/export-flows.py "Crew Trade Check" "Conflict Flag" "Reschedule Pool"
git add flows/scripts/live_job_clause.py flows/scripts/test_live_job_clause.py flows/scripts/2026-10-01-live-job-clause.py flows/exports/
git commit -m "Whole-list flows skip Complete projects"
```

## Part 3: planner

### Task 4: Capture filtered Graph payloads

**Files:**
- Modify: `fixtures/planner/capture-graph.js`, `fixtures/planner/capture-graph.html`
- Create: `fixtures/planner/live-payloads-graph-filtered.json`

- [ ] **Step 1:** Add a second capture mode (`?mode=filtered`) to `capture-graph.html`: after resolving the site, read Jobs, pick two live jobs (the job with the most assignments and one with fewer than 46), and fire:
  - `.../lists/{asg}/items?$expand=fields&$filter=fields/JobLookupId eq '<id>'&$top=500` once without and once with header `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly`
  - `.../lists/{tasks}/items?$expand=fields&$filter=<or chain of fields/AssignmentLookupId eq '<id>' over that job's assignments>&$top=500`, same two header variants
  - the same tasks query in chunks of 15
  Record for each: HTTP status, error body, row count, `@odata.nextLink` presence. POST `{capturedAt, siteId, jobs, queries:[{label, url, prefer, status, error, rows}]}` to `/capture-filtered`; `capture-graph.js` writes `live-payloads-graph-filtered.json`.
- [ ] **Step 2:** `node fixtures/planner/capture-graph.js`, open `http://localhost:8787/?mode=filtered`. Needs an interactive D2 sign-in (Shane, or the Playwright profile if it still holds a D2 session).
- [ ] **Step 3:** Read the file. Decide and write the outcome into this plan's Task 6 before coding it: Prefer header needed (yes/no), full-chain or chunked tasks reads, and that the per-job row counts equal the job's `TasksTotal` sum. **If Graph refuses both the full chain and chunks of 15, stop and bring the evidence to Shane.**
- [ ] **Step 4: Commit** the capture tool change and the JSON.

### Task 5: Mapper splits live and completed jobs

**Files:**
- Modify: `web/graph-to-planner.js` (`toPlannerPayload`, :107-251)
- Test: `fixtures/planner/complete.js` (create), `fixtures/planner/complete.g2p-mutations.json` (create)

**Interfaces:**
- Produces: `toPlannerPayload(graph, opts?)` now returns `completedJobs: [{id, jobno, name, pm, completedOn}]` (newest `completedOn` first, from `fields.Modified`) and `completedJobNumbers: [jobno]`, and omits Complete jobs from `jobs` unless `opts.includeComplete === true`.

- [ ] **Step 1: Write the failing test.** Create `fixtures/planner/complete.js` in the `board-controls.js` pattern (lines 24-114: jsdom boot, MSAL stub, fetch stub routing lists, `ok()` helper, `process.exit(fail)`). First block, Node-side only:

```js
const M=require('../../web/graph-to-planner.js');
const G2=JSON.parse(JSON.stringify(G));
const done=G2.jobs[0]; done.fields.Status='Complete'; done.fields.Modified='2026-10-02T15:00:00Z';
const p=M.toPlannerPayload(G2);
ok('complete job left out of jobs', !p.jobs.some(j=>String(j.jobno)===String(done.fields.JobNumber)));
ok('complete job listed', p.completedJobs.length===1 && p.completedJobs[0].completedOn==='2026-10-02T15:00:00Z');
ok('complete job number carried', p.completedJobNumbers.includes(done.fields.JobNumber));
ok('includeComplete keeps it', M.toPlannerPayload(G2,{includeComplete:true}).jobs.some(j=>String(j.jobno)===String(done.fields.JobNumber)));
```

- [ ] **Step 2: Run, watch it fail.** `node fixtures/planner/complete.js` → `FAIL · complete job left out of jobs`.
- [ ] **Step 3: Implement** in `toPlannerPayload`: a `const isComplete=st=>String(st||'')==='Complete';` split of the job rows, skip completed rows when building `jobs` unless `opts&&opts.includeComplete`, and build `completedJobs` / `completedJobNumbers` from them (pm resolved through the same people map the live jobs use).
- [ ] **Step 4: Run, watch it pass.**
- [ ] **Step 5: Mutations.** `complete.g2p-mutations.json`: drop the skip (`completed job still mapped`), drop the sort, drop `completedJobNumbers`. `python fixtures/planner/mutate.py fixtures/planner/complete.js web/graph-to-planner.js --json fixtures/planner/complete.g2p-mutations.json`, all red.
- [ ] **Step 6: Commit.**

### Task 6: Per-job Graph reads on Refresh

**Files:**
- Create: `web/graph-live-read.js` (UMD, `window.D2GraphLiveRead` / `module.exports`)
- Modify: `web/index.html` (`<script src="graph-live-read.js">` beside the other helpers; `loadFromD2ViaGraph` :2934-2957; `graphPageAll` :2923 gains an optional `headers` argument)
- Modify: `fixtures/planner/board-controls.js` and the other harnesses' `boot()` so they inline `graph-live-read.js` like `graph-to-planner.js`
- Test: `fixtures/planner/complete.js`

**Interfaces:**
- Produces:
  - `asgUrl(itemsUrl, jobId) -> string`, which builds `itemsUrl + "?$expand=fields&$filter=" + encodeURIComponent("fields/JobLookupId eq '" + String(jobId) + "'") + "&$top=500"`
  - `taskUrls(itemsUrl, asgIds, chunk) -> string[]`, which returns an empty array for an empty `asgIds` and otherwise one URL per chunk of `fields/AssignmentLookupId eq '<id>'` joined with `' or '`
  - `readLive({jobs, asgItems, taskItems, pageAll, chunk, headers}) -> Promise<{asg, tasks}>`, which reads each live job's assignments and that job's tasks (jobs in parallel; a job's tasks wait for its assignments) and concatenates them
  - `isComplete(status) -> boolean`
- `chunk` and `headers` come from Task 4's outcome (default: whole chain, i.e. `chunk = Infinity`, no Prefer header).

- [ ] **Step 1: Write the failing tests** in `complete.js`:
  - Node: `taskUrls(u, [], 46)` is `[]`. `taskUrls(u, [1,'2'], 46)` has one URL containing `AssignmentLookupId eq '1' or fields/AssignmentLookupId eq '2'`. With `chunk 15` and 46 ids it gives 4 URLs.
  - Browser (jsdom boot with one job's `Status` set `Complete`): the fetch stub records every URL. After Refresh, no URL fetched for Assignments or Tasks lacks a `$filter`. No Assignments URL names the completed job's id. Tasks URLs name only assignment ids belonging to live jobs. The Board shows every live job and not the completed one.
  - The fetch stub must answer filtered URLs by filtering `G.asg` on `String(fields.JobLookupId)` and `G.tasks` on `String(fields.AssignmentLookupId)`, with ids parsed out of the decoded filter.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement** `graph-live-read.js`, then in `loadFromD2ViaGraph`:
  1. Read `jobs`, `cal` and `req` through `graphPageAll` as today. Remove `asg` and `tasks` from that `Promise.all`.
  2. `const live=rows.jobs.filter(r=>!LR.isComplete(r.fields&&r.fields.Status));`
  3. `const {asg,tasks}=await LR.readLive({jobs:live, asgItems:base+D2_GRAPH.lists.asg+'/items', taskItems:base+D2_GRAPH.lists.tasks+'/items', pageAll:(u)=>graphPageAll(u,tok,HEADERS), chunk:CHUNK});`
  4. `graphPayload.asg=asg; graphPayload.tasks=tasks;` The mapper excludes Complete jobs itself (Task 5).
- [ ] **Step 4: Run** `complete.js`, then `npm test` and `node fixtures/planner/graph-read.js`. All green.
- [ ] **Step 5: Mutations** in `complete.mutations.json` against `web/graph-live-read.js`: empty-ids guard removed; `String()` dropped from the id; the live filter inverted. All red.
- [ ] **Step 6: Commit.**

### Task 7: Import drops newly completed projects and keeps local sketches

**Files:**
- Modify: `web/index.html` `importFromD2Payload` (:1886-2045)
- Test: `fixtures/planner/complete.js`, `fixtures/planner/complete.mutations.json`

- [ ] **Step 1: Write the failing tests:**
  - Boot and Refresh with all jobs live. Then set job A's Status `Complete` in the stub and Refresh again: A is gone from `S.jobs`.
  - A local sketch with no baseline (created with `+ Job` but never saved) survives the second Refresh.
  - With two live jobs `26-2055` and `26- 2055` in the stub, completing `26- 2055` removes only that one.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.** After the merge loop:

```js
const doneNos=new Set((d.completedJobNumbers||[]).map(String));
S.jobs=S.jobs.filter(j=>!(doneNos.has(String(j.jobno))&&poolHasBaseline(j)));
S.completedJobs=d.completedJobs||[];
```

  If `S.jobs` is referenced through a `const` alias anywhere, splice in place instead of reassigning; check with a grep for `S.jobs=` first. Add the removed count to the Refresh confirm text: "N completed project(s) will leave the planner."
- [ ] **Step 4: Run, watch them pass.** Run `npm test` too.
- [ ] **Step 5: Mutations:** remove the `poolHasBaseline` condition (the sketch is lost); compare with `.trim()` (both `2055`s go). Both red.
- [ ] **Step 6: Commit.**

### Task 8: Save reads only the jobs it writes

**Files:**
- Modify: `web/index.html` `pushChangeSet` (:2329-2346), `pushSignoffs` (:2275-2327)
- Test: `fixtures/planner/complete.js`

**Interfaces:**
- Consumes: `LR.asgUrl`, `LR.taskUrls` from Task 6.
- Produces: `liveById`, unchanged in shape (keyed by `String(r.fields.id)`), but built from per-job reads of the jobs in the change set, sign-off set and rejection set.

- [ ] **Step 1: Write the failing test.** Edit one crew on job A, Save. The fetch log shows Assignments read only with job A's filter, and no unfiltered Assignments or Tasks URL. A sign-off tick on job B reads only job B's assignments and tasks. The PATCH bodies are unchanged from today (compare with the existing `signoff-push.js` expectations).
- [ ] **Step 2: Run, watch it fail.**
- [ ] **Step 3: Implement.** In `pushChangeSet`, collect the SharePoint job ids (`j.id`) of every pool in `pools` plus the sign-off and rejection sets (`confirmSaveByPush` :2560 passes them). Read `LR.asgUrl` for each in parallel and build `liveById` from the union. In `pushSignoffs`, replace the whole-Tasks read with `LR.taskUrls` over the assignment ids of the sections being written.
- [ ] **Step 4: Run** `complete.js`, `signoff-push.js`, `rejections.js` and `npm test`. All green.
- [ ] **Step 5: Mutation:** fall back to the unfiltered read. Red.
- [ ] **Step 6: Commit.**

### Task 9: Mark complete, Ready to complete, the banner, Completed projects and Reopen

**Files:**
- Modify: `web/index.html` `vJobs` (:1245-1308, status cell :1296-1302), `jobBadge` (:364-371), and a new `readyToComplete(j)`, `completeProject(jobId)`, `reopenProject(jobno)` beside `planPool` (:1760)
- Test: `fixtures/planner/complete.js`, `fixtures/planner/complete.mutations.json`

**Interfaces:**
- Consumes: `doSetPoolStatus(jobId, from, to)` (:1778); `S.completedJobs` from Task 7.
- Produces:

```js
function hasUnsaved(j){ return divergedSecs(j).length>0 || buildSignoffSet().some(c=>String(c.jobId)===String(j.id)) || buildRejectionSet().some(c=>String(c.jobId)===String(j.id)); }
function readyToComplete(j){
  if(!j||j.building||j.readOnly||j.status!=='Active'||!poolHasBaseline(j))return false;
  const secs=allSecs(j); return secs.length>0 && secs.every(({s})=>s.inst||s.skip);
}
```

  Before writing, read `buildSignoffSet` (:2167) and `buildRejectionSet` (:2211) and use whatever key each entry carries for its job. The property name above is an assumption to check.

- [ ] **Step 1: Write the failing tests:**
  - All sub-phases `inst` or `skip`, Active, not building: Ready to complete chip and Mark complete button shown, and the banner reads "1 project is ready to complete: <jobno>." (singular and plural both tested).
  - One sub-phase neither `inst` nor `skip`: no chip, no button.
  - Planned, or building: never offered.
  - Mark complete with nothing unsaved: confirm, then exactly one PATCH to the Jobs item with `{"Status":"Complete"}`, then a Refresh.
  - Live Status no longer `Active` in the stub: no PATCH, explained refusal.
  - **Review Focus 1:** the last INST tick made locally and not saved means Mark complete is refused with "Save first" and no PATCH.
  - The Completed projects section lists `S.completedJobs` newest first. Reopen sends one PATCH `{"Status":"Active"}` after confirm.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.**
  - Status cell: in the `Active` branch, add `${readyToComplete(j)?`<button class="btn sm p" onclick="completeProject('${j.id}')">Mark complete</button>`:''}` after Back to planning.
  - `jobBadge`: add `readyToComplete(j)?'<span class="chip jb ok">Ready to complete</span>':''`.
  - Banner above the Jobs table when any are ready.
  - `completeProject`: guard `if(hasUnsaved(j)){alert('Save first. '+j.jobno+' has changes that are not saved yet.');return;}`. Then a confirm in the house style: "Mark <jobno> <name> complete? It leaves the Board, the daily dispatch, the summaries and, at the next 04:30 sweep, the calendar. You can reopen it from Completed projects." Then `doSetPoolStatus(jobId,'Active','Complete')`.
  - Completed projects: a `<details>` under the Jobs table listing job number, name, PM and `completedOn` as a date, with **Open** and **Reopen** buttons. `reopenProject(jobno)` reads the live Jobs row the way `doSetPoolStatus` does (it needs the SharePoint id from `S.completedJobs`, not a `S.jobs` entry), requires `Complete`, PATCHes `G.statusBody('Active')`, then Refreshes. Factor the shared read-compare-PATCH out of `doSetPoolStatus` into `setStatusByJobRow(row, from, to)` rather than duplicating it.
  - Escape every job name and number with `esc()`.
- [ ] **Step 4: Run, watch them pass.** Run `npm test`, `node fixtures/planner/escaping.js` and `node fixtures/planner/honest-copy.js`.
- [ ] **Step 5: Mutations:** eligibility ignores `skip`; eligibility ignores `building`; the `hasUnsaved` guard removed; Reopen sends `Complete`. All red.
- [ ] **Step 6: Commit.**

### Task 10: Open a completed project read-only

**Files:**
- Modify: `web/index.html`: new `openCompleted(jobno)`, and a `frozen(j)` helper used at every edit gate the planner map found
- Test: `fixtures/planner/complete.js`, `fixtures/planner/complete.mutations.json`

**Interfaces:**
- Produces: `function frozen(j){ return !!(j&&(j.building||j.readOnly)); }`. Replace `j.building` with `frozen(j)` in: `divergedSecs` (:689), `buildChangeSet` (:2088), `buildJobStartChanges` (:2108), `buildSignoffSet` (:2167), `buildRejectionSet` (:2211), `inlineEditable` (:1071), `editSec` (:1370, with read-only hint text "Completed project, read only" when `j.readOnly`), `resetStart` (:1573), `activatePool` (:1720), `planPool` (:1760). Add guards where none exist today: `sign()` (:720, return when `frozen(j)`), `sgHTML` (:746) and the group checkboxes (:1024-1026) render `disabled` when `frozen(j)`, `setJob` (:1565), `autoSchedule` (skip `frozen` jobs at :428, and still let their dated rows seed `busy` at :415/:425 so live crews are not double-booked against them), `conflicts()` (:762, skip `j.readOnly` only, so building projects still raise conflicts as today). The `Building` chip and copy keep reading `j.building` directly.

- [ ] **Step 1: Write the failing tests** (**Review Focus 5**): Open a completed project, then:
  - the read-only banner shows on the Board
  - no `.ic-row` controls on its rows
  - its sign-off checkboxes are `disabled`
  - `sign()` called directly changes nothing
  - the drawer shows the read-only text
  - Auto-Schedule leaves every one of its rows' crew and start unchanged
  - `buildChangeSet()`, `buildSignoffSet()` and `buildRejectionSet()` contain nothing for it
  - Schedule Check raises nothing naming it
  - the next Refresh removes it
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement** `openCompleted(jobno)`:
  1. Find the entry in `S.completedJobs`.
  2. Read that one job's assignments and tasks with `LR.readLive({jobs:[{fields:{id:String(c.id)}}], ...})`.
  3. Build a payload with `toPlannerPayload({...graphPayloadBase, jobs:[liveJobRow], asg, tasks}, {includeComplete:true})`, where `liveJobRow` is re-read from Jobs by id.
  4. Merge it silently with `importFromD2Payload(payload, true)`, then set `readOnly=true` on that job and `render()`.
  5. Keep `graphPayloadBase` (`cal`, `req`, `users`, `comments`, `site`) from the last Refresh on a module variable so Open does not re-read them.
  
  Then make the `frozen()` substitutions listed above.
- [ ] **Step 4: Run, watch them pass.** Run the full suite: `npm test` plus `freshness.js`, `graph-read.js`, `graph-write.js`, `writeback*.js`, `signoff-push.js`, `escaping.js`, `honest-copy.js`, `rules.js`, `schedulecheck.js`, `startdate.js` and `workcalendar.js`.
- [ ] **Step 5: Mutations:** remove each new guard one at a time (`sign`, `inlineEditable`, `buildSignoffSet`, `autoSchedule`, `conflicts`). Each must go red.
- [ ] **Step 6:** Add `node fixtures/planner/complete.js` to `package.json` `test`. Commit.

### Task 11: Shakedown, deploy, live verification, records

**Files:**
- Modify: `tools/planner-shakedown.js` (add a Complete pass), `CLAUDE.md`, session log

- [ ] **Step 1:** Extend `tools/planner-shakedown.js`. Mark one injected project complete in the payload. Assert it is absent from the Board, present in Completed projects, and opens read-only with a clean console. Run `node tools/planner-shakedown.js`: 0 hard errors.
- [ ] **Step 2: Deploy** (CLAUDE.md "THE HOSTED PLANNER WAS REDEPLOYED"): pin `az` to subscription `cbcbe68b-...`, pull the token, run `npx -y @azure/static-web-apps-cli deploy ./web --deployment-token "$TOKEN" --env production`, then `git tag deploy/2026-10-0x`. Re-run the anonymous wall checks: every path 302, `/auth-redirect.html` 200, `/.auth/login/github` 404.
- [ ] **Step 3: Live, on a throwaway project owned by D2 Bot** (`+ Job`, default crews off, after Don's builds have finished):
  - Measure a Refresh (network log) before anything else.
  - Sign every sub-phase or mark it N/A through the planner, then Save. Set it Active.
  - Mark complete. Read the Jobs row back: Status `Complete`. Confirm the project is off the Board and in Completed projects.
  - Open it. The banner shows and nothing is editable.
  - Reopen it. Status `Active`, and the project is back on the Board.
  - Mark it complete again and measure a Refresh. Confirm in the network log that no Assignments or Tasks URL names it.
  - Delete it through Delete Pool Requests with `OverrideSignedOff`. Remove both request rows. Read the tenant counts back.
- [ ] **Step 4: Records.** In CLAUDE.md, add a section on the shipped behaviour, the Graph filter shape captured in Task 4, and the Counter Reconciliation per-job design (with the "no Terminate in loops" capped-list pattern). Flag for Shane that the client guide needs a "Completing a project" section in the next reissue. Commit.

---

## Self-review notes

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | §1 Mark complete / Completed / Reopen / Open | Tasks 9 and 10 |
  | §2 per-job reads | Task 6 |
  | §2 capture first | Task 4 |
  | §2 merge semantics | Task 7 |
  | §2 Save reads only what it writes | Task 8 |
  | §3 flows | Tasks 1-3 |
  | §5 harness and live checks | Tasks 5-11 |
  | §5 client guide | flagged in Task 11 |

  §4 needs no work.
- **Deviation from the spec, deliberate:** the spec's per-job `Guard_read_complete` cannot terminate inside `For_each_job`, because Logic Apps forbids `Terminate` in any loop. Capped jobs are collected into a `capped` array and the run terminates after the loop, so every other job is still repaired.
- **Assumption to check in Task 9:** the job key carried by `buildSignoffSet` and `buildRejectionSet` entries.
