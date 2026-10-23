r"""D2 - New Pool escapes the job number and its result messages (2026-10-23).

The 2026-10-13 change (new_pool_escape_strings.py) escaped Title, Address, City, SubPhaseName and
task titles, and left the job number and the four composed Result messages raw. Don types names into
the job number (`25-2038 Becky`, `25=2029 White Heart`), so both quote characters are realistic there:

- A double quote or a backslash broke the JSON body of Create_job and of the two refusal status
  writes. In a composed message (which carries the job number and the title) it broke the final
  status write, so a pool built in full would leave its request at Building. Those seven sites now
  take the same replace(replace(x, '\', '\\'), '"', '\"') wrap as the 10-13 change.
- A single quote ended the OData string in Get_existing_job and Get_earlier_request, so both
  duplicate guards failed and the run failed with them. OData escapes a quote by doubling it. In
  Workflow Definition Language a quote inside a single-quoted literal is also doubled, so '''' is one
  quote and '''''' is two, and the filters read replace(x, '''', '''''').
"""
from new_pool_escape_strings import esc, sub, find

JN = "triggerOutputs()?['body/JobNumber']"
SQ, SQ2 = "''''", "''''''"           # one quote, two quotes, as WDL literals


def odata(expr):
    return 'replace(' + expr + ', ' + SQ + ', ' + SQ2 + ')'


JSON_JOBNUMBER = ('Create_job', 'Set_status_failed_duplicate', 'Set_status_failed_concurrent')
RESULTS = {
    'Set_status_failed_provision': 'Compose_provision_failure_message',
    'Set_status_failed_span': 'Compose_short_scheduled_message',
    'Set_status_done': 'Compose_result',
    'Set_status_failed_partial': 'Compose_failure_message',
}
FILTERS = ('Get_existing_job', 'Get_earlier_request')


def params(actions, name):
    return find(actions, name)['inputs']['parameters']


def apply(actions):
    if '@{' + esc(JN) + '}' in params(actions, 'Create_job')['parameters/body']:
        return actions
    for n in JSON_JOBNUMBER:
        p = params(actions, n)
        p['parameters/body'] = sub(p['parameters/body'], '@{' + JN + '}', '@{' + esc(JN) + '}')
    for n, compose in RESULTS.items():
        p = params(actions, n)
        o = "outputs('" + compose + "')"
        p['parameters/body'] = sub(p['parameters/body'], '@{' + o + '}', '@{' + esc(o) + '}')
    for n in FILTERS:
        p = params(actions, n)
        p['$filter'] = sub(p['$filter'], "'@{" + JN + "}'", "'@{" + odata(JN) + "}'")
    return actions
