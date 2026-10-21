r"""D2 - New Pool builds optional features as N/A unless picked, and stamps each row's structure (2026-10-21).

docs/specs/2026-10-21-projects-own-structure-design.md, part C.

- Select_features: the request's Features (';'-separated names), trimmed and lowercased.
- Compose_is_na, first in each sub-phase: the template row is Optional and its feature name
  (Feature, else the sub-phase title) is not among the picks.
- An N/A sub-phase takes no days: Condition_is_work_day never fires for it, so the span loop ends
  after one pass with no dates, the cursor stays where it was (Compose_cursor_next already keeps it
  when spanFinish is empty) and the next sub-phase starts where this one would have. It is never
  reported as short, and it keeps the template's DurationDays so turning it on later has a length.
- Create_assignment writes NotApplicable from Compose_is_na, and PhaseName, Skill, TemplateItemId and
  Feature (the feature name on optional rows, blank otherwise) so the planner lays the project out
  from its own rows. Tasks are still created for N/A rows, so turning a feature on needs no creates.
"""
from new_pool_escape_strings import esc, find, sub

IT = "items('Apply_to_each_subphase')"
IS_NA = "@and(equals(" + IT + "?['Optional'], true), not(contains(body('Select_features'), toLower(trim(coalesce(" \
        + IT + "?['Feature'], " + IT + "?['Title']))))))"
NOT_NA = {'not': {'equals': ["@outputs('Compose_is_na')", True]}}
DAYS_OLD = "@{if(less(variables('daysTaken'), int(" + IT + "?['DurationDays'])), variables('daysTaken'), " + IT + "?['DurationDays'])}"
DAYS_NEW = "@{if(or(equals(outputs('Compose_is_na'), true), not(less(variables('daysTaken'), int(" + IT \
           + "?['DurationDays'])))), " + IT + "?['DurationDays'], variables('daysTaken'))}"
FEATURE = "if(equals(" + IT + "?['Optional'], true), coalesce(" + IT + "?['Feature'], " + IT + "?['Title']), '')"
STRUCT = ('"PhaseName":"@{' + esc("coalesce(" + IT + "?['PhaseName'], '')") + '}",'
          '"Skill":"@{' + esc("coalesce(" + IT + "?['Skill'], '')") + '}",'
          '"TemplateItemId":@{' + IT + "?['ID']},"
          '"Feature":"@{' + esc(FEATURE) + '}",')


def apply(actions):
    loop = actions['Apply_to_each_subphase']
    if 'Compose_is_na' in loop['actions']:
        return actions
    assert loop['runAfter'] == {'Init_shortScheduledSubphase': ['Succeeded']}, loop['runAfter']
    actions['Select_features'] = {
        'runAfter': {'Init_shortScheduledSubphase': ['Succeeded']}, 'type': 'Select',
        'inputs': {'from': "@split(coalesce(triggerOutputs()?['body/Features'], ''), ';')",
                   'select': '@toLower(trim(item()))'}}
    loop['runAfter'] = {'Select_features': ['Succeeded']}

    acts = loop['actions']
    assert acts['Set_currentSubphase']['runAfter'] == {}
    acts['Compose_is_na'] = {'runAfter': {}, 'type': 'Compose', 'inputs': IS_NA}
    acts['Set_currentSubphase']['runAfter'] = {'Compose_is_na': ['Succeeded']}

    work = find(acts, 'Condition_is_work_day')
    old = work['expression']
    work['expression'] = {'and': (old['and'] if 'and' in old else [old]) + [NOT_NA]}

    short = acts['Condition_span_incomplete']
    short['expression'] = {'and': [NOT_NA, short['expression']]}

    p = acts['Create_assignment']['inputs']['parameters']
    b = p['parameters/body']
    b = sub(b, DAYS_OLD, DAYS_NEW)
    b = sub(b, '"NotApplicable":false', '"NotApplicable":@{if(equals(outputs(\'Compose_is_na\'), true), \'true\', \'false\')}')
    b = sub(b, '"Locked":false,', STRUCT + '"Locked":false,')
    p['parameters/body'] = b
    return actions
