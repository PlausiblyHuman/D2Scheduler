# flows/scripts/test_new_pool_escape_jobnumber.py   Run: python flows/scripts/test_new_pool_escape_jobnumber.py
import json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_escape_jobnumber import apply, find, JN, JSON_JOBNUMBER, RESULTS, FILTERS
from new_pool_escape_strings import esc
EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-New-Pool-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
MARK = '@{' + esc(JN) + '}'
carries = lambda acts: MARK in find(acts, 'Create_job')['inputs']['parameters']['parameters/body']
before = load([p for p in EXPORTS if not carries(load(p))][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

BSL = chr(92)
P = lambda acts, n: find(acts, n)['inputs']['parameters']
A = apply(json.loads(json.dumps(before)))

for n in JSON_JOBNUMBER:
    ok(f'{n}: the job number carries both replaces, backslash first', P(A, n)['parameters/body'].count(MARK) == 1)
for n, c in RESULTS.items():
    ok(f'{n}: {c} carries both replaces', P(A, n)['parameters/body'].count('@{' + esc("outputs('" + c + "')") + '}') == 1)
ODATA = "'@{replace(" + JN + ", '''', '''''')}'"
for n in FILTERS:
    ok(f'{n}: the job number has its quotes doubled for OData', P(A, n)['$filter'].count(ODATA) == 1, P(A, n)['$filter'][:120])

# Render: an escaped expression yields the escaped value, any other expression a plain stand-in.
NASTY = "26-2077 O'Brien \"Lake\" " + BSL + " house"
def render(b):
    def r(m):
        if m.group(1).startswith('replace(replace('):
            return NASTY.replace(BSL, BSL * 2).replace('"', BSL + '"')
        return 'X' if b[m.start() - 1] == '"' else '7'
    return json.loads(re.sub(r'@\{((?:[^{}]|\{[^{}]*\})*)\}', r, b))
for n in JSON_JOBNUMBER + tuple(RESULTS):
    b = P(A, n)['parameters/body']
    try:
        out = render(b)
        ok(f'{n} renders to valid JSON and round-trips the value', NASTY in json.dumps(out, ensure_ascii=False).replace(BSL + '"', '"').replace(BSL * 2, BSL), str(out)[:100])
    except ValueError as e:
        ok(f'{n} renders to valid JSON and round-trips the value', False, str(e))

# OData: WDL '''' is one quote, so replace(x, '''', '''''') doubles each quote in the value.
for n in FILTERS:
    f = P(A, n)['$filter']
    rendered = f.replace(ODATA, "'" + NASTY.replace("'", "''") + "'")
    lit = re.search(r"JobNumber eq '((?:[^']|'')*)'(?:\s|$)", rendered)
    ok(f'{n}: the rendered filter keeps the whole job number in one string', bool(lit) and lit.group(1).replace("''", "'") == NASTY, rendered[:120])

try:
    json.loads(re.sub(r'@\{((?:[^{}]|\{[^{}]*\})*)\}', lambda m: NASTY if 'JobNumber' in m.group(1) else '7', P(before, 'Create_job')['parameters/body']))
    ok('control: the unescaped Create_job body breaks on the same value', False)
except ValueError:
    ok('control: the unescaped Create_job body breaks on the same value', True)

C = json.loads(json.dumps(A))
for n in JSON_JOBNUMBER + tuple(RESULTS):
    P(C, n)['parameters/body'] = P(before, n)['parameters/body']
for n in FILTERS:
    P(C, n)['$filter'] = P(before, n)['$filter']
ok('nothing outside the seven bodies and two filters changed', json.dumps(C, sort_keys=True) == json.dumps(before, sort_keys=True))
ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))
ok('the definition is ASCII-safe when dumped', json.dumps(A, ensure_ascii=True).isascii())
drv = pathlib.Path(__file__).with_name('2026-10-23-new-pool-escape-jobnumber.py').read_text(encoding='utf-8')
ok('the driver backup lives outside the exports glob', "'backups'" in drv)
# No-drift target: the first export carrying this change, not the newest.
after = [p for p in EXPORTS if carries(load(p))]
if after:
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(load(after[0])) == strip(A))
else:
    ok('no export carries this change yet, no-drift check skipped', True)
sys.exit(1 if fails else 0)
