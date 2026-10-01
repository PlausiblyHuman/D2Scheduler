"""Convert D2 - Counter Reconciliation to read per live project (Spec A, Part 1).

    python flows/scripts/2026-10-01-counter-recon-per-job.py            dry run, writes nothing
    python flows/scripts/2026-10-01-counter-recon-per-job.py copy       writes the DISARMED definition
                                                                        (Repair_counters is a Compose) to
                                                                        flows/testdata/counter-recon-disarmed.json
                                                                        for FlowAgent create_flow
    python flows/scripts/2026-10-01-counter-recon-per-job.py apply      PATCH clientdata + PublishXml on the live flow

Route: Dataverse workflows(<id>).clientdata, as on 2026-09-28; edit_flow cannot save these flows.
"""
import json, pathlib, shutil, subprocess, sys, urllib.error, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from counter_recon_per_job import build_actions

TENANT = 'f24d9b39-6a71-4f4e-a376-03b6f61c97e4'
ORG = 'https://org4ed2f722.crm.dynamics.com'
WF = '291fa9d9-caaa-f111-aaac-6045bd0195dd'
NAME = 'D2 - Counter Reconciliation'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'dry'
OUT = pathlib.Path(__file__).parents[1] / 'testdata' / 'counter-recon-disarmed.json'


def sh(*a):
    exe = shutil.which(a[0]) or a[0]
    return subprocess.run([exe, *a[1:]], capture_output=True, text=True).stdout.strip()


got = sh('az', 'account', 'show', '--query', 'tenantId', '-o', 'tsv')
if got != TENANT:
    sys.exit(f'ABORT: az is on tenant {got!r}, expected D2 ({TENANT}).')
print('tenant CONFIRMED', sh('az', 'account', 'show', '--query', 'user.name', '-o', 'tsv'))
TOK = sh('az', 'account', 'get-access-token', '--resource', ORG + '/', '--query', 'accessToken', '-o', 'tsv')


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=body)
    req.add_header('Authorization', 'Bearer ' + TOK); req.add_header('Accept', 'application/json')
    if body is not None:
        req.add_header('Content-Type', 'application/json; charset=utf-8')
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read(); return r.status, (json.loads(raw.decode('utf-8')) if raw else None)
    except urllib.error.HTTPError as e:
        print('  HTTP', e.code, e.read().decode('utf-8', 'replace')[:1500]); raise SystemExit(2)


st, row = call('GET', f'{ORG}/api/data/v9.2/workflows({WF})?$select=clientdata,statecode,name,modifiedon')
assert row['name'] == NAME, row['name']
cd = json.loads(row['clientdata'])
A = cd['properties']['definition']['actions']
LIVE_A = A
if 'Get_all_tasks' not in A:
    # Already converted: rebuild from the last pre-conversion export (the builder's input), so a
    # builder fix can be re-applied and a half-finished apply (PATCH landed, PublishXml failed) completes.
    exports = sorted((pathlib.Path(__file__).parents[1] / 'exports').glob('D2-Counter-Reconciliation-*.json'))
    load = lambda p: json.loads(p.read_text(encoding='utf-8'))['definition']['actions']
    A = load([p for p in exports if 'Get_all_tasks' in load(p)][-1])
    print('live flow already converted; rebuilding from the pre-conversion export')
print(f"live: statecode {row['statecode']} modified {row['modifiedon']} top-level {sorted(LIVE_A)}")

if MODE == 'copy':
    d = json.loads(json.dumps(cd['properties']['definition']))
    d['actions'] = build_actions(json.loads(json.dumps(A)), disarm=True)
    OUT.write_text(json.dumps({'definition': d, 'connectionReferences': cd['properties']['connectionReferences']},
                              indent=1, ensure_ascii=True), encoding='utf-8')
    print('disarmed definition written to', OUT, 'top-level', sorted(d['actions']))
    sys.exit(0)

new_actions = build_actions(json.loads(json.dumps(A)), disarm=False)
unchanged = new_actions == LIVE_A
cd['properties']['definition']['actions'] = new_actions
new = json.dumps(cd, ensure_ascii=True)
print(f"new top-level {sorted(new_actions)} bytes {len(row['clientdata'])}->{len(new)} "
      f"{'(live already matches; publish only)' if unchanged else '(changes the live definition)'}")
if MODE != 'apply':
    print('dry run, nothing written'); sys.exit(0)

if not unchanged:
    st, _ = call('PATCH', f'{ORG}/api/data/v9.2/workflows({WF})', json.dumps({'clientdata': new}, ensure_ascii=True).encode('ascii'))
    print('PATCH', st)
px = '<importexportxml><workflows><workflow>{' + WF + '}</workflow></workflows></importexportxml>'
st, _ = call('POST', f'{ORG}/api/data/v9.2/PublishXml', json.dumps({'ParameterXml': px}).encode('ascii'))
print('PublishXml', st)
st, r2 = call('GET', f'{ORG}/api/data/v9.2/workflows({WF})?$select=clientdata,statecode,modifiedon')
A2 = json.loads(r2['clientdata'])['properties']['definition']['actions']
assert A2 == new_actions, 'published actions differ from what was built'
print(f"published: statecode {r2['statecode']} modified {r2['modifiedon']} top-level {sorted(A2)}")
