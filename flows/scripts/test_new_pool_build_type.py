# flows/scripts/test_new_pool_build_type.py   Run: python flows/scripts/test_new_pool_build_type.py
import json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_build_type import apply, find
EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-New-Pool-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
before = load([p for p in EXPORTS if 'Compose_build_type' not in json.dumps(load(p))][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

A = apply(json.loads(json.dumps(before)))
scope = A['Scope_provision_job']['actions']
ok('Compose_build_type sits in the provision scope after Ensure_pm_user', scope['Compose_build_type']['runAfter'] == {'Ensure_pm_user': ['Succeeded']})
ok('it coalesces a missing BuildType to Gunite', scope['Compose_build_type']['inputs'] == "@coalesce(triggerOutputs()?['body/BuildType']?['Value'], 'Gunite')")
sp, tt = scope['Get_subphase_template']['inputs']['parameters'], scope['Get_task_template']['inputs']['parameters']
ok('the template reads now run BEFORE Create_job, straight after the type', scope['Get_subphase_template']['runAfter'] == {'Compose_build_type': ['Succeeded']} and scope['Get_task_template']['runAfter'] == {'Get_subphase_template': ['Succeeded']})
ok('sub-phase read filtered by type, still ordered by Sequence, cap 100', sp['$filter'] == "BuildType eq '@{outputs('Compose_build_type')}'" and sp['$orderby'] == 'Sequence asc' and sp['$top'] == 100)
ok('task read filtered by type, cap raised to 1000', tt['$filter'] == "BuildType eq '@{outputs('Compose_build_type')}'" and tt['$top'] == 1000)
cap = scope['Condition_read_at_cap']
ok('the guard runs after the task read', cap['runAfter'] == {'Get_task_template': ['Succeeded']})
ok('the guard fires at either cap', cap['expression'] == {'or': [{'greaterOrEquals': ["@length(outputs('Get_subphase_template')?['body/value'])", 100]}, {'greaterOrEquals': ["@length(outputs('Get_task_template')?['body/value'])", 1000]}]})
ok('the guard marks the request Failed with ReadAtCap and terminates', 'ReadAtCap' in json.dumps(cap['actions']['Set_status_failed_cap']['inputs']) and cap['actions']['Terminate_cap']['type'] == 'Terminate' and cap['actions']['Terminate_cap']['inputs']['runStatus'] == 'Failed')
ok('Create_job runs only after the guard passes, so a capped read builds nothing', scope['Create_job']['runAfter'] == {'Condition_read_at_cap': ['Succeeded']})
ok('Create_job writes BuildType', '"BuildType\\":\\"@{outputs(\'Compose_build_type\')}\\"' in json.dumps(scope['Create_job']['inputs']['parameters']['parameters/body']))
ok('the work-calendar read follows Create_job, as the reads used to', scope['Get_work_calendar']['runAfter'] == {'Create_job': ['Succeeded']})
ok('the result message names the type', "outputs('Compose_build_type')" in find(A, 'Compose_result')['inputs'])
ok('a short-span and failure messages are untouched', find(A, 'Compose_short_scheduled_message') == find(before, 'Compose_short_scheduled_message'))
ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))
ok('nothing outside the scope and the result changed', json.dumps({k: v for k, v in before.items() if k not in ('Scope_provision_job', 'Condition_short_scheduled')}, sort_keys=True) == json.dumps({k: v for k, v in A.items() if k not in ('Scope_provision_job', 'Condition_short_scheduled')}, sort_keys=True))
body = scope['Create_job']['inputs']['parameters']['parameters/body']
rendered = json.loads(re.sub(r'@\{([^{}]*)\}', lambda m: 'Fiberglass' if 'Compose_build_type' in m.group(1) else ('X' if body[m.start()-1] == '"' else '7'), body))
ok('the Create_job body is valid JSON with BuildType beside Status', rendered['BuildType'] == 'Fiberglass' and rendered['Status'] == 'Planned')
for name in ('Compose_build_type', 'Compose_result'):
    ok(f'{name}: quotes balanced', json.dumps(find(A, name)['inputs']).count("'") % 2 == 0)
ok('the definition is ASCII-safe when dumped', json.dumps(A, ensure_ascii=True).isascii())
drv = pathlib.Path(__file__).with_name('2026-10-13-new-pool-build-type.py').read_text(encoding='utf-8')
ok('the driver backup lives outside the exports glob', "'backups'" in drv and 'exports/D2-New-Pool-' not in drv)
# No-drift target: the first export carrying this change (the export taken right after it was pushed), not the newest.
after = [p for p in EXPORTS if 'Compose_build_type' in json.dumps(load(p))]
if after:
    newest = load(after[0])
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(newest) == strip(A))
else:
    ok('no export carries this change yet, no-drift check skipped', True)
sys.exit(1 if fails else 0)
