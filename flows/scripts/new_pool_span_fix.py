"""D2 - New Pool: the work-day search no longer gives up after one hour, and a short sub-phase is
reported accurately (2026-10-01).

Found when 32 projects were raised at once: D2 Bot's request allowance throttled every run, one
iteration of Do_until_span_complete ran 5.6 hours, its PT1H timeout ended the loop with the span
unfinished, and the flow then failed the whole build, telling the PM to delete the project and
re-enter it. Every sub-phase had in fact been created; one ended a day short. 12 of 32 builds hit it.

Changes, all on the short-span path:
- Do_until_span_complete timeout PT1H -> P1D. The 90-iteration (90-day) count is unchanged.
- The short-span text says what happened and what to do: correct that sub-phase's dates, do not
  delete or re-enter the project.
- The email subject drops "URGENT ... INCOMPLETE" and goes at Normal importance.
The request still ends Failed, so the row stands out in New Pool Requests.
"""

TIMEOUT = 'P1D'

SHORT_VALUE = ("@{concat(items('Apply_to_each_subphase')?['SubPhaseNumber'], ' ', "
               "items('Apply_to_each_subphase')?['Title'], ' needs ', "
               "string(items('Apply_to_each_subphase')?['DurationDays']), ' work day(s) but only ', "
               "string(variables('daysTaken')), ' were found before the search stopped')}")

MESSAGE = ("@concat(triggerOutputs()?['body/JobNumber'], ' (', triggerOutputs()?['body/Title'], "
           "') was built in full: every sub-phase and task now exists. One sub-phase is shorter than its "
           "duration: ', variables('shortScheduledSubphase'), '. That happens when the search for work days "
           "stops early, which can occur while the system is very busy. Correct the dates of that sub-phase "
           "in the planner, or reschedule the project from it. Do not delete or re-enter the project.')")

SUBJECT = "Check dates on new project @{triggerOutputs()?['body/JobNumber']}"


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
    until = find(actions, 'Do_until_span_complete')
    assert until['limit'] == {'count': 90, 'timeout': 'PT1H'} or until['limit']['timeout'] == TIMEOUT, until['limit']
    until['limit'] = {'count': 90, 'timeout': TIMEOUT}
    find(actions, 'Set_shortScheduledSubphase')['inputs']['value'] = SHORT_VALUE
    find(actions, 'Compose_short_scheduled_message')['inputs'] = MESSAGE
    p = find(actions, 'Send_span_failure_email')['inputs']['parameters']
    p['emailMessage/Subject'] = SUBJECT
    p['emailMessage/Importance'] = 'Normal'
    return actions
