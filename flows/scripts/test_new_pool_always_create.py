# Run: python flows/scripts/test_new_pool_always_create.py   (exit 0 = all pass)
import json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_always_create import apply, find, MOVED, LOOP, COND

EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-New-Pool-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
# The last export where the create still sits in the else branch.
before = load([p for p in EXPORTS if 'else' in load(p)[LOOP]['actions'][COND]][-1])
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

A = apply(json.loads(json.dumps(before)))
loop = A[LOOP]['actions']; cond = loop[COND]

ok('the create and everything after it now sit in the loop, outside the If', all(k in loop for k in MOVED))
ok('the If has no else branch left', 'else' not in cond)
ok('the If only records the short sub-phase', list(cond['actions']) == ['Append_shortScheduledSubphase']
   and cond['actions']['Append_shortScheduledSubphase']['type'] == 'AppendToStringVariable')
ok('the create runs after the If, on either branch', loop['Create_assignment']['runAfter'] == {COND: ['Succeeded']})
ok('tasks, total and cursor keep their order', loop['Filter_tasks_for_subphase']['runAfter'] == {'Create_assignment': ['Succeeded']}
   and loop['Compose_cursor_next']['runAfter'] == {'Merge_task_total': ['Succeeded']}
   and loop['Set_cursor_next']['runAfter'] == {'Compose_cursor_next': ['Succeeded']})
ok('Set_cursor_next does not read the variable it writes', "variables('cursor')" not in json.dumps(loop['Set_cursor_next']))
ok('nothing else in the loop moved', [k for k in before[LOOP]['actions'] if k != COND] == [k for k in loop if k not in MOVED + ['Compose_cursor_next', COND]])
ok('nothing outside the loop and the message changed',
   json.dumps({k: v for k, v in before.items() if k not in (LOOP, 'Condition_short_scheduled')}, sort_keys=True)
   == json.dumps({k: v for k, v in A.items() if k not in (LOOP, 'Condition_short_scheduled')}, sort_keys=True))
ok('apply is idempotent', json.dumps(apply(json.loads(json.dumps(A))), sort_keys=True) == json.dumps(A, sort_keys=True))

# Render the Create_assignment body for three spans and parse it as JSON, so a quoting slip in the
# body template fails here rather than as a 400 in a live build.
body = loop['Create_assignment']['inputs']['parameters']['parameters/body']
def render(spanStart, spanFinish, daysTaken, duration):
    def ev(m):
        e, pre = m.group(1), body[m.start() - 1]
        if e.startswith("if(empty(variables('spanStart'))"):
            return 'null' if not spanStart else f'"{spanStart}"'
        if e.startswith("if(empty(variables('spanFinish'))"):
            return 'null' if not spanFinish else f'"{spanFinish}"'
        if e.startswith("if(less(variables('daysTaken')"):
            return str(daysTaken if daysTaken < duration else duration)
        return 'X' if pre == '"' else '7'
    return json.loads(re.sub(r'@\{([^{}]*)\}', ev, body))
full = render('2026-10-05', '2026-10-06', 2, 2)
short = render('2026-10-05', '2026-10-05', 1, 2)
none_ = render('', '', 0, 2)
ok('a full span writes its dates and planned duration', full['ScheduledStart'] == '2026-10-05' and full['ScheduledFinish'] == '2026-10-06' and full['DurationDays'] == 2)
ok('a short span writes the days found, so dates and duration agree', short['ScheduledFinish'] == '2026-10-05' and short['DurationDays'] == 1)
ok('no day found writes empty dates, never an empty string', none_['ScheduledStart'] is None and none_['ScheduledFinish'] is None and none_['DurationDays'] == 0)
old = before[LOOP]['actions'][COND]['else']['actions']['Create_assignment']['inputs']['parameters']['parameters/body']
ok('the body writes the same columns as before', set(full) == set(json.loads(re.sub(r'@\{([^{}]*)\}', lambda m: 'X' if old[m.start()-1] == '"' else '7', old))))

msg = find(A, 'Compose_short_scheduled_message')['inputs']
ok('the message says every sub-phase exists and how to fix the days', 'every sub-phase and task exists' in msg and 'planned number of days' in msg and 'Do not delete or re-enter' in msg)
ok('the message strips the leading separator', "substring(variables('shortScheduledSubphase'), 2)" in msg)
# A WDL string literal is single-quoted; an unescaped apostrophe inside one breaks the expression.
for name in ('Compose_short_scheduled_message', 'Append_shortScheduledSubphase', 'Compose_cursor_next'):
    ok(f'{name}: quotes balanced', json.dumps(find(A, name)['inputs']).count("'") % 2 == 0)
ok('the request still ends Failed on a short span', '"Status\\":\\"Failed\\"' in json.dumps(find(A, 'Set_status_failed_span')['inputs']))

newest = load(EXPORTS[-1])
if 'else' not in newest[LOOP]['actions'][COND]:
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(newest) == strip(A))
sys.exit(1 if fails else 0)
