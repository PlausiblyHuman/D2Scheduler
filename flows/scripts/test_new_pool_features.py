# flows/scripts/test_new_pool_features.py   Run: python flows/scripts/test_new_pool_features.py
import json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_features import apply
from new_pool_escape_strings import find
from counter_recon_per_job import max_depth, terminates_in_loop
EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-New-Pool-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
before = load([p for p in EXPORTS if 'Compose_is_na' not in json.dumps(load(p))][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

A = apply(json.loads(json.dumps(before)))
loop = A['Apply_to_each_subphase']; acts = loop['actions']
sel = A['Select_features']
ok('Select_features runs before the sub-phase loop', sel['runAfter'] == {'Init_shortScheduledSubphase': ['Succeeded']} and loop['runAfter'] == {'Select_features': ['Succeeded']})
ok('it splits Features on ; and trims and lowercases each name', sel['inputs'] == {'from': "@split(coalesce(triggerOutputs()?['body/Features'], ''), ';')", 'select': '@toLower(trim(item()))'})
na = acts['Compose_is_na']
ok('Compose_is_na is first in each sub-phase, and Set_currentSubphase follows it', na['runAfter'] == {} and acts['Set_currentSubphase']['runAfter'] == {'Compose_is_na': ['Succeeded']})
ok('N/A means Optional AND its feature name not picked', "equals(items('Apply_to_each_subphase')?['Optional'], true)" in na['inputs'] and "not(contains(body('Select_features')" in na['inputs'])
ok('the feature name is Feature, else the sub-phase title, compared lowercased and trimmed', "toLower(trim(coalesce(items('Apply_to_each_subphase')?['Feature'], items('Apply_to_each_subphase')?['Title'])))" in na['inputs'])
work = find(acts, 'Condition_is_work_day')['expression']
ok('an N/A sub-phase never counts a work day', 'and' in work and {'not': {'equals': ["@outputs('Compose_is_na')", True]}} in work['and'] and find(before, 'Condition_is_work_day')['expression'] in work['and'])
short = acts['Condition_span_incomplete']['expression']
ok('an N/A sub-phase is never reported short', short['and'][0] == {'not': {'equals': ["@outputs('Compose_is_na')", True]}} and short['and'][1] == before['Apply_to_each_subphase']['actions']['Condition_span_incomplete']['expression'])
ok('the cursor already stays put when there is no finish', "if(empty(variables('spanFinish')), variables('cursor')" in acts['Compose_cursor_next']['inputs'])
ok('the span loop still ends: its exit test is unchanged', acts['Do_until_span_complete']['expression'] == before['Apply_to_each_subphase']['actions']['Do_until_span_complete']['expression'])

body = acts['Create_assignment']['inputs']['parameters']['parameters/body']
ok('NotApplicable comes from Compose_is_na', '"NotApplicable":@{if(equals(outputs(\'Compose_is_na\'), true), \'true\', \'false\')}' in body)
ok('an N/A row keeps the template duration rather than 0 days taken', "if(or(equals(outputs('Compose_is_na'), true), not(less(variables('daysTaken')" in body)
for col in ('PhaseName', 'Skill', 'TemplateItemId', 'Feature'):
    ok(f'{col} is written', f'"{col}":' in body)
ok('TemplateItemId is the template row id, unquoted', "\"TemplateItemId\":@{items('Apply_to_each_subphase')?['ID']}," in body)
ok('Feature is the feature name only on optional rows', "if(equals(items('Apply_to_each_subphase')?['Optional'], true), coalesce(items('Apply_to_each_subphase')?['Feature'], items('Apply_to_each_subphase')?['Title']), '')" in body)
ok('the three new strings are escaped like the others', body.count('replace(replace(') == 2 + 3, str(body.count('replace(replace(')))

def render(b, na_value):
    def r(m):
        e = m.group(1); quoted = b[m.start() - 1] == '"'
        if quoted: return 'X'
        if "Compose_is_na'), true), 'true'" in e: return na_value
        return '7'
    return json.loads(re.sub(r'@\{((?:[^{}]|\{[^{}]*\})*)\}', r, b))
for v in ('true', 'false'):
    try:
        j = render(body, v); good = j['NotApplicable'] is (v == 'true') and j['TemplateItemId'] == 7 and j['Locked'] is False
    except Exception as e:
        good, j = False, e
    ok(f'the Create_assignment body is valid JSON with NotApplicable {v}', good, '' if good else str(j))

ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))
untouched = lambda x: {k: v for k, v in x.items() if k not in ('Apply_to_each_subphase', 'Select_features')}
ok('nothing outside the loop changed', json.dumps(untouched(before), sort_keys=True) == json.dumps(untouched(A), sort_keys=True))
inner_before = {k: v for k, v in before['Apply_to_each_subphase']['actions'].items() if k not in ('Do_until_span_complete', 'Condition_span_incomplete', 'Create_assignment', 'Set_currentSubphase')}
inner_after = {k: v for k, v in acts.items() if k in inner_before}
ok('inside the loop only the four touched actions changed', json.dumps(inner_before, sort_keys=True) == json.dumps(inner_after, sort_keys=True))
ok('nesting stays within 8', max_depth(A) <= 8, str(max_depth(A)))
ok('no Terminate inside a loop', not terminates_in_loop(A))
ok('the definition is ASCII-safe when dumped', json.dumps(A, ensure_ascii=True).isascii())
after = [p for p in EXPORTS if 'Compose_is_na' in json.dumps(load(p))]
if after:
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(load(after[0])) == strip(A))
else:
    ok('no export carries this change yet, no-drift check skipped', True)
sys.exit(1 if fails else 0)
