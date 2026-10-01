"""Whole-list flows skip Complete projects (Spec A, Part 2).

    python flows/scripts/2026-10-01-live-job-clause.py          dry run, writes nothing
    python flows/scripts/2026-10-01-live-job-clause.py apply    PATCH clientdata + PublishXml on each flow

Adds Get_live_jobs / Select_live_job_ids / Compose_live_job_clause before the whole-list Assignments
read of Crew Trade Check, Conflict Flag and Reschedule Pool (see live_job_clause.py). Skips a flow
that already has the clause. Route: Dataverse workflows(<id>).clientdata, as on 2026-09-28.
"""
import json, pathlib, shutil, subprocess, sys, urllib.error, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from live_job_clause import TARGETS, apply_to

TENANT = 'f24d9b39-6a71-4f4e-a376-03b6f61c97e4'
ORG = 'https://org4ed2f722.crm.dynamics.com'
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


for t in TARGETS:
    wf = t['wf']
    st, row = call('GET', f'{ORG}/api/data/v9.2/workflows({wf})?$select=clientdata,statecode,name,modifiedon')
    assert row['name'] == t['name'], row['name']
    cd = json.loads(row['clientdata'])
    A = cd['properties']['definition']['actions']
    if 'Get_live_jobs' in json.dumps(A):
        print(f"{t['name']}: already has the live-job clause, skipped"); continue
    before = len(json.dumps(A))
    apply_to(A, t['read'], t['after'])
    new = json.dumps(cd, ensure_ascii=True)
    print(f"{t['name']}: statecode {row['statecode']} modified {row['modifiedon']} actions-bytes {before}->{len(json.dumps(A))}")
    if MODE != 'apply':
        continue
    st, _ = call('PATCH', f'{ORG}/api/data/v9.2/workflows({wf})', json.dumps({'clientdata': new}, ensure_ascii=True).encode('ascii'))
    px = '<importexportxml><workflows><workflow>{' + wf + '}</workflow></workflows></importexportxml>'
    st2, _ = call('POST', f'{ORG}/api/data/v9.2/PublishXml', json.dumps({'ParameterXml': px}).encode('ascii'))
    st3, r2 = call('GET', f'{ORG}/api/data/v9.2/workflows({wf})?$select=clientdata,statecode,modifiedon')
    A2 = json.loads(r2['clientdata'])['properties']['definition']['actions']
    assert A2 == A, f"{t['name']}: published actions differ from what was built"
    print(f"  PATCH {st} PublishXml {st2} published: statecode {r2['statecode']} modified {r2['modifiedon']}")
print('dry run, nothing written' if MODE != 'apply' else 'done')
