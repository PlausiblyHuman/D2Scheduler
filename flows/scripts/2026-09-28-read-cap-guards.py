"""Scale piece 1: read caps to 5,000 and a fail-before-write guard when a read comes back full.
The licence caps a connector read at 5,000 rows (InvalidPaginationPolicy above that), so a full
read means rows were probably cut off. The guard terminates Failed before anything is written.
Edits each Dataverse workflow row's clientdata, then PublishXml. Token from az, bytes handled here."""
import json, subprocess, sys, urllib.request, urllib.error

ORG = 'https://org4ed2f722.crm.dynamics.com'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'dry'
CAP = 5000

def token():
    return subprocess.check_output('az account get-access-token --resource ' + ORG + '/ --query accessToken -o tsv',
                                   shell=True, text=True).strip()
TOK = token()

def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=body)
    req.add_header('Authorization', 'Bearer ' + TOK); req.add_header('Accept', 'application/json')
    if body is not None: req.add_header('Content-Type', 'application/json; charset=utf-8')
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read(); return r.status, (json.loads(raw.decode('utf-8')) if raw else None)
    except urllib.error.HTTPError as e:
        print('  HTTP', e.code, e.read().decode('utf-8', 'replace')[:1200]); raise SystemExit(2)

def guard(name, after, reads, msg):
    cond = [{'greaterOrEquals': [f"@length(outputs('{r}')?['body/value'])", CAP]} for r in reads]
    return {'runAfter': {after: ['Succeeded']}, 'type': 'If',
            'expression': cond[0] if len(cond) == 1 else {'or': cond},
            'actions': {'Terminate_read_at_cap': {'runAfter': {}, 'type': 'Terminate', 'inputs': {
                'runStatus': 'Failed', 'runError': {'code': 'ReadAtCap', 'message': msg}}}},
            'else': {'actions': {}}}

def ctc(A):
    assert A['Get_assignments']['inputs']['parameters']['$top'] == 1000
    A['Get_assignments']['inputs']['parameters']['$top'] = CAP
    A['Guard_read_complete'] = guard('Guard_read_complete', 'Get_assignments', ['Get_assignments'],
        'Assignments read returned 5,000 rows, the most one read can return, so some rows were probably '
        'not read. Stopped before writing any TradeMismatch flag.')
    assert A['Init_qual']['runAfter'] == {'Get_assignments': ['Succeeded']}
    A['Init_qual']['runAfter'] = {'Guard_read_complete': ['Succeeded']}

def counters(A):
    for r in ('Get_all_tasks', 'Get_all_assignments'):
        assert A[r]['inputs']['parameters']['$top'] == CAP, r
    A['Guard_read_complete'] = guard('Guard_read_complete', 'Get_all_assignments', ['Get_all_tasks', 'Get_all_assignments'],
        'A Tasks or Assignments read returned 5,000 rows, the most one read can return. Counting from a partial '
        'read would write wrong TasksComplete and TasksTotal values, so no counter was written.')
    assert A['Init_repaired']['runAfter'] == {'Get_all_assignments': ['Succeeded']}
    A['Init_repaired']['runAfter'] = {'Guard_read_complete': ['Succeeded']}

def conflict(A):
    assert A['Get_assignments']['inputs']['parameters']['$top'] == CAP
    A['Guard_read_complete'] = guard('Guard_read_complete', 'Get_assignments', ['Get_assignments'],
        'Assignments read returned 5,000 rows, the most one read can return, so some rows were probably '
        'not read. Stopped before writing any ConflictWith flag.')
    assert A['For_each_crew']['runAfter'] == {'Get_assignments': ['Succeeded']}
    A['For_each_crew']['runAfter'] = {'Guard_read_complete': ['Succeeded']}

FLOWS = [('D2 - Crew Trade Check', 'a5f50628-eead-f111-aaac-6045bd0195dd', ctc),
         ('D2 - Counter Reconciliation', '291fa9d9-caaa-f111-aaac-6045bd0195dd', counters),
         ('D2 - Conflict Flag', 'f0dd9a1d-8bac-f111-aaab-002248043e80', conflict)]

for name, wf, fn in FLOWS:
    st, row = call('GET', f'{ORG}/api/data/v9.2/workflows({wf})?$select=clientdata,statecode,name,modifiedon')
    assert row['name'] == name, row['name']
    cd = json.loads(row['clientdata']); A = cd['properties']['definition']['actions']
    if 'Guard_read_complete' in A: print(name, 'already guarded, skipped'); continue
    before = len(A); fn(A)
    new = json.dumps(cd, ensure_ascii=True)
    print(f"{name}: statecode {row['statecode']} modified {row['modifiedon']} actions {before}->{len(A)} bytes {len(row['clientdata'])}->{len(new)}")
    if MODE != 'apply': continue
    call('PATCH', f'{ORG}/api/data/v9.2/workflows({wf})', json.dumps({'clientdata': new}, ensure_ascii=True).encode('ascii'))
    px = '<importexportxml><workflows><workflow>{' + wf + '}</workflow></workflows></importexportxml>'
    call('POST', f'{ORG}/api/data/v9.2/PublishXml', json.dumps({'ParameterXml': px}).encode('ascii'))
    st, r2 = call('GET', f'{ORG}/api/data/v9.2/workflows({wf})?$select=clientdata,statecode,modifiedon')
    A2 = json.loads(r2['clientdata'])['properties']['definition']['actions']
    tops = {k: v['inputs']['parameters'].get('$top') for k, v in A2.items()
            if v.get('type') == 'OpenApiConnection' and 'parameters' in v.get('inputs', {}) and '$top' in v['inputs']['parameters']}
    print(f"  published: statecode {r2['statecode']} modified {r2['modifiedon']} guard {'Guard_read_complete' in A2} tops {tops}")
print('dry run, nothing written' if MODE != 'apply' else 'done')
