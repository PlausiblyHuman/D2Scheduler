"""Apply new_pool_build_type to D2 - New Pool: build from the request's build type template (see that module).

    python flows/scripts/2026-10-13-new-pool-build-type.py          dry run, writes nothing
    python flows/scripts/2026-10-13-new-pool-build-type.py apply    PATCH clientdata + PublishXml

Runs already in flight keep the definition they started with; only new requests get this one.
"""
import json, pathlib, shutil, subprocess, sys, urllib.error, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from new_pool_build_type import apply, find

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
print(f"live: statecode {row['statecode']} modified {row['modifiedon']} Compose_build_type present: {'Compose_build_type' in A['Scope_provision_job']['actions']}")
before = json.dumps(A, sort_keys=True)
apply(A)
already = json.dumps(A, sort_keys=True) == before
if already:
    print('live already matches; publish only')
new = json.dumps(cd, ensure_ascii=True)
print(f"Compose_build_type present: {'Compose_build_type' in A['Scope_provision_job']['actions']} bytes {len(row['clientdata'])}->{len(new)}")
if MODE != 'apply':
    print('dry run, nothing written'); sys.exit(0)

BACKUP = pathlib.Path(__file__).resolve().parents[1] / 'exports' / 'backups' / 'D2-New-Pool-pre-build-type.json'
if already:
    print('no backup: live already matches')
elif BACKUP.exists():
    print('backup exists, left untouched:', BACKUP)
else:
    BACKUP.parent.mkdir(parents=True, exist_ok=True)
    BACKUP.write_text(row['clientdata'], encoding='utf-8')
    print('backup written:', BACKUP)
st, _ = call('PATCH', f'{ORG}/api/data/v9.2/workflows({WF})', json.dumps({'clientdata': new}, ensure_ascii=True).encode('ascii'))
print('PATCH', st)
px = '<importexportxml><workflows><workflow>{' + WF + '}</workflow></workflows></importexportxml>'
st, _ = call('POST', f'{ORG}/api/data/v9.2/PublishXml', json.dumps({'ParameterXml': px}).encode('ascii'))
print('PublishXml', st)
st, r2 = call('GET', f'{ORG}/api/data/v9.2/workflows({WF})?$select=clientdata,statecode,modifiedon')
A2 = json.loads(r2['clientdata'])['properties']['definition']['actions']
assert A2 == A, 'published actions differ from what was built'
print(f"published: statecode {r2['statecode']} modified {r2['modifiedon']} Compose_build_type present: {'Compose_build_type' in A2['Scope_provision_job']['actions']}")
