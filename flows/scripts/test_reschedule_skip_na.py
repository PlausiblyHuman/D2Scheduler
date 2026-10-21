# flows/scripts/test_reschedule_skip_na.py   Run: python flows/scripts/test_reschedule_skip_na.py
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from reschedule_skip_na import apply, SKIP_NEW, PIN_NEW
from new_pool_escape_strings import find
from counter_recon_per_job import max_depth, terminates_in_loop
EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-Reschedule-Pool-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
before = load([p for p in EXPORTS if "(not applicable)" not in json.dumps(load(p))][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

A = apply(json.loads(json.dumps(before)))
skip = find(A, 'Condition_skip_row')
ok('an N/A row is skipped', skip['expression'] == {'equals': [SKIP_NEW, True]} and "equals(item()?['NotApplicable'], true)" in SKIP_NEW)
ok('locked, signed-off and no-duration rows are still skipped', all(t in SKIP_NEW for t in ("item()?['Locked']", "item()?['InstallerSignOff']", "item()?['DurationDays']")))
pin = skip['actions']['Condition_is_pinned']
ok('an N/A row is never treated as pinned, so its missing finish date is never read', pin['expression'] == {'equals': [PIN_NEW, True]} and PIN_NEW.startswith("@and(not(equals(item()?['NotApplicable'], true))"))
ok('the pinned branch itself is unchanged', pin['actions'] == find(before, 'Condition_is_pinned')['actions'])
lab = pin['else']['actions']['Compose_skipped_no_duration']['inputs']
ok('it is listed as (not applicable), others still as (no duration)', "' (not applicable)', ' (no duration)')" in lab)
ok('the scheduling branch for an ordinary row is unchanged', skip['else'] == find(before, 'Condition_skip_row')['else'])
strip_skip = lambda x: json.loads(json.dumps(x).replace(json.dumps(find(x, 'Condition_skip_row')), '"X"'))
ok('nothing outside Condition_skip_row changed', strip_skip(before) == strip_skip(A))
ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))
ok('nesting stays within 8', max_depth(A) <= 8, str(max_depth(A)))
ok('no Terminate inside a loop', not terminates_in_loop(A))
for e in (SKIP_NEW, PIN_NEW, lab):
    ok('balanced parentheses and quotes', e.count('(') == e.count(')') and e.count("'") % 2 == 0, e[:60])
after = [p for p in EXPORTS if "(not applicable)" in json.dumps(load(p))]
if after:
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(load(after[0])) == strip(A))
else:
    ok('no export carries this change yet, no-drift check skipped', True)
sys.exit(1 if fails else 0)
