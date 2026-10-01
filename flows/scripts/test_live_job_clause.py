# Structural test for the live-job clause on the three whole-list Assignments readers.
# Run: python flows/scripts/test_live_job_clause.py   (exit 0 = all pass)
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from live_job_clause import TARGETS, apply_to, resolve
from counter_recon_per_job import max_depth

EXP = pathlib.Path(__file__).parents[1] / 'exports'
fails = 0
def ok(label, cond):
    global fails
    print(('PASS' if cond else 'FAIL') + ' · ' + label); fails += (not cond)

def names(actions, out=None):
    out = set() if out is None else out
    for k, a in actions.items():
        out.add(k); names(a.get('actions', {}), out); names(a.get('else', {}).get('actions', {}), out)
    return out

for t in TARGETS:
    # Builder input = newest export that does NOT yet carry the clause.
    exports = sorted(EXP.glob(t['export_glob']))
    load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
    src = [p for p in exports if 'Get_live_jobs' not in json.dumps(load(p))][-1]
    before = load(src)
    A = json.loads(json.dumps(before))
    apply_to(A, t['read'], t['after'])
    container, read_name = resolve(A, t['read'])
    read = container[read_name]
    flt = read['inputs']['parameters']['$filter']
    n = t['name']
    ok(f'{n}: live jobs are Status ne Complete', container['Get_live_jobs']['inputs']['parameters']['$filter'] == "Status ne 'Complete'")
    ok(f'{n}: clause actions are siblings of the read', all(k in container for k in ('Get_live_jobs', 'Select_live_job_ids', 'Compose_live_job_clause')))
    ok(f'{n}: live jobs read after {t["after"]}', container['Get_live_jobs']['runAfter'] == {t['after']: ['Succeeded']})
    ok(f'{n}: read waits for the clause', read['runAfter'] == {'Compose_live_job_clause': ['Succeeded']})
    ok(f'{n}: read filters by the clause', "@{outputs('Compose_live_job_clause')}" in flt)
    old_flt = resolve(before, t['read'])[0][read_name]['inputs']['parameters'].get('$filter')
    ok(f'{n}: existing filter kept', old_flt is None or flt.startswith(old_flt + ' and '))
    ok(f'{n}: no action removed', names(before) <= names(A))
    ok(f'{n}: depth unchanged', max_depth(A) == max_depth(before))
    ok(f'{n}: empty live set filters to nothing, never to everything',
       "'JobId eq -1'" in container['Compose_live_job_clause']['inputs'])
    newest = load(exports[-1])
    if 'Get_live_jobs' in json.dumps(newest):
        ok(f'{n}: published flow equals what the builder produces (no drift)', newest == A)
sys.exit(1 if fails else 0)
