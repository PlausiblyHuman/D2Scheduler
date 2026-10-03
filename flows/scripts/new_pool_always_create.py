"""D2 - New Pool: every sub-phase is always created, even when the work-day search stops short
(2026-10-03).

Found repairing the 32-project load of 2026-09-30. Create_assignment, its tasks, Merge_task_total and
Set_cursor_next all sat in the ELSE branch of Condition_span_incomplete, so when the search for work
days stopped early the sub-phase was skipped outright: no Assignment, no Tasks, and the next
sub-phase started where the skipped one would have. 16 of 32 builds lost 28 sub-phases between them.
The 2026-10-01 message ("built in full ... one sub-phase is shorter") described a row that did not
exist.

Changes:
- Create_assignment, Filter_tasks_for_subphase, Increment_taskCount, Apply_to_each_task,
  Merge_task_total and Set_cursor_next move out of the If and run after it, so they run every time.
- On a short span the row is written with the work days actually found as its DurationDays, so its
  start, duration and finish agree and the planner shows it as it is stored. With no work day found
  at all, the dates are written empty rather than as an empty string, which SharePoint rejects.
- Set_cursor_next reads a new Compose_cursor_next, which keeps the cursor where it was when no day
  was found. A SetVariable that reads the variable it writes fails save-time validation.
- Every short sub-phase is listed (AppendToStringVariable), not only the last one, and the message
  tells the PM to set each back to its planned days in the planner.
The request still ends Failed and the email still goes at Normal importance, as on 2026-10-01.
"""

LOOP = 'Apply_to_each_subphase'
COND = 'Condition_span_incomplete'
MOVED = ['Create_assignment', 'Filter_tasks_for_subphase', 'Increment_taskCount',
         'Apply_to_each_task', 'Merge_task_total', 'Set_cursor_next']

ITEM = "items('Apply_to_each_subphase')"
APPEND = {
    'runAfter': {},
    'type': 'AppendToStringVariable',
    'inputs': {
        'name': 'shortScheduledSubphase',
        'value': ("@{concat('; ', " + ITEM + "?['SubPhaseNumber'], ' ', " + ITEM + "?['Title'], ' (', "
                  "string(variables('daysTaken')), ' of ', string(" + ITEM + "?['DurationDays']), ' work days)')}"),
    },
}

START_OLD = "\"ScheduledStart\":\"@{variables('spanStart')}\""
START_NEW = "\"ScheduledStart\":@{if(empty(variables('spanStart')), 'null', concat('\"', variables('spanStart'), '\"'))}"
FINISH_OLD = "\"ScheduledFinish\":\"@{variables('spanFinish')}\""
FINISH_NEW = "\"ScheduledFinish\":@{if(empty(variables('spanFinish')), 'null', concat('\"', variables('spanFinish'), '\"'))}"
DAYS_OLD = "\"DurationDays\":@{" + ITEM + "?['DurationDays']}"
DAYS_NEW = ("\"DurationDays\":@{if(less(variables('daysTaken'), int(" + ITEM + "?['DurationDays'])), "
            "variables('daysTaken'), " + ITEM + "?['DurationDays'])}")

COMPOSE_CURSOR = {
    'runAfter': {'Merge_task_total': ['Succeeded']},
    'type': 'Compose',
    'inputs': ("@if(empty(variables('spanFinish')), variables('cursor'), "
               "formatDateTime(addDays(variables('spanFinish'), 1), 'yyyy-MM-dd'))"),
}

MESSAGE = ("@concat(triggerOutputs()?['body/JobNumber'], ' (', triggerOutputs()?['body/Title'], "
           "') was built in full: every sub-phase and task exists. The search for work days stopped early on ', "
           "substring(variables('shortScheduledSubphase'), 2), "
           "', so each was created with fewer work days than planned. That can happen while the system is very "
           "busy. In the planner, set each one back to its planned number of days and the rest of the project "
           "moves with it. Do not delete or re-enter the project.')")


def find(actions, name):
    for k, a in actions.items():
        if k == name:
            return a
        for sub in (a.get('actions', {}), a.get('else', {}).get('actions', {})):
            hit = find(sub, name)
            if hit:
                return hit
    return None


def apply(actions):
    loop = actions[LOOP]['actions']
    cond = loop[COND]
    if 'Create_assignment' in loop:          # already applied
        return actions
    branch = cond['else']['actions']
    assert set(branch) == set(MOVED), sorted(branch)
    assert list(cond['actions']) == ['Set_shortScheduledSubphase'], list(cond['actions'])

    cond['actions'] = {'Append_shortScheduledSubphase': APPEND}
    del cond['else']

    moved = {k: branch[k] for k in MOVED}
    moved['Create_assignment']['runAfter'] = {COND: ['Succeeded']}
    p = moved['Create_assignment']['inputs']['parameters']
    body = p['parameters/body']
    for old, new in ((START_OLD, START_NEW), (FINISH_OLD, FINISH_NEW), (DAYS_OLD, DAYS_NEW)):
        assert body.count(old) == 1, old
        body = body.replace(old, new)
    p['parameters/body'] = body

    moved['Set_cursor_next']['runAfter'] = {'Compose_cursor_next': ['Succeeded']}
    moved['Set_cursor_next']['inputs']['value'] = "@{outputs('Compose_cursor_next')}"
    loop.update(moved)
    loop['Compose_cursor_next'] = COMPOSE_CURSOR

    find(actions, 'Compose_short_scheduled_message')['inputs'] = MESSAGE
    return actions
