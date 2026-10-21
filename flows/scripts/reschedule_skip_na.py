r"""D2 - Reschedule Pool skips N/A sub-phases (2026-10-21).

docs/specs/2026-10-21-projects-own-structure-design.md, part C. The planner's reflowFrom has always
skipped N/A rows; this flow walked them, giving an unpicked optional feature dates and pushing every
later sub-phase back. Now:

- Condition_skip_row also skips a row with NotApplicable = true.
- Condition_is_pinned treats an N/A row as not pinned, so the pinned branch never reads a finish date
  an N/A row does not have; the cursor does not move for it.
- The skipped list names it "(not applicable)" rather than "(no duration)".
"""
from new_pool_escape_strings import find

NA = "equals(item()?['NotApplicable'], true)"
SKIP_OLD = "@or(equals(item()?['Locked'], true), equals(item()?['InstallerSignOff'], true), lessOrEquals(coalesce(item()?['DurationDays'], 0), 0))"
SKIP_NEW = "@or(equals(item()?['Locked'], true), equals(item()?['InstallerSignOff'], true), lessOrEquals(coalesce(item()?['DurationDays'], 0), 0), " + NA + ")"
PIN_OLD = "@or(equals(item()?['Locked'], true), equals(item()?['InstallerSignOff'], true))"
PIN_NEW = "@and(not(" + NA + "), or(equals(item()?['Locked'], true), equals(item()?['InstallerSignOff'], true)))"
LABEL_OLD = "item()?['Title'], ' (no duration)')"
LABEL_NEW = "item()?['Title'], if(" + NA + ", ' (not applicable)', ' (no duration)'))"


def apply(actions):
    skip = find(actions, 'Condition_skip_row')
    if skip['expression'] == {'equals': [SKIP_NEW, True]}:
        return actions
    assert skip['expression'] == {'equals': [SKIP_OLD, True]}, skip['expression']
    skip['expression'] = {'equals': [SKIP_NEW, True]}
    pin = skip['actions']['Condition_is_pinned']
    assert pin['expression'] == {'equals': [PIN_OLD, True]}, pin['expression']
    pin['expression'] = {'equals': [PIN_NEW, True]}
    lab = pin['else']['actions']['Compose_skipped_no_duration']
    assert lab['inputs'].count(LABEL_OLD) == 1, lab['inputs']
    lab['inputs'] = lab['inputs'].replace(LABEL_OLD, LABEL_NEW)
    return actions
