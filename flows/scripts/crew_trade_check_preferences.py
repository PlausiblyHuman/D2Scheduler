r"""D2 - Crew Trade Check honours ratings (2026-10-29).

docs/specs: skills and crew preferences. A rating of 0 means Never: a crew rated 0 for a trade
(Crew-Trades.Preference), or rated 0 overall (Crews.Preference), is not qualified for it.

- Init_never, a new top-level array variable (InitializeVariable may only sit at top level).
- Inside For_each_crew: Compose_overall_never, first; Filter_crew_trades now leaves Never rows out of
  qual; Filter_never_rows / Select_never_pairs / Compose_merged_never / Set_never collect them into
  never, keeping the crew-equality clause.
- Compose_text, inside For_each_assignment: pass when the pair is in qual, else a "rated Never"
  message when it is in never, else the existing "does not hold the required trade" text. The outer
  null-trade / null-crew guard is untouched (a null trade is a PASS by design).
- The connector leaves null fields out of its output, so every rating read goes through
  coalesce(..., 3).
"""
from new_pool_escape_strings import find

CREW = "items('For_each_crew')"
PREF = "coalesce(item()?['Preference'], 3)"
AS = "items('For_each_assignment')"
PAIR = "concat(string(item()?['Trade']?['Id']), ':', " + CREW + "?['CrewID'])"
HAS = "does not hold the required trade "


def ok(*names):
    return {n: ['Succeeded'] for n in names}


def apply(actions):
    if 'Init_never' in actions:
        return actions
    actions['Init_never'] = {'runAfter': ok('Init_cleared'), 'type': 'InitializeVariable',
                             'inputs': {'variables': [{'name': 'never', 'type': 'array', 'value': []}]}}
    actions['For_each_crew']['runAfter'] = ok('Init_never')
    acts = find(actions, 'For_each_crew')['actions']
    acts['Compose_overall_never'] = {'runAfter': {}, 'type': 'Compose',
                                     'inputs': "@equals(coalesce(" + CREW + "?['Preference'], 3), 0)"}
    f = acts['Filter_crew_trades']
    f['runAfter'] = ok('Compose_overall_never')
    f['inputs']['where'] = ("@and(equals(item()?['Crew']?['Id'], " + CREW + "?['ID']), "
                            "not(outputs('Compose_overall_never')), not(equals(" + PREF + ", 0)))")
    acts['Filter_never_rows'] = {'runAfter': ok('Set_qual'), 'type': 'Query', 'inputs': {
        'from': "@outputs('Get_crew_trades')?['body/value']",
        'where': ("@and(equals(item()?['Crew']?['Id'], " + CREW + "?['ID']), "
                  "or(equals(outputs('Compose_overall_never'), true), equals(" + PREF + ", 0)))")}}
    acts['Select_never_pairs'] = {'runAfter': ok('Filter_never_rows'), 'type': 'Select', 'inputs': {
        'from': "@body('Filter_never_rows')", 'select': "@" + PAIR}}
    acts['Compose_merged_never'] = {'runAfter': ok('Select_never_pairs'), 'type': 'Compose',
                                    'inputs': "@union(variables('never'), body('Select_never_pairs'))"}
    acts['Set_never'] = {'runAfter': ok('Compose_merged_never'), 'type': 'SetVariable',
                         'inputs': {'name': 'never', 'value': "@outputs('Compose_merged_never')"}}
    ct = find(actions, 'For_each_assignment')['actions']['Compose_text']
    old = "if(contains(variables('qual'), outputs('Compose_pair')),'',concat('Crew ', " + AS + "?['Crew']?['Value'],' " + HAS + "', " + AS + "?['Trade']?['Value'])))"
    assert old in ct['inputs'], ct['inputs']
    new = ("if(contains(variables('qual'), outputs('Compose_pair')),'',"
           "if(contains(variables('never'), outputs('Compose_pair')),"
           "concat('Crew ', " + AS + "?['Crew']?['Value'],' is rated Never for ', " + AS + "?['Trade']?['Value']),"
           "concat('Crew ', " + AS + "?['Crew']?['Value'],' " + HAS + "', " + AS + "?['Trade']?['Value']))))")
    ct['inputs'] = ct['inputs'].replace(old, new)
    return actions
