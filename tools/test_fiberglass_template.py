# tools/test_fiberglass_template.py   Run: python tools/test_fiberglass_template.py  (exit 0 = pass)
import json, pathlib, subprocess, sys, csv
ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'D2-Build-Scheduler' / 'D2-Build-Scheduler' / 'data'
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)

r = subprocess.run([sys.executable, '-I', str(ROOT / 'tools' / 'fiberglass-template.py')], capture_output=True, text=True)
ok('generator exits 0', r.returncode == 0, r.stderr[-400:])
tpl = json.loads((DATA / 'fiberglass-template.json').read_text(encoding='utf-8'))
secs = [s for p in tpl for s in p['sections']]
ok('10 phases, 0 to 9', [p['num'] for p in tpl] == [str(i) for i in range(10)])
ok('45 sub-phases', len(secs) == 45, len(secs))
ok('248 tasks', sum(len(s['tasks']) for s in secs) == 248, sum(len(s['tasks']) for s in secs))
ok('sub-phase numbers unique', len({s['num'] for s in secs}) == 45)
ok('the two Phase 7s merged into 7.1 to 7.7',
   [s['num'] for s in secs if s['num'].startswith('7.')] == ['7.1','7.2','7.3','7.4','7.5','7.6','7.7'])
ok('7.4 is Startup Preparation (was the second 7.1)', next(s['name'] for s in secs if s['num']=='7.4') == 'Startup Preparation')
ok('7.7 is Trim Out', next(s['name'] for s in secs if s['num']=='7.7') == 'Trim Out')
ok('phase 7 name is the merged one', tpl[7]['name'] == 'Equipment Installation, Startup and Trim Out')
ok('phase 4 is Electrical Rough-In, from the Task Name column', tpl[4]['name'] == 'Electrical Rough-In')
ok('phase 6 is Coping and Decking, from the Task Name column', tpl[6]['name'] == 'Coping and Decking')
ok('every duration is 2', all(s['days'] == 2 for s in secs))
ok('the punch-list note row is not a task', not any('multipal' in t for s in secs for t in s['tasks']))
s85 = next(s for s in secs if s['num'] == '8.5')
ok('the two oddly-sectioned rows are tasks of 8.5', len(s85['tasks']) == 6 and any(t.startswith('Fence Pool safety') for t in s85['tasks']))
ok("Don's text is verbatim", any(t.startswith('Fence Pool safety Barrior') for t in s85['tasks']))
by = {s['num']: s for s in secs}
ok('name matches copy the Gunite trade: 1.2 Site Preparation -> demolition', by['1.2']['skill'] == 'demolition')
ok('shifted matches: 1.4 Pool Layout -> dig (Gunite 1.3)', by['1.4']['skill'] == 'dig')
ok('near-name: 3.2 Plumbing Installation -> plumbing', by['3.2']['skill'] == 'plumbing')
ok('near-name: 6.1 Bond Beam/Collar Preparation -> rebar', by['6.1']['skill'] == 'rebar')
ok('swapped pair: 7.1 Equipment Plumbing -> plumbing, 7.3 Equipment Electrical -> automation',
   by['7.1']['skill'] == 'plumbing' and by['7.3']['skill'] == 'automation')
ok('9.0 Client Orientation -> poolschool', by['9.0']['skill'] == 'poolschool')
ok('office exceptions: 0.1 and 1.3 -> @office', by['0.1']['skill'] == '@office' and by['1.3']['skill'] == '@office')
ok('Gunite-unassigned matches stay @unassigned: 1.5, 4.4, 6.7', all(by[n]['skill'] == '@unassigned' for n in ('1.5','4.4','6.7')))
ok('subcontractor matches: 4.1, 4.2 -> @sub', by['4.1']['skill'] == '@sub' and by['4.2']['skill'] == '@sub')
ok('14 Fiberglass-only rows are @unassigned',
   sorted(n for n, s in by.items() if s['skill'] == '@unassigned' and n in ('2.1','2.2','2.3','5.1','5.2','5.3','7.4','7.7','8.1','8.2','8.3','8.4','8.5','8.6')) ==
   ['2.1','2.2','2.3','5.1','5.2','5.3','7.4','7.7','8.1','8.2','8.3','8.4','8.5','8.6'])
rows = list(csv.DictReader(open(DATA / 'fiberglass-sub-phase-template.csv', encoding='utf-8-sig')))
ok('sub-phase CSV has 45 rows and the Gunite columns', len(rows) == 45 and list(rows[0].keys()) ==
   ['SubPhaseNumber','SubPhaseName','PhaseNumber','PhaseName','TradeCode','TradeName','AssignTo','DefaultDurationDays','Sequence','TaskCount'])
ok('Sequence is 1..45', [int(r['Sequence']) for r in rows] == list(range(1, 46)))
trows = list(csv.DictReader(open(DATA / 'fiberglass-task-template.csv', encoding='utf-8-sig')))
ok('task CSV has 248 rows', len(trows) == 248)
ok('generator is deterministic', subprocess.run([sys.executable, '-I', str(ROOT / 'tools' / 'fiberglass-template.py')], capture_output=True).returncode == 0
   and json.loads((DATA / 'fiberglass-template.json').read_text(encoding='utf-8')) == tpl)
sys.exit(1 if fails else 0)
