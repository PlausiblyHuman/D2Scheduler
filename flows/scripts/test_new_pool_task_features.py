# flows/scripts/test_new_pool_task_features.py   Run: python flows/scripts/test_new_pool_task_features.py
import json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_task_features import apply
from new_pool_escape_strings import find
from counter_recon_per_job import max_depth, terminates_in_loop
EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-New-Pool-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
before = load([p for p in EXPORTS if 'Compose_task_is_na' not in json.dumps(load(p))][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

A = apply(json.loads(json.dumps(before)))
loop = find(A, 'Apply_to_each_task'); acts = loop['actions']
na = acts.get('Compose_task_is_na', {})
ok('Compose_task_is_na is first in each task, and Create_task follows it',
   na.get('runAfter') == {} and acts['Create_task']['runAfter'] == {'Compose_task_is_na': ['Succeeded']})
inp = na.get('inputs', '')
ok('it reads Feature through coalesce, trimmed', "trim(coalesce(items('Apply_to_each_task')?['Feature'], ''))" in inp)
ok('N/A needs a non-blank Feature', "not(equals(trim(coalesce(items('Apply_to_each_task')?['Feature'], '')), ''))" in inp)
ok('N/A means the lowercased feature is not among the sub-phase picks',
   "not(contains(body('Select_features'), toLower(trim(coalesce(items('Apply_to_each_task')?['Feature'], '')))))" in inp)
body = acts['Create_task']['inputs']['parameters']['parameters/body']
ok('Feature, NotApplicable and the Note branch are written', all(k in body for k in ('"Feature":"', '"NotApplicable":', '\\"Note\\"')) or all(k in body for k in ('"Feature":"', '"NotApplicable":', '"Note"')))
ok('the Note is the automatic reason: the trimmed Feature plus " not on this project"',
   "concat(trim(coalesce(items('Apply_to_each_task')?['Feature'], '')), ' not on this project')" in body)
ok('the two new strings are escaped like Title', body.count('replace(replace(') == 1 + 2, str(body.count('replace(replace(')))


def render(b, feature, na):
    """Evaluate the body template for one case, as the flow would, then parse it."""
    def esc_json(s):
        return s.replace('\\', '\\\\').replace('"', '\\"')
    reason = feature.strip() + ' not on this project'
    def r(m):
        e = m.group(1)
        if "Compose_task_is_na'), true), concat(" in e:
            return (',"Note":"' + esc_json(reason) + '"') if na else ''
        if "Compose_task_is_na'), true), 'true'" in e:
            return 'true' if na else 'false'
        if "['Feature']" in e:
            return esc_json(feature.strip())
        if "['Title']" in e:
            return 'T'
        return '7'
    return json.loads(re.sub(r'@\{((?:[^{}]|\{[^{}]*\})*)\}', r, b))

cases = [('no feature', '', False), ('feature picked', 'Spa', False), ('feature unpicked', 'Auto "Cover"', True)]
for label, feat, isna in cases:
    try:
        j = render(body, feat, isna)
        good = (j['Feature'] == feat and j['NotApplicable'] is isna and j['Complete'] is False
                and (j.get('Note') == feat + ' not on this project' if isna else 'Note' not in j))
    except Exception as e:
        good, j = False, e
    ok(f'Create_task body is valid JSON and right for: {label}', good, '' if good else str(j))

ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))
strip_loop = lambda x: json.loads(json.dumps(x))
b2 = strip_loop(before); a2 = strip_loop(A)
find(b2, 'Apply_to_each_task')['actions'] = {}; find(a2, 'Apply_to_each_task')['actions'] = {}
ok('nothing outside the task loop changed', json.dumps(b2, sort_keys=True) == json.dumps(a2, sort_keys=True))
ok('nesting stays within 8', max_depth(A) <= 8, str(max_depth(A)))
ok('no Terminate inside a loop', not terminates_in_loop(A))
ok('the definition is ASCII-safe when dumped', json.dumps(A, ensure_ascii=True).isascii())
after = [p for p in EXPORTS if 'Compose_task_is_na' in json.dumps(load(p))]
if after:
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(load(after[0])) == strip(A))
else:
    ok('no export carries this change yet, no-drift check skipped', True)
sys.exit(1 if fails else 0)
