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
ok('11 phases, 0 to 10, numbered by their place in the sheet', [p['num'] for p in tpl] == [str(i) for i in range(11)])
ok('45 sub-phases', len(secs) == 45, len(secs))
ok('248 tasks', sum(len(s['tasks']) for s in secs) == 248, sum(len(s['tasks']) for s in secs))
ok('sub-phase numbers unique', len({s['num'] for s in secs}) == 45)
ok('Phase 7 is Equipment Installation, 7.1 to 7.3',
   tpl[7]['name'] == 'Equipment Installation' and [s['num'] for s in tpl[7]['sections']] == ['7.1','7.2','7.3'])
ok('Phase 8 is Startup and Trim Out, 8.1 to 8.4 (the sheet\'s second Phase 7)',
   tpl[8]['name'] == 'Startup and Trim Out' and [s['num'] for s in tpl[8]['sections']] == ['8.1','8.2','8.3','8.4']
   and tpl[8]['sections'][0]['name'] == 'Startup Preparation' and tpl[8]['sections'][3]['name'] == 'Trim Out')
ok('Phase 9 is Site Restoration, 9.1 to 9.6',
   tpl[9]['name'] == 'Site Restoration and Final Grade' and [s['num'] for s in tpl[9]['sections']] == ['9.1','9.2','9.3','9.4','9.5','9.6'])
ok('Phase 10 is Post Construction, 10.0 and 10.1',
   tpl[10]['name'] == 'Post Construction Completion Phase' and [s['num'] for s in tpl[10]['sections']] == ['10.0','10.1'])
ok('every sub-phase number starts with its phase number',
   all(s['num'].split('.')[0] == p['num'] for p in tpl for s in p['sections']))
ok('phase 4 is Electrical Rough-In, from the Task Name column', tpl[4]['name'] == 'Electrical Rough-In')
ok('phase 6 is Coping and Decking, from the Task Name column', tpl[6]['name'] == 'Coping and Decking')
ok('every duration is 2', all(s['days'] == 2 for s in secs))
ok('the punch-list note row is not a task', not any('multipal' in t for s in secs for t in s['tasks']))
s85 = next(s for s in secs if s['num'] == '9.5')
ok('the two oddly-sectioned rows are tasks of 9.5', len(s85['tasks']) == 6 and any(t.startswith('Fence Pool safety') for t in s85['tasks']))
ok("Don's text is verbatim", any(t.startswith('Fence Pool safety Barrior') for t in s85['tasks']))
by = {s['num']: s for s in secs}
ok('name matches copy the Gunite trade: 1.2 Site Preparation -> demolition', by['1.2']['skill'] == 'demolition')
ok('shifted matches: 1.4 Pool Layout -> dig (Gunite 1.3)', by['1.4']['skill'] == 'dig')
ok('near-name: 3.2 Plumbing Installation -> plumbing', by['3.2']['skill'] == 'plumbing')
ok('near-name: 6.1 Bond Beam/Collar Preparation -> rebar', by['6.1']['skill'] == 'rebar')
ok('swapped pair: 7.1 Equipment Plumbing -> plumbing, 7.3 Equipment Electrical -> automation',
   by['7.1']['skill'] == 'plumbing' and by['7.3']['skill'] == 'automation')
ok('10.0 Client Orientation -> poolschool', by['10.0']['skill'] == 'poolschool')
ok('renumbered matches keep their Gunite match: 10.1 Warranty -> @office (Gunite 7.0)', by['10.1']['skill'] == '@office')
ok('the new 9.1 Construction Cleanup does not inherit the old 9.1 (Warranty) Gunite match',
   by['9.1']['name'] == 'Construction Cleanup' and by['9.1']['skill'] == '@unassigned')
ok('office exceptions: 0.1 and 1.3 -> @office', by['0.1']['skill'] == '@office' and by['1.3']['skill'] == '@office')
ok('Gunite-unassigned matches stay @unassigned: 1.5, 4.4, 6.7', all(by[n]['skill'] == '@unassigned' for n in ('1.5','4.4','6.7')))
ok('subcontractor matches: 4.1, 4.2 -> @sub', by['4.1']['skill'] == '@sub' and by['4.2']['skill'] == '@sub')
ok('14 Fiberglass-only rows are @unassigned',
   sorted(n for n, s in by.items() if s['skill'] == '@unassigned' and n in ('2.1','2.2','2.3','5.1','5.2','5.3','8.1','8.4','9.1','9.2','9.3','9.4','9.5','9.6')) ==
   sorted(['2.1','2.2','2.3','5.1','5.2','5.3','8.1','8.4','9.1','9.2','9.3','9.4','9.5','9.6']))
rows = list(csv.DictReader(open(DATA / 'fiberglass-sub-phase-template.csv', encoding='utf-8-sig')))
ok('sub-phase CSV has 45 rows and the Gunite columns', len(rows) == 45 and list(rows[0].keys()) ==
   ['SubPhaseNumber','SubPhaseName','PhaseNumber','PhaseName','TradeCode','TradeName','AssignTo','DefaultDurationDays','Sequence','TaskCount'])
ok('Sequence is 1..45', [int(r['Sequence']) for r in rows] == list(range(1, 46)))
trows = list(csv.DictReader(open(DATA / 'fiberglass-task-template.csv', encoding='utf-8-sig')))
ok('task CSV has 248 rows', len(trows) == 248)
ok('generator is deterministic', subprocess.run([sys.executable, '-I', str(ROOT / 'tools' / 'fiberglass-template.py')], capture_output=True).returncode == 0
   and json.loads((DATA / 'fiberglass-template.json').read_text(encoding='utf-8')) == tpl)
sys.exit(1 if fails else 0)
