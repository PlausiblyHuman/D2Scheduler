"""Adds the live-job clause (Jobs where Status ne 'Complete') to a flow's whole-list Assignments read.

The idiom is copied from Calendar Sync's Get_active_jobs / Select_active_job_ids /
Compose_active_job_clause, with the filter changed from Status eq 'Active' to Status ne 'Complete'.
The three actions are inserted as siblings of the read, so no container is added.
"""

DS = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler'
JOBS = 'ee0ecabf-2f11-458d-a9ea-641f76d10cc3'
CLAUSE = "@{outputs('Compose_live_job_clause')}"

TARGETS = [
    {'name': 'D2 - Crew Trade Check', 'wf': 'a5f50628-eead-f111-aaac-6045bd0195dd',
     'export_glob': 'D2-Crew-Trade-Check-*.json', 'read': 'Get_assignments', 'after': 'Get_crew_trades'},
    {'name': 'D2 - Conflict Flag', 'wf': 'f0dd9a1d-8bac-f111-aaab-002248043e80',
     'export_glob': 'D2-Conflict-Flag-*.json', 'read': 'Get_assignments', 'after': 'Get_crews'},
    {'name': 'D2 - Reschedule Pool', 'wf': '210f1d70-e2ab-f111-aaab-6045bd0196b3',
     'export_glob': 'D2-Reschedule-Pool-*.json',
     'read': 'Scope_reflow/Condition_job_found/else/Condition_sequence_exists/else/Get_all_assignments',
     'after': 'Apply_to_each_row'},
]


def clause_actions(after):
    return {
        'Get_live_jobs': {
            'runAfter': {after: ['Succeeded']}, 'type': 'OpenApiConnection',
            'inputs': {'host': {'connectionName': 'shared_sharepointonline', 'operationId': 'GetItems',
                                'apiId': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline'},
                       'parameters': {'dataset': DS, 'table': JOBS, '$filter': "Status ne 'Complete'", '$top': 500}}},
        'Select_live_job_ids': {
            'runAfter': {'Get_live_jobs': ['Succeeded']}, 'type': 'Select',
            'inputs': {'from': "@outputs('Get_live_jobs')?['body/value']",
                       'select': "@concat('JobId eq ', string(item()?['ID']))"}},
        'Compose_live_job_clause': {
            'runAfter': {'Select_live_job_ids': ['Succeeded']}, 'type': 'Compose',
            'inputs': "@if(empty(body('Select_live_job_ids')), 'JobId eq -1', "
                      "concat('(', join(body('Select_live_job_ids'), ' or '), ')'))"},
    }


def resolve(actions, path):
    """Returns (container dict, action name) for a '/'-separated path; 'else' steps into an If's else."""
    parts = path.split('/')
    container = actions
    i = 0
    while i < len(parts) - 1:
        node = container[parts[i]]
        if i + 1 < len(parts) - 1 and parts[i + 1] == 'else':
            container = node['else']['actions']; i += 2
        else:
            container = node['actions']; i += 1
    return container, parts[-1]


def apply_to(actions, read_path, after):
    container, name = resolve(actions, read_path)
    read = container[name]
    assert read['runAfter'] == {after: ['Succeeded']}, (name, read['runAfter'])
    container.update(clause_actions(after))
    read['runAfter'] = {'Compose_live_job_clause': ['Succeeded']}
    params = read['inputs']['parameters']
    params['$filter'] = (params['$filter'] + ' and ' + CLAUSE) if params.get('$filter') else CLAUSE
