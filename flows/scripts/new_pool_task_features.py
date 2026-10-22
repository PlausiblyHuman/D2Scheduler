r"""D2 - New Pool marks a tagged task N/A when its feature is not picked (2026-10-22).

docs/specs/2026-10-22-step4-features-design.md, "D2 - New Pool".

- Compose_task_is_na, first in Apply_to_each_task: the Task Template row's Feature is non-blank and
  its trimmed, lowercased value is not among Select_features' picks (the same picks the sub-phase
  check uses).
- Create_task writes Feature (the template value, blank when untagged), NotApplicable from
  Compose_task_is_na, and Note only on an N/A task: "<Feature> not on this project", the automatic
  reason the planner recognises and is the only N/A note it will clear.
- Get_task_template is a connector GetItems with no $select, so Feature arrives once the column
  exists, but the connector leaves null fields out of its output; every read coalesces to ''.
"""
from new_pool_escape_strings import esc, find, sub

IT = "items('Apply_to_each_task')"
FEAT = "trim(coalesce(" + IT + "?['Feature'], ''))"
IS_NA = "@and(not(equals(" + FEAT + ", '')), not(contains(body('Select_features'), toLower(" + FEAT + "))))"
NA_TRUE = "equals(outputs('Compose_task_is_na'), true)"
REASON = "concat(" + FEAT + ", ' not on this project')"
TAIL = ('"Complete":false,'
        '"Feature":"@{' + esc(FEAT) + '}",'
        '"NotApplicable":@{if(' + NA_TRUE + ", 'true', 'false')}"
        '@{if(' + NA_TRUE + ", concat(',\"Note\":\"', " + esc(REASON) + ", '\"'), '')}}")


def apply(actions):
    loop = find(actions, 'Apply_to_each_task')
    acts = loop['actions']
    if 'Compose_task_is_na' in acts:
        return actions
    assert list(acts) == ['Create_task'] and acts['Create_task']['runAfter'] == {}, list(acts)
    acts['Compose_task_is_na'] = {'runAfter': {}, 'type': 'Compose', 'inputs': IS_NA}
    acts['Create_task']['runAfter'] = {'Compose_task_is_na': ['Succeeded']}
    p = acts['Create_task']['inputs']['parameters']
    p['parameters/body'] = sub(p['parameters/body'], '"Complete":false}', TAIL)
    return actions
