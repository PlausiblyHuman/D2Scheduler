# flows/scripts/test_counter_recon_chunk.py   Run: python flows/scripts/test_counter_recon_chunk.py
import json, math, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from counter_recon_chunk import apply, CHUNK_READ, NEW_LEN
from new_pool_escape_strings import find
from counter_recon_per_job import max_depth, terminates_in_loop
EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-Counter-Reconciliation-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
before = load([p for p in EXPORTS if 'For_each_job' in json.dumps(load(p)) and 'Init_job_tasks' not in json.dumps(load(p))][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

A = apply(json.loads(json.dumps(before)))
ok('job_tasks is initialised at the top level, before the project loop',
   A['Init_job_tasks']['runAfter'] == {'Init_tasks_scanned': ['Succeeded']} and A['For_each_job']['runAfter'] == {'Init_job_tasks': ['Succeeded']}
   and A['Init_job_tasks']['inputs']['variables'][0] == {'name': 'job_tasks', 'type': 'array', 'value': []})
r = find(A, 'Condition_job_readable')['actions']
ok('it is emptied per project, first thing', r['Reset_job_tasks']['runAfter'] == {} and r['Reset_job_tasks']['inputs'] == {'name': 'job_tasks', 'value': []})
ok('the chunk index runs 0 .. ceil(n/46)-1', r['Compose_chunk_index']['inputs'] == "@range(0, div(add(length(body('Select_task_clauses')), 45), 46))")
# The WDL integer arithmetic, checked for the sizes that matter.
for n in (1, 45, 46, 47, 60, 92, 93):
    ok(f'{n} assignments give {math.ceil(n / 46)} chunk(s)', len(range(0, (n + 45) // 46)) == math.ceil(n / 46))
loop = r['For_each_chunk']
ok('chunks are read one at a time', loop['runtimeConfiguration'] == {'concurrency': {'repetitions': 1}} and loop['runAfter'] == {'Compose_chunk_index': ['Succeeded']})
get = loop['actions']['Get_job_tasks']
ok('each read takes 46 clauses from the chunk offset', get['inputs']['parameters']['$filter'] == CHUNK_READ and 'take(skip(' in CHUNK_READ and 'mul(item(), 46)), 46)' in CHUNK_READ)
ok('the read is otherwise unchanged (table, cap)', {k: v for k, v in get['inputs']['parameters'].items() if k != '$filter'} == {k: v for k, v in find(before, 'Get_job_tasks')['inputs']['parameters'].items() if k != '$filter'})
ok('rows are unioned through a Compose, never a self-reading SetVariable',
   loop['actions']['Compose_tasks_union']['inputs'] == "@union(variables('job_tasks'), body('Get_job_tasks')?['value'])"
   and loop['actions']['Set_job_tasks']['inputs'] == {'name': 'job_tasks', 'value': "@outputs('Compose_tasks_union')"})
done = r['Condition_tasks_complete']
ok('the cap check runs after every chunk and counts all of them', done['runAfter'] == {'For_each_chunk': ['Succeeded']} and done['expression'] == {'less': [NEW_LEN, 5000]})
ok('tasks scanned counts all chunks', find(A, 'Add_tasks_scanned')['inputs']['value'] == NEW_LEN)
ok('the recount filters the combined rows', find(A, 'Filter_tasks')['inputs']['from'] == "@variables('job_tasks')")
ok('the capped and else branches are unchanged', done['else'] == find(before, 'Condition_tasks_complete')['else'])
ok('the repair logic inside the assignment loop is unchanged',
   json.dumps({k: v for k, v in find(A, 'Apply_to_each_assignment')['actions'].items() if k != 'Filter_tasks'}, sort_keys=True)
   == json.dumps({k: v for k, v in find(before, 'Apply_to_each_assignment')['actions'].items() if k != 'Filter_tasks'}, sort_keys=True))
ok('Guard_capped and Summarise are unchanged', A['Guard_capped'] == before['Guard_capped'] and A['Summarise'] == before['Summarise'])
ok('no expression still reads a single Get_job_tasks outside the chunk loop',
   json.dumps({k: v for k, v in A.items() if k != 'For_each_job'}).count("Get_job_tasks") == 0
   and json.dumps(done).count("Get_job_tasks") == 0)
ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))
ok('nesting stays within 8', max_depth(A) <= 8, str(max_depth(A)))
ok('no Terminate inside a loop', not terminates_in_loop(A))
after = [p for p in EXPORTS if 'Init_job_tasks' in json.dumps(load(p))]
if after:
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(load(after[0])) == strip(A))
else:
    ok('no export carries this change yet, no-drift check skipped', True)
sys.exit(1 if fails else 0)
