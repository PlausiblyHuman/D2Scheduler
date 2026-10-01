"""Builds D2 - Counter Reconciliation's per-live-job definition from its current actions.

Reads Jobs where Status ne 'Complete', then per job: that job's Assignments (JobId eq <id>) and that
job's Tasks (an `or` chain of its assignment ids, because concurrent New Pool builds interleave
assignment ids), and recounts exactly as before. Logic Apps forbids Terminate inside any loop, so a
read that hits its cap records the job in `capped`, skips that job, and the run fails after the loop.
"""
import copy

DS = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler'
JOBS = 'ee0ecabf-2f11-458d-a9ea-641f76d10cc3'
ASG = '49ef7006-d3fe-40a7-a52f-c4c18545bd35'
TASKS = '22c45847-ff0d-417a-b53e-1ea018fbb6d3'
HOST = {'apiId': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
        'connectionName': 'shared_sharepointonline', 'operationId': 'GetItems'}
JOBNO = "@{items('For_each_job')?['JobNumber']}"
CONTAINERS = ('If', 'Foreach', 'Until', 'Scope')


def get_items(table, after, flt, top):
    return {'runAfter': after, 'type': 'OpenApiConnection',
            'inputs': {'host': dict(HOST),
                       'parameters': {'dataset': DS, 'table': table, '$filter': flt, '$top': top}}}


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
        drifted = loop['actions']['Condition_drifted']['actions']
        drifted['Repair_counters'] = {'runAfter': {}, 'type': 'Compose',
                                      'inputs': drifted['Repair_counters']['inputs']['parameters']['parameters/body']}
    asg_len = "@length(body('Get_job_assignments')?['value'])"
    tasks_len = "@length(body('Get_job_tasks')?['value'])"
    return {
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
                        'Get_job_tasks': get_items(
                            TASKS, {}, "@{concat('(', join(body('Select_task_clauses'), ' or '), ')')}", 5000),
                        'Condition_tasks_complete': {
                            'runAfter': {'Get_job_tasks': ['Succeeded']}, 'type': 'If',
                            'expression': {'less': [tasks_len, 5000]},
                            'actions': {
                                'Add_tasks_scanned': {'runAfter': {}, 'type': 'IncrementVariable',
                                                      'inputs': {'name': 'tasks_scanned', 'value': tasks_len}},
                                'Apply_to_each_assignment': loop},
                            'else': {'actions': {
                                'Record_tasks_capped': append_capped(JOBNO + ': tasks read returned 5,000')}}}},
                    'else': {'actions': {'Condition_assignments_capped': {
                        'runAfter': {}, 'type': 'If',
                        'expression': {'greaterOrEquals': [asg_len, 500]},
                        'actions': {'Record_asg_capped': append_capped(JOBNO + ': assignments read returned 500')},
                        'else': {'actions': {}}}}}}}},
        'Guard_capped': {
            'runAfter': {'For_each_job': ['Succeeded']}, 'type': 'If',
            'expression': {'not': {'empty': ["@variables('capped')"]}},
            'actions': {'Terminate_read_at_cap': {'runAfter': {}, 'type': 'Terminate', 'inputs': {
                'runStatus': 'Failed', 'runError': {
                    'code': 'ReadAtCap',
                    'message': "@{concat('A read returned its maximum for: ', join(variables('capped'), '; '), "
                               "'. Those projects were not recounted. Every other project was checked and repaired.')}"}}}},
            'else': {'actions': {}}},
        'Summarise': {
            'runAfter': {'Guard_capped': ['Succeeded']}, 'type': 'Compose',
            'inputs': {'jobsChecked': "@length(body('Get_live_jobs')?['value'])",
                       'tasksScanned': "@variables('tasks_scanned')",
                       'countersRepaired': "@length(variables('repaired'))",
                       'detail': "@variables('repaired')",
                       'capped': "@variables('capped')"}},
    }


def _children(a):
    kids = dict(a.get('actions', {}))
    kids.update(a.get('else', {}).get('actions', {}))
    return kids


def max_depth(actions, d=0):
    return max([d] + [max_depth(_children(a), d + 1) for a in actions.values() if a['type'] in CONTAINERS])


def terminates_in_loop(actions, in_loop=False):
    for a in actions.values():
        if a['type'] == 'Terminate' and in_loop:
            return True
        if a['type'] in CONTAINERS and terminates_in_loop(_children(a), in_loop or a['type'] in ('Foreach', 'Until')):
            return True
    return False
