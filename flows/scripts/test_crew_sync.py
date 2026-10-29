"""Structural test for D2 - Crew Sync. Run: py -3 flows/scripts/test_crew_sync.py"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crew_sync  # noqa: E402

built = crew_sync.build()
d = built['definition']
dumped = json.dumps(d)

trig = d['triggers']['When_a_crew_is_added_or_changed']
assert trig['inputs']['parameters']['table'] == '45e9ff1f-bf36-4ab5-929d-25ab9a80d460'
assert trig['inputs']['host']['operationId'] == 'GetOnUpdatedItems'

a = d['actions']
for k in ['Get_crews', 'Select_codes', 'Filter_bad_codes', 'Get_crew_field', 'Compose_all_codes', 'Guard_codes',
          'Select_formula_terms', 'Compose_formula', 'Compose_message', 'Merge_crew_field',
          'Get_crew_field_after', 'Filter_missing_written', 'Guard_written']:
    assert k in a, k
p = a['Get_crews']['inputs']['parameters']
assert p['$top'] == 500 and '$filter' not in p

m = a['Merge_crew_field']['inputs']['parameters']
body = m['parameters/body']
assert '"type":"SP.FieldChoice"' in body and 'Collection(Edm.String)' in body
assert 'ValidationFormula' in body and 'ValidationMessage' in body
assert 'SchemaXml' not in dumped
assert m['parameters/headers']['X-HTTP-Method'] == 'MERGE'
assert m['parameters/method'] == 'POST'

# guards end the run Failed with no write
assert a['Guard_codes']['type'] == 'If' and 'Terminate_bad_codes' in a['Guard_codes']['actions']
assert a['Guard_codes']['actions']['Terminate_bad_codes']['inputs']['runStatus'] == 'Failed'
assert a['Guard_codes']['actions']['Terminate_bad_codes']['inputs']['runError']['code'] == 'BadCrewCodes'
assert a['Guard_written']['type'] == 'If' and 'Terminate_not_written' in a['Guard_written']['actions']
assert a['Guard_written']['actions']['Terminate_not_written']['inputs']['runError']['code'] == 'CrewFieldNotWritten'
for g, em in (('Guard_codes', 'Send_failure_email'), ('Guard_written', 'Send_failure_email_2')):
    e = a[g]['actions'][em]
    assert e['inputs']['host']['operationId'] == 'SendEmailV2'
    assert e['inputs']['parameters']['emailMessage/To'] == 'stratirus@d2pools.com'
    assert a[g]['actions'][{'Guard_codes': 'Terminate_bad_codes', 'Guard_written': 'Terminate_not_written'}[g]]['runAfter'] == {em: ['Succeeded']}
assert a['Guard_codes']['actions']['Send_failure_email']['inputs']['parameters']['emailMessage/Subject'] == 'D2 Crew Sync stopped: crew codes not written'

# the guard reads the bare (bracketless) form SharePoint stores in the read-back
assert 'Crew=\\"' in json.dumps(a['Filter_missing_written']), 'formula check'
assert 'Choices' in json.dumps(a['Filter_missing_written']) and 'ValidationFormula' in json.dumps(a['Filter_missing_written'])

# union rule: the sync never removes a code
assert a['Compose_all_codes']['inputs'] == "@union(coalesce(body('Get_crew_field')?['Choices'], json('[]')), body('Select_codes'))"
assert a['Compose_all_codes']['runAfter'] == {'Get_crew_field': ['Succeeded']}
assert a['Guard_codes']['runAfter'] == {'Compose_all_codes': ['Succeeded']}
assert "less(length(body('Select_codes')), length(" not in a['Guard_codes']['expression']
assert 'Filter_bad_codes' in a['Guard_codes']['expression'] and "less(length(body('Select_codes')), 1)" in a['Guard_codes']['expression']
ALL = "outputs('Compose_all_codes')"
assert ALL in a['Select_formula_terms']['inputs']['from']
assert ALL in a['Filter_missing_written']['inputs']['from']
assert ALL in a['Compose_message']['inputs']
assert "'results', " + ALL in body
assert 'InitializeVariable' not in dumped

# chain: each action runs after the one before
chain = ['Get_crews', 'Select_codes', 'Filter_bad_codes', 'Get_crew_field', 'Compose_all_codes', 'Guard_codes',
         'Select_formula_terms', 'Compose_formula', 'Compose_message', 'Merge_crew_field',
         'Get_crew_field_after', 'Filter_missing_written', 'Guard_written']
assert a[chain[0]]['runAfter'] == {}
for prev, cur in zip(chain, chain[1:]):
    assert a[cur]['runAfter'] == {prev: ['Succeeded']}, (cur, a[cur]['runAfter'])

# no Terminate inside a loop (there are no loops), InitializeVariable only at top level
def walk(o, in_loop=False):
    if isinstance(o, dict):
        t = o.get('type')
        if t == 'Terminate':
            assert not in_loop
        loop = in_loop or t in ('Foreach', 'Until')
        for v in o.values():
            walk(v, loop)
    elif isinstance(o, list):
        for v in o:
            walk(v, in_loop)
walk(d)
assert 'authentication' not in json.dumps(a)

# round trip, ascii only
s = json.dumps(built, ensure_ascii=True)
assert json.loads(s) == built
assert all(ord(c) < 128 for c in s)
refs = built['connectionReferences']
assert 'shared_sharepointonline' in refs and 'shared_office365' in refs
assert refs['shared_office365']['connectionReferenceLogicalName'] == 'new_sharedoffice365_4d59e'
assert refs['shared_sharepointonline']['connectionReferenceLogicalName'] == 'new_sharedsharepointonline_beb06'
print('ok test_crew_sync')
