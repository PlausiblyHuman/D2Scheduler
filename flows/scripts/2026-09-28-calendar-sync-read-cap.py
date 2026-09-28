"""Calendar Sync: page the two Assignments reads and guard orphan removal.
Edits the Dataverse workflow row's clientdata, then PublishXml. Token from az,
response bytes handled here (never through az rest), written with ensure_ascii."""
import json, subprocess, sys, urllib.request, urllib.error

ORG = 'https://org4ed2f722.crm.dynamics.com'
WF = 'f890f891-48ad-f111-aaab-6045bd0196b3'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'dry'

def token():
    return subprocess.check_output(
        'az account get-access-token --resource ' + ORG + '/ --query accessToken -o tsv',
        shell=True, text=True).strip()

def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=body)
    req.add_header('Authorization', 'Bearer ' + TOK)
    req.add_header('Accept', 'application/json')
    if body is not None:
        req.add_header('Content-Type', 'application/json; charset=utf-8')
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw.decode('utf-8')) if raw else None)
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.read().decode('utf-8', 'replace')[:1500])
        sys.exit(2)

TOK = token()
st, row = call('GET', f'{ORG}/api/data/v9.2/workflows({WF})?$select=clientdata,statecode,name,modifiedon')
print('row', row['name'], 'statecode', row['statecode'], 'modified', row['modifiedon'])
cd = json.loads(row['clientdata'])
A = cd['properties']['definition']['actions']

for n in ('Get_in_scope', 'Get_with_event'):
    assert A[n]['inputs']['parameters']['$top'] in (500, 5000), n
    A[n]['inputs']['parameters']['$top'] = 5000
    A[n].pop('runtimeConfiguration', None)   # licence caps paging at 5,000; $top 5000 is the whole read

send = json.loads(json.dumps(A['Condition_should_report']['actions']['Send_report']))
send['runAfter'] = {}
send['inputs']['parameters'] = {
    'emailMessage/To': 'stratirus@d2pools.com',
    'emailMessage/Subject': 'D2 Calendar Sync stopped before removing events',
    'emailMessage/Body': ('<div style="font-family:Segoe UI,sans-serif;font-size:14px;color:#1a2332">'
        '<h2 style="color:#082544;margin-bottom:4px">D2 Calendar Sync stopped</h2>'
        "<p>The full sweep read @{length(outputs('Get_in_scope')?['body/value'])} in-scope sub-phase(s) for "
        "@{length(outputs('Get_active_jobs')?['body/value'])} active job(s), against "
        "@{length(outputs('Get_with_event')?['body/value'])} row(s) carrying a calendar event. "
        'That read looks incomplete, so no events were removed and nothing was changed.</p>'
        '<p style="color:#666">Check the run in Power Automate. The next scheduled run will try again.</p></div>'),
    'emailMessage/Importance': 'High'}
A['Guard_in_scope_complete'] = {
    'runAfter': {'Select_in_scope_ids': ['Succeeded']},
    'type': 'If',
    'expression': {'and': [
        {'equals': ["@outputs('Compose_mode')", 'full']},
        {'greater': ["@length(outputs('Get_with_event')?['body/value'])", 0]},
        {'or': [
            {'and': [
                {'greater': ["@length(outputs('Get_active_jobs')?['body/value'])", 0]},
                {'equals': ["@length(outputs('Get_in_scope')?['body/value'])", 0]}]},
            {'greaterOrEquals': ["@length(outputs('Get_in_scope')?['body/value'])", 5000]}]}]},
    'actions': {
        'Send_guard_notice': send,
        'Terminate_guard': {
            'runAfter': {'Send_guard_notice': ['Succeeded', 'Failed']},
            'type': 'Terminate',
            'inputs': {'runStatus': 'Failed', 'runError': {
                'code': 'InScopeReadIncomplete',
                'message': 'Full sweep read an empty or capped in-scope set while events exist. '
                           'Stopped before removing any calendar events.'}}}},
    'else': {'actions': {}}}
assert A['Filter_orphans']['runAfter'] == {'Select_in_scope_ids': ['Succeeded']}
A['Filter_orphans']['runAfter'] = {'Guard_in_scope_complete': ['Succeeded']}

new_cd = json.dumps(cd, ensure_ascii=True)
print('actions', len(A), 'clientdata bytes', len(row['clientdata']), '->', len(new_cd))
if MODE != 'apply':
    print('dry run, nothing written'); sys.exit(0)

st, _ = call('PATCH', f'{ORG}/api/data/v9.2/workflows({WF})',
             json.dumps({'clientdata': new_cd}, ensure_ascii=True).encode('ascii'))
print('PATCH', st)
px = '<importexportxml><workflows><workflow>{' + WF + '}</workflow></workflows></importexportxml>'
st, _ = call('POST', f'{ORG}/api/data/v9.2/PublishXml',
             json.dumps({'ParameterXml': px}).encode('ascii'))
print('PublishXml', st)
st, row2 = call('GET', f'{ORG}/api/data/v9.2/workflows({WF})?$select=clientdata,statecode,modifiedon')
A2 = json.loads(row2['clientdata'])['properties']['definition']['actions']
print('readback statecode', row2['statecode'], 'modified', row2['modifiedon'],
      'guard' , 'Guard_in_scope_complete' in A2,
      'pag', A2['Get_in_scope'].get('runtimeConfiguration'), A2['Get_with_event'].get('runtimeConfiguration'),
      'filter_after', A2['Filter_orphans']['runAfter'])
