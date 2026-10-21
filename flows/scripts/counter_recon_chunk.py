r"""D2 - Counter Reconciliation reads each project's tasks in chunks of 46 assignment ids (2026-10-21).

docs/specs/2026-10-21-projects-own-structure-design.md, part C. Get_job_tasks put every assignment id
of a project into one `or` chain. 46 terms is the longest chain proven against the connector (a Gunite
project, 2026-10-01); optional feature lines take a project past that. Now:

- Init_job_tasks (array) at the top level; Reset_job_tasks empties it per project.
- Compose_chunk_index: 0 .. ceil(n/46)-1. For_each_chunk (sequential) reads one chunk with
  take(skip(clauses, i*46), 46) and unions its rows into job_tasks through Compose_tasks_union,
  because a SetVariable that reads the variable it writes fails save validation.
- Condition_tasks_complete, Add_tasks_scanned and Filter_tasks read job_tasks instead of one read.
"""
import copy
from new_pool_escape_strings import find

CHUNK = 46
ONE_READ = "@{concat('(', join(body('Select_task_clauses'), ' or '), ')')}"
CHUNK_READ = "@{concat('(', join(take(skip(body('Select_task_clauses'), mul(item(), " + str(CHUNK) + ")), " + str(CHUNK) + "), ' or '), ')')}"
OLD_LEN = "@length(body('Get_job_tasks')?['value'])"
NEW_LEN = "@length(variables('job_tasks'))"


def apply(actions):
    if 'Init_job_tasks' in actions:
        return actions
    assert actions['For_each_job']['runAfter'] == {'Init_tasks_scanned': ['Succeeded']}
    actions['Init_job_tasks'] = {'runAfter': {'Init_tasks_scanned': ['Succeeded']}, 'type': 'InitializeVariable',
                                 'inputs': {'variables': [{'name': 'job_tasks', 'type': 'array', 'value': []}]}}
    actions['For_each_job']['runAfter'] = {'Init_job_tasks': ['Succeeded']}

    readable = find(actions, 'Condition_job_readable')['actions']
    get = copy.deepcopy(readable.pop('Get_job_tasks'))
    assert get['inputs']['parameters']['$filter'] == ONE_READ, get['inputs']['parameters']['$filter']
    get['inputs']['parameters']['$filter'] = CHUNK_READ
    get['runAfter'] = {}
    readable['Reset_job_tasks'] = {'runAfter': {}, 'type': 'SetVariable', 'inputs': {'name': 'job_tasks', 'value': []}}
    readable['Compose_chunk_index'] = {
        'runAfter': {'Reset_job_tasks': ['Succeeded']}, 'type': 'Compose',
        'inputs': "@range(0, div(add(length(body('Select_task_clauses')), " + str(CHUNK - 1) + "), " + str(CHUNK) + "))"}
    readable['For_each_chunk'] = {
        'runAfter': {'Compose_chunk_index': ['Succeeded']}, 'type': 'Foreach',
        'foreach': "@outputs('Compose_chunk_index')",
        'runtimeConfiguration': {'concurrency': {'repetitions': 1}},
        'actions': {
            'Get_job_tasks': get,
            'Compose_tasks_union': {'runAfter': {'Get_job_tasks': ['Succeeded']}, 'type': 'Compose',
                                    'inputs': "@union(variables('job_tasks'), body('Get_job_tasks')?['value'])"},
            'Set_job_tasks': {'runAfter': {'Compose_tasks_union': ['Succeeded']}, 'type': 'SetVariable',
                              'inputs': {'name': 'job_tasks', 'value': "@outputs('Compose_tasks_union')"}}}}

    done = readable['Condition_tasks_complete']
    assert done['runAfter'] == {'Get_job_tasks': ['Succeeded']} and done['expression'] == {'less': [OLD_LEN, 5000]}
    done['runAfter'] = {'For_each_chunk': ['Succeeded']}
    done['expression'] = {'less': [NEW_LEN, 5000]}
    scanned = find(actions, 'Add_tasks_scanned')['inputs']
    assert scanned['value'] == OLD_LEN
    scanned['value'] = NEW_LEN
    flt = find(actions, 'Filter_tasks')['inputs']
    assert flt['from'] == "@body('Get_job_tasks')?['value']"
    flt['from'] = "@variables('job_tasks')"
    return actions
