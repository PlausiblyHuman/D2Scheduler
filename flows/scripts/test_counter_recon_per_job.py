# Structural test for the per-live-job Counter Reconciliation definition.
# Run: python flows/scripts/test_counter_recon_per_job.py   (exit 0 = all pass)
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from counter_recon_per_job import build_actions, max_depth, terminates_in_loop

EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-Counter-Reconciliation-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
# The builder's input is the last export taken BEFORE conversion (it still reads every Task).
old = load([p for p in EXPORTS if 'Get_all_tasks' in load(p)][-1])
fails = 0
def ok(label, cond):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label); fails += (not cond)

def strip_auth(x):
    if isinstance(x, dict):
        return {k: strip_auth(v) for k, v in x.items() if k != 'authentication'}
    if isinstance(x, list):
        return [strip_auth(v) for v in x]
    return x

# No-drift target: the first export carrying this change, not the newest; a later change to the
# same flow (the 2026-10-21 chunked task read) would otherwise fail this check for the wrong reason.
newest = load([p for p in EXPORTS if 'For_each_job' in load(p)][0])
if 'For_each_job' in newest:
    ok('published flow equals what the builder produces (no drift)',
       strip_auth(newest) == strip_auth(build_actions(json.loads(json.dumps(old)))))

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
    ok(f'{tag}: loop runs over this job', loop['foreach'] == "@body('Get_job_assignments')?['value']")
    ok(f'{tag}: summary written even when a job fails or is capped',
       A['Summarise']['runAfter'] == {'For_each_job': ['Succeeded', 'Failed']})
    ok(f'{tag}: Terminate after the loop and after the summary', A['Guard_capped']['runAfter'] == {'Summarise': ['Succeeded']})
    ok(f'{tag}: a failed job read still fails the run (not masked by the summary)',
       "actions('For_each_job')?['status']" in json.dumps(A['Guard_capped']['expression']))
    repair = loop['actions']['Condition_drifted']['actions']['Repair_counters']
    ok(f'{tag}: disarm controls writes', (repair['type'] == 'Compose') == disarm)
    names = set(A)
    for k, a in A.items():
        for dep in a.get('runAfter', {}):
            ok(f'{tag}: {k} runs after an action that exists', dep in names)
sys.exit(1 if fails else 0)
