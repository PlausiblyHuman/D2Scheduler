# Run: python flows/scripts/test_new_pool_span_fix.py   (exit 0 = all pass)
import json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_span_fix import apply, find

EXPORTS = sorted(pathlib.Path(__file__).parents[1].joinpath('exports').glob('D2-New-Pool-*.json'))
load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
before = load([p for p in EXPORTS if 'PT1H' in json.dumps(load(p))][-1])
fails = 0
def ok(label, cond):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label); fails += (not cond)

A = apply(json.loads(json.dumps(before)))
ok('the work-day search allows a day, not an hour', find(A, 'Do_until_span_complete')['limit'] == {'count': 90, 'timeout': 'P1D'})
msg = find(A, 'Compose_short_scheduled_message')['inputs']
ok('the message no longer says to delete and re-enter', 'Delete Pool' not in msg and 'resubmit' not in msg.lower() and 'Do not delete or re-enter' in msg)
ok('the message no longer blames the 90-day limit alone', '90-day' not in json.dumps(A))
mail = find(A, 'Send_span_failure_email')['inputs']['parameters']
ok('the subject is not URGENT/INCOMPLETE', 'URGENT' not in mail['emailMessage/Subject'] and 'INCOMPLETE' not in mail['emailMessage/Subject'])
ok('normal importance', mail['emailMessage/Importance'] == 'Normal')
# A WDL string literal is single-quoted; an unescaped apostrophe inside one breaks the expression.
for name in ('Compose_short_scheduled_message', 'Set_shortScheduledSubphase'):
    expr = json.dumps(find(A, name)['inputs'])
    ok(f'{name}: quotes balanced', expr.count("'") % 2 == 0)
ok('the request still ends Failed', '"Status\\":\\"Failed\\"' in json.dumps(find(A, 'Set_status_failed_span')['inputs']))
ok('nothing else changed', json.dumps({k: v for k, v in before.items() if k not in ('Apply_to_each_subphase', 'Condition_short_scheduled')}, sort_keys=True)
   == json.dumps({k: v for k, v in A.items() if k not in ('Apply_to_each_subphase', 'Condition_short_scheduled')}, sort_keys=True))
newest = load(EXPORTS[-1])
if 'P1D' in json.dumps(newest):
    strip = lambda x: json.loads(json.dumps(x).replace('"authentication": "@parameters(\'$authentication\')", ', ''))
    ok('published flow equals what the builder produces (no drift)', strip(newest) == strip(A))
sys.exit(1 if fails else 0)
