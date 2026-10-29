# flows/scripts/test_crew_trade_check_preferences.py   Run: python flows/scripts/test_crew_trade_check_preferences.py
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from crew_trade_check_preferences import apply
from new_pool_escape_strings import find
from counter_recon_per_job import max_depth, terminates_in_loop
EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-Crew-Trade-Check-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
before = load([p for p in EXPORTS if 'Init_never' not in json.dumps(load(p))][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

A = apply(json.loads(json.dumps(before)))
ok('Init_never is a top-level array variable named never, after Init_cleared',
   A.get('Init_never', {}).get('type') == 'InitializeVariable'
   and A['Init_never']['inputs'] == {'variables': [{'name': 'never', 'type': 'array', 'value': []}]}
   and A['Init_never']['runAfter'] == {'Init_cleared': ['Succeeded']})
ok('For_each_crew now runs after Init_never', A['For_each_crew']['runAfter'] == {'Init_never': ['Succeeded']})
acts = A['For_each_crew']['actions']
ok('Compose_overall_never is first in the loop',
   acts['Compose_overall_never'] == {'runAfter': {}, 'type': 'Compose',
       'inputs': "@equals(coalesce(items('For_each_crew')?['Preference'], 3), 0)"})
ok('Filter_crew_trades runs after it and excludes Never rows',
   acts['Filter_crew_trades']['runAfter'] == {'Compose_overall_never': ['Succeeded']}
   and acts['Filter_crew_trades']['inputs']['where'] ==
   "@and(equals(item()?['Crew']?['Id'], items('For_each_crew')?['ID']), not(outputs('Compose_overall_never')), not(equals(coalesce(item()?['Preference'], 3), 0)))")
ok('Filter_never_rows keeps the crew clause and adds the Never or',
   acts['Filter_never_rows']['inputs'] == {
       'from': "@outputs('Get_crew_trades')?['body/value']",
       'where': "@and(equals(item()?['Crew']?['Id'], items('For_each_crew')?['ID']), or(equals(outputs('Compose_overall_never'), true), equals(coalesce(item()?['Preference'], 3), 0)))"}
   and acts['Filter_never_rows']['type'] == 'Query'
   and acts['Filter_never_rows']['runAfter'] == {'Set_qual': ['Succeeded']})
ok('Select_never_pairs uses the same concat as Select_pairs over the never rows',
   acts['Select_never_pairs']['inputs'] == {'from': "@body('Filter_never_rows')", 'select': acts['Select_pairs']['inputs']['select']}
   and acts['Select_never_pairs']['runAfter'] == {'Filter_never_rows': ['Succeeded']})
ok('Compose_merged_never unions into never',
   acts['Compose_merged_never']['inputs'] == "@union(variables('never'), body('Select_never_pairs'))"
   and acts['Compose_merged_never']['runAfter'] == {'Select_never_pairs': ['Succeeded']})
ok('Set_never writes the never variable',
   acts['Set_never']['type'] == 'SetVariable'
   and acts['Set_never']['inputs'] == {'name': 'never', 'value': "@outputs('Compose_merged_never')"}
   and acts['Set_never']['runAfter'] == {'Compose_merged_never': ['Succeeded']})
ok('the qual chain is otherwise unchanged',
   all(json.dumps(acts[k], sort_keys=True) == json.dumps(find(before, 'For_each_crew')['actions'][k], sort_keys=True)
       for k in ('Select_pairs', 'Compose_merged', 'Set_qual')))
ct = find(A, 'For_each_assignment')['actions']['Compose_text']['inputs']
AS = "items('For_each_assignment')"
want = ("@if(or(equals(coalesce(" + AS + "?['Trade']?['Id'],''),''), equals(coalesce(" + AS + "?['Crew']?['Value'],''),'')),'',"
        "if(contains(variables('qual'), outputs('Compose_pair')),'',"
        "if(contains(variables('never'), outputs('Compose_pair')),"
        "concat('Crew ', " + AS + "?['Crew']?['Value'],' is rated Never for ', " + AS + "?['Trade']?['Value']),"
        "concat('Crew ', " + AS + "?['Crew']?['Value'],' does not hold the required trade ', " + AS + "?['Trade']?['Value']))))")
ok('Compose_text is null-guard, qual pass, Never message, else does-not-hold', ct == want, ct)
ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))
changed = ('Init_never', 'For_each_crew')
ok('no top-level action outside Init_never and For_each_crew changed (For_each_assignment differs only in Compose_text)',
   all(json.dumps(A[k], sort_keys=True) == json.dumps(before[k], sort_keys=True) for k in before if k not in changed + ('For_each_assignment',))
   and all(json.dumps(A['For_each_assignment']['actions'][k], sort_keys=True) == json.dumps(before['For_each_assignment']['actions'][k], sort_keys=True)
           for k in before['For_each_assignment']['actions'] if k != 'Compose_text'))
ok('InitializeVariable only at top level',
   not any(a.get('type') == 'InitializeVariable' for t in A.values() for sub in [t.get('actions', {}), t.get('else', {}).get('actions', {})] for a in sub.values()))
ok('nesting stays within 8', max_depth(A) <= 8, str(max_depth(A)))
ok('no Terminate inside a loop', not terminates_in_loop(A))
ok('the definition is ASCII-safe when dumped', json.dumps(A, ensure_ascii=True).isascii())
after = [p for p in EXPORTS if 'Init_never' in json.dumps(load(p))]
if after:
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(load(after[-1])) == strip(A))
else:
    ok('no export carries this change yet, no-drift check skipped', True)
sys.exit(1 if fails else 0)
