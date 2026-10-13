# tools/test_gen_template_seed.py   Run: python tools/test_gen_template_seed.py
import json, pathlib, subprocess, sys, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
GEN = ROOT / 'tools' / 'gen-template-seed.py'
LIVE = ROOT / 'tools' / 'fixtures' / 'live-crews-sample.json'
FIB = ROOT / 'D2-Build-Scheduler' / 'D2-Build-Scheduler' / 'data' / 'fiberglass-template.json'
fails = 0
def ok(label, cond, detail=''):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label + (f'  [{detail}]' if detail else '')); fails += (not cond)
def run(*args):
    return subprocess.run([sys.executable, str(GEN), *args], capture_output=True, text=True, cwd=str(ROOT))
with tempfile.TemporaryDirectory() as d:
    out = pathlib.Path(d) / 'fib.json'
    r = run('--template', str(FIB), '--build-type', 'Fiberglass', '--live', str(LIVE), '--out', str(out))
    ok('fiberglass run exits 0', r.returncode == 0, r.stdout[-300:] + r.stderr[-300:])
    seed = json.loads(out.read_text(encoding='utf-8'))
    ok('buildType on the file', seed.get('buildType') == 'Fiberglass')
    ok('45 sub-phases, 248 tasks', seed['counts'] == {'subphases': 45, 'tasks': 248}, seed['counts'])
    s = seed['subphases']
    ok('every sub-phase carries phaseNum and phaseName', all(x.get('phaseNum') and x.get('phaseName') for x in s))
    ok('2.3 is in Base Preparation and Shell Set', next(x for x in s if x['num'] == '2.3')['phaseName'] == 'Base Preparation and Shell Set')
    ok('seq is 1..45', [x['seq'] for x in s] == list(range(1, 46)))
    ok('@office rows get the office crew', next(x for x in s if x['num'] == '0.1')['defaultCrew'] == 'office')
    ok('@unassigned rows get unassigned', next(x for x in s if x['num'] == '2.3')['defaultCrew'] == 'unassigned')
    ok('a traded row gets a qualified crew from the live list', next(x for x in s if x['num'] == '1.2')['defaultCrew'] in ('campos', 'devon'))
    out2 = pathlib.Path(d) / 'gun.json'
    r = run('--live', str(LIVE), '--out', str(out2))
    ok('default run (Gunite from SEED_TEMPLATE) exits 0', r.returncode == 0, r.stderr[-300:])
    g = json.loads(out2.read_text(encoding='utf-8'))
    ok('default run is Gunite with 46/295', g['buildType'] == 'Gunite' and g['counts'] == {'subphases': 46, 'tasks': 295})
    ok('Gunite rows carry phaseName too', next(x for x in g['subphases'] if x['num'] == '4.3')['phaseName'] == 'Gunite And Shotcrete')
    r = run('--template', str(FIB), '--build-type', 'Carbon', '--live', str(LIVE), '--out', str(out))
    ok('an unknown build type is refused', r.returncode != 0)
sys.exit(1 if fails else 0)
