"""D2 - New Pool builds from the template of the request's build type (2026-10-13).

- Compose_build_type reads BuildType off the request, Gunite when absent (older planner builds and
  REST creates that omit it).
- Both template reads are filtered by type. The task read's cap rises to 1000: the list now holds
  Gunite's 295 and Fiberglass's 248, and the old cap of 500 would have truncated Gunite's own tasks.
- A read that comes back at its cap fails the request (ReadAtCap) before Create_job, as the
  2026-09-28 guards do on four other flows. A truncated template must never become a half-built project.
- Create_job writes BuildType on the Job; the result email names the type.
"""
SCOPE = 'Scope_provision_job'
TYPE = "outputs('Compose_build_type')"
COMPOSE_TYPE = {'runAfter': {'Ensure_pm_user': ['Succeeded']}, 'type': 'Compose',
                'inputs': "@coalesce(triggerOutputs()?['body/BuildType']?['Value'], 'Gunite')"}
FILTER = "BuildType eq '@{" + TYPE + "}'"
REQ_TYPE = 'SP.Data.New_x0020_Pool_x0020_RequestsListItem'
CAP = {
    'runAfter': {'Get_task_template': ['Succeeded']}, 'type': 'If',
    'expression': {'or': [
        {'greaterOrEquals': ["@length(outputs('Get_subphase_template')?['body/value'])", 100]},
        {'greaterOrEquals': ["@length(outputs('Get_task_template')?['body/value'])", 1000]}]},
    'actions': {
        'Set_status_failed_cap': {'runAfter': {}, 'type': 'OpenApiConnection', 'inputs': {
            'host': {'apiId': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline', 'operationId': 'HttpRequest', 'connectionName': 'shared_sharepointonline'},
            'parameters': {
                'dataset': 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler',
                'parameters/method': 'POST',
                'parameters/uri': "_api/web/lists/GetByTitle('New Pool Requests')/items(@{triggerOutputs()?['body/ID']})",
                'parameters/headers': {'X-HTTP-Method': 'MERGE', 'If-Match': '*', 'Content-Type': 'application/json;odata=verbose', 'Accept': 'application/json;odata=verbose'},
                'parameters/body': '{"__metadata":{"type":"' + REQ_TYPE + '"},"Status":"Failed","Result":"ReadAtCap: the @{' + TYPE + '} template read came back at its cap (sub-phases @{length(outputs(\'Get_subphase_template\')?[\'body/value\'])}, tasks @{length(outputs(\'Get_task_template\')?[\'body/value\'])}). Nothing was built. The template lists need checking before this request is re-entered."}'}}},
        'Terminate_cap': {'runAfter': {'Set_status_failed_cap': ['Succeeded']}, 'type': 'Terminate', 'inputs': {'runStatus': 'Failed', 'runError': {'code': 'ReadAtCap', 'message': 'Template read at cap'}}}},
}
RESULT_OLD = "@concat('Created ', triggerOutputs()?['body/JobNumber'], ': ', "
RESULT_NEW = "@concat('Created ', triggerOutputs()?['body/JobNumber'], ' (', " + TYPE + ", '): ', "

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
    scope = actions[SCOPE]['actions']
    if 'Compose_build_type' in scope:
        return actions
    # Order today: Ensure_pm_user -> Create_job -> Get_subphase_template -> Get_task_template -> Get_work_calendar.
    # Order after:  Ensure_pm_user -> Compose_build_type -> Get_subphase_template -> Get_task_template
    #               -> Condition_read_at_cap -> Create_job -> Get_work_calendar. A capped read never creates the Job.
    assert scope['Get_subphase_template']['runAfter'] == {'Create_job': ['Succeeded']}, scope['Get_subphase_template']['runAfter']
    assert scope['Get_work_calendar']['runAfter'] == {'Get_task_template': ['Succeeded']}, scope['Get_work_calendar']['runAfter']
    scope['Compose_build_type'] = COMPOSE_TYPE
    scope['Get_subphase_template']['runAfter'] = {'Compose_build_type': ['Succeeded']}
    sp = scope['Get_subphase_template']['inputs']['parameters']; sp['$filter'] = FILTER
    tt = scope['Get_task_template']['inputs']['parameters']; tt['$filter'] = FILTER; tt['$top'] = 1000
    scope['Condition_read_at_cap'] = CAP
    scope['Create_job']['runAfter'] = {'Condition_read_at_cap': ['Succeeded']}
    body = scope['Create_job']['inputs']['parameters']['parameters/body']
    assert body.count('"Status":"Planned"') == 1
    scope['Create_job']['inputs']['parameters']['parameters/body'] = body.replace('"Status":"Planned"', '"Status":"Planned","BuildType":"@{' + TYPE + '}"')
    scope['Get_work_calendar']['runAfter'] = {'Create_job': ['Succeeded']}
    res = find(actions, 'Compose_result')
    assert res['inputs'].startswith(RESULT_OLD), res['inputs'][:80]
    res['inputs'] = RESULT_NEW + res['inputs'][len(RESULT_OLD):]
    return actions
