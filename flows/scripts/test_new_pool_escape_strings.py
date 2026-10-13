# flows/scripts/test_new_pool_escape_strings.py   Run: python flows/scripts/test_new_pool_escape_strings.py
import json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_escape_strings import apply, find
EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-New-Pool-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
before = load([p for p in EXPORTS if 'replace(replace(' not in json.dumps(load(p))][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

BSL = chr(92)
# The literals as they must appear in the definition: '\' (one backslash), '\\' (two), '"', '\"'
ONE, TWO, DQ, DQE = "'" + BSL + "'", "'" + BSL * 2 + "'", "'" + '"' + "'", "'" + BSL + '"' + "'"
wrap = lambda e: '@{replace(replace(' + e + ', ' + ONE + ', ' + TWO + '), ' + DQ + ', ' + DQE + ')}'
body = lambda acts, n: find(acts, n)['inputs']['parameters']['parameters/body']

A = apply(json.loads(json.dumps(before)))
want = {
    'Create_job': ["triggerOutputs()?['body/Title']", "coalesce(triggerOutputs()?['body/Address'], '')", "coalesce(triggerOutputs()?['body/City'], '')"],
    'Create_assignment': ["items('Apply_to_each_subphase')?['Title']"],
    'Create_task': ["items('Apply_to_each_task')?['Title']"],
}
for n, exprs in want.items():
    for e in exprs:
        ok(f'{n}: {e[:48]} carries both replaces, backslash first', body(A, n).count(wrap(e)) == 1)
ba = body(A, 'Create_assignment')
ok('Create_assignment Title wraps the whole concat', '"Title":"@{replace(replace(concat(triggerOutputs()?[\'body/JobNumber\'], ' in ba and ')' + ', ' + ONE + ', ' + TWO + '), ' + DQ + ', ' + DQE + ')}","JobId"' in ba)
ok('six interpolations escaped in total', sum(body(A, n).count('replace(replace(') for n in want) == 6)
bj = body(A, 'Create_job')
ok('dates, numbers and the PM id are left alone', "@{formatDateTime(triggerOutputs()?['body/StartDate'],'yyyy-MM-dd')}" in bj and "ProjectManagerId\":@{body('Ensure_pm_user')?['d']?['Id']}" in bj and "\"Sequence\":@{items('Apply_to_each_subphase')?['Sequence']}" in ba)

NASTY = 'x"y' + BSL + 'z" 12-18" per side' + BSL
def render(b):
    def r(m):
        if m.group(1).startswith('replace(replace('):
            return NASTY.replace(BSL, BSL * 2).replace('"', BSL + '"')   # what the expression yields
        return 'X' if b[m.start()-1] == '"' else '7'
    return json.loads(re.sub(r'@\{([^{}]*)\}', r, b))
r = render(bj)
ok('Create_job renders to valid JSON and round-trips the value', r['Title'] == r['Address'] == r['City'] == NASTY and r['Status'] == 'Planned')
r = render(ba)
ok('Create_assignment renders to valid JSON and round-trips the value', r['Title'] == r['SubPhaseName'] == NASTY)
r = render(body(A, 'Create_task'))
ok('Create_task renders to valid JSON and round-trips the value', r['Title'] == NASTY)
try:
    json.loads(body(before, 'Create_task').replace("@{items('Apply_to_each_task')?['Title']}", NASTY).replace("@{body('Create_assignment')?['d']?['Id']}", '7').replace("@{items('Apply_to_each_task')?['Sequence']}", '7'))
    ok('control: the unescaped body breaks on the same value', False)
except ValueError:
    ok('control: the unescaped body breaks on the same value', True)

m = find(A, 'Compose_failure_message')['inputs']
ok('failure message no longer claims where the build stopped', 'interrupted while creating sub-phase' not in m and 'last sub-phase processed was' in m and 'gap may be earlier' in m)
ok('failure message keeps its instructions', all(s in m for s in ('Do NOT resubmit', 'Delete Pool form', 'create it again', 'A Job row and a partial set')))
ok('failure message: quotes balanced', json.dumps(m).count("'") % 2 == 0)

C = json.loads(json.dumps(A))
for n in want:
    find(C, n)['inputs']['parameters']['parameters/body'] = body(before, n)
find(C, 'Compose_failure_message')['inputs'] = find(before, 'Compose_failure_message')['inputs']
ok('nothing outside the three bodies and the message changed', json.dumps(C, sort_keys=True) == json.dumps(before, sort_keys=True))
ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))
ok('the definition is ASCII-safe when dumped', json.dumps(A, ensure_ascii=True).isascii())
drv = pathlib.Path(__file__).with_name('2026-10-13-new-pool-escape-strings.py').read_text(encoding='utf-8')
ok('the driver backup lives outside the exports glob', "'backups'" in drv and 'exports/D2-New-Pool-' not in drv)
# No-drift target: the first export carrying this change (the export taken right after it was pushed), not the newest.
after = [p for p in EXPORTS if 'replace(replace(' in json.dumps(load(p))]
if after:
    newest = load(after[0])
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(newest) == strip(A))
else:
    ok('no export carries this change yet, no-drift check skipped', True)
sys.exit(1 if fails else 0)
