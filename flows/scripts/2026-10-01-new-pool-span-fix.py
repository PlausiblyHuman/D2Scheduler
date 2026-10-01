"""Apply new_pool_span_fix to D2 - New Pool (see that module for why).

    python flows/scripts/2026-10-01-new-pool-span-fix.py          dry run, writes nothing
    python flows/scripts/2026-10-01-new-pool-span-fix.py apply    PATCH clientdata + PublishXml

Runs already in flight keep the definition they started with; only new requests get this one.
"""
import json, pathlib, shutil, subprocess, sys, urllib.error, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_span_fix import apply, find

TENANT = 'f24d9b39-6a71-4f4e-a376-03b6f61c97e4'
ORG = 'https://org4ed2f722.crm.dynamics.com'
WF = 'd782ee70-2fab-f111-aaab-6045bd0196b3'
NAME = 'D2 - New Pool'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'dry'


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
old_limit = find(A, 'Do_until_span_complete')['limit']
print(f"live: statecode {row['statecode']} modified {row['modifiedon']} loop limit {old_limit}")
before = json.dumps(A, sort_keys=True)
apply(A)
if json.dumps(A, sort_keys=True) == before:
    print('live already matches; publish only')
new = json.dumps(cd, ensure_ascii=True)
print(f"new loop limit {find(A, 'Do_until_span_complete')['limit']} bytes {len(row['clientdata'])}->{len(new)}")
if MODE != 'apply':
    print('dry run, nothing written'); sys.exit(0)

st, _ = call('PATCH', f'{ORG}/api/data/v9.2/workflows({WF})', json.dumps({'clientdata': new}, ensure_ascii=True).encode('ascii'))
print('PATCH', st)
px = '<importexportxml><workflows><workflow>{' + WF + '}</workflow></workflows></importexportxml>'
st, _ = call('POST', f'{ORG}/api/data/v9.2/PublishXml', json.dumps({'ParameterXml': px}).encode('ascii'))
print('PublishXml', st)
st, r2 = call('GET', f'{ORG}/api/data/v9.2/workflows({WF})?$select=clientdata,statecode,modifiedon')
A2 = json.loads(r2['clientdata'])['properties']['definition']['actions']
assert A2 == A, 'published actions differ from what was built'
print(f"published: statecode {r2['statecode']} modified {r2['modifiedon']} loop limit {find(A2, 'Do_until_span_complete')['limit']}")
